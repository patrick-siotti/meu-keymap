import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bindingsRecoveryFixture } from "./bindings-recovery-fixture.ts";
import { bindingsRecoveryJournalSchema, exactBindings, recoveryPlan } from "../lib/bindings-recovery.ts";
import { parseHardwareMap } from "../lib/hardware-map.ts";
import { mapFingerprint } from "../native/configuration.ts";
import { UsbCoordinator } from "../native/usb-coordinator.ts";
import { fileHash, valueHash } from "../native/recovery-files.ts";
import { ApplicationService } from "../native/application.ts";

const targetFingerprint = "a6a7d7f2e06bbdc1d3903f4ad39b0cc0cc4c01a3da8ddf3081ff6999c6f8667f";
test("recovery replays the real 69/6 retention case, stages 12 exact maps, commits device and is idempotent", async () => {
  const f = await bindingsRecoveryFixture();
  try {
    assert.equal(mapFingerprint(f.map()), "de6e1456ac3bd8a1485cc071a0c6c947c3f9c7d80c80be992202a84587e737c2");
    const before = await f.state.store.load(), profiles = await f.files.read("profiles.json"), flag = await f.files.read("device-recovery.json");
    const preview = await f.application.prepareBindingsRecovery(f.input);
    assert.equal(preview.steps.length, 12); assert.equal(preview.targetFingerprint, targetFingerprint);
    assert.deepEqual(preview.steps.map(step => [step.slot, step.kind]), [25, 20, 21, 22, 23, 24].flatMap(slot => [[slot, "null"], [slot, "media"]]));
    const first = f.application.applyBindingsRecovery(preview.token), duplicate = f.application.applyBindingsRecovery(preview.token);
    assert.equal(first, duplicate); await first;
    assert.equal(mapFingerprint(f.map()), targetFingerprint); assert.equal(f.writes.length, 12);
    assert.ok(f.writes.every(packet => packet.startsWith("03FD") && packet.slice(6, 8) === "01" && parseInt(packet.slice(4, 6), 16) >= 20));
    const journal = bindingsRecoveryJournalSchema.parse(JSON.parse((await f.files.read("bindings-recovery.json"))!));
    assert.equal(journal.phase, "complete"); assert.equal(journal.confirmed, 12);
    assert.equal(journal.observations.length, 15); // prepare, apply, 12 steps, independent final
    assert.equal(journal.beforeState.delivery.bindings!.attempt, "old-partial");
    assert.equal((await f.files.read("profiles.json")), profiles);
    assert.equal(await f.files.read(`device-recovery.json.resolved-${preview.operationId}`), flag);
    assert.equal(await f.files.read("device-recovery.json"), null);
    const state = await f.state.store.load(), deployment = JSON.parse((await f.files.read("deployment.json"))!);
    assert.deepEqual(state.desired, before.desired); assert.deepEqual(state.delivery.rgb, before.delivery.rgb);
    assert.equal(state.recovery, null); assert.equal(state.policy.enabled, true);
    assert.equal(state.delivery.bindings!.attempt, preview.operationId); assert.equal(state.delivery.bindings!.confirmedByRead, true);
    assert.equal(state.delivery.bindings!.lastConfirmation!.fingerprint, targetFingerprint);
    assert.equal(deployment.mode, "device"); assert.equal(deployment.restored, false); assert.equal(deployment.backup, f.input.incident.backup);
    assert.equal(await f.files.read("rgb-latest.json"), "historical RGB, untouched");
    assert.equal(await f.files.read("calibration.json"), "calibration, untouched");
    assert.equal(await f.configuration.usb.recovery(), null);
    const counts = f.counters(); await f.application.applyBindingsRecovery(preview.token); assert.deepEqual(f.counters(), counts);
    const status = await f.application.status(); assert.equal(status.bindingsRecovery!.phase, "complete"); assert.equal(JSON.stringify(status).includes(preview.token), false);
    assert.equal(status.runtime.active, false); assert.equal(status.runtime.pending, 0);
    assert.deepEqual({ starts: counts.starts, executions: counts.executions, rgbCalls: counts.rgbCalls }, { starts: 0, executions: 0, rgbCalls: 0 });
  } finally { await f.close(); }
});

