import { spawn,execFile } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { stat } from "node:fs/promises";
import { win32,extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseChord,modifierVirtualKeys } from "../lib/keys.ts";
import type { Action,CommandAction } from "../lib/model.ts";
import { ChildLifecycle } from "./child-lifecycle.ts";
export interface ActionExecutor {start():Promise<void>;execute(action:Action,signal:AbortSignal):Promise<string>;stop():void;close?():Promise<void>;}
const absolutePath=(value:string)=>win32.isAbsolute(value)&&(/^[A-Za-z]:[\\/]/.test(value)||/^\\\\[^\\/]+[\\/][^\\/]+[\\/]/.test(value));
export async function commandSpec(action:CommandAction):Promise<{file:string;args:string[];verbatim:boolean;input?:string}> {
  if(!absolutePath(action.path)||!(await stat(action.path)).isFile())throw new Error("Escolha um arquivo existente com caminho absoluto.");
  if(action.cwd&&(!absolutePath(action.cwd)||!(await stat(action.cwd)).isDirectory()))throw new Error("Pasta de trabalho inválida.");
  const extension=extname(action.path).toLowerCase();
  if(action.runner==="powershell"){
    if(extension!==".ps1")throw new Error("PowerShell requer arquivo .ps1.");
    return {file:"powershell.exe",args:["-NoProfile","-NonInteractive","-File",fileURLToPath(new URL("./run-script.ps1",import.meta.url))],verbatim:false,input:JSON.stringify({path:action.path,arguments:action.arguments})};
  }
  if(action.runner==="python"){
    if(extension!==".py")throw new Error("Python requer arquivo .py.");
    return {file:"python.exe",args:[action.path,...action.arguments],verbatim:false};
  }
  if(action.runner==="batch"){
    if(![".bat",".cmd"].includes(extension))throw new Error("Lote requer arquivo .bat ou .cmd.");
    if([action.path,...action.arguments].some(s=>/["%&|<>^!\r\n]/.test(s)))throw new Error("Argumentos de lote contêm caracteres de shell. Use PowerShell ou executável com argumentos separados.");
    const command='chcp 65001>nul & '+[action.path,...action.arguments].map(s=>'"'+s+'"').join(" ");
    return {file:"cmd.exe",args:["/d","/v:off","/s","/c",command],verbatim:true};
  }
  if(![".exe",".com"].includes(extension))throw new Error("Programa deve ser .exe ou .com; escolha o interpretador para scripts.");
  return {file:action.path,args:action.arguments,verbatim:false};
}
export async function runCommand(action:CommandAction,signal:AbortSignal):Promise<string>{
  const spec=await commandSpec(action);signal.throwIfAborted();
  return await new Promise<string>((resolve,reject)=>{
    const child=spawn(spec.file,spec.args,{cwd:action.cwd||undefined,env:{...process.env,PYTHONIOENCODING:"utf-8"},windowsHide:true,windowsVerbatimArguments:spec.verbatim,shell:false,stdio:["pipe","pipe","pipe"]});
    child.stdin.end(spec.input??"");child.stdin.on("error",()=>{});
    let output="",settled=false,reason="";
    const capture=(value:Buffer)=>{output=(output+value.toString("utf8")).slice(-4096);};
    child.stdout.on("data",capture);child.stderr.on("data",capture);
    const kill=(message:string)=>{if(reason||settled)return;reason=message;if(child.pid&&child.exitCode===null)execFile("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true},()=>{});};
    const abort=()=>kill("Execução cancelada.");signal.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(()=>kill("Tempo máximo do comando excedido."),action.timeoutMs);
    const finish=(error:Error|null,code?:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener("abort",abort);if(error||reason||code!==0)reject(error??new Error(reason||`Comando terminou com código ${code}. ${output}`));else resolve(output.trim()||"Comando concluído (código 0).");};
    child.once("error",error=>finish(error));child.once("close",code=>finish(null,code));
  });
}
export class WindowsExecutor implements ActionExecutor {
  private children=new ChildLifecycle();
  private worker:ChildProcessWithoutNullStreams|null=null;
  private requests=new Map<string,{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  start():Promise<void>{
    if(this.worker)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const worker=spawn("powershell.exe",["-NoProfile","-NonInteractive","-File",fileURLToPath(new URL("./action-host.ps1",import.meta.url))],{windowsHide:true,stdio:"pipe"});this.worker=worker;
      this.children.track(worker);
      let buffer="",ready=false;
      const timeout=setTimeout(()=>{this.stop();reject(new Error("Executor Windows não iniciou."));},10000);
      worker.stdout.setEncoding("utf8");worker.stdout.on("data",(chunk:string)=>{buffer+=chunk;if(buffer.length>100000){this.stop();return;}let end:number;while((end=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const result=JSON.parse(line);if(result.ready){ready=true;clearTimeout(timeout);resolve();}else{const pending=this.requests.get(result.id);if(pending){clearTimeout(pending.timer);this.requests.delete(result.id);if(result.ok)pending.resolve();else pending.reject(new Error(result.error));}}}catch{}}});
      const failed=()=>{clearTimeout(timeout);if(this.worker===worker)this.worker=null;for(const request of this.requests.values()){clearTimeout(request.timer);request.reject(new Error("Executor Windows encerrou."));}this.requests.clear();if(!ready)reject(new Error("Não foi possível iniciar o executor Windows."));};
      worker.on("error",failed);worker.on("exit",failed);worker.stderr.on("data",()=>{});
    });
  }
  private async send(payload:Record<string,unknown>,signal:AbortSignal){
    signal.throwIfAborted();if(!this.worker)throw new Error("Executor Windows parado.");
    const id=randomUUID();await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{this.requests.delete(id);reject(new Error("Executor não confirmou a ação."));},3000);this.requests.set(id,{resolve,reject,timer});this.worker!.stdin.write(JSON.stringify({id,...payload})+"\n");});signal.throwIfAborted();
  }
  async execute(action:Action,signal:AbortSignal):Promise<string>{
    if(action.kind==="command")return runCommand(action,signal);
    if(action.kind==="text")await this.send({kind:"text",text:action.value},signal);
    if(action.kind==="media")await this.send({kind:"keys",keys:[({mute:173,volumeDown:174,volumeUp:175,next:176,previous:177,playPause:179})[action.command]]},signal);
    if(action.kind==="shortcut"||action.kind==="macro")for(const step of action.kind==="shortcut"?[{keys:action.keys,delay:0}]:action.steps){const chord=parseChord(step.keys);await this.send({kind:"keys",keys:[...chord.modifiers.map(m=>modifierVirtualKeys[m]!),chord.virtualKey]},signal);if(step.delay)await delay(step.delay,undefined,{signal});}
    return "Ação enviada ao Windows.";
  }
  stop(){const worker=this.worker;this.worker=null;worker?.stdin.end();worker?.kill();}
  async close(){this.stop();await this.children.close();}
}
