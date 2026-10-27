import { z } from "zod";
import { actionLabel,actionSchema,makeProfile,makeRule } from "./model.ts";
import type { Action,Profile,Trigger } from "./model.ts";
export const HARDWARE_CHANNELS=Array.from({length:25},(_,i)=>{
  const slot=i+1;
  return slot<=16?{slot,controlId:`key-${slot}`,trigger:"press" as const,label:`Tecla ${String(slot).padStart(2,"0")}`}:{slot,controlId:`knob-${Math.floor((slot-17)/3)+1}`,trigger:(["left","press","right"] as const)[(slot-17)%3]!,label:`Encoder ${Math.floor((slot-17)/3)+1} · ${["esquerda","clique","direita"][(slot-17)%3]}`};
});
export function hardwareAddress(controlId:string,trigger:Trigger,layer:number):{slot:number;layer:number}|null {
  if(!Number.isInteger(layer)||layer<0||layer>2)return null;
  const channel=HARDWARE_CHANNELS.find(c=>c.controlId===controlId&&(controlId.startsWith("key-")||c.trigger===(trigger==="left"||trigger==="right"?trigger:"press")));
  return channel?{slot:channel.slot,layer:layer+1}:null;
}
const reportHex=z.string().regex(/^(?:[0-9A-F]{2}){64,65}$/);
export const rawConfigurationSchema=z.object({at:z.number().int().positive(),devicePath:z.string().max(4096),identity:reportHex,layers:z.array(z.object({layer:z.number().int().min(1).max(3),reports:z.array(reportHex).length(25)})).length(3),error:z.null()});
const hexBytes=(hex:string)=>hex.match(/../g)!.map(b=>parseInt(b,16));
function usageName(code:number):string|null {
  if(code>=4&&code<=29)return String.fromCharCode(65+code-4);
  if(code>=30&&code<=38)return String(code-29);
  if(code===39)return "0";
  if(code>=58&&code<=69)return `F${code-57}`;
  if(code>=104&&code<=115)return `F${code-91}`;
  return ({40:"Enter",41:"Esc",42:"Backspace",43:"Tab",44:"Space",45:"-",46:"=",47:"[",48:"]",49:"\\",51:";",52:"'",53:"`",54:",",55:".",56:"/",57:"CapsLock",70:"PrintScreen",71:"ScrollLock",72:"Pause",73:"Insert",74:"Home",75:"PageUp",76:"Delete",77:"End",78:"PageDown",79:"ArrowRight",80:"ArrowLeft",81:"ArrowDown",82:"ArrowUp"} as Record<number,string>)[code]??null;
}
export function decodeHardwareAction(bytes:number[]):Action|null {
  if(bytes[4]===2&&bytes[6]===2){const commands:Record<number,Extract<Action,{kind:"media"}>["command"]>={233:"volumeUp",234:"volumeDown",226:"mute",205:"playPause",181:"next",182:"previous"};const command=commands[bytes[9]!];return command?{kind:"media",command}:null;}
  if(bytes[4]!==1)return null;
  const count=bytes[6]!;
  if(count===0)return bytes.slice(9).every(b=>b===0)?{kind:"none"}:null;
  if(count>18)return null;
  const codes=Array.from({length:count},(_,i)=>bytes[9+3*i]!);
  const modifierNames:Record<number,string>={241:"Ctrl",242:"Shift",243:"Alt",244:"Win",245:"RightCtrl",246:"RightShift",247:"RightAlt",248:"RightWin"};
  const last=codes.at(-1)!,name=usageName(last);
  if(!name||codes.slice(0,-1).some(code=>!modifierNames[code]))return null;
  return {kind:"shortcut",keys:[...codes.slice(0,-1).map(code=>modifierNames[code]!),name].join("+")};
}
export interface HardwareEntry {slot:number;layer:number;raw:string;label:string;action:Action|null;mode:number;}
export interface HardwareMap {version:1;readAt:number;devicePath:string;protocolVersion:number;entries:HardwareEntry[];backup:string;}
export const hardwareMapSchema:z.ZodType<HardwareMap>=z.object({version:z.literal(1),readAt:z.number().int().positive(),devicePath:z.string().max(4096),protocolVersion:z.number().int().min(10).max(255),entries:z.array(z.object({slot:z.number().int().min(1).max(25),layer:z.number().int().min(1).max(3),raw:reportHex,label:z.string().max(200),action:actionSchema.nullable(),mode:z.number().int().min(0).max(255)})).length(75),backup:z.string().max(200)}).refine(m=>new Set(m.entries.map(e=>`${e.layer}:${e.slot}`)).size===75,"Endereços duplicados");
export function parseHardwareMap(input:unknown,backup=""):HardwareMap {
  const raw=rawConfigurationSchema.parse(input),identity=hexBytes(raw.identity);
  if(identity[0]!==3||identity[1]!==251||identity[2]!==16||identity[3]!==3||identity[4]!<=9)throw new Error("Identificação do aparelho incompatível com o mapa 16+3.");
  const entries:HardwareEntry[]=[],banks=new Set<number>();
  for(const layer of raw.layers){
    if(banks.has(layer.layer))throw new Error("Camada duplicada na leitura.");banks.add(layer.layer);
    const slots=new Set<number>();
    for(const report of layer.reports){
      const b=hexBytes(report),slot=b[2]!;
      if(b[0]!==3||b[1]!==250||b[3]!==layer.layer||slot<1||slot>25||slots.has(slot))throw new Error("Endereço de controle inválido ou duplicado na leitura.");
      slots.add(slot);const action=decodeHardwareAction(b);
      entries.push({slot,layer:layer.layer,raw:report,action,mode:b[5]!,label:action? action.kind==="none"?"NULL":actionLabel(action):`Tipo ${b[4]} · ${b[6]} entradas`});
    }
  }
  return {version:1,readAt:raw.at,devicePath:raw.devicePath,protocolVersion:identity[4]!,entries:entries.sort((a,b)=>a.layer-b.layer||a.slot-b.slot),backup};
}
export function profileFromHardware(map:HardwareMap,id:string,name:string):Profile {
  if(map.entries.some(e=>e.action===null))throw new Error("Há ações não reconhecidas; preserve a leitura bruta antes de importar.");
  const profile=makeProfile(id,name);profile.events=[];
  profile.layers.forEach((layer,index)=>{
    layer.name="Do aparelho";
    layer.controls.forEach(control=>{
      const channels=HARDWARE_CHANNELS.filter(c=>c.controlId===control.id);
      control.rules=channels.map(channel=>{
        const rule=makeRule(channel.trigger,channel.trigger);
        const entry=map.entries.find(e=>e.layer===index+1&&e.slot===channel.slot);
        if(!entry?.action)throw new Error("Leitura incompleta.");
        rule.behavior.action=structuredClone(entry.action);return rule;
      });
      control.rules.push(makeRule("activate","activate"));
      const primary=control.rules.find(r=>r.trigger==="press")!.behavior.action;
      control.label=control.kind==="knob"?`Encoder ${control.id.split("-")[1]}`:primary.kind==="none"?"":actionLabel(primary).slice(0,30);
    });
  });return profile;
}