test("recovery rejects retained NULL, contaminated media, unrelated changes, identity/generation and transport/read errors without rollback", async t => {
  for (const failure of ["null-tail", "media-tail", "unrelated", "identity", "generation", "partial-timeout", "read-timeout"] as const) await t.test(failure, async () => {
    const f = await bindingsRecoveryFixture();
    try {
      const preview = await f.application.prepareBindingsRecovery(f.input), flag = await f.files.read("device-recovery.json");
      f.onWrite(async (count) => {
        if (failure === "media-tail" && count === 2 || failure === "null-tail" && count === 1) f.mutate(raw => {
          const bytes = Buffer.from(raw.layers[0]!.reports[24]!, "hex"); bytes[18] = 0x6e; raw.layers[0]!.reports[24] = bytes.toString("hex").toUpperCase();
        });
        if (count !== 1) return;
        if (failure === "unrelated") f.mutate(raw => { raw.layers[1]!.reports[0] = raw.layers[1]!.reports[0]!.slice(0, 18) + "7F" + raw.layers[1]!.reports[0]!.slice(20); });
        if (failure === "identity") f.mutate(raw => { raw.devicePath = "foreign-fixture-path"; });
        if (failure === "generation") f.configuration.usb.invalidate();
        if (failure === "partial-timeout") throw new Error("synthetic timeout after physical update");
        if (failure === "read-timeout") f.onRead(async () => { throw new Error("synthetic read timeout"); });
      });
      await assert.rejects(f.application.applyBindingsRecovery(preview.token));
      assert.equal(f.writes.length, failure === "media-tail" ? 2 : 1);
      assert.equal(await f.files.read("device-recovery.json"), flag);
      assert.equal((await f.state.store.load()).policy.enabled, false);
      assert.ok(await f.configuration.usb.recovery());
      const count = f.writes.length; await assert.rejects(f.application.applyBindingsRecovery(preview.token)); assert.equal(f.writes.length, count);
      assert.equal(f.counters().rgbCalls, 0); assert.equal(f.counters().starts, 0); assert.equal(f.counters().executions, 0);
    } finally { await f.close(); }
  });
});

test("recovery CAS rejects profile, desired, policy, deployment, flag and backup changes before sending", async t => {
  for (const field of ["profile", "desired", "policy", "deployment", "flag", "backup"] as const) await t.test(field, async () => {
    const f = await bindingsRecoveryFixture();
    try {
      const preview = await f.application.prepareBindingsRecovery(f.input);
      if (field === "profile") { const envelope = await f.store.load(); envelope.document.profiles[0]!.name += " edited"; await f.store.save(envelope.document, envelope.revision); }
      if (field === "desired") await f.state.store.update(undefined, state => ({ ...state, desired: { ...state.desired!, revision: 32 } }));
      if (field === "policy") await f.state.store.update(undefined, state => ({ ...state, policy: { enabled: true } }));
      if (field === "deployment") await f.files.write("deployment.json", "null");
      if (field === "flag") await f.files.write("device-recovery.json", "another incident");
      if (field === "backup") await writeFile(join(f.directory, "hardware-backups", f.input.incident.backup), "changed");
      const after = await f.state.store.load(), deployment = await f.files.read("deployment.json");
      await assert.rejects(f.application.applyBindingsRecovery(preview.token)); assert.equal(f.writes.length, 0);
      const result = await f.state.store.load(); assert.deepEqual(result.desired, after.desired); assert.deepEqual(result.policy, after.policy);
      assert.equal(await f.files.read("deployment.json"), deployment);
    } finally { await f.close(); }
  });
});

