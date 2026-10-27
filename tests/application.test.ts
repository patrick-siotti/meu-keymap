import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeProfile } from "../lib/model.ts";
import { bindingPacket } from "../lib/bindings.ts";
import { ConfigurationReader,mapFingerprint } from "../native/configuration.ts";
import { ApplicationService } from "../native/application.ts";
import { LocalRuntime } from "../native/runtime.ts";
function setup(failStart=false){
  const identity=Buffer.alloc(65);identity.set([3,251,16,3,11]);
  const raw={at:Date.now(),devicePath:"test",identity:identity.toString("hex").toUpperCase(),error:null,layers:[1,2,3].map(layer=>({layer,reports:Array.from({length:25},(_,i)=>bindingPacket(i+1,layer,{kind:"none"}).replace(/^03FD/,"03FA"))}))};
  let writes=0;
  const transport={read:async()=>structuredClone(raw),write:async(packets:string[])=>{writes++;for(const packet of packets)raw.layers[parseInt(packet.slice(6,8),16)-1]!.reports[parseInt(packet.slice(4,6),16)-1]=packet.replace(/^03FD/,"03FA");}};
  const runtime=new LocalRuntime({inventory:async()=>({type:"inventory",at:Date.now(),platform:"win32",devices:[]}),recent:()=>[],subscribe:()=>{},observe:()=>()=>{}},{observe:next=>{next({at:Date.now(),processNames:["node"],values:{}});return()=>{};}},{start:async()=>{if(failStart)throw new Error("executor unavailable");},execute:async()=>"ok",stop:()=>{}});
  const profile=makeProfile("fixture","Testar aplicação");profile.events=[];
  for(const layer of profile.layers)for(const control of layer.controls)for(const rule of control.rules){rule.behavior.action={kind:"none"};rule.behavior.transition.eventId="";}
  return {raw,runtime,transport,profile,writes:()=>writes};
}
test("application tokens apply all banks once, retain native backup across local updates, and restore",async()=>{
  const fixture=setup(),directory=await mkdtemp(join(tmpdir(),"keymap-application-"));
  const reader=new ConfigurationReader(directory,fixture.transport),service=new ApplicationService(directory,reader,fixture.runtime);
  const original=mapFingerprint(await reader.read());
  const preview=await service.prepare(fixture.profile,"local");assert.equal(preview.changed,75);assert.equal(preview.errors.length,0);
  try{
    await service.apply(preview.token!);assert.equal(fixture.runtime.status().active,true);
    const first=await service.status();assert.ok(first.deployment?.backup);
    await assert.rejects(service.apply(preview.token!),/expirada/);assert.equal(fixture.writes(),1);
    const update=await service.prepare({...fixture.profile,name:"Atualizado"},"local");assert.equal(update.changed,0);await service.apply(update.token!);
    assert.equal((await service.status()).deployment!.backup,first.deployment!.backup);
    await service.restore(first.deployment!.backup);assert.equal(fixture.runtime.status().active,false);
    assert.equal(mapFingerprint(await reader.read()),original);
    assert.equal((await service.status()).deployment!.restored,true);
    await assert.rejects(service.start(),/Automações/);
    await assert.rejects(service.restore("../../profiles.json"),/inválido/);
  }finally{service.stop();}
});
test("executor initialization failure rolls hardware back and cannot leave a success deployment",async()=>{
  const fixture=setup(true),directory=await mkdtemp(join(tmpdir(),"keymap-app-rollback-"));
  const reader=new ConfigurationReader(directory,fixture.transport),service=new ApplicationService(directory,reader,fixture.runtime);
  const original=mapFingerprint(await reader.read()),preview=await service.prepare(fixture.profile,"local");
  await assert.rejects(service.apply(preview.token!),/restaurada/);
  assert.equal(mapFingerprint(await reader.read()),original);assert.equal((await service.status()).deployment,null);
  assert.equal((await service.status()).busy,false);assert.equal(await readFile(join(directory,"deployment.json"),"utf8"),"null");
});
test("independent hardware verification detects external changes and stops the resident engine",async()=>{
  const fixture=setup(),directory=await mkdtemp(join(tmpdir(),"keymap-app-verify-")),service=new ApplicationService(directory,new ConfigurationReader(directory,fixture.transport),fixture.runtime);
  try{
    const preview=await service.prepare(fixture.profile,"local");await service.apply(preview.token!);
    assert.equal((await service.verify()).hardware.matches,true);
    await service.pauseForVerification();assert.equal(fixture.runtime.status().paused,true);await assert.rejects(service.prepare(fixture.profile,"local"),/conferência/);service.resumeAfterVerification();
    assert.equal(fixture.runtime.status().active,true);assert.equal(fixture.runtime.status().paused,false);
    fixture.raw.layers[0]!.reports[2]=bindingPacket(3,1,{kind:"shortcut",keys:"C"}).replace(/^03FD/,"03FA");
    const result=await service.verify();assert.equal(result.hardware.matches,false);assert.equal(result.runtime.active,false);assert.match(result.message,/divergiu/);
    await assert.rejects(service.start(),/mudou/);
  }finally{service.stop();}
});
