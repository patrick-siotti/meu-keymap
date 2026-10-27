import { hardwareMapSchema } from "../../lib/hardware-map";
import type { HardwareMap } from "../../lib/hardware-map";
export async function loadHardwareMap(read=false,signal?:AbortSignal):Promise<HardwareMap|null> {
  const response=await fetch(read?"/api/device/configuration/read":"/api/device/configuration",{method:read?"POST":"GET",headers:read?{"Content-Type":"application/json"}:{},...(signal?{signal}:{})});
  const data=await response.json() as {snapshot:unknown;error?:string};
  if(!response.ok)throw new Error(data.error??"Não foi possível ler o mapa do aparelho.");
  return data.snapshot===null?null:hardwareMapSchema.parse(data.snapshot);
}
