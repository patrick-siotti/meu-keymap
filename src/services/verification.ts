import type { VerificationStatus } from "../../native/verification";
export type { VerificationStatus };
export async function verificationRequest(path="",body?:unknown):Promise<VerificationStatus>{
  const response=await fetch(`/api/device/verification${path}`,{method:body===undefined?"GET":"POST",...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw new Error(result.error??"Conferência não concluída.");return result as VerificationStatus;
}