test("tokens expire, pending RGB/application incidents and unknown maps cannot enter recovery", async t => {
  for (const kind of ["expired", "rgb-flag", "application-flag", "rgb-delivery", "unknown-map"] as const) await t.test(kind, async () => {
    const f = await bindingsRecoveryFixture();
    try {
      if (kind === "expired") {
        const preview = await f.application.prepareBindingsRecovery(f.input);
        const journal = JSON.parse((await f.files.read("bindings-recovery.json"))!); journal.expiresAt = 1;
        await f.files.write("bindings-recovery.json", JSON.stringify(journal)); await assert.rejects(f.application.applyBindingsRecovery(preview.token));
      } else {
        if (kind === "rgb-flag" || kind === "application-flag") await f.files.write(kind === "rgb-flag" ? "rgb-recovery.json" : "application-recovery.json", "unrelated incident");
        if (kind === "rgb-delivery") await f.state.store.update(undefined, state => ({ ...state, delivery: { ...state.delivery, rgb: { ...state.delivery.rgb!, confirmedByRead: false, status: "partial" } } }));
        if (kind === "unknown-map") { f.mutate(raw => { raw.layers[2]!.reports[0] = raw.layers[2]!.reports[0]!.slice(0, 22) + "45" + raw.layers[2]!.reports[0]!.slice(24); }); f.input.fingerprint = mapFingerprint(f.map()); }
        await assert.rejects(f.application.prepareBindingsRecovery(f.input));
      }
      assert.equal(f.writes.length, 0); assert.equal(f.counters().rgbCalls, 0); assert.equal(f.counters().starts, 0);
    } finally { await f.close(); }
  });
});

test("disk failures at every commit boundary retain a startup gate and explicitly resume without resending confirmed stages", async t => {
  for (const boundary of ["intent", "deployment", "state-write", "state-rename", "state-renamed", "evidence", "archive", "archived", "append", "appended", "completion"] as const) await t.test(boundary, async () => {
    const f = await bindingsRecoveryFixture();
    try {
      const preview = await f.application.prepareBindingsRecovery(f.input); let failed = false;
      f.diskFault(async (operation, name, text) => {
        const parsed = text ? JSON.parse(text) : null;
        const confirmedState = name === "device-state.json" && parsed?.policy.enabled === true && parsed?.recovery === null;
        const trigger = boundary === "intent" ? operation === "write" && name === "bindings-recovery.json" && parsed?.phase === "running"
          : boundary === "deployment" ? operation === "write" && name === "deployment.json"
          : boundary.startsWith("state-") ? operation === boundary && confirmedState
          : boundary === "evidence" ? operation === "write" && name.startsWith("bindings-recovery-result-")
          : boundary === "completion" ? operation === "write" && name === "bindings-recovery.json" && parsed?.phase === "complete"
          : operation === boundary;
        if (!failed && trigger) { failed = true; throw new Error("synthetic disk failure at " + boundary); }
      });
      await assert.rejects(f.application.applyBindingsRecovery(preview.token)); assert.equal(failed, true);
      const writes = f.writes.length; assert.equal(writes, boundary === "intent" ? 0 : 12);
      const restart = new UsbCoordinator(f.directory);
      try { assert.ok(await restart.recovery()); await assert.rejects(restart.assertWritable()); } finally { await restart.close(); }
      f.diskFault(null);
      const resumed = await f.application.prepareBindingsRecovery({ ...f.input, fingerprint: mapFingerprint(f.map()), operationId: preview.operationId });
      assert.equal(resumed.operationId, preview.operationId);
      await f.application.applyBindingsRecovery(resumed.token);
      assert.equal(f.writes.length, 12); assert.equal(mapFingerprint(f.map()), targetFingerprint);
      assert.equal(await f.configuration.usb.recovery(), null); assert.equal(f.counters().rgbCalls, 0); assert.equal(f.counters().starts, 0);
    } finally { await f.close(); }
  });
});

test("an acknowledged-loss stage resumes from its exact boundary and unexpected bytes refuse resume", async t => {
  for (const unknown of [false, true]) await t.test(String(unknown), async () => {
    const f = await bindingsRecoveryFixture();
    try {
      const preview = await f.application.prepareBindingsRecovery(f.input);
      f.onWrite(async count => { if (count === 1) throw new Error("lost acknowledgement"); });
      await assert.rejects(f.application.applyBindingsRecovery(preview.token)); f.onWrite(null);
      if (unknown) f.mutate(raw => { const bytes = Buffer.from(raw.layers[0]!.reports[24]!, "hex"); bytes[48] = 0x7f; raw.layers[0]!.reports[24] = bytes.toString("hex").toUpperCase(); });
      const prepare = f.application.prepareBindingsRecovery({ ...f.input, operationId: preview.operationId, fingerprint: mapFingerprint(f.map()) });
      if (unknown) { await assert.rejects(prepare); assert.equal(f.writes.length, 1); }
      else { const resumed = await prepare; assert.equal(resumed.confirmedSteps, 1); await f.application.applyBindingsRecovery(resumed.token); assert.equal(f.writes.length, 12); }
    } finally { await f.close(); }
  });
});

