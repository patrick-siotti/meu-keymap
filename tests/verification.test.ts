import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HardwareVerifier } from "../native/verification.ts";
import { markerKeys } from "../lib/bindings.ts";
import type { DeviceEvent } from "../lib/device.ts";
test("physical verification confirms only the selected real code/layer and resumes inputs without changing bindings",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-physical-check-"));let listener:((event:DeviceEvent)=>void)|null=null,paused=0,resumed=0;
  const verifier=new HardwareVerifier(directory,{inventory:async()=>({type:"inventory",at:Date.now(),platform:"win32",devices:[]}),subscribe:()=>{},recent:()=>[],observe:callback=>{listener=callback;return()=>{listener=null;};}},{pauseForVerification:async()=>{paused++;return "fingerprint";},resumeAfterVerification:()=>{resumed++;}});
  const pulse=(index:number)=>{for(const released of [false,true])for(const code of markerKeys(index))listener?.({type:"input",kind:"keyboard",at:Date.now(),devicePath:"test",data:{vkey:code+20,released,modifiers:0}});};
  try{
    await verifier.start();assert.equal(paused,1);await assert.rejects(verifier.start(),/andamento/);assert.equal(resumed,0);
    verifier.select(0,17);pulse(0);assert.deepEqual(verifier.status().confirmed,{});assert.match(verifier.status().lastReceived,/Tecla 01/);
    pulse(16);pulse(16);assert.equal(verifier.status().confirmed["0:17"]?.count,2);assert.equal(verifier.status().confirmed["0:17"]?.double,true);
    verifier.select(1,17);pulse(16);assert.equal(Object.keys(verifier.status().confirmed).length,1);pulse(41);assert.equal(Object.keys(verifier.status().confirmed).length,2);
    await verifier.stop();assert.equal(resumed,1);assert.equal(verifier.status().active,false);pulse(41);assert.equal(verifier.status().confirmed["1:17"]?.count,1);
    const saved=JSON.parse(await readFile(join(directory,"hardware-verification.json"),"utf8"));assert.equal(saved.active,false);assert.equal(saved.confirmed["0:17"].count,2);
  }finally{await verifier.stop();}
});
