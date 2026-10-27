import test from "node:test";
import assert from "node:assert/strict";
import { readFile,writeFile,mkdir,rm,readdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { createApiHandler, ProfileStore } from "../server.ts";
import { capabilities,emptyDeviceState } from "../lib/device-state.ts";
import { DeviceStateStore } from "../native/device-state.ts";
import { UsbCoordinator,processBirth } from "../native/usb-coordinator.ts";
import { deliverCapability } from "../native/reconciliation.ts";
import { reconciliationFixture } from "./reconciliation-fixture.ts";
import { bindingPacket,markerKeys } from "../lib/bindings.ts";
import { makeEvent } from "../lib/model.ts";

test("state store rejects malformed files, revision conflict and ENOSPC without replacing the previous document",async()=>{
  const f=await reconciliationFixture();
  try{
    const store=new DeviceStateStore(f.directory);assert.deepEqual(await store.load(),emptyDeviceState());
    await store.update(0,current=>current);await assert.rejects(store.update(0,current=>current),/estado mudou/);
    const prior=await readFile(join(f.directory,"device-state.json"),"utf8");
    const failed=new DeviceStateStore(f.directory,{read:path=>readFile(path,"utf8"),write:async()=>{throw Object.assign(new Error("disk full"),{code:"ENOSPC"});},rename:async()=>assert.fail("No rename on failed write")});
    await assert.rejects(failed.update(1,current=>current),/disk full/);assert.equal(await readFile(join(f.directory,"device-state.json"),"utf8"),prior);
    await writeFile(join(f.directory,"device-state.json"),"{invalid");await assert.rejects(store.load(),/inválido/);await assert.rejects(store.update(undefined,current=>current),/inválido/);assert.equal(await readFile(join(f.directory,"device-state.json"),"utf8"),"{invalid");
  }finally{await f.state.close();}
});

test("read is independent of desired, timeout cannot fallback or preserve live confidence, capabilities remain evidence-based",async()=>{
  const f=await reconciliationFixture();
  try{
    const first=await f.state.read();assert.equal(first.desired,null);assert.equal(first.session.observedCurrent,true);assert.equal(first.physicalLayer,null);
    const preview=await f.application.prepare(f.profile,"device");await f.application.apply(preview.token!);
    f.raw.layers[0]!.reports[0]=bindingPacket(1,1,{kind:"shortcut",keys:"C"}).replace(/^03FD/,"03FA");
    const read=await f.state.read();assert.notEqual(read.observed!.bindings!.value.entries[0]!.raw,read.desired!.bindings![0]!.replace(/^03FD/,"03FA"));
    const writes=f.counters().writes;f.setReadFailure(true);await assert.rejects(f.state.read(),/timeout/);
    const failed=await f.state.snapshot();assert.equal(failed.session.observedCurrent,false);assert.equal(failed.capabilities.bindings!.read,"available");assert.equal(failed.capabilities.opticalState!.read,"unknown");assert.equal(f.counters().writes,writes);assert.ok(failed.delivery.bindings?.lastConfirmation);
    f.setReadFailure(false);f.setRgbFailure(true);await f.state.reconcile();assert.equal(f.counters().writes,writes+1);assert.equal((await f.state.snapshot()).session.phase,"ready");
  }finally{await f.state.close();}
});

test("unsupported fallback uses a synthetic documented capability only; unknown/timeout never authorize it",async()=>{
  let writes=0,reads=0;const adapter={read:async()=>{reads++;throw new Error("timeout");},write:async()=>{writes++;},matches:()=>true};
  const synthetic={read:"unsupported",write:"available",physical:"unknown",variant:"synthetic adapter only",provenance:"Synthetic contract explicitly omits read; not evidence for physical device"} as const;
  assert.equal(await deliverCapability(synthetic,adapter),"sent");assert.equal(writes,1);assert.equal(reads,0);
  await assert.rejects(deliverCapability({...synthetic,read:"unknown"},adapter),/não autoriza/);
  await assert.rejects(deliverCapability(capabilities().bindings!,adapter),/timeout/);assert.equal(writes,1);
});

test("resident monitoring reconnects same identity once, inventory does not write, other port is rejected, server restart remains disarmed",async()=>{
  const f=await reconciliationFixture();
  try{
    f.state.start();await new Promise(resolve=>setTimeout(resolve,1));await f.state.idle();
    const preview=await f.application.prepare(f.profile,"device");await f.application.apply(preview.token!);
    const chosen=await f.state.snapshot();assert.equal(chosen.policy.enabled,true);
    assert.equal(chosen.delivery.bindings?.sent,false);assert.equal(chosen.delivery.bindings?.confirmedByRead,true);
    f.setConnected(false);assert.equal((await f.state.snapshot()).session.observedCurrent,false);
    f.raw.layers[0]!.reports[0]=bindingPacket(1,1,{kind:"shortcut",keys:"D"}).replace(/^03FD/,"03FA");
    const before=f.counters().writes;f.setConnected(true);await f.state.idle();assert.equal(f.counters().writes,before+1);
    for(let i=0;i<5;i++)f.emit(f.inventory());await f.state.idle();assert.equal(f.counters().writes,before+1);
    assert.equal(f.runtime.status().active,false);
    f.setConnected(false);f.setPath("\\\\?\\HID#VID_514C&PID_8850&MI_00#different-port");f.setConnected(true);await f.state.idle();assert.equal(f.counters().writes,before+1);assert.match((await f.state.snapshot()).session.error,/caminho|porta/);
    assert.ok((await readdir(f.directory)).some(name=>name.startsWith("device-state-before-")));
  }finally{await f.state.close();}
  const restarted=await reconciliationFixture(f.directory);
  try{assert.equal((await restarted.state.snapshot()).session.observedCurrent,false);assert.equal(restarted.runtime.status().active,false);restarted.state.start();await new Promise(resolve=>setTimeout(resolve,1));await restarted.state.idle();assert.equal(restarted.runtime.status().active,false);}finally{await restarted.state.close();}
});

test("successful explicit restore records its outcome and cannot become an interrupted-write gate on restart",async()=>{
  const f=await reconciliationFixture();
  try{
    const preview=await f.application.prepare(f.profile,"device");await f.application.apply(preview.token!);
    const applied=await f.application.status();await f.application.restore(applied.deployment!.backup);
    const restored=await f.state.snapshot();assert.equal(restored.policy.enabled,false);assert.equal(restored.delivery.bindings?.status,"restored");
    await f.configuration.usb.close();const restarted=new UsbCoordinator(f.directory);assert.equal(await restarted.recovery(),null);await restarted.close();
  }finally{await f.state.close();}
});

test("stale in-flight read and queued writes are cancelled by generation change",async()=>{
  const f=await reconciliationFixture();let release!:()=>void;let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});
  try{
    await f.state.read();f.setHold(async()=>{entered();await held;});
    const reading=f.state.read();const rejected=assert.rejects(reading,/sessão USB mudou/);await started;
    const queued=f.configuration.apply([bindingPacket(1,1,{kind:"shortcut",keys:"E"})]);const queueRejected=assert.rejects(queued,/sessão USB mudou/);
    f.state.handleEvent({type:"inventory",at:Date.now(),platform:"synthetic",devices:[]});release();await rejected;await queueRejected;
    assert.equal((await f.state.snapshot()).session.observedCurrent,false);assert.equal(f.counters().writes,0);
  }finally{release?.();await f.state.close();}
});

