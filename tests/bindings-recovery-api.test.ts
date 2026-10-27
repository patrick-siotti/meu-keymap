import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createApiHandler } from "../server.ts";
import { bindingsRecoveryFixture } from "./bindings-recovery-fixture.ts";
import { mapFingerprint } from "../native/configuration.ts";

test("recovery HTTP endpoints accept only typed prepare/token and maintain 409 gates, readable status and draft bytes", async () => {
  const f = await bindingsRecoveryFixture();
  const api = createApiHandler(f.store, f.device, { configuration: f.configuration, rgb: f.rgb, runtime: f.runtime, desktop: true });
  const server = createServer((req, res) => { void api(req, res); });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const call = (path: string, body: unknown, method = "POST", origin?: string) => fetch(base + path, { method,
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  let release: () => void = () => {};
  try {
    const route = "/api/application/recover-bindings/";
    assert.equal((await call(route + "prepare", f.input, "POST", "https://foreign.example")).status, 403);
    assert.equal((await call(route + "prepare", { ...f.input, packets: [] })).status, 400);
    assert.equal((await call(route + "apply", { token: "missing" })).status, 400);
    const response = await call(route + "prepare", f.input); assert.equal(response.status, 200);
    const preview = await response.json() as { token: string; operationId: string };
    assert.equal((await call(route + "apply", { ...preview })).status, 400);
    const envelope = await f.store.load(), source = await f.files.read("profiles.json");
    // This request passes the first route guard, then stalls before its JSON body.
    const slowResponse = new Promise<number>(done => {
      const slow = request(base + "/api/profiles", { method: "PUT", headers: { "Content-Type": "application/json" } }, result => { result.resume(); done(result.statusCode!); });
      slow.flushHeaders();
      release = () => slow.end(JSON.stringify({ revision: envelope.revision, document: envelope.document }));
    });
    let entered!: () => void, unblock!: () => void;
    const started = new Promise<void>(done => { entered = done; }), held = new Promise<void>(done => { unblock = done; });
    f.onWrite(async count => { if (count === 1) { entered(); await held; } });
    const apply = call(route + "apply", { token: preview.token }); await started;
    try {
      for (const [path, body, method] of [
        ["/api/profiles", { revision: envelope.revision, document: envelope.document }, "PUT"],
        ["/api/profiles/sync", { revision: envelope.revision, document: envelope.document, mode: "device" }, "PUT"],
        ["/api/application/prepare", { profile: f.profile, mode: "device" }, "POST"],
        ["/api/application/apply", { token: preview.token }, "POST"],
        ["/api/application/restore", { backup: f.input.incident.backup }, "POST"],
        ["/api/device/state/reconcile", { revision: 0 }, "POST"],
        ["/api/device/state/recover", {}, "POST"],
        ["/api/device/state/policy", { revision: 0, enabled: false }, "PUT"],
        ["/api/device/configuration/read", {}, "POST"],
        ["/api/device/rgb/read", {}, "POST"],
        ["/api/runtime/start", {}, "POST"],
        [route + "prepare", f.input, "POST"],
      ] as const) assert.equal((await call(path, body, method)).status, 409, path);
      release(); release = () => {}; assert.equal(await slowResponse, 409);
      await assert.rejects(f.store.save(envelope.document, envelope.revision), /manutenção/);
      await assert.rejects(api.state.policy((await api.state.store.load()).revision, false), /manutenção/);
      const status = await (await fetch(base + "/api/application/status")).json();
      assert.equal(status.busy, true); assert.equal(status.bindingsRecovery.operationId, preview.operationId);
      assert.equal(JSON.stringify(status).includes(preview.token), false);
      assert.equal((await call("/api/runtime/stop", {})).status, 200);
      assert.equal(await f.files.read("profiles.json"), source); assert.equal(f.counters().rgbCalls, 0);
    } finally { unblock(); }
    assert.equal((await apply).status, 200);
    const counts = f.counters(); assert.equal((await call(route + "apply", { token: preview.token })).status, 200); assert.deepEqual(f.counters(), counts);
    const status = await (await fetch(base + "/api/application/status")).json();
    assert.equal(status.bindingsRecovery.phase, "complete"); assert.equal(status.deployment.mode, "device"); assert.equal(status.runtime.active, false);
    assert.equal(status.hardware.matches, true); assert.equal(status.deviceState.policy.enabled, true);
    assert.equal(mapFingerprint(f.map()), "a6a7d7f2e06bbdc1d3903f4ad39b0cc0cc4c01a3da8ddf3081ff6999c6f8667f");
    // Maintenance is temporary. Saving a draft resumes after successful completion.
    assert.equal((await call("/api/profiles", { revision: envelope.revision, document: envelope.document }, "PUT")).status, 200);
  } finally {
    release(); await api.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await f.close();
  }
});
