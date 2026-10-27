import { profileSchema } from "./model.ts";
import type { Profile } from "./model.ts";
export async function profileStamp(profile:Profile):Promise<string>{
  const execution=profileSchema.parse(profile);
  for(const layer of execution.layers)for(const control of layer.controls)delete control.icon;
  const bytes=new TextEncoder().encode(JSON.stringify(execution));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
