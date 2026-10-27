import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { staticRgbSchema } from "../lib/rgb.ts";
import type { RgbLayer } from "../lib/rgb.ts";
import { bindingPacket } from "../lib/bindings.ts";
import { createApiHandler, ProfileStore } from "../server.ts";
import { profileSources, startRuntime, simulateRule, changeEvent, activateLayer } from "../lib/engine.ts";
import { defaultDocument, parseDocument, emptyEffect } from "../lib/model.ts";
import { reconciliationFixture } from "./reconciliation-fixture.ts";
const slots=Array.from({length:16},(_,i)=>i);
const banks=():RgbLayer[]=>[0,1,2].map((mode,index)=>({mode,colors:slots.map(slot=>`#${(index*100+slot+1).toString(16).padStart(6,"0")}`.toUpperCase())}));

test("static batch changes all 48 colors in one write, persists desired before send and preserves all bindings",async()=>{
 const f=await reconciliationFixture();
 try{
  f.setRgb(banks());const before=await f.state.read(),bindings=structuredClone(f.raw.layers),callback=f.rgb.onWrite;
  f.rgb.onWrite=async phase=>{await callback?.(phase);if(phase==="sending"){const saved=await f.state.store.load();assert.ok(saved.desired!.rgb!.every(bank=>bank.mode===1&&bank.colors.every(color=>color==="#060710")));assert.equal(saved.delivery.rgb!.confirmedByRead,false);}};
  const result=await f.state.applyStaticRgb({layers:[0,1,2],slots,color:"#060710",fingerprint:before.observed!.rgb!.value.fingerprint});
  assert.equal(f.counters().rgbWrites,1);assert.equal(f.rgbPackets[0]!.length,3);assert.deepEqual(f.raw.layers,bindings);assert.equal(f.counters().writes,0);
  assert.ok(result.layers.every(bank=>bank.mode===1&&bank.colors.every(color=>color==="#060710")));
  const saved=await f.state.snapshot();assert.equal(saved.delivery.rgb!.confirmedByRead,true);assert.equal(saved.policy.enabled,false);
 }finally{await f.state.close();}
});

test("static selection preserves every non-target slot and legacy modes in unedited banks",async()=>{
 const f=await reconciliationFixture();
 try{for(const [layers,selected] of [[[1],[4]],[[0,2],[1,7,15]]] as [number[],number[]][]){
  const original=banks();f.setRgb(original);const before=await f.state.read();
  const result=await f.state.applyStaticRgb({layers,slots:selected,color:"#000000",fingerprint:before.observed!.rgb!.value.fingerprint});
  for(let bank=0;bank<3;bank++){assert.equal(result.layers[bank]!.mode,layers.includes(bank)?1:original[bank]!.mode);for(const slot of slots)assert.equal(result.layers[bank]!.colors[slot],layers.includes(bank)&&selected.includes(slot)?"#000000":original[bank]!.colors[slot]);}
 }}finally{await f.state.close();}
});

test("static request is strict and stale fingerprint sends nothing or alters desired",async()=>{
 const valid={layers:[0],slots:[0],color:"#123456",fingerprint:"a".repeat(64)};
 for(const bad of [{layers:[]},{layers:[0,0]},{layers:[3]},{layers:[0.5]},{slots:[]},{slots:[0,0]},{slots:[16]},{color:"red"},{color:"#1234"},{fingerprint:"wrong"},{extra:true}])assert.equal(staticRgbSchema.safeParse({...valid,...bad}).success,false);
 const f=await reconciliationFixture();try{await f.state.read();await assert.rejects(f.state.applyStaticRgb(valid),/mudou/);assert.equal(f.counters().rgbWrites,0);assert.equal((await f.state.snapshot()).desired,null);}finally{await f.state.close();}
});

test("partial RGB is rolled back and reported failed; failed recovery still gates bindings and RGB",async()=>{
 const f=await reconciliationFixture();try{
  f.setRgb(banks());
  const before=await f.state.read(),rgb=before.observed!.rgb!.value;
  f.setRgbPartial(true);await assert.rejects(f.state.applyStaticRgb({layers:[0,1,2],slots,color:"#121212",fingerprint:rgb.fingerprint}),/restaurada e relida/);
  assert.deepEqual((await f.rgb.read()).layers,rgb.layers);assert.equal((await f.state.snapshot()).delivery.rgb!.status,"failed");assert.equal((await f.state.snapshot()).recovery,null);
  f.setRgbPartial(false);f.setRgbWriteFailure(true);await assert.rejects(f.state.applyStaticRgb({layers:[0],slots:[1],color:"#131313",fingerprint:rgb.fingerprint}),/recuperação RGB pendente/);
  assert.equal((await f.state.snapshot()).session.phase,"recovery-required");await assert.rejects(f.configuration.apply([]),/Recuperação pendente/);
 }finally{await f.state.close();}
});

test("generation change before RGB send rejects the queued operation without configuration writes",async()=>{
 const f=await reconciliationFixture();try{
  const before=await f.state.read(),callback=f.rgb.onWrite;f.rgb.onWrite=async phase=>{await callback?.(phase);if(phase==="sending")f.configuration.usb.invalidate();};
  await assert.rejects(f.state.applyStaticRgb({layers:[0],slots:[0],color:"#111111",fingerprint:before.observed!.rgb!.value.fingerprint}),/recuperação RGB pendente/);assert.equal(f.counters().rgbWrites,0);
 }finally{await f.state.close();}
});

