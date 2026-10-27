import { z } from "zod";
export const RGB_MODES=["Modo 0 (apagamento não confirmado)","Fixo","Ao pressionar","Onda","Arco-íris por linhas","Arco-íris por colunas"] as const;
const report=z.string().regex(/^[0-9A-F]{130}$/);
export const rgbLayerSchema=z.object({mode:z.number().int().min(0).max(5),colors:z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).length(16)});
export type RgbLayer=z.infer<typeof rgbLayerSchema>;
const uniqueIndices=(maximum:number)=>z.array(z.number().int().min(0).max(maximum)).min(1).max(maximum+1).refine(values=>new Set(values).size===values.length,"Índices repetidos.");
export const staticRgbSchema=z.object({layers:uniqueIndices(2),slots:uniqueIndices(15),color:z.string().regex(/^#[0-9A-Fa-f]{6}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type StaticRgbInput=z.infer<typeof staticRgbSchema>;
export function staticRgbLayers(baseline:RgbLayer[],input:StaticRgbInput):RgbLayer[]{
  const parsed=staticRgbSchema.parse(input);
  return baseline.map((bank,index)=>parsed.layers.includes(index)?{mode:1,colors:bank.colors.map((color,slot)=>parsed.slots.includes(slot)?parsed.color.toUpperCase():color)}:structuredClone(bank));
}
export const rgbRawSchema=z.object({at:z.number().int(),devicePath:z.string().min(1),identity:report,layers:z.array(z.object({layer:z.number().int().min(0).max(2),raw:report})).length(3)});
export const rgbSnapshotSchema=z.object({at:z.number().int(),devicePath:z.string().min(1),layers:z.array(rgbLayerSchema).length(3),backup:z.string().regex(/^rgb-[0-9]+-[a-f0-9-]+\.json$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)});
export type RgbSnapshot=z.infer<typeof rgbSnapshotSchema>;
export function parseRgb(input:unknown):Omit<RgbSnapshot,"backup"|"fingerprint"> {
  const raw=rgbRawSchema.parse(input);
  if(!raw.identity.startsWith("03FB10030B")||new Set(raw.layers.map(l=>l.layer)).size!==3)throw new Error("Identidade ou camadas RGB incompatíveis.");
  const layers=raw.layers.sort((a,b)=>a.layer-b.layer).map(layer=>{
    const bytes=layer.raw.match(/../g)!.map(v=>parseInt(v,16));
    if(bytes[0]!==3||bytes[1]!==250||bytes[2]!>5||bytes.slice(51).some(b=>b!==0))throw new Error("Resposta RGB desconhecida; nenhuma cor foi presumida.");
    return rgbLayerSchema.parse({mode:bytes[2],colors:Array.from({length:16},(_,i)=>"#"+layer.raw.slice((3+i*3)*2,(6+i*3)*2))});
  });
  return {at:raw.at,devicePath:raw.devicePath,layers};
}
export function rgbPacket(layer:number,settings:RgbLayer):string {
  if(!Number.isInteger(layer)||layer<0||layer>2)throw new Error("Camada RGB inválida.");
  const parsed=rgbLayerSchema.parse(settings),bytes=[3,254,176,layer,parsed.mode,...parsed.colors.flatMap(c=>c.slice(1).match(/../g)!.map(v=>parseInt(v,16)))];
  while(bytes.length<65)bytes.push(0);
  return bytes.map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
}
export function equalRgb(a:RgbLayer,b:RgbLayer):boolean {return a.mode===b.mode&&a.colors.every((c,i)=>c.toUpperCase()===b.colors[i]?.toUpperCase());}
