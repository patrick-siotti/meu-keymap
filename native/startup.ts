import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const execute=promisify(execFile);
const statusSchema=z.object({enabled:z.boolean(),conflict:z.boolean()});
export type StartupStatus=z.infer<typeof statusSchema>;
export async function startupStatus(mode:"read"|"enable"|"disable"="read"):Promise<StartupStatus>{
  const {stdout}=await execute("powershell.exe",["-NoProfile","-NonInteractive","-File",fileURLToPath(new URL("./startup.ps1",import.meta.url)),"-Mode",mode],{windowsHide:true,timeout:5000,maxBuffer:12000});
  const result=statusSchema.parse(JSON.parse(stdout.trim()));
  if(mode!=="read"&&result.enabled!==(mode==="enable"))throw new Error("A releitura da inicialização não confirmou a alteração.");return result;
}