test("USB lock retains one writer, recovers verified dead owner and recovery gate survives marker removal and reader restart",async()=>{
  const f=await reconciliationFixture();
  try{
    await f.state.read();const second=new UsbCoordinator(f.directory);await assert.rejects(second.run(async()=>{}),/Outro processo/);
    assert.ok(await processBirth(process.pid));await f.configuration.usb.close();
    const lock=new UsbCoordinator(f.directory);await mkdir(lock.lockPath);await writeFile(join(lock.lockPath,"owner.json"),JSON.stringify({pid:2147483646,birth:"dead",token:"old"}));
    await lock.run(async()=>{});await lock.requireRecovery("synthetic partial write",["preserved-backup"]);
    await rm(join(f.directory,"device-recovery.json"));await assert.rejects(lock.run(()=>lock.assertWritable()),/Recuperação pendente/);await lock.close();
    const restarted=new UsbCoordinator(f.directory);await assert.rejects(restarted.run(()=>restarted.assertWritable()),/Recuperação pendente/);await restarted.completeRecovery({synthetic:true,readback:"verified fixture"});await restarted.run(()=>restarted.assertWritable());await restarted.close();
  }finally{await f.state.close();}
});

test("partial writes roll back, unrecoverable failures block RGB and bindings, explicit recovery requires fresh fingerprints",async()=>{
  const f=await reconciliationFixture();
  try{
    const read=await f.state.read(),baseline=read.observed!;
    f.setPartial(true);await assert.rejects(f.configuration.apply([bindingPacket(1,1,{kind:"shortcut",keys:"A"}),bindingPacket(2,1,{kind:"shortcut",keys:"B"})]),/restaurada e relida/);f.setPartial(false);
    assert.equal((await f.configuration.read()).entries[0]!.raw,baseline.bindings!.value.entries[0]!.raw);
    f.setWriteFailure(true);await assert.rejects(f.configuration.apply([bindingPacket(1,1,{kind:"shortcut",keys:"A"})]),/restauração falharam/);f.setWriteFailure(false);
    await assert.rejects(f.rgb.apply(0,{mode:1,colors:Array<string>(16).fill("#111111")},baseline.rgb!.value.fingerprint),/Recuperação pendente/);
    await assert.rejects(f.configuration.apply([]),/Recuperação pendente/);
    const now=await f.state.read();const input={revision:now.revision,bindingsBackup:baseline.bindings!.value.backup,rgbBackup:baseline.rgb!.value.backup,bindingsFingerprint:baseline.bindings!.fingerprint,rgbFingerprint:baseline.rgb!.value.fingerprint};
    await assert.rejects(f.state.recover({...input,bindingsFingerprint:"0".repeat(64)}),/mudou/);
    const fresh=await f.state.snapshot();const recovered=await f.state.recover({...input,revision:fresh.revision});assert.equal(recovered.session.phase,"ready");assert.equal(recovered.policy.enabled,false);
  }finally{await f.state.close();}
});

