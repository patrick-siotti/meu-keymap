import type { ApplicationPreview,ApplicationService } from "../../native/application";
import type { ApplicationMode } from "../../lib/bindings";
import type { Profile } from "../../lib/model";
export type ApplicationStatus=Awaited<ReturnType<ApplicationService["status"]>>;
async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(path,{method:body===undefined?"GET":"POST",headers:body===undefined?{}:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??"A operação não foi concluída.");return data as T;
}
export const applicationStatus=(signal?:AbortSignal)=>request<ApplicationStatus>("/api/application/status",undefined,signal);
export const prepareApplication=(profile:Profile,mode:ApplicationMode)=>request<ApplicationPreview>("/api/application/prepare",{profile,mode});
export const applyApplication=(token:string)=>request<ApplicationStatus>("/api/application/apply",{token});
export const restoreApplication=(backup:string)=>request<ApplicationStatus>("/api/application/restore",{backup});
export const startExecution=()=>request("/api/runtime/start",{});
export const stopExecution=()=>request("/api/runtime/stop",{});
export const verifyApplication=()=>request<ApplicationStatus>("/api/application/verify",{});