test("bindings apply, reconnect, reconcile and restart resume independently of stale desired RGB and RGB timeout",async()=>{
 const f=await reconciliationFixture();try{
  f.state.start();await new Promise(resolve=>setTimeout(resolve,1));await f.state.idle();
  await f.state.store.update(undefined,current=>({...current,desired:null}));f.setRgbFailure(true);
  const plan=await f.application.prepare(f.profile,"local");await f.application.apply(plan.token!);assert.equal(f.runtime.status().active,true);
  await f.state.store.update(undefined,current=>({...current,desired:{...current.desired!,rgb:banks()}}));
  const before=f.counters();f.setConnected(false);f.raw.layers[0]!.reports[0]=bindingPacket(1,1,{kind:"shortcut",keys:"Z"}).replace(/^03FD/,"03FA");f.setConnected(true);await f.state.idle();
  assert.equal(f.counters().writes,before.writes+1);assert.equal(f.counters().rgbWrites,0);assert.equal(f.counters().rgbReads,before.rgbReads);assert.equal(f.runtime.status().paused,false);
  const explicitRead=await f.state.read();assert.equal(explicitRead.readStatus.rgb.current,false);assert.match(explicitRead.readStatus.rgb.error,/timeout/);assert.equal(explicitRead.session.phase,"ready");assert.equal(f.runtime.status().paused,false);
  f.state.observeLayer(2,Date.now());await f.state.reconcile();f.application.stop();await f.application.start();assert.equal(f.runtime.status().active,true);assert.equal(f.counters().rgbWrites,0);
 }finally{await f.state.close();}
});

test("legacy profile data survives save/export/import while simulation preserves actions and ignores lighting sources",async()=>{
 const f=await reconciliationFixture();try{
  const document=defaultDocument(),profile=document.profiles[0]!,rule=profile.layers[0]!.controls[0]!.rules.find(rule=>rule.trigger==="press")!;
  rule.behavior.light.effect={...emptyEffect(),mode:"breathe",intensity:{source:{kind:"input",key:"audio:microphone:level",label:"legacy",type:"number",provider:"windows"},inputMin:0,inputMax:100}};
  rule.behavior.action={kind:"text",value:"preserved action"};
  const serialized=JSON.stringify(document),store=new ProfileStore(f.directory);await store.save(document,0);
  const saved=await store.load();assert.equal(JSON.stringify(parseDocument(JSON.parse(JSON.stringify(saved.document)))),serialized);assert.deepEqual(JSON.parse(await readFile(join(f.directory,"profiles.json"),"utf8")).document,document);
  let runtime=startRuntime(profile);runtime=simulateRule(profile,runtime,0,"key-1",rule);runtime=changeEvent(profile,runtime,profile.events[0]!.id,profile.events[0]!.states[1]!.id);runtime=activateLayer(profile,runtime,2);
  assert.deepEqual(runtime.lights,{});assert.ok(runtime.logs.some(log=>log.includes("preserved action")));assert.ok(!profileSources(profile).some(source=>source.kind==="input"&&source.key==="audio:microphone:level"));assert.equal(JSON.stringify(document),serialized);
 }finally{await f.state.close();}
});

test("HTTP static endpoint uses real coordinator/services offline; legacy apply refuses dynamic modes",async()=>{
 const f=await reconciliationFixture(),api=createApiHandler(new ProfileStore(f.directory),f.device,{configuration:f.configuration,rgb:f.rgb,runtime:f.runtime});
 const server=createServer((req,res)=>{void api(req,res);});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();assert.ok(address&&typeof address!=="string");
 const base=`http://127.0.0.1:${address.port}`,post=(path:string,body:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 try{
  const fresh=await (await post("/api/device/rgb/read",{})).json(),body={layers:[0,2],slots:[0,15],color:"#060710",fingerprint:fresh.snapshot.fingerprint};
  assert.equal((await post("/api/device/rgb/static",{...body,layers:[0,0]})).status,400);assert.equal((await post("/api/device/rgb/static",{...body,settings:{}})).status,400);
  assert.equal((await fetch(base+"/api/device/rgb/static",{method:"POST",body:JSON.stringify(body)})).status,415);
  assert.equal((await fetch(base+"/api/device/rgb/static",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://foreign.example"},body:JSON.stringify(body)})).status,403);
  for(const mode of [0,2,3,4,5])assert.equal((await post("/api/device/rgb/apply",{layer:0,settings:{mode,colors:Array(16).fill("#000000")},fingerprint:body.fingerprint})).status,400);
  const response=await post("/api/device/rgb/static",body);assert.equal(response.status,200);const result=await response.json();assert.equal(result.snapshot.layers[0].colors[0],"#060710");assert.equal(result.state.delivery.rgb.confirmedByRead,true);
  assert.equal((await post("/api/device/rgb/static",body)).status,400);assert.equal(f.counters().rgbWrites,1);
 }finally{await api.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
