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

test("a momentary event runs on the two hardware edges without repeating or mistaking a pulse for release", async () => {
  const profile = makeProfile("held", "Ditar");
  const dictate = makeEvent("dictation", "Ditar");
  dictate.states[1]!.condition = { id: "held", kind:"test", source:{ kind:"key", controlId:"key-14" }, operator:"eq", value:true };
  dictate.states[0]!.condition = { id: "up", kind:"test", source:{ kind:"key", controlId:"key-14" }, operator:"eq", value:false };
  profile.events = [dictate];
  const rules = profile.layers[0]!.controls[13]!.rules;
  const down = makeRule("down","down"), hold = makeRule("hold","hold"), release = makeRule("release","release");
  down.behavior.transition = { eventId: dictate.id, operation: "set", stateId: "active" };
  down.behavior.action = { kind: "shortcut", keys: "Ctrl+Shift+D", whileHeld: { mutePlayback: true } };
  release.behavior.transition = { eventId: dictate.id, operation: "reset", stateId: "" };
  release.behavior.action = { kind: "text", value: "terminou" };
  hold.behavior.action = { kind: "text", value: "segurou" };
  rules.push(down, hold, release);
  const shortcut = makeRule("during", "press", { controlId: "key-14", modifiers: [] });
  shortcut.behavior.action = { kind: "text", value: "outra tecla" };
  profile.layers[0]!.controls[0]!.rules.push(shortcut);
  let listener = (_event: DeviceEvent) => {};
  const performed: Action[] = [];
  const shortcutEdges: [number, string?, boolean?][] = [];
  const runtime = new LocalRuntime({
    inventory: async () => ({ type:"inventory", at:Date.now(), platform:"win32", devices:[] }),
    recent: () => [], subscribe: () => {}, observe: callback => { listener = callback; return () => { listener = () => {}; }; },
  }, { observe: () => () => {} }, {
    start: async () => {}, execute: async action => { performed.push(action); return "ok"; }, stop: () => {},
    pressShortcut: async (slot, keys, mutePlayback) => { shortcutEdges.push([slot, keys, mutePlayback]); },
    releaseShortcut: async (slot) => { shortcutEdges.push([slot]); },
  });
  const key = (released = false) => listener(event(132, released));
  try {
    await runtime.start(profile, { windowsSlots: [0, 13], held: [{ index: 13, virtualKey: 132 }] });
    key(true);
    assert.equal(runtime.status().events.dictation, "inactive");
    key();
    assert.equal(runtime.status().events.dictation, "active");
    key();
    for (const code of markerKeys(0)) { listener(event(code+20)); listener(event(code+20, true)); }
    await new Promise(done => setTimeout(done, 440));
    assert.equal(runtime.status().events.dictation, "active");
    assert.deepEqual(performed.map(value => value.kind === "text" && value.value), ["outra tecla", "segurou"]);
    assert.deepEqual(shortcutEdges, [[13, "Ctrl+Shift+D", true]]);
    key(true); key(true);
    assert.equal(runtime.status().events.dictation, "inactive");
    assert.equal(performed.length, 3);
    assert.deepEqual(shortcutEdges, [[13, "Ctrl+Shift+D", true], [13]]);
    key();
    assert.equal(runtime.status().events.dictation, "active");
    runtime.suspendConnection();
    assert.equal(runtime.status().events.dictation, "inactive");
    assert.equal(performed.length, 3);
    await runtime.resumeConnection();
    key(true);
    assert.equal(performed.length, 3);
    assert.deepEqual(shortcutEdges, [[13, "Ctrl+Shift+D", true], [13], [13, "Ctrl+Shift+D", true], [13]]);
  } finally { runtime.stop(); }
});
