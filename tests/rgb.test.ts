import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile,readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rgbPacket,parseRgb } from "../lib/rgb.ts";
import type { RgbLayer } from "../lib/rgb.ts";
import { bindingPacket } from "../lib/bindings.ts";
import { ConfigurationReader } from "../native/configuration.ts";
import { RgbService } from "../native/rgb.ts";
const path="test-device",identity="03FB10030B"+"00".repeat(60);
const off=():RgbLayer=>({mode:0,colors:Array(16).fill("#000000")});
const raw=(layers:RgbLayer[])=>({at:Date.now(),devicePath:path,identity,layers:layers.map((l,layer)=>({layer,raw:"03FA"+rgbPacket(layer,l).slice(8,106)+"00".repeat(14)}))});
const bindings=()=>({at:Date.now(),devicePath:path,identity,error:null,layers:[1,2,3].map(layer=>({layer,reports:Array.from({length:25},(_,i)=>bindingPacket(i+1,layer,{kind:"none"}).replace(/^03FD/,"03FA"))}))});
test("RGB codec follows original offsets and validates actual device replies without assuming requested colors",()=>{
  const settings=off();settings.mode=1;settings.colors[0]="#102030";settings.colors[15]="#AABBCC";
  const packet=rgbPacket(0,settings);assert.equal(packet.length,130);assert.equal(packet.slice(0,16),"03FEB00001102030");assert.equal(packet.slice(100,106),"AABBCC");
  assert.deepEqual(parseRgb(raw([settings,off(),off()])).layers[0],settings);
  assert.throws(()=>rgbPacket(3,settings));assert.throws(()=>rgbPacket(0,{...settings,mode:6}));
  const invalid=raw([settings,off(),off()]);invalid.layers[0]!.raw=invalid.layers[0]!.raw.slice(0,-2)+"01";assert.throws(()=>parseRgb(invalid));
});
test("RGB performs baseline/backup/readback, preserves the other layers and bindings, and rejects stale state",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-rgb-"));let layers=[off(),off(),off()],writes=0,failNext=false;
  const config=new ConfigurationReader(directory,{read:async()=>bindings(),write:async()=>{assert.fail("RGB must not write bindings");}});
  const service=new RgbService(directory,config,{read:async()=>raw(layers),write:async packets=>{writes++;assert.equal(packets.length,1);if(failNext){failNext=false;return;}for(const packet of packets){const bytes=packet.match(/../g)!.map(v=>parseInt(v,16)),layer=bytes[3]!;layers[layer]={mode:bytes[4]!,colors:Array.from({length:16},(_,i)=>"#"+packet.slice((5+i*3)*2,(8+i*3)*2))};}}});
  const before=await service.read(),settings=off();settings.mode=1;settings.colors[2]="#004000";
  const result=await service.apply(0,settings,before.fingerprint);assert.equal(writes,1);assert.deepEqual(result.layers,[settings,off(),off()]);assert.notEqual(result.fingerprint,before.fingerprint);
  const backup=JSON.parse(await readFile(join(directory,"rgb-backups",before.backup),"utf8"));assert.deepEqual(parseRgb(backup).layers,[off(),off(),off()]);
  await assert.rejects(service.apply(1,settings,before.fingerprint),/mudou/);assert.equal(writes,1);
  failNext=true;await assert.rejects(service.apply(1,settings,result.fingerprint),/restaurada e relida/);assert.equal(writes,3);assert.deepEqual((await service.read()).layers,[settings,off(),off()]);
});
test("unrecognized RGB replies are backed up and never become confirmed state",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-rgb-unknown-")),reply=raw([off(),off(),off()]);reply.layers[0]!.raw="03FAFF"+reply.layers[0]!.raw.slice(6);
  const service=new RgbService(directory,new ConfigurationReader(directory,{read:async()=>bindings(),write:async()=>{assert.fail("No binding write");}}),{read:async()=>reply,write:async()=>{assert.fail("Unknown replies must not be written");}});
  await assert.rejects(service.read(),/desconhecida/);assert.equal((await readdir(join(directory,"rgb-backups"))).length,1);assert.equal(await service.latest(),null);
});
