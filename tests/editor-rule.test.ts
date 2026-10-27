import test from "node:test";
import assert from "node:assert/strict";
import { makeProfile,makeRule,profileSchema } from "../lib/model.ts";
import { resolveEditorRule,editControlRule } from "../lib/editor-rule.ts";
import { profileStamp } from "../lib/profile-stamp.ts";

test("default click is virtual and navigation cannot mutate or execute activation",async()=>{
  const profile=makeProfile("default-click","Default click"),control=profile.layers[0]!.controls[2]!;
  const activation=makeRule("activate","activate");activation.behavior.action={kind:"shortcut",keys:"Ctrl+X"};control.rules=[activation];
  const original=JSON.stringify(profile),stamp=await profileStamp(profile);
  for(let i=0;i<10;i++){
    const selection=resolveEditorRule(control,"");assert.equal(selection.virtual,true);assert.equal(selection.rule?.trigger,"press");assert.equal(selection.rule?.behavior.action.kind,"none");
    assert.deepEqual(resolveEditorRule(control,"activate").rule,activation);
  }
  assert.equal(JSON.stringify(profile),original);assert.equal(await profileStamp(profile),stamp);
  control.rules=editControlRule(control,resolveEditorRule(control,""),r=>({...r,behavior:{...r.behavior,action:{kind:"shortcut",keys:"Ctrl+C"}}}));
  assert.equal(control.rules.length,2);assert.deepEqual(control.rules[0],activation);assert.equal(resolveEditorRule(control,"").virtual,false);assert.equal(resolveEditorRule(control,"").rule?.behavior.action.kind,"shortcut");
  const saved=profileSchema.parse(JSON.parse(JSON.stringify(profile)));assert.deepEqual(saved,profile);
  control.rules=control.rules.filter(r=>r.trigger!=="press");assert.equal(resolveEditorRule(control,"").virtual,true);assert.equal(resolveEditorRule(control,"").rule?.behavior.action.kind,"none");assert.deepEqual(control.rules,[activation]);
});
test("condition and event edits materialize once, preserve existing presses and avoid id collisions",()=>{
  const control=makeProfile("click-edit","Click edit").layers[0]!.controls[0]!;
  control.rules=[makeRule("press","activate")];control.icon={kind:"library",name:"star"};
  const selected=resolveEditorRule(control,"");assert.equal(selected.virtual,true);assert.equal(selected.rule?.id,"press-2");
  control.rules=editControlRule(control,selected,r=>({...r,condition:{id:"condition",kind:"all",children:[]}}));
  const stored=resolveEditorRule(control,"");assert.equal(stored.virtual,false);assert.equal(stored.rule?.condition.id,"condition");
  control.rules=editControlRule(control,stored,r=>({...r,behavior:{...r.behavior,transition:{eventId:"event",stateId:"",operation:"next"}}}));
  assert.equal(control.rules.filter(r=>r.trigger==="press").length,1);assert.deepEqual(control.icon,{kind:"library",name:"star"});
  assert.equal(resolveEditorRule(control,"","left").rule,undefined);
  const left=makeRule("left","left");control.rules.push(left);assert.deepEqual(resolveEditorRule(control,"left","left").rule,left);
  assert.equal(resolveEditorRule(control,"","press").rule?.trigger,"press");
});
