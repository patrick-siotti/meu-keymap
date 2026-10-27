import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, writeFile, rename, rm, stat,appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stateDocumentSchema } from "../lib/device-state.ts";
import { bindingsRecoveryJournalSchema, exactBindings } from "../lib/bindings-recovery.ts";
import { fileHash, recoveryFiles, valueHash } from "./recovery-files.ts";
import type { RecoveryFiles } from "./recovery-files.ts";
const execute=promisify(execFile);
const localLocks=new Map<string,UsbCoordinator>();
interface Lease {generation:number;signal:AbortSignal;}
interface Owner {pid:number;birth:string;token:string;}
export async function processBirth(pid:number):Promise<string|null>{
  if(process.platform==="win32"){
    const {stdout}=await execute("powershell.exe",["-NoProfile","-NonInteractive","-Command",`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){$p.StartTime.ToUniversalTime().Ticks.ToString()}; exit 0`],{windowsHide:true,timeout:5000});
    return stdout.trim()||null;
  }
  try{const text=await readFile(`/proc/${pid}/stat`,"utf8");return text.slice(text.lastIndexOf(")")+2).split(" ")[19]??null;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
}
export class UsbCoordinator {
  private queue:Promise<unknown>=Promise.resolve();
  private context=new AsyncLocalStorage<Lease>();
  private generation=0;
  private controller=new AbortController();
  private stickyRecovery:string|null=null;
  private birth:Promise<string|null>;
  private releaseOwner:(()=>Promise<void>)|null=null;
  private ownerToken:string|null=null;
  private initialRecovery:Promise<void>|null=null;
  readonly directory:string;
  readonly lockPath:string;
  constructor(directory:string,native=false){this.directory=directory;this.lockPath=native?join(tmpdir(),"meu-keymap-514c-8850-usb.lock"):join(directory,"usb.lock");this.birth=processBirth(process.pid);}
  static shared(directory:string,native=false):UsbCoordinator{
    const key=resolve(directory);let item=localLocks.get(key);if(!item){item=new UsbCoordinator(directory,native);localLocks.set(key,item);}return item;
  }
  currentGeneration(){return this.generation;}
  invalidate(){this.controller.abort();this.controller=new AbortController();return ++this.generation;}
  signal(){return this.context.getStore()?.signal;}
  private inspectInterruptedIntent():Promise<void>{
    this.initialRecovery??=(async()=>{
      try{
        const state=stateDocumentSchema.parse(JSON.parse(await readFile(join(this.directory,"device-state.json"),"utf8")));
        if(state.recovery)this.stickyRecovery=state.recovery.reason;
        for(const delivery of Object.values(state.delivery))if(delivery&&((delivery.status==="unknown"&&delivery.sent===null)||delivery.status==="sent"||delivery.status==="partial")&&!delivery.confirmedByRead)this.stickyRecovery??="Intenção de escrita interrompida sem resultado confirmado; recuperação explícita necessária.";
      }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw new Error("Estado do aparelho inválido ou ilegível; gravações bloqueadas.");}
    })();
    return this.initialRecovery;
  }
  assertCurrent(){const lease=this.context.getStore();if(lease&&(lease.generation!==this.generation||lease.signal.aborted))throw new Error("Operação cancelada: a sessão USB mudou.");}
  async recovery():Promise<string|null>{
    await this.inspectInterruptedIntent();
    const journal=await recoveryFiles(this.directory).read("bindings-recovery.json");
    if(journal!==null){
      const parsed=bindingsRecoveryJournalSchema.safeParse(JSON.parse(journal));
      if(!parsed.success)throw new Error("Diário de recuperação inválido; gravações bloqueadas.");
      if(parsed.data.phase!=="complete"&&(parsed.data.phase!=="prepared"||parsed.data.commitStarted||parsed.data.confirmed>0))this.stickyRecovery??=`Recuperação de bindings interrompida: ${parsed.data.operationId}.`;
    }
    try{const lines=(await readFile(join(this.directory,"device-recovery-ledger.jsonl"),"utf8")).trim().split("\n");const last=JSON.parse(lines.at(-1)!);if(last.pending)this.stickyRecovery??=String(last.reason);}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw new Error("Registro de recuperação inválido; gravações bloqueadas.");}
    for(const file of ["device-recovery.json","application-recovery.json","rgb-recovery.json"]){
      try{const text=await readFile(join(this.directory,file),"utf8");this.stickyRecovery??=`Recuperação pendente (${file}): ${text.slice(0,500)}`;}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    }
    return this.stickyRecovery;
  }
  async completeBindingsRecovery(input:{operationId:string;flagHash:string;ledgerHash:string;evidence:unknown},verifyCore:()=>Promise<void>,files:RecoveryFiles=recoveryFiles(this.directory)){
    this.assertCurrent();
    this.stickyRecovery??=`Bindings: finalização pendente (${input.operationId}).`;
    const check=async()=>{
      for(const name of ["rgb-recovery.json","application-recovery.json"])
        if(await files.read(name)!==null)throw new Error("Outra recuperação pendente; finalização de bindings recusada.");
      const flag=await files.read("device-recovery.json"),archive=`device-recovery.json.resolved-${input.operationId}`;
      if(fileHash(flag??await files.read(archive)??"")!==input.flagHash)throw new Error("O incidente de bindings mudou.");
      const ledger=await files.read("device-recovery-ledger.jsonl");
      if(ledger===null)throw new Error("Ledger de recuperação ausente.");
      const last=JSON.parse(ledger.trim().split("\n").at(-1)!);
      const terminal=last.pending===false&&last.operationId===input.operationId&&last.incident===input.flagHash;
      if(!terminal&&fileHash(ledger)!==input.ledgerHash)throw new Error("Ledger de recuperação mudou.");
      return {flag,archive,terminal};
    };
    await check();await verifyCore();this.assertCurrent();
    await files.write(`bindings-recovery-result-${input.operationId}.json`,JSON.stringify(input.evidence,null,2));
    const current=await check();await verifyCore();this.assertCurrent();
    if(current.flag!==null)await files.archive("device-recovery.json",current.archive);
    if(!current.terminal)await files.append("device-recovery-ledger.jsonl",JSON.stringify({at:Date.now(),pending:false,operationId:input.operationId,incident:input.flagHash,evidence:input.evidence})+"\n");
    // The unfinished journal remains a gate until its durable completion is read back.
  }
  async releaseBindingsRecovery(operationId:string,files:RecoveryFiles=recoveryFiles(this.directory)){
    this.assertCurrent();
    this.stickyRecovery??=`Bindings: confirmação durável pendente (${operationId}).`;
    const journal=bindingsRecoveryJournalSchema.parse(JSON.parse(await files.read("bindings-recovery.json")??"null"));
    const ledger=await files.read("device-recovery-ledger.jsonl");
    const last=ledger&&JSON.parse(ledger.trim().split("\n").at(-1)!);
    const state=stateDocumentSchema.parse(JSON.parse(await files.read("device-state.json")??"null"));
    if(journal.operationId!==operationId||journal.phase!=="complete"||!last||last.pending!==false||last.operationId!==operationId||last.incident!==journal.input.incident.flagHash||state.recovery||
      state.desired?.mode!=="device"||!state.policy.enabled||valueHash(state.desired)!==valueHash(journal.beforeState.desired)||
      valueHash(state.delivery.rgb)!==valueHash(journal.beforeState.delivery.rgb)||state.delivery.bindings?.attempt!==operationId||
      state.delivery.bindings.status!=="confirmed"||!state.delivery.bindings.confirmedByRead||
      !state.observed?.bindings||!exactBindings(state.observed.bindings.value,journal.target)||
      fileHash(await files.read(`device-recovery.json.resolved-${operationId}`)??"")!==journal.input.incident.flagHash)
      throw new Error("Conclusão durável da recuperação não confirmada.");
    for(const name of ["device-recovery.json","rgb-recovery.json","application-recovery.json"])
      if(await files.read(name)!==null)throw new Error("Uma recuperação permanece pendente.");
    this.stickyRecovery=null;
  }
  async assertWritable(){this.assertCurrent();if(await this.recovery())throw new Error("Recuperação pendente. Todos os caminhos de gravação estão bloqueados; preserve os backups.");}
  async requireRecovery(reason:string,backups:string[]=[]){
    this.stickyRecovery=reason;
    await mkdir(this.directory,{recursive:true});
    await appendFile(join(this.directory,"device-recovery-ledger.jsonl"),JSON.stringify({at:Date.now(),pending:true,reason,backups})+"\n",{flush:true});
    const temporary=join(this.directory,`recovery-${randomUUID()}.tmp`);
    await writeFile(temporary,JSON.stringify({at:Date.now(),reason,backups},null,2),{flag:"wx"});
    await rename(temporary,join(this.directory,"device-recovery.json"));
  }
  // Only the explicit recovery operation may bypass the gate, then record independent verification.
  async completeRecovery(evidence:unknown){
    await mkdir(this.directory,{recursive:true});
    await writeFile(join(this.directory,`recovery-result-${Date.now()}-${randomUUID()}.json`),JSON.stringify(evidence,null,2),{flag:"wx"});
    for(const file of ["device-recovery.json","application-recovery.json","rgb-recovery.json"]){
      try{await rename(join(this.directory,file),join(this.directory,`${file}.resolved-${randomUUID()}`));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    }
    await appendFile(join(this.directory,"device-recovery-ledger.jsonl"),JSON.stringify({at:Date.now(),pending:false,evidence})+"\n",{flush:true});
    this.stickyRecovery=null;
  }
  private async acquire():Promise<()=>Promise<void>>{
    if(this.releaseOwner){const owner=JSON.parse(await readFile(join(this.lockPath,"owner.json"),"utf8")) as Owner;if(owner.token!==this.ownerToken)throw new Error("Ownership do lock USB mudou; gravações bloqueadas.");return async()=>{};}
    await mkdir(resolve(this.lockPath,".."),{recursive:true});
    const owner:Owner={pid:process.pid,birth:await this.birth??"unknown",token:randomUUID()};
    for(let attempt=0;attempt<2;attempt++){
      try{await mkdir(this.lockPath);await writeFile(join(this.lockPath,"owner.json"),JSON.stringify(owner),{flag:"wx"});
        this.ownerToken=owner.token;
        this.releaseOwner=async()=>{const current=JSON.parse(await readFile(join(this.lockPath,"owner.json"),"utf8")) as Owner;if(current.token!==owner.token)throw new Error("Ownership do lock USB mudou.");const target=resolve(this.lockPath);if(target!==this.lockPath||!target.endsWith("usb.lock"))throw new Error("Destino do lock inválido.");await rm(target,{recursive:true});};
        return async()=>{};
      }catch(error){
        if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
        let existing:Owner;
        try{existing=JSON.parse(await readFile(join(this.lockPath,"owner.json"),"utf8")) as Owner;}
        catch{const info=await stat(this.lockPath);throw new Error(`Lock USB sem identidade verificável (${info.mtime.toISOString()}); nenhum envio permitido.`);}
        if(!Number.isSafeInteger(existing.pid)||existing.pid<1||typeof existing.birth!=="string")throw new Error("Lock USB inválido; nenhum envio permitido.");
        const birth=await processBirth(existing.pid);
        if(birth!==null&&(birth===existing.birth||existing.birth==="unknown"))throw new Error("Outro processo do Meu Keymap está usando o aparelho. Aguarde a operação terminar.");
        // Atomic quarantine: do not delete a replacement owner's lock.
        const check=JSON.parse(await readFile(join(this.lockPath,"owner.json"),"utf8")) as Owner;
        if(check.token!==existing.token)throw new Error("Lock USB mudou durante recuperação.");
        await rename(this.lockPath,`${this.lockPath}.stale-${randomUUID()}`);
      }
    }
    throw new Error("Não foi possível obter o lock USB.");
  }
  // Recovery previews do not retain process ownership while a token awaits approval/use.
  preview<T>(operation:()=>Promise<T>):Promise<T>{return this.run(operation,true);}
  run<T>(operation:()=>Promise<T>,releaseOwnership=false):Promise<T>{
    if(this.context.getStore()){this.assertCurrent();return operation();}
    const lease:Lease={generation:this.generation,signal:this.controller.signal};
    const result=this.queue.catch(()=>{}).then(async()=>{
      await this.inspectInterruptedIntent();
      if(lease.generation!==this.generation||lease.signal.aborted)throw new Error("Operação cancelada: a sessão USB mudou.");
      const release=await this.acquire();
      try{return await this.context.run(lease,async()=>{this.assertCurrent();const value=await operation();this.assertCurrent();return value;});}
      finally{
        await release();
        if(releaseOwnership){await this.releaseOwner?.();this.releaseOwner=null;this.ownerToken=null;}
      }
    });
    this.queue=result;return result;
  }
  async close(){this.invalidate();await this.queue.catch(()=>{});await this.releaseOwner?.();this.releaseOwner=null;this.ownerToken=null;}
}
