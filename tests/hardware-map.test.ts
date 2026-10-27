import test from "node:test";
import assert from "node:assert/strict";
import { hardwareAddress, hardwareMapSchema, parseHardwareMap, profileFromHardware } from "../lib/hardware-map.ts";
import { documentSchema } from "../lib/model.ts";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { ProfileStore,createApiHandler } from "../server.ts";
function fixture() {
  const hex = (b:number[]) => Buffer.from(b).toString("hex").toUpperCase();
  const identity = new Array<number>(65).fill(0);
  identity.splice(0,5,3,251,16,3,11);
  return {at:Date.now(),devicePath:"test-device",identity:hex(identity),error:null,layers:[1,2,3].map(layer=>({layer,reports:Array.from({length:25},(_,i)=>{
    const b=new Array<number>(65).fill(0);b.splice(0,10,3,250,i+1,layer,1,1,1,0,0,4+i);
    if(layer===1 && i===0){b[5]=0;b[6]=2;b[9]=241;b[12]=6;}
    if(layer===1 && (i===2||i===3)){b[5]=0;b[6]=0;b[9]=0;}
    return hex(b);
  })}))};
}
test("75 addresses include silent NULL slots and separate configuration banks",()=>{
  const map=parseHardwareMap(fixture(),"read-test.json");
  assert.equal(map.entries.length,75);
  assert.equal(map.entries[0]!.label,"Ctrl + C");
  assert.equal(map.entries[2]!.label,"NULL");
  assert.deepEqual(map.entries[2]!.action,{kind:"none"});
  assert.equal(map.entries[27]!.label,"C");
  assert.equal(hardwareMapSchema.safeParse(map).success,true);
  for(const [trigger,slot] of [["left",17],["press",18],["right",19]] as const)
    assert.deepEqual(hardwareAddress("knob-1",trigger,2),{slot,layer:3});
  assert.deepEqual(hardwareAddress("knob-3","right",0),{slot:25,layer:1});
  assert.deepEqual(hardwareAddress("key-3","release",0),{slot:3,layer:1});
  assert.equal(hardwareAddress("layer-switch","press",0),null);
  assert.equal(hardwareAddress("key-1","press",3),null);
});
test("reject incomplete, duplicate, cross-bank and incompatible responses",()=>{
  const missing=fixture();missing.layers[0]!.reports.pop();assert.throws(()=>parseHardwareMap(missing));
  const duplicate=fixture();duplicate.layers[0]!.reports[1]=duplicate.layers[0]!.reports[0]!;assert.throws(()=>parseHardwareMap(duplicate));
  const crossed=fixture();crossed.layers[1]!.reports[0]=crossed.layers[0]!.reports[0]!;assert.throws(()=>parseHardwareMap(crossed));
  const banks=fixture();banks.layers[1]!.layer=1;assert.throws(()=>parseHardwareMap(banks));
  const identity=fixture();identity.identity=identity.identity.replace("03FB10030B","03FB100309");assert.throws(()=>parseHardwareMap(identity));
  const odd=fixture();odd.identity=odd.identity.slice(0,-1);assert.throws(()=>parseHardwareMap(odd));
});
test("import creates editable actions at fixed slots without inventing RGB or event behavior",()=>{
  const map=parseHardwareMap(fixture());
  const profile=profileFromHardware(map,"hardware-profile","Do macropad");
  assert.deepEqual(profile.events,[]);
  assert.deepEqual(profile.layers[0]!.controls[2]!.rules[0]!.behavior.action,{kind:"none"});
  const encoder=profile.layers[0]!.controls.find(c=>c.id==="knob-1")!;
  assert.deepEqual(encoder.rules.slice(0,3).map(r=>r.behavior.action),["Q","R","S"].map(keys=>({kind:"shortcut",keys})));
  assert.ok(profile.layers.every(l=>l.controls.every(c=>c.rules.every(r=>r.behavior.light.effect.mode==="none"))));
  assert.equal(documentSchema.safeParse({version:3,profiles:[profile],activeProfile:profile.id}).success,true);
  const action=profile.layers[0]!.controls[0]!.rules[0]!.behavior.action;
  if(action.kind==="shortcut")action.keys="X";
  assert.equal(map.entries[0]!.label,"Ctrl + C");
});
test("unknown action remains raw and blocks lossy import",()=>{
  const raw=fixture();raw.layers[0]!.reports[0]=raw.layers[0]!.reports[0]!.slice(0,8)+"03"+raw.layers[0]!.reports[0]!.slice(10);
  const map=parseHardwareMap(raw);
  assert.equal(map.entries[0]!.action,null);
  assert.equal(map.entries[0]!.raw,raw.layers[0]!.reports[0]);
  assert.throws(()=>profileFromHardware(map,"id","Name"));
});
test("cached map API preserves profiles and rejects foreign-origin queries",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-code-test-")),raw=fixture();
  await writeFile(join(directory,"hardware-latest.json"),JSON.stringify({raw,backup:"test.json"}));
  await writeFile(join(directory,"profiles.json"),"preserve-me");
  const handler=createApiHandler(new ProfileStore(directory));
  const server=createServer((req,res)=>{void handler(req,res);});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const url=`http://127.0.0.1:${address.port}/api/device/configuration`;
  try {
    const response=await fetch(url);assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.snapshot.entries.length,75);
    assert.equal(body.snapshot.entries[2].label,"NULL");
    assert.equal((await fetch(url+"/read",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://foreign.example"}})).status,403);
    assert.equal((await fetch(url+"/read",{method:"POST"})).status,415);
    assert.equal((await fetch(url+"/apply",{method:"POST"})).status,404);
    assert.equal(await readFile(join(directory,"profiles.json"),"utf8"),"preserve-me");
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
