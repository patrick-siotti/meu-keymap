import { conditionSources,conditionCount } from "./conditions.ts";
import { HARDWARE_CHANNELS } from "./hardware-map.ts";
import { parseChord } from "./keys.ts";
import type { Action,Profile } from "./model.ts";
import { OBS_KEYS } from "./obs.ts";
export type ApplicationMode="device"|"local";
export interface BindingPlan {mode:ApplicationMode;packets:string[];errors:string[];warnings:string[];}
export const packetHex=(bytes:number[])=>bytes.map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
export const packetBytes=(hex:string)=>hex.match(/../g)!.map(b=>parseInt(b,16));
export function bindingPacket(slot:number,layer:number,action:Action):string {
  const b=new Array<number>(65).fill(0);b.splice(0,5,3,253,slot,layer,1);
  if(slot<1||slot>25||layer<1||layer>3)throw new Error("Endereço inválido.");
  if(action.kind==="none")return packetHex(b);
  if(action.kind==="media"){
    b[4]=2;b[6]=2;b[9]=({volumeUp:233,volumeDown:234,mute:226,playPause:205,next:181,previous:182})[action.command];return packetHex(b);
  }
  if(action.kind!=="shortcut"&&action.kind!=="macro")throw new Error("Esta ação precisa do modo Automações.");
  const steps=action.kind==="shortcut"?[{keys:action.keys,delay:50}]:action.steps;
  const entries:{code:number;delay:number}[]=[];
  for(const step of steps){const chord=parseChord(step.keys);for(const code of chord.modifiers)entries.push({code,delay:50});entries.push({code:chord.key,delay:step.delay});}
  if(entries.length>18)throw new Error("O aparelho aceita no máximo 18 entradas por macro, contando modificadores.");
  b[5]=action.kind==="shortcut"&&entries.length===1?1:0;b[6]=entries.length;
  entries.forEach((e,i)=>{b[9+3*i]=e.code;b[10+3*i]=e.delay>>8;b[11+3*i]=e.delay&255;});
  return packetHex(b);
}
export const MARKERS:number[][]=[];
for(let a=0;a<9;a++)for(let b=a+1;b<10;b++)for(let c=b+1;c<11;c++)MARKERS.push([115,104+a,104+b,104+c]);
export function markerKeys(index:number):number[]{if(!Number.isInteger(index)||index<0||index>=75)throw new Error("Marcador inválido.");return [...MARKERS[index]!];}
export function markerPacket(slot:number,layer:number):string {
  const b=packetBytes(bindingPacket(slot,layer,{kind:"none"}));b[6]=4;
  markerKeys((layer-1)*25+slot-1).forEach((key,i)=>{b[9+i*3]=key;b[11+i*3]=50;});return packetHex(b);
}
export function compileProfile(profile:Profile,mode:ApplicationMode):BindingPlan {
  const errors:string[]=[],warnings=new Set<string>(),packets:string[]=[];
  const rgbWarning="Dados antigos de luz são preservados, mas não são executados. Configure cores estáticas na aba LEDs.";
  if(profile.events.some(e=>e.states.some(s=>s.lights.length||s.otherwise?.lights.length)))warnings.add(rgbWarning);
  if(mode==="device"&&profile.events.length)errors.push("Eventos personalizados precisam do modo Automações.");
  const checkSources=(sources:ReturnType<typeof conditionSources>,where:string)=>{
    for(const source of sources){
      if(source.kind==="key")errors.push(`${where}: estado de tecla mantida não é confiável neste firmware; use um evento de segurança.`);
      if(source.kind==="input"&&source.provider!=="windows"&&!(source.provider==="obs"&&OBS_KEYS.some(key=>key===source.key)))warnings.add(`Fonte ${source.label} sem adaptador: valor desconhecido, seguirá Senão.`);
    }
  };
  profile.layers.forEach((layer,index)=>{
    for(const control of layer.controls){
      const where=`Camada ${index+1}, ${control.id}`;
      for(const rule of control.rules){
        if(rule.behavior.light.effect.mode!=="none"||rule.otherwise?.light.effect.mode&&rule.otherwise.light.effect.mode!=="none")warnings.add(rgbWarning);
        if(mode==="device"){
          if(rule.trigger==="activate"&&rule.behavior.action.kind==="none"&&!rule.behavior.transition.eventId)continue;
          if(!["press","left","right"].includes(rule.trigger)||rule.qualifier.controlId||rule.qualifier.modifiers.length||conditionCount(rule.condition)||rule.behavior.when.eventId||rule.behavior.transition.eventId||rule.otherwise)errors.push(`${where}: gatilho ${rule.trigger} com lógica precisa do modo Automações.`);
        }else{
          if(["hold","release"].includes(rule.trigger)||rule.qualifier.controlId)errors.push(`${where}: segurar/soltar e combinação com outra tecla do macropad não têm detecção física confiável.`);
          checkSources(conditionSources(rule.condition),where);
        }
        for(const behavior of [rule.behavior,...(rule.otherwise?[rule.otherwise]:[])]){
          if(behavior.action.kind==="shortcut")try{parseChord(behavior.action.keys);}catch(e){errors.push(`${where}: ${(e as Error).message}`);}
          if(behavior.action.kind==="macro")for(const step of behavior.action.steps)try{parseChord(step.keys);}catch(e){errors.push(`${where}: ${(e as Error).message}`);}
        }
      }
    }
    for(const channel of HARDWARE_CHANNELS){
      const control=layer.controls.find(c=>c.id===channel.controlId)!;
      const rules=control.rules.filter(r=>r.trigger===channel.trigger&&!r.qualifier.controlId&&!r.qualifier.modifiers.length);
      if(mode==="local")packets.push(markerPacket(channel.slot,index+1));
      else try{if(rules.length>1)throw new Error("Mais de uma regra para a mesma posição.");packets.push(bindingPacket(channel.slot,index+1,rules[0]?.behavior.action??{kind:"none"}));}catch(e){errors.push(`Camada ${index+1}, código ${channel.slot}: ${(e as Error).message}`);}
    }
  });
  for(const event of profile.events)for(const state of event.states){
    checkSources(conditionSources(state.condition),event.name);
    for(const action of [state.action,...(state.otherwise?[state.otherwise.action]:[])]){
      if(action.kind==="shortcut")try{parseChord(action.keys);}catch(e){errors.push((e as Error).message);}
      if(action.kind==="macro")for(const step of action.steps)try{parseChord(step.keys);}catch(e){errors.push((e as Error).message);}
    }
  }
  if(mode==="local")warnings.add("Requer o servidor local ativo. Reserva F13–F24; evite atribuir essas teclas em outros programas. A camada física só é reconhecida no próximo toque.");
  return {mode,packets,errors:[...new Set(errors)],warnings:[...warnings]};
}