test("marker updates observed layer before touch once, layer/reconnect never replay entry actions or queued double clicks",async()=>{
  const f=await reconciliationFixture();
  const pulse=(index:number)=>{for(const code of markerKeys(index))f.emit({type:"input",at:Date.now(),devicePath:f.inventory().devices[0]!.path,kind:"keyboard",data:{vkey:code+20,released:false,modifiers:0}});for(const code of markerKeys(index))f.emit({type:"input",at:Date.now(),devicePath:f.inventory().devices[0]!.path,kind:"keyboard",data:{vkey:code+20,released:true,modifiers:0}});};
  try{
    f.profile.events=[makeEvent("custom","Custom")];f.profile.events[0]!.states[0]!.action={kind:"text",value:"initial replay forbidden"};
    for(const layer of f.profile.layers)layer.controls[0]!.rules.find(rule=>rule.trigger==="activate")!.behavior.action={kind:"text",value:"activation forbidden"};
    f.profile.layers[1]!.controls[0]!.rules.find(rule=>rule.trigger==="press")!.behavior.action={kind:"text",value:"one new touch"};
    f.state.start();await new Promise(resolve=>setTimeout(resolve,1));await f.state.idle();
    const preview=await f.application.prepare(f.profile,"local");await f.application.apply(preview.token!);const manualStartActions=f.performed.length;assert.equal(manualStartActions,1);
    const writes=f.counters().writes;pulse(25);await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(f.performed.slice(manualStartActions),[{kind:"text",value:"one new touch"}]);assert.equal((await f.state.snapshot()).lastObservedLayer!.layer,1);assert.equal(f.runtime.status().runtimeLayer,1);assert.equal(f.counters().writes,writes);
    f.setConnected(false);f.setConnected(true);await f.state.idle();assert.equal(f.runtime.status().active,true);assert.equal(f.runtime.status().paused,false);assert.equal(f.performed.length,manualStartActions+1);
    pulse(25);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.performed.length,manualStartActions+2);f.application.stop();
  }finally{await f.state.close();}
});

