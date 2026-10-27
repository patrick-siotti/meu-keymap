import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore } from "../server.ts";
import { ProfileSynchronizer } from "../native/profile-sync.ts";
import { ConfigurationReader } from "../native/configuration.ts";
import { ApplicationService } from "../native/application.ts";
import { LocalRuntime } from "../native/runtime.ts";
import { makeProfile,emptyBehavior,makeRule } from "../lib/model.ts";
import { bindingPacket } from "../lib/bindings.ts";
import { profileStamp } from "../lib/profile-stamp.ts";
import { reconciliationFixture } from "./reconciliation-fixture.ts";
import { markerKeys } from "../lib/bindings.ts";
import type { DeviceInput } from "../lib/device.ts";
test("Save and apply writes the saved keys, verifies them, and reports saved-but-not-applied on failure",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-save-apply-")),store=new ProfileStore(directory);
  const identity=Buffer.alloc(65);identity.set([3,251,16,3,11]);
  const raw={at:Date.now(),devicePath:"test",identity:identity.toString("hex").toUpperCase(),error:null,layers:[1,2,3].map(layer=>({layer,reports:Array.from({length:25},(_,i)=>bindingPacket(i+1,layer,{kind:"none"}).replace(/^03FD/,"03FA"))}))};
  let writes=0,missing=false;
  const reader=new ConfigurationReader(directory,{read:async()=>{if(missing)throw new Error("Dispositivo ausente");return structuredClone(raw);},write:async packets=>{writes++;for(const packet of packets)raw.layers[parseInt(packet.slice(6,8),16)-1]!.reports[parseInt(packet.slice(4,6),16)-1]=packet.replace(/^03FD/,"03FA");}});
  const runtime=new LocalRuntime({inventory:async()=>({type:"inventory",at:Date.now(),platform:"win32",devices:[]}),subscribe:()=>{},recent:()=>[],observe:()=>()=>{}},{observe:()=>()=>{}},{start:async()=>{},stop:()=>{},execute:async()=>"ok"});
  const application=new ApplicationService(directory,reader,runtime),sync=new ProfileSynchronizer(store,application);
  const profile=makeProfile("saved","Saved");profile.events=[];
  for(const layer of profile.layers)for(const control of layer.controls)for(const rule of control.rules)rule.behavior=emptyBehavior();
  profile.layers[0]!.controls[2]!.rules[0]!.behavior.action={kind:"shortcut",keys:"Ctrl+C"};
  const document={version:3 as const,activeProfile:profile.id,profiles:[profile]};
  await store.save(document,0);assert.equal(writes,0,"saving to disk alone must not count as a hardware application");
  const result=await sync.sync(document,1,"device");assert.equal(result.applied,true);assert.equal(result.saved.revision,2);assert.equal(writes,1);assert.equal((await reader.read()).entries[2]!.label,"Ctrl + C");
  const status=await application.status();assert.equal(status.deployment!.mode,"device");assert.equal(status.deployment!.profileStamp,await profileStamp(profile));
  raw.layers[0]!.reports[2]=bindingPacket(3,1,{kind:"shortcut",keys:"B"}).replace(/^03FD/,"03FA");
  const retry=await sync.sync(document,2,"device");assert.equal(retry.applied,true);assert.equal(writes,2,"explicit application still repairs external hardware divergence");
  missing=true;profile.layers[0]!.controls[2]!.rules[0]!.behavior.action={kind:"shortcut",keys:"A"};
  const failed=await sync.sync(document,3,"device");assert.equal(failed.applied,false);assert.match(failed.error!,/NÃO aplicado/);assert.equal(failed.saved.revision,4);assert.equal(writes,2);
  assert.deepEqual((await store.load()).document.profiles[0]!.layers[0]!.controls[2]!.rules[0]!.behavior.action,{kind:"shortcut",keys:"A"});
  assert.notEqual((await application.status()).deployment!.profileStamp,await profileStamp(profile));
  application.stop();
});
test("explicit local save starts the motor; marker actions, missing clicks and decoration-only updates are traceable",async()=>{
  const f=await reconciliationFixture(),store=new ProfileStore(f.directory),sync=new ProfileSynchronizer(store,f.application);
  const p=f.profile,c=p.layers[0]!.controls[2]!;
  const activation=makeRule("activate","activate");activation.behavior.action={kind:"shortcut",keys:"Ctrl+X"};c.rules=[activation];
  const doc={version:3 as const,activeProfile:p.id,profiles:[p]};
  const pulse=()=>{for(const released of [false,true])for(const code of markerKeys(2))f.emit({type:"input",at:Date.now(),devicePath:"synthetic-keyboard",kind:"keyboard",data:{vkey:code+20,released,modifiers:0}} satisfies DeviceInput);};
  try{
    f.state.start();await new Promise(r=>setTimeout(r,1));await f.state.idle();
    const first=await sync.sync(doc,0,"local");assert.equal(first.applied,true);assert.equal(first.mode,"local");assert.equal(first.runtimeActive,true);assert.equal((await f.application.status()).deployment?.mode,"local");
    const count=f.performed.length;pulse();await new Promise(r=>setTimeout(r,20));assert.equal(f.performed.length,count);assert.ok(f.runtime.status().logs.some(l=>l.includes("Nenhuma regra")));
    const press=makeRule("press","press");press.behavior.action={kind:"shortcut",keys:"Shift+Win+S"};c.rules.push(press);
    const second=await sync.sync(doc,1,"local");assert.equal(second.applied,true);pulse();await new Promise(r=>setTimeout(r,20));assert.deepEqual(f.performed.at(-1),press.behavior.action);
    const writes=f.counters().writes,actions=f.performed.length,stamp=await profileStamp(p),runtimeInput=f.runtime.status().lastInput;
    c.icon={kind:"library",name:"star"};const third=await sync.sync(doc,2,"local");
    assert.equal(third.applied,true);assert.equal(await profileStamp(p),stamp);assert.equal(f.counters().writes,writes);assert.equal(f.performed.length,actions,"no replay of activation actions for a decoration");assert.equal(f.runtime.status().lastInput,runtimeInput);
    f.setConnected(false);pulse();assert.equal(f.runtime.status().paused,true);const afterDisconnect=f.performed.length;
    f.setConnected(true);await f.state.idle();pulse();await new Promise(r=>setTimeout(r,20));assert.equal(f.performed.length,afterDisconnect+1);assert.equal(f.counters().rgbWrites,0);
    f.application.stop();pulse();assert.equal(f.runtime.status().active,false);
    const reopened=new ApplicationService(f.directory,f.configuration,f.runtime);assert.equal((await reopened.status()).runtime.active,false,"persisted deployment cannot auto-arm on startup");
    await f.application.start();assert.equal(f.runtime.status().active,true);
  }finally{await f.state.close();await f.runtime.close();}
});
test("unrepresentable device mode fails after saving and never silently changes mode",async()=>{
  const f=await reconciliationFixture(),store=new ProfileStore(f.directory),sync=new ProfileSynchronizer(store,f.application);
  f.profile.layers[0]!.controls[0]!.rules[0]!.behavior.action={kind:"text",value:"local only"};
  try{
    const result=await sync.sync({version:3,activeProfile:f.profile.id,profiles:[f.profile]},0,"device");
    assert.equal(result.applied,false);assert.equal(result.mode,"device");assert.match(result.error!,/NÃO aplicado/);assert.equal(result.saved.revision,1);assert.equal(f.counters().writes,0);assert.equal(f.runtime.status().active,false);
  }finally{await f.state.close();}
});
