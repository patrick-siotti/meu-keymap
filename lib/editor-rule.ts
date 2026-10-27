import { makeRule } from "./model.ts";
import type { Control,Rule,Trigger } from "./model.ts";
import { primaryRule } from "./action-presentation.ts";

export interface EditorRule { rule:Rule|undefined; virtual:boolean; }
export function resolveEditorRule(control:Control,selectedId:string,trigger:Trigger="press"):EditorRule {
  const stored=control.rules.find(rule=>rule.id===selectedId)??primaryRule(control,trigger);
  if(stored)return {rule:stored,virtual:false};
  if(trigger!=="press")return {rule:undefined,virtual:false};
  let id="press",suffix=2;
  while(control.rules.some(rule=>rule.id===id))id=`press-${suffix++}`;
  return {rule:makeRule(id,"press"),virtual:true};
}
export function editControlRule(control:Control,selection:EditorRule,edit:(rule:Rule)=>Rule):Rule[] {
  if(!selection.rule)return control.rules;
  const selected=selection.rule;
  if(!selection.virtual)return control.rules.map(rule=>rule.id===selected.id?edit(structuredClone(rule)):rule);
  if(control.rules.length>=100)throw new Error("Este controle já tem 100 gatilhos. Remova um antes de configurar o clique.");
  // An explicit edit is the only place where the default becomes document data.
  return [...control.rules,edit(structuredClone(selected))];
}