test("RGB writes only differing banks; external binding change is preserved and blocks recovery across domains",async()=>{
  const f=await reconciliationFixture();
  try{
    const first=await f.state.read(),before=first.observed!.rgb!.value;
    const original=f.rgb.onWrite;
    f.rgb.onWrite=async phase=>{await original?.(phase);if(phase==="sent")f.raw.layers[1]!.reports[3]=bindingPacket(4,2,{kind:"shortcut",keys:"Z"}).replace(/^03FD/,"03FA");};
    await assert.rejects(f.state.applyRgb(0,{mode:1,colors:Array<string>(16).fill("#101010")},before.fingerprint),/recuperação RGB pendente/);
    assert.equal(f.counters().rgbWrites,1);assert.equal(f.counters().writes,0);assert.match(f.raw.layers[1]!.reports[3]!,/^03FA0402/);
    const current=await f.state.snapshot();assert.equal(current.session.phase,"recovery-required");assert.equal(current.delivery.rgb?.sent,true);assert.equal(current.delivery.rgb?.confirmedByRead,false);
    await assert.rejects(f.configuration.apply([]),/Recuperação pendente/);
  }finally{await f.state.close();}
});

test("policy disable does not reapply differences on reconnect; direct read failure removes current trust",async()=>{
  const f=await reconciliationFixture();
  try{
    f.state.start();await new Promise(resolve=>setTimeout(resolve,1));await f.state.idle();
    const preview=await f.application.prepare(f.profile,"device");await f.application.apply(preview.token!);
    const chosen=await f.state.snapshot();await f.state.policy(chosen.revision,false);const writes=f.counters().writes;
    f.setConnected(false);f.raw.layers[0]!.reports[2]=bindingPacket(3,1,{kind:"shortcut",keys:"V"}).replace(/^03FD/,"03FA");f.setConnected(true);await f.state.idle();assert.equal(f.counters().writes,writes);
    f.setReadFailure(true);await assert.rejects(f.configuration.read(),/timeout/);const failed=await f.state.snapshot();assert.equal(failed.readStatus.bindings.current,false);assert.equal(failed.session.observedCurrent,false);assert.equal(failed.policy.enabled,false);
  }finally{await f.state.close();}
});

test("interrupted sending intent blocks a restarted writer even when no recovery marker could be saved",async()=>{
  const f=await reconciliationFixture();
  try{
    await f.state.read();await f.state.store.update(undefined,current=>({...current,delivery:{...current.delivery,bindings:{desiredRevision:1,generation:0,attempt:"synthetic-interruption",startedAt:Date.now(),finishedAt:null,status:"unknown",sent:null,confirmedByRead:false,error:"",lastConfirmation:null}}}));
    await f.configuration.usb.close();const restarted=new UsbCoordinator(f.directory);
    await assert.rejects(restarted.run(()=>restarted.assertWritable()),/Recuperação pendente/);assert.equal(f.counters().writes,0);await restarted.close();
  }finally{await f.state.close();}
});

test("state API validates origins and revisions, GET never writes and draft save never creates desired",async()=>{
  const f=await reconciliationFixture(),store=new ProfileStore(f.directory),api=createApiHandler(store,f.device,{configuration:f.configuration,rgb:f.rgb,runtime:f.runtime});
  const server=createServer((req,res)=>{void api(req,res);});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
  const post=(path:string,body:unknown,method="POST",origin?:string)=>fetch(base+path,{method,headers:{"Content-Type":"application/json",...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  try{
    assert.equal((await post("/api/device/state/read",{},"POST","https://foreign.example")).status,403);
    assert.equal((await post("/api/device/state/policy",{revision:0,enabled:"yes"},"PUT")).status,400);
    assert.equal((await post("/api/device/state/reconcile",{revision:0,packets:["arbitrary"]})).status,400);
    const initial=await(await fetch(base+"/api/device/state")).json();assert.equal(initial.desired,null);assert.equal(f.counters().reads,0);
    await store.save({version:3,activeProfile:f.profile.id,profiles:[f.profile]},0);assert.equal((await(await fetch(base+"/api/device/state")).json()).desired,null);
    const read=await post("/api/device/state/read",{});assert.equal(read.status,200);
    assert.equal((await post("/api/device/state/policy",{revision:0,enabled:false},"PUT")).status,409);
    const rgb=await(await fetch(base+"/api/device/rgb")).json();assert.equal(rgb.historical,true);assert.equal(rgb.live,false);
    assert.equal(f.counters().writes,0);
  }finally{await api.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
