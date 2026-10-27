import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileSchema, defaultDocument } from "../lib/model.ts";
import { rawConfigurationSchema, parseHardwareMap } from "../lib/hardware-map.ts";
import { compileProfile } from "../lib/bindings.ts";
import { profileStamp } from "../lib/profile-stamp.ts";
import type { DomainDelivery } from "../lib/device-state.ts";
import type { BindingsRecoveryInput } from "../lib/bindings-recovery.ts";
import { ConfigurationReader, mapFingerprint } from "../native/configuration.ts";
import { DeviceStateStore } from "../native/device-state.ts";
import { RgbService } from "../native/rgb.ts";
import { LocalRuntime } from "../native/runtime.ts";
import { ReconciliationService } from "../native/reconciliation.ts";
import { ApplicationService } from "../native/application.ts";
import { fileHash, recoveryFiles, valueHash } from "../native/recovery-files.ts";
import type { RecoveryFiles } from "../native/recovery-files.ts";
import { ProfileStore } from "../server.ts";

export async function bindingsRecoveryFixture() {
  const fixture: unknown = JSON.parse(await readFile(new URL("./fixtures/bindings-recovery.json", import.meta.url), "utf8"));
  assert.ok(fixture && typeof fixture === "object" && "baseline" in fixture && "original" in fixture && "profile" in fixture);
  const baseline = rawConfigurationSchema.parse(fixture.baseline), original = rawConfigurationSchema.parse(fixture.original), profile = profileSchema.parse(fixture.profile);
  const directory = await mkdtemp(join(tmpdir(), "keymap-binding-recovery-")), files = recoveryFiles(directory);
  let raw = structuredClone(baseline), reads = 0, starts = 0, executions = 0, rgbCalls = 0;
  const writes: string[] = [];
  let onRead: ((count: number) => Promise<void>) | null = null;
  let onWrite: ((count: number, packet: string) => Promise<void>) | null = null;
  let diskFault: ((operation: string, name: string, text?: string) => Promise<void>) | null = null;
  const injected: RecoveryFiles = {
    read: name => files.read(name),
    async write(name, text) { await diskFault?.("write", name, text); await files.write(name, text); await diskFault?.("wrote", name, text); },
    async archive(from, to) { await diskFault?.("archive", from); await files.archive(from, to); await diskFault?.("archived", from); },
    async append(name, text) { await diskFault?.("append", name, text); await files.append(name, text); await diskFault?.("appended", name, text); },
  };
  const configuration = new ConfigurationReader(directory, {
    async read() { reads++; await onRead?.(reads); return { ...structuredClone(raw), at: Date.now() }; },
    async write(packets, path) {
      assert.equal(path, raw.devicePath); assert.equal(packets.length, 1);
      for (const packet of packets) {
        writes.push(packet);
        const bytes = Buffer.from(packet.replace(/^03FD/, "03FA"), "hex"), slot = bytes[2]!, layer = bytes[3]!;
        const previous = Buffer.from(raw.layers[layer - 1]!.reports[slot - 1]!, "hex");
        if (bytes[4] === 2) for (const offset of [11, 14, 15, 17, 18, 20]) bytes[offset] = previous[offset]!;
        raw.layers[layer - 1]!.reports[slot - 1] = bytes.toString("hex").toUpperCase();
        await onWrite?.(writes.length, packet);
      }
    },
  });
  const device = { inventory: async () => ({ type: "inventory" as const, at: Date.now(), platform: "OFFLINE FIXTURE", devices: [{
    path: baseline.devicePath, kind: "hid" as const, product: "fixture", manufacturer: "fixture", usagePage: 0xff00, usage: 1, inputBytes: 65, outputBytes: 65, featureBytes: 0, version: 11,
  }] }), recent: () => [], subscribe: () => {}, observe: () => () => {} };
  const runtime = new LocalRuntime(device, { observe: () => () => {} }, {
    start: async () => { starts++; assert.fail("Recovery must not start a runtime"); },
    execute: async () => { executions++; assert.fail("Recovery must not execute input"); }, stop: () => {},
  });
  const rgb = new RgbService(directory, configuration, {
    read: async () => { rgbCalls++; assert.fail("Recovery must not read RGB"); }, write: async () => { rgbCalls++; assert.fail("Recovery must not write RGB"); },
  });
  const stateStore = new DeviceStateStore(directory, {
    read: path => readFile(path, "utf8"),
    async write(path, text) { await diskFault?.("state-write", "device-state.json", text); await writeFile(path, text, { flag: "wx", flush: true }); },
    async rename(from, to) { const text = await readFile(from, "utf8"); await diskFault?.("state-rename", "device-state.json", text); await rename(from, to); await diskFault?.("state-renamed", "device-state.json", text); },
  });
  const state = new ReconciliationService(directory, configuration, rgb, device, runtime, stateStore);
  const store = new ProfileStore(directory), application = new ApplicationService(directory, configuration, runtime);
  application.setDeviceState(state); application.configureRecovery(store, injected);
  const document = defaultDocument(); document.profiles = [profile]; document.activeProfile = profile.id;
  await files.write("profiles.json", JSON.stringify({ revision: 12, document }, null, 2));
  await files.write("deployment.json", JSON.stringify({ version: 1, mode: "local", profile, fingerprint: mapFingerprint(parseHardwareMap(original)), backup: "read-old-local.json", appliedAt: 1, restored: false }));
  await configuration.read();
  const backup = "read-synthetic-original.json", backupText = JSON.stringify(original, null, 2);
  await mkdir(join(directory, "hardware-backups"), { recursive: true }); await writeFile(join(directory, "hardware-backups", backup), backupText);
  const reason = "Bindings: synthetic six media retention incident", at = Date.now();
  const flag = JSON.stringify({ at, reason, backups: [backup] }, null, 2), ledger = JSON.stringify({ at, pending: true, reason, backups: [backup] }) + "\n";
  await files.write("device-recovery.json", flag); await files.write("device-recovery-ledger.jsonl", ledger);
  await files.write("rgb-latest.json", "historical RGB, untouched"); await files.write("calibration.json", "calibration, untouched");
  const stamp = await profileStamp(profile);
  const delivery: DomainDelivery = { desiredRevision: 31, generation: 0, attempt: "old-partial", startedAt: at, finishedAt: at,
    status: "partial", sent: true, confirmedByRead: false, error: reason, lastConfirmation: null };
  await state.store.update(undefined, current => ({ ...current, policy: { enabled: false },
    desired: { revision: 31, hash: valueHash(profile), profile, profileHash: stamp, mode: "device", identity: current.observed!.identity, bindings: compileProfile(profile, "device").packets, rgb: null, chosenAt: at },
    recovery: { at, reason, backups: [], identity: current.observed!.identity },
    delivery: { bindings: delivery, rgb: { ...delivery, attempt: "old-RGB-confirmed", status: "confirmed", confirmedByRead: true, error: "", lastConfirmation: { desiredRevision: 30, generation: 0, at, fingerprint: "a".repeat(64) } } },
  }));
  const current = await state.store.load();
  const input: BindingsRecoveryInput = { profileId: profile.id, revision: 12, profileStamp: stamp, fingerprint: mapFingerprint(parseHardwareMap(baseline)),
    incident: { flagHash: fileHash(flag), ledgerHash: fileHash(ledger), recoveryHash: valueHash(current.recovery), backup, backupHash: fileHash(backupText) } };
  return { directory, files, injected, configuration, state, store, application, device, runtime, rgb, input, original, baseline, profile, writes,
    map: () => parseHardwareMap(raw), counters: () => ({ reads, writes: writes.length, starts, executions, rgbCalls }),
    mutate: (change: (value: typeof raw) => void) => change(raw), reset: () => { raw = structuredClone(baseline); },
    onRead: (handler: typeof onRead) => { onRead = handler; }, onWrite: (handler: typeof onWrite) => { onWrite = handler; },
    diskFault: (handler: typeof diskFault) => { diskFault = handler; },
    close: () => state.close(),
  };
}