test("a policy change during a stage stops the next send and remains preserved", async () => {
  const f = await bindingsRecoveryFixture();
  try {
    const preview = await f.application.prepareBindingsRecovery(f.input);
    f.onWrite(async count => { if (count === 1) await f.state.store.update(undefined, state => ({ ...state, policy: { enabled: true } })); });
    await assert.rejects(f.application.applyBindingsRecovery(preview.token)); assert.equal(f.writes.length, 1);
    assert.equal((await f.state.store.load()).policy.enabled, true); assert.ok(await f.configuration.usb.recovery());
  } finally { await f.close(); }
});

test("interrupted intent blocks automatic startup even after a terminal ledger, then resumes explicitly in the new generation", async () => {
  const f = await bindingsRecoveryFixture();
  try {
    const preview = await f.application.prepareBindingsRecovery(f.input);
    f.diskFault(async (operation, name, text) => {
      if (operation === "write" && name === "bindings-recovery.json" && ["complete","failed"].includes(JSON.parse(text!).phase)) {
        throw new Error("power loss before durable completion, including failure logging");
      }
    });
    await assert.rejects(f.application.applyBindingsRecovery(preview.token)); f.diskFault(null);
    assert.equal(JSON.parse((await f.files.read("bindings-recovery.json"))!).phase,"committing");
    assert.equal(JSON.parse((await f.files.read("device-recovery-ledger.jsonl"))!.trim().split("\n").at(-1)!).pending, false);
    const count = f.writes.length;
    f.state.start(); await new Promise<void>(done => setImmediate(done)); await f.state.idle();
    assert.equal(f.writes.length, count); assert.equal(f.counters().starts, 0);
    assert.equal((await f.state.snapshot()).session.phase, "recovery-required");
    const resumed = await f.application.prepareBindingsRecovery({ ...f.input, operationId: preview.operationId, fingerprint: mapFingerprint(f.map()) });
    await f.application.applyBindingsRecovery(resumed.token); assert.equal(f.writes.length, count);
    assert.equal(await f.configuration.usb.recovery(), null); assert.equal((await f.state.snapshot()).session.phase, "ready");
    assert.equal((await f.state.store.load()).delivery.bindings!.generation, f.configuration.usb.currentGeneration());
  } finally { await f.close(); }
});

test("independent final read rejects a late byte mutation before deployment or gate completion", async () => {
  const f=await bindingsRecoveryFixture();
  try{
    const preview=await f.application.prepareBindingsRecovery(f.input),deployment=await f.files.read("deployment.json");
    let readsAfterLastSend=0;
    f.onRead(async()=>{
      if(f.writes.length===12&&++readsAfterLastSend===2)f.mutate(raw=>{
        const bytes=Buffer.from(raw.layers[2]!.reports[24]!,"hex");bytes[52]=0x71;raw.layers[2]!.reports[24]=bytes.toString("hex").toUpperCase();
      });
    });
    await assert.rejects(f.application.applyBindingsRecovery(preview.token),/final divergiu/);
    assert.equal(f.writes.length,12);assert.equal(await f.files.read("deployment.json"),deployment);
    assert.ok(await f.files.read("device-recovery.json"));assert.equal((await f.state.store.load()).policy.enabled,false);
    assert.equal(f.counters().rgbCalls,0);assert.equal(f.counters().starts,0);
  }finally{await f.close();}
});

