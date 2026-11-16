import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopControl } from "../native/desktop-control.ts";
import { createApiHandler, ProfileStore } from "../server.ts";
import { reconciliationFixture } from "./reconciliation-fixture.ts";
import { makeProfile } from "../lib/model.ts";
import { BrowserSession } from "../native/browser-session.ts";
import { bindingPacket, markerKeys } from "../lib/bindings.ts";

const listen = async (server: Server) => {
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return address.port;
};
test("desktop control denies browser origins, wrong token/host and unsupported methods; shutdown is single-use", async () => {
  const directory = await mkdtemp(join(tmpdir(), "keymap-desktop-control-"));
  let control: DesktopControl; let stopped = 0;
  const server = createServer((req, res) => { control.handle(req, res, async () => ({ active: false }), async () => { stopped++; }); });
  const port = await listen(server), token = "ab".repeat(32);
  control = new DesktopControl({ app: "meu-keymap", version: 1, instance: "own", root: directory, dataDirectory: directory, port,
    pid: process.pid, birth: "synthetic", mode: "desktop" }, directory, token);
  await control.publish();
  const base = `http://127.0.0.1:${port}/api/desktop/`;
  try {
    assert.equal((await fetch(base + "status")).status, 403);
    assert.equal((await fetch(base + "shutdown", { method: "POST", headers: { "x-keymap-desktop-token": "cd".repeat(32) } })).status, 403);
    for (const origin of ["https://example.com", `http://127.0.0.1:${port}`, "null"]) {
      assert.equal((await fetch(base + "shutdown", { method: "POST", headers: { "x-keymap-desktop-token": token, Origin: origin } })).status, 403);
    }
    const foreignHost = await new Promise<number>(done => {
      const call = request(base + "status", { headers: { Host: `localhost:${port}`, "x-keymap-desktop-token": token } }, res => { res.resume(); done(res.statusCode!); }); call.end();
    });
    assert.equal(foreignHost, 403);
    const headers = { "x-keymap-desktop-token": token };
    const status = await (await fetch(base + "status", { headers })).json();
    assert.equal(status.status.active, false); assert.equal("token" in status, false);
    assert.equal((await fetch(base + "shutdown", { headers })).status, 404);
    assert.equal((await fetch(base + "shutdown", { headers, method: "POST" })).status, 202);
    assert.equal((await fetch(base + "shutdown", { headers, method: "POST" })).status, 409);
    await new Promise(done => setImmediate(done)); assert.equal(stopped, 1);
    await writeFile(join(directory, `server-${port}.json`), JSON.stringify({ instance: "replacement" }));
    await control.remove();
    assert.equal(JSON.parse(await readFile(join(directory, `server-${port}.json`), "utf8")).instance, "replacement");
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});

test("API close is awaited and idempotent, rejects new work and stops the synthetic runtime", async () => {
  const fixture = await reconciliationFixture();
  const api = createApiHandler(new ProfileStore(fixture.directory), fixture.device, { configuration: fixture.configuration, rgb: fixture.rgb, runtime: fixture.runtime, desktop: true });
  const server = createServer((req, res) => { void api(req, res); }); const port = await listen(server);
  try {
    assert.equal(api.canShutdownWithoutTabs(), true);
    await fixture.runtime.start(makeProfile("lifecycle-qa", "Lifecycle sintético"));
    assert.equal(fixture.runtime.status().active, true);
    assert.equal(api.canShutdownWithoutTabs(), false);
    await Promise.all([api.close(), api.close()]);
    assert.equal(fixture.runtime.status().active, false); assert.equal(fixture.runtime.status().pending, 0);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/runtime/start`, { method: "POST" })).status, 503);
    assert.equal(fixture.performed.length, 0);
  } finally { await api.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});

test("login waits for the verified macropad, starts the applied profile and never replays entry actions", async () => {
  const f = await reconciliationFixture();
  const control = f.profile.layers[0]!.controls[0]!;
  control.rules.find(rule => rule.trigger === "activate")!.behavior.action = { kind: "text", value: "entrada" };
  control.rules.find(rule => rule.trigger === "press")!.behavior.action = { kind: "text", value: "toque" };
  const preview = await f.application.prepare(f.profile, "local");
  await f.application.apply(preview.token!);
  f.application.stop();
  f.performed.length = 0;
  const writes = f.counters().writes;
  const api = createApiHandler(new ProfileStore(f.directory), f.device, {
    configuration: f.configuration, rgb: f.rgb, runtime: f.runtime, desktop: true, background: true,
  });
  const server = createServer((req, res) => { void api(req, res); });
  const port = await listen(server);
  try {
    f.setConnected(false);
    api.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.runtime.status().active, false);
    assert.equal(api.canShutdownWithoutTabs(), false);
    const original = f.raw.layers[0]!.reports[0]!;
    f.raw.layers[0]!.reports[0] = bindingPacket(1, 1, { kind: "none" }).replace(/^03FD/, "03FA");
    f.setConnected(true);
    await api.state.idle();
    assert.equal(f.runtime.status().active, false);
    assert.equal(f.counters().writes, writes);
    f.setConnected(false);
    f.raw.layers[0]!.reports[0] = original;
    f.setConnected(true);
    await api.state.idle();
    assert.equal(f.runtime.status().active, true);
    assert.deepEqual(f.performed, []);
    assert.equal(f.counters().writes, writes);
    for (const code of markerKeys(0)) {
      for (const released of [false, true])
        f.emit({ type: "input", at: Date.now(), devicePath: f.inventory().devices[0]!.path,
          kind: "keyboard", data: { vkey: code + 20, released, modifiers: 0 } });
    }
    assert.deepEqual(f.performed, [{ kind: "text", value: "toque" }]);
    const stop = await fetch(`http://127.0.0.1:${port}/api/runtime/stop`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(stop.status, 200);
    f.setConnected(false); f.setConnected(true);
    await api.state.idle();
    assert.equal(f.runtime.status().active, false);
  } finally {
    await api.close();
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});

test("desktop exit lets an in-flight device operation finish and rejects new operations once accepted", async () => {
  const fixture = await reconciliationFixture();
  const api = createApiHandler(new ProfileStore(fixture.directory), fixture.device, { configuration: fixture.configuration, rgb: fixture.rgb, runtime: fixture.runtime, desktop: true });
  let control: DesktopControl;
  const server = createServer((req, res) => {
    if (!control.handle(req, res, api.desktopStatus, api.close, api.beginDesktopShutdown)) void api(req, res);
  });
  const port = await listen(server);
  const token = "ab".repeat(32);
  control = new DesktopControl({ app: "meu-keymap", version: 1, instance: "synthetic", root: fixture.directory, dataDirectory: fixture.directory, port,
    pid: process.pid, birth: "synthetic", mode: "desktop" }, fixture.directory, token);
  const base = "http://127.0.0.1:" + port;
  const post = (path: string) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const exit = () => fetch(base + "/api/desktop/shutdown", { method: "POST", headers: { "x-keymap-desktop-token": token } });
  let signalReadStarted!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>(resolve => { signalReadStarted = resolve; });
  const heldRead = new Promise<void>(resolve => { releaseRead = resolve; });
  fixture.setHold(() => { signalReadStarted(); return heldRead; });
  try {
    const read = post("/api/device/state/read");
    await readStarted;
    const busy = await exit();
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).error, "Aguarde a operação atual terminar para sair.");
    releaseRead();
    assert.equal((await read).status, 200);
    assert.equal((await exit()).status, 202);
    assert.equal((await post("/api/device/state/read")).status, 503);
  } finally {
    releaseRead();
    await api.close();
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});

test("desktop opening suppresses automatic binding writes without changing persisted policy", async () => {
  const fixture = await reconciliationFixture();
  try {
    await fixture.state.read();
    const profile = fixture.profile;
    profile.layers[0]!.controls[0]!.rules[0]!.behavior.action = { kind: "shortcut", keys: "Q" };
    const preview = await fixture.application.prepare(profile, "device");
    assert.deepEqual(preview.errors, []);
    await fixture.application.apply(preview.token!);
    assert.equal((await fixture.state.snapshot()).policy.enabled, true);
    const before = fixture.counters().writes;
    fixture.raw.layers[0]!.reports[0] = fixture.raw.layers[0]!.reports[1]!.slice(0, 4) + "01" + fixture.raw.layers[0]!.reports[1]!.slice(6);
    fixture.state.suppressAutomaticReapply();
    fixture.state.start(); await fixture.state.idle();
    fixture.setConnected(false); await fixture.state.idle();
    fixture.setConnected(true); await fixture.state.idle();
    assert.equal(fixture.counters().writes, before);
    assert.equal((await fixture.state.snapshot()).policy.enabled, true);
    assert.equal(fixture.runtime.status().active, false);
  } finally { await fixture.state.close(); }
});

test("browser bootstrap is same-origin, one-use and HttpOnly; streams count tabs, reload cancels grace and last disconnect stops", async () => {
  let session:BrowserSession;let stopped=0;
  const server=createServer((req,res)=>{if(!session.handle(req,res)){res.writeHead(404);res.end();}});
  const port=await listen(server);session=new BrowserSession(port,async()=>{stopped++;},()=>true,120,500);
  const base=`http://127.0.0.1:${port}`;
  const headers={Origin:base,"sec-fetch-site":"same-origin"};
  const ticket=()=>session.html("<head></head>").match(/content="([a-f0-9]+)"/)![1]!;
  const streams:AbortController[]=[];
  const open=async(cookie:string)=>{
    const controller=new AbortController();streams.push(controller);
    const response=await fetch(base+"/api/desktop/tabs",{headers:{...headers,Cookie:cookie},signal:controller.signal});
    assert.equal(response.status,200);void response.text().catch(()=>{});return controller;
  };
  try{
    const key=ticket();
    assert.equal((await fetch(base+"/api/desktop/bootstrap",{method:"POST",headers:{...headers,"sec-fetch-site":"same-site","x-keymap-tab-ticket":key}})).status,403);
    assert.equal((await fetch(base+"/api/desktop/bootstrap",{method:"POST",headers:{...headers,Origin:"https://example.com","x-keymap-tab-ticket":key}})).status,403);
    const response=await fetch(base+"/api/desktop/bootstrap",{method:"POST",headers:{...headers,"x-keymap-tab-ticket":key}});
    assert.equal(response.status,204);const setCookie=response.headers.get("set-cookie")!;
    assert.match(setCookie,/HttpOnly; SameSite=Strict/);const cookie=setCookie.split(";")[0]!;
    assert.equal((await fetch(base+"/api/desktop/bootstrap",{method:"POST",headers:{...headers,"x-keymap-tab-ticket":key}})).status,403);
    assert.equal((await fetch(base+"/api/desktop/tabs",{headers})).status,403);
    assert.equal((await fetch(base+"/api/desktop/tabs",{headers:{...headers,"sec-fetch-site":"same-site",Cookie:cookie}})).status,403);
    const first=await open(cookie),second=await open(cookie);assert.equal(session.snapshot().tabs,2);
    first.abort();await new Promise(done=>setTimeout(done,170));assert.equal(stopped,0);assert.equal(session.snapshot().tabs,1);
    second.abort();await new Promise(done=>setTimeout(done,35));assert.ok(session.snapshot().deadline);
    const reloaded=await open(cookie);await new Promise(done=>setTimeout(done,170));assert.equal(stopped,0);assert.equal(session.snapshot().tabs,1);
    reloaded.abort();await new Promise(done=>setTimeout(done,200));assert.equal(stopped,1);
  }finally{for(const controller of streams)controller.abort();session.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});

test("browser startup without a tab expires; a stale bootstrap is rejected and shutdown clears timers",async()=>{
  let calls=0;const session=new BrowserSession(4199,async()=>{calls++;},()=>true,20,60);
  await new Promise(done=>setTimeout(done,100));assert.equal(calls,1);session.close();
  const cancelled=new BrowserSession(4199,async()=>{calls++;},()=>true,20,60);cancelled.close();
  await new Promise(done=>setTimeout(done,100));assert.equal(calls,1);
});

test("tab timeout rechecks the motor state and restarts after the motor stops with no tabs", async () => {
  let motorActive = false;
  let shutdowns = 0;
  const session = new BrowserSession(4199, async () => { shutdowns++; }, () => !motorActive, 20, 60);
  try {
    assert.ok(session.snapshot().deadline);
    motorActive = true;
    await new Promise(done => setTimeout(done, 100));
    assert.equal(shutdowns, 0);
    assert.equal(session.snapshot().deadline, null);
    session.opened();
    assert.equal(session.snapshot().deadline, null);
    motorActive = false;
    session.refreshIdleTimeout();
    assert.ok(session.snapshot().deadline);
    await new Promise(done => setTimeout(done, 100));
    assert.equal(shutdowns, 1);
  } finally {
    session.close();
  }
});
