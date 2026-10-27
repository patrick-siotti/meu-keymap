import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bindingPacket,markerPacket,markerKeys,compileProfile } from "../lib/bindings.ts";
import { makeProfile } from "../lib/model.ts";
import { ConfigurationReader,mapFingerprint } from "../native/configuration.ts";
test("FD compiler addresses all banks, bounds macros, preserves modifiers and unique local markers",()=>{
  assert.ok(bindingPacket(1,1,{kind:"shortcut",keys:"Ctrl+C"}).startsWith("03FD01010100020000F10032060032"));
  assert.ok(bindingPacket(25,3,{kind:"shortcut",keys:"F24"}).startsWith("03FD19030101010000730032"));
  assert.equal(new Set(Array.from({length:75},(_,i)=>markerKeys(i).join(","))).size,75);
  assert.ok(markerPacket(3,2).startsWith("03FD03020100040000730032"));
  assert.throws(()=>bindingPacket(1,1,{kind:"macro",steps:Array.from({length:19},()=>({keys:"A",delay:50}))}));
  const profile=makeProfile("test","Test");profile.events=[];
  assert.equal(compileProfile(profile,"local").packets.length,75);
  profile.layers[0]!.controls[0]!.rules[0]!.trigger="hold";
  assert.ok(compileProfile(profile,"local").errors.some(e=>e.includes("segurar/soltar")));
});
function fakeDevice(){
  const hex=(bytes:number[])=>Buffer.from(bytes).toString("hex").toUpperCase();
  const identity=new Array<number>(65).fill(0);identity.splice(0,5,3,251,16,3,11);
  const raw={at:Date.now(),devicePath:"test",identity:hex(identity),error:null,layers:[1,2,3].map(layer=>({layer,reports:Array.from({length:25},(_,i)=>bindingPacket(i+1,layer,{kind:"none"}).replace(/^03FD/,"03FA"))}))};
  return raw;
}
test("write transaction verifies all slots, rejects stale baseline and restores on partial failure",async()=>{
  const raw=fakeDevice();let writes=0,fail=false;
  const adapter={read:async()=>structuredClone(raw),write:async(packets:string[])=>{writes++;for(const p of packets){const slot=parseInt(p.slice(4,6),16),layer=parseInt(p.slice(6,8),16);raw.layers[layer-1]!.reports[slot-1]=p.replace(/^03FD/,"03FA");if(fail){fail=false;throw new Error("Disconnected after write");}}}};
  const reader=new ConfigurationReader(await mkdtemp(join(tmpdir(),"keymap-write-")),adapter);
  const before=await reader.read(),packet=bindingPacket(3,1,{kind:"shortcut",keys:"F24"});
  const applied=await reader.apply([packet],mapFingerprint(before));assert.equal(applied.changed,1);assert.equal(applied.map.entries[2]!.label,"F24");
  await assert.rejects(reader.apply([packet],mapFingerprint(before)),/mudou/);
  assert.equal(writes,1);
  fail=true;await assert.rejects(reader.apply([bindingPacket(3,1,{kind:"none"})]),/restaurada/);
  assert.equal((await reader.read()).entries[2]!.label,"F24");
});
