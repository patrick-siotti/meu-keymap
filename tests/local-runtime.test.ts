import test from "node:test";
import assert from "node:assert/strict";
import { MarkerDecoder } from "../lib/marker-decoder.ts";
import { markerKeys } from "../lib/bindings.ts";
import { makeProfile,makeEvent,makeRule,emptyBehavior } from "../lib/model.ts";
import { LocalRuntime } from "../native/runtime.ts";
import type { DeviceEvent,DeviceInput } from "../lib/device.ts";
import type { Action } from "../lib/model.ts";
const path="\\\\?\\HID#VID_514C&PID_8850&MI_01#test";
function event(code:number,release=false):DeviceInput{return {type:"input",at:Date.now(),devicePath:path,kind:"keyboard",data:{vkey:code,released:release,modifiers:0}};}
test("marker sequences decode 75 unique addresses, ignore releases, duplicates and unrelated pulses",()=>{
  const decoder=new MarkerDecoder();
  for(let index=0;index<75;index++){
    const keys=markerKeys(index);assert.equal(new Set(keys).size,4);
    const events=keys.map(code=>event(code+20));
    for(const e of events)assert.equal(decoder.accept(e),null);
    assert.equal(decoder.accept(events[0]!),null);
    const results=events.map(e=>decoder.accept({...e,data:{...e.data,released:true}}));
    const result=results.at(-1)!;assert.ok(result);assert.equal(result.layer,Math.floor(index/25));
  }
  assert.equal(decoder.accept(event(65)),null);
  decoder.reset();
  for(let index=0;index<75;index++){
    let result=null;
    for(const code of markerKeys(index)){assert.equal(decoder.accept(event(code+20)),null);result=decoder.accept(event(code+20,true));}
    assert.ok(result);assert.equal(result.layer,Math.floor(index/25));
  }
  decoder.reset();
  const overlap=[...new Set([...markerKeys(0),...markerKeys(74)])];
  for(const code of overlap)decoder.accept(event(code+20));
  assert.ok(overlap.every(code=>decoder.accept(event(code+20,true))===null));
});
test("resident engine executes Então/Senão and event transitions, with no replay after stop",async()=>{
  const profile=makeProfile("test","Live test");profile.events=[makeEvent("recording","Gravando")];
  for(const layer of profile.layers)for(const control of layer.controls)for(const rule of control.rules){rule.behavior.action={kind:"none"};rule.behavior.transition.eventId="";}
  const rule=profile.layers[0]!.controls[0]!.rules[0]!;
  rule.condition={id:"process",kind:"test",source:{kind:"process",name:"node.exe"},operator:"eq",value:true};
  rule.behavior.action={kind:"text",value:"accepted"};rule.behavior.transition={eventId:"recording",operation:"next",stateId:""};
  rule.otherwise=structuredClone(rule.behavior);rule.otherwise.action={kind:"text",value:"rejected"};rule.otherwise.transition.eventId="";
  let listener:((e:DeviceEvent)=>void)|null=null;
  const performed:Action[]=[];
  const runtime=new LocalRuntime({inventory:async()=>({type:"inventory",at:Date.now(),platform:"win32",devices:[]}),recent:()=>[],subscribe:()=>{},observe:next=>{listener=next;return()=>{listener=null;};}}, {observe:next=>{next({at:Date.now(),processNames:["node"],values:{}});return()=>{};}}, {start:async()=>{},execute:async action=>{performed.push(action);return "ok";},stop:()=>{}});
  await runtime.start(profile);
  const send=()=>{for(const code of markerKeys(0))listener?.(event(code+20));for(const code of markerKeys(0))listener?.(event(code+20,true));};
  send();await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(performed,[{kind:"text",value:"accepted"}]);assert.equal(runtime.status().events.recording,"active");
  runtime.pauseInputs();send();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(performed.length,1);assert.equal(runtime.status().paused,true);
  runtime.resumeInputs();assert.equal(runtime.status().paused,false);assert.equal(runtime.status().events.recording,"active");assert.equal(performed.length,1);
  runtime.stop();send();assert.equal(performed.length,1);assert.equal(runtime.status().active,false);
});
test("double click suppresses single click and pending clicks cannot cross layers or stop",async()=>{
  const profile=makeProfile("double","Double test");profile.events=[];
  for(const layer of profile.layers)for(const control of layer.controls)for(const rule of control.rules)rule.behavior=emptyBehavior();
  profile.layers[0]!.controls[0]!.rules[0]!.behavior.action={kind:"text",value:"single"};
  const double=makeRule("double","double");double.behavior.action={kind:"text",value:"double"};profile.layers[0]!.controls[0]!.rules.push(double);
  let listener:((e:DeviceEvent)=>void)|null=null;const performed:Action[]=[];
  const runtime=new LocalRuntime({inventory:async()=>({type:"inventory",at:Date.now(),platform:"win32",devices:[]}),recent:()=>[],subscribe:()=>{},observe:next=>{listener=next;return()=>{listener=null;};}},{observe:next=>{next({at:Date.now(),processNames:[],values:{}});return()=>{};}},{start:async()=>{},execute:async action=>{performed.push(action);return "ok";},stop:()=>{}});
  const pulse=(index=0)=>{for(const code of markerKeys(index))listener?.(event(code+20));for(const code of markerKeys(index))listener?.(event(code+20,true));};
  try{
    await runtime.start(profile);pulse();pulse();await new Promise(resolve=>setTimeout(resolve,450));
    assert.deepEqual(performed,[{kind:"text",value:"double"}]);
    pulse();await new Promise(resolve=>setTimeout(resolve,450));assert.deepEqual(performed.at(-1),{kind:"text",value:"single"});
    pulse();pulse(25);await new Promise(resolve=>setTimeout(resolve,450));assert.equal(performed.length,2);assert.equal(runtime.status().layer,1);
    pulse(0);runtime.stop();await new Promise(resolve=>setTimeout(resolve,450));assert.equal(performed.length,2);
  }finally{runtime.stop();}
});
