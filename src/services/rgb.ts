import type { RgbLayer,RgbSnapshot,StaticRgbInput } from "../../lib/rgb";
import { rgbSnapshotSchema } from "../../lib/rgb";
async function request(path:string,body:unknown):Promise<RgbSnapshot>{
  const response=await fetch(`/api/device/rgb/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const result=await response.json() as {snapshot?:RgbSnapshot;error?:string};
  if(!response.ok||!result.snapshot)throw new Error(result.error??"Não foi possível confirmar o RGB no aparelho.");return rgbSnapshotSchema.parse(result.snapshot);
}
export const readRgb=()=>request("read",{});
export const applyRgb=(layer:number,settings:RgbLayer,fingerprint:string)=>request("apply",{layer,settings,fingerprint});
export const applyStaticRgb=(input:StaticRgbInput)=>request("static",input);
