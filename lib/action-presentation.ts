import { CATALOG, LEGACY_CATALOG_TITLES } from "./catalog.ts";
import { actionLabel } from "./actions.ts";
import type { Action,Control,Profile,Trigger } from "./model.ts";
import { chordIdentity } from "./keys.ts";
import type { ActionIconName } from "./control-icon.ts";
export type { ActionIconName } from "./control-icon.ts";
const shortcutKey=(keys:string)=>{try{return chordIdentity(keys);}catch{return null;}};
const icons=new Map<string,ActionIconName>(Object.entries({"Ctrl+C":"copy","Ctrl+V":"paste","Ctrl+X":"cut","Ctrl+Z":"undo","Ctrl+Y":"redo","Ctrl+S":"save","Ctrl+F":"search","Win+Shift+S":"capture","Win+E":"folder","Win+D":"desktop","Win+L":"lock"} as const).map(([keys,icon])=>[chordIdentity(keys),icon]));
export function actionPresentation(action:Action):{label:string;icon:ActionIconName}{
  if(action.kind==="none")return {label:"Configurar",icon:"plus"};
  if(action.kind==="shortcut"){
    const key=shortcutKey(action.keys),match=key?CATALOG.find(item=>item.action.kind==="shortcut"&&shortcutKey(item.action.keys)===key):undefined;
    return {label:match?.title??actionLabel({kind:"shortcut",keys:action.keys.replace(/\s*\+\s*/g,"+")}),icon:key?icons.get(key)??"keyboard":"keyboard"};
  }
  if(action.kind==="media")return {label:actionLabel(action),icon:({volumeUp:"volume",volumeDown:"volume",mute:"mute",playPause:"play",next:"next",previous:"previous"} as const)[action.command]};
  return {label:action.kind==="text"?"Escrever texto":action.kind==="macro"?"Sequência de atalhos":action.kind==="command"?action.path.split(/[\\/]/).pop()??"Comando":`Camada ${action.value+1}`,icon:action.kind==="text"?"text":action.kind==="macro"?"macro":action.kind==="command"?"command":"layer"};
}
export function primaryRule(control:Control,trigger:Trigger="press"){
  return control.rules.find(rule=>rule.trigger===trigger&&!rule.qualifier.controlId&&!rule.qualifier.modifiers.length);
}
const legacyLabels=new Set([...LEGACY_CATALOG_TITLES,"Captura","Explorador","Play / pause","Próxima","Sem som","Gravando","Bloquear","Volume","Mídia","Zoom"]);
export function usesCustomLabel(control:Control):boolean {
  if(control.labelMode)return control.labelMode==="custom"&&!!control.label;
  if(!control.label||legacyLabels.has(control.label))return false;
  if(/^(?:(?:Ctrl|Shift|Alt|Win|RightCtrl|RightShift|RightAlt|RightWin)\s*\+\s*)*(?:[A-Z0-9]|F\d{1,2})$/i.test(control.label))return false;
  return true;
}
export function controlPresentation(control:Control,profile:Profile){
  const rule=primaryRule(control),action=rule?.behavior.action??{kind:"none" as const};
  let presentation=actionPresentation(action);
  if(action.kind==="none"&&rule?.behavior.transition.eventId)presentation={label:profile.events.find(e=>e.id===rule.behavior.transition.eventId)?.name??"Alterar evento",icon:"event"};
  return {...presentation,label:usesCustomLabel(control)?control.label:presentation.label,...(control.icon?{customIcon:control.icon}:{})};
}
