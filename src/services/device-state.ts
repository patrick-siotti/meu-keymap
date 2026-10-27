import type { DeviceStateSnapshot } from "../../lib/device-state";
async function request(path:string,method="GET",body?:unknown,signal?:AbortSignal):Promise<DeviceStateSnapshot>{
  const response=await fetch(`/api/device/state${path}`,{method,headers:body===undefined?{}:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
  const value=await response.json();if(!response.ok)throw new Error(value.error??"Não foi possível consultar o estado do aparelho.");return value as DeviceStateSnapshot;
}
export const loadDeviceState=(signal?:AbortSignal)=>request("","GET",undefined,signal);
export const readDeviceState=()=>request("/read","POST",{});
export const reconcileDeviceState=(revision:number)=>request("/reconcile","POST",{revision});
export const setDevicePolicy=(revision:number,enabled:boolean)=>request("/policy","PUT",{revision,enabled});
export const recoverDeviceState=(body:{revision:number;bindingsBackup:string;rgbBackup:string;bindingsFingerprint:string;rgbFingerprint:string})=>request("/recover","POST",body);
