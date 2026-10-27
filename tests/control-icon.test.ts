import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlIconSchema,validIconPng,MAX_ICON_DATA_URL } from "../lib/control-icon.ts";
import { actionPresentation,controlPresentation } from "../lib/action-presentation.ts";
import { chordIdentity } from "../lib/keys.ts";
import { profileStamp } from "../lib/profile-stamp.ts";
import { makeProfile,parseDocument,profileSchema } from "../lib/model.ts";
import { ProfileStore } from "../server.ts";
import { createApiHandler } from "../server.ts";
import { createServer } from "node:http";
function crc(bytes:Buffer){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export function png(width=1,height=1){
  const chunk=(type:string,body:Buffer)=>{const length=Buffer.alloc(4),tail=Buffer.alloc(4);length.writeUInt32BE(body.length);const content=Buffer.concat([Buffer.from(type),body]);tail.writeUInt32BE(crc(content));return Buffer.concat([length,content,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(1+width*4)+1+x*4;raw[i]=235;raw[i+3]=128;}
  return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
test("shortcut icon identity uses parser semantics without changing execution bytes",()=>{
  for(const keys of ["Win+Shift+S","Shift+Win+S"," shift + meta + s ","META+SHIFT+s"]){assert.equal(actionPresentation({kind:"shortcut",keys}).icon,"capture");assert.equal(chordIdentity(keys),chordIdentity("Win+Shift+S"));}
  for(const keys of ["Ctrl+X","CONTROL + x"]){assert.equal(actionPresentation({kind:"shortcut",keys}).icon,"cut");}
  assert.equal(actionPresentation({kind:"shortcut",keys:"Alt+F9"}).icon,"keyboard");
  for(const keys of ["Ctrl+Unknown","Ctrl+Control+C","garbage"]){assert.throws(()=>chordIdentity(keys));assert.equal(actionPresentation({kind:"shortcut",keys}).icon,"keyboard");}
  assert.notEqual(chordIdentity("RightWin+Shift+S"),chordIdentity("Win+Shift+S"));
});
test("HTTP icon/body limits return readable errors and preserve the last saved document",async()=>{
  const store=new ProfileStore(await mkdtemp(join(tmpdir(),"keymap-icon-api-"))),handler=createApiHandler(store);
  const server=createServer((req,res)=>{void handler(req,res);});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
  const profile=makeProfile("http-icons","HTTP icons"),document={version:3 as const,activeProfile:profile.id,profiles:[profile]};
  await store.save(document,0);const prior=await store.load();
  try{
    for(const icon of [{kind:"image",dataUrl:png(129,1)},{kind:"image",dataUrl:"https://example.com/image.png"},{kind:"image",dataUrl:"data:image/png;base64,"+"A".repeat(MAX_ICON_DATA_URL)}]){
      const copy=structuredClone(document);Object.assign(copy.profiles[0]!.layers[0]!.controls[0]!,{icon});
      const response=await fetch(base+"/api/profiles",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({document:copy,revision:1})});
      assert.equal(response.status,400);assert.match((await response.json()).error,/ícone|Imagem inválida/i);assert.deepEqual(await store.load(),prior);
    }
    const oversized=await fetch(base+"/api/profiles",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({document,revision:1,padding:"a".repeat(2_000_000)})});
    assert.equal(oversized.status,413);assert.match((await oversized.json()).error,/2 MB/);assert.deepEqual(await store.load(),prior);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await handler.close();}
});
test("icon validation rejects external/SVG, malformed base64/PNG, oversize and invalid dimensions",()=>{
  assert.equal(validIconPng(png(128,64)),true);
  for(const value of [png(129,1),png(1,129),png(0,1),png().slice(0,-3),png()+"AAAA",png().replace("AAAA", "AAAB"),"data:image/svg+xml;base64,PHN2Zy8+","https://example.com/icon.png","data:image/png;base64,!!!!","data:image/png;base64,"+"A".repeat(MAX_ICON_DATA_URL)])assert.equal(validIconPng(value),false,value.slice(0,50));
  assert.equal(controlIconSchema.safeParse({kind:"library",name:"not-a-lucide-choice"}).success,false);
  assert.equal(controlIconSchema.safeParse({kind:"image",dataUrl:png(),url:"https://example.com"}).success,false);
});
test("icons survive save/reload/duplicate/export/import without changing legacy execution stamp",async()=>{
  const profile=makeProfile("icons","Ícones"),control=profile.layers[0]!.controls[2]!,store=new ProfileStore(await mkdtemp(join(tmpdir(),"keymap-icon-roundtrip-")));
  const baseline=await profileStamp(profile),legacy=profileSchema.parse(profile);
  control.icon={kind:"library",name:"star"};assert.equal(await profileStamp(profile),baseline);
  control.label="Pessoal";control.labelMode="custom";assert.notEqual(await profileStamp(profile),baseline);
  const nameStamp=await profileStamp(profile);control.icon={kind:"image",dataUrl:png(64,32)};assert.equal(await profileStamp(profile),nameStamp);
  control.rules[0]!.behavior.action={kind:"shortcut",keys:"Shift+Meta+S"};assert.equal(controlPresentation(control,profile).label,"Pessoal");assert.deepEqual(controlPresentation(control,profile).customIcon,control.icon);
  const copy={...structuredClone(profile),id:"duplicate",name:"Cópia"};
  const document={version:3 as const,activeProfile:profile.id,profiles:[profile,copy, {...legacy,id:"legacy"}]};
  await store.save(document,0);const loaded=await store.load(),imported=parseDocument(JSON.parse(JSON.stringify(loaded.document)));
  assert.deepEqual(imported,document);assert.equal(imported.profiles[1]!.layers[0]!.controls[2]!.icon?.kind,"image");assert.equal(imported.profiles[2]!.layers[0]!.controls[2]!.icon,undefined);
  delete control.icon;assert.equal(controlPresentation(control,profile).icon,"capture");assert.equal(controlPresentation(control,profile).customIcon,undefined);
});
