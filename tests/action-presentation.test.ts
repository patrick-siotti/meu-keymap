import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeProfile,profileSchema,controlName } from "../lib/model.ts";
import { startRuntime,simulate } from "../lib/engine.ts";
import { actionPresentation,controlPresentation } from "../lib/action-presentation.ts";
import { profileStamp } from "../lib/profile-stamp.ts";
test("labels and icons follow the action on any slot and preserve an explicit custom name",async()=>{
  const profile=makeProfile("presentation","Presentation"),control=profile.layers[0]!.controls[2]!;
  control.label="Recortar";control.rules[0]!.behavior.action={kind:"shortcut",keys:"Ctrl + C"};
  assert.deepEqual(controlPresentation(control,profile),{label:"Copiar",icon:"copy"});
  assert.equal(controlName(control,profile),"Tecla 3 · Copiar");
  assert.ok(simulate(profile,startRuntime(profile),0,"key-3","press").logs.some(line=>line.includes("Tecla 3 · Copiar")));
  control.rules[0]!.behavior.action={kind:"shortcut",keys:"Ctrl+V"};assert.deepEqual(controlPresentation(control,profile),{label:"Colar",icon:"paste"});
  control.rules[0]!.behavior.action={kind:"shortcut",keys:"A"};assert.deepEqual(controlPresentation(control,profile),{label:"A",icon:"keyboard"});
  control.label="Minha ação";control.labelMode="custom";assert.equal(controlPresentation(control,profile).label,"Minha ação");
  assert.equal(profileSchema.parse(profile).layers[0]!.controls[2]!.labelMode,"custom");
  assert.deepEqual(actionPresentation({kind:"shortcut",keys:"Ctrl+X"}),{label:"Recortar",icon:"cut"});
  const first=await profileStamp(profile);control.rules[0]!.behavior.action={kind:"shortcut",keys:"B"};assert.notEqual(await profileStamp(profile),first);
});
test("actual board renders Copy for key 03 and encoder 3 rather than positional Cut/Zoom icons",async()=>{
  const vite=await createServer({server:{middlewareMode:true},appType:"custom"});
  try{
    const {DeviceBoard}=await vite.ssrLoadModule("/src/components/DeviceBoard.tsx");
    const profile=makeProfile("render","Render");
    for(const id of ["key-3","knob-3"]){const control=profile.layers[0]!.controls.find(c=>c.id===id)!;control.rules.find(r=>r.trigger==="press")!.behavior.action={kind:"shortcut",keys:"Ctrl+C"};}
    const html=renderToStaticMarkup(createElement(DeviceBoard,{profile,layer:0,selected:"key-3",event:"press",runtime:startRuntime(profile),testing:false,now:Date.now(),onSelect:()=>{}}));
    const key=html.match(/<button[^>]*aria-label="Tecla 3: Copiar"[\s\S]*?<\/button>/)?.[0];assert.ok(key);assert.match(key,/data-action-icon="copy"/);assert.doesNotMatch(key,/data-action-icon="cut"/);
    const encoder=html.match(/<button[^>]*aria-label="Encoder 3: clique"[\s\S]*?<\/button>/)?.[0];assert.ok(encoder);assert.match(encoder,/data-action-icon="copy"/);
  }finally{await vite.close();}
});