test("a persisted read failure adopts only the known NULL boundary; late domain flags are preserved", async t => {
  for (const kind of ["read-state-write", "rgb", "application"] as const) await t.test(kind, async () => {
    const f = await bindingsRecoveryFixture();
    try {
      const preview = await f.application.prepareBindingsRecovery(f.input); let failed = false;
      if (kind === "read-state-write") f.diskFault(async (operation, name, text) => {
        if (!failed && operation === "state-write" && name === "device-state.json" && JSON.parse(text!).observed.bindings.fingerprint === preview.steps[0]!.fingerprint) {
          failed = true; throw new Error("read-state disk full");
        }
      });
      else f.onWrite(async count => { if (count === 1) await f.files.write(`${kind}-recovery.json`, "independent late incident"); });
      await assert.rejects(f.application.applyBindingsRecovery(preview.token)); assert.equal(f.writes.length, 1);
      if (kind === "read-state-write") {
        f.diskFault(null);
        const resumed = await f.application.prepareBindingsRecovery({ ...f.input, operationId: preview.operationId, fingerprint: mapFingerprint(f.map()) });
        assert.equal(resumed.confirmedSteps, 1); await f.application.applyBindingsRecovery(resumed.token); assert.equal(f.writes.length, 12);
      } else {
        assert.equal(await f.files.read(`${kind}-recovery.json`), "independent late incident");
        assert.ok(await f.files.read("device-recovery.json"));
        await assert.rejects(f.application.prepareBindingsRecovery({ ...f.input, operationId: preview.operationId, fingerprint: mapFingerprint(f.map()) }));
        assert.equal(f.writes.length, 1);
      }
    } finally { await f.close(); }
  });
});

test("the pure admission rule rejects corruption rather than accepting decoded media or a forged journal", async () => {
  const f = await bindingsRecoveryFixture();
  try {
    const before = parseHardwareMap(f.baseline), original = parseHardwareMap(f.original), plan = recoveryPlan(f.profile, before, original);
    assert.equal(before.entries.filter((entry, index) => entry.raw === plan.target.entries[index]!.raw).length, 69);
    assert.equal(exactBindings(before, plan.target), false);
    const preview = await f.application.prepareBindingsRecovery(f.input);
    const journal = JSON.parse((await f.files.read("bindings-recovery.json"))!);
    journal.steps[0].packet = journal.steps[1].packet;
    await f.files.write("bindings-recovery.json", JSON.stringify(journal)); await assert.rejects(f.application.applyBindingsRecovery(preview.token));
    assert.equal(f.writes.length, 0);
    assert.equal(fileHash(await readFile(join(f.directory, "hardware-backups", f.input.incident.backup), "utf8")), f.input.incident.backupHash);
    assert.equal(valueHash((await f.state.store.load()).recovery), f.input.incident.recoveryHash);
  } finally { await f.close(); }
});

test("a prepared token is bound to its service session and USB generation; active/pending runtime prevents entry", async t => {
  for (const kind of ["session", "generation", "active", "pending"] as const) await t.test(kind, async () => {
    const f = await bindingsRecoveryFixture();
    try {
      const preview = await f.application.prepareBindingsRecovery(f.input);
      if(kind==="session"){
        const restarted = new ApplicationService(f.directory,f.configuration,f.runtime);restarted.setDeviceState(f.state);restarted.configureRecovery(f.store);
        await assert.rejects(restarted.applyBindingsRecovery(preview.token),/sessão/);
      }else if(kind==="generation"){
        f.configuration.usb.invalidate();await assert.rejects(f.application.applyBindingsRecovery(preview.token),/geração/);
      }else{
        const snapshot=f.runtime.status();f.runtime.status=()=>({...snapshot,active:kind==="active",pending:kind==="pending"?1:0});
        assert.throws(()=>f.application.prepareBindingsRecovery(f.input),/motor/);
        await assert.rejects(f.application.applyBindingsRecovery(preview.token),/motor/);
      }
      assert.equal(f.writes.length,0);assert.equal(f.counters().starts,0);assert.ok(await f.files.read("device-recovery.json"));
    }finally{await f.close();}
  });
});

test("prepare releases the USB ownership and profile maintenance while the token waits", async () => {
  const f=await bindingsRecoveryFixture();
  try{
    const preview=await f.application.prepareBindingsRecovery(f.input),other=new UsbCoordinator(f.directory);
    try{await other.run(async()=>{});}finally{await other.close();}
    const envelope=await f.store.load();await f.store.save(envelope.document,envelope.revision);
    assert.equal(f.application.recoveryActive,false);assert.equal(f.writes.length,0);
    await assert.rejects(f.application.applyBindingsRecovery(preview.token),/Perfis mudaram/);assert.equal(f.writes.length,0);
  }finally{await f.close();}
});
