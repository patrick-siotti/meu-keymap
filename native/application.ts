import { mkdir,readFile,writeFile,rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { APPLICATION_MODES, compileProfile, readHeldBindings, readPulseBindings } from "../lib/bindings.ts";
import type { ApplicationMode,BindingPlan } from "../lib/bindings.ts";
import { parseHardwareMap } from "../lib/hardware-map.ts";
import { profileSchema } from "../lib/model.ts";
import type { HardwareMap } from "../lib/hardware-map.ts";
import type { Action,Profile } from "../lib/model.ts";
import { ConfigurationReader,mapFingerprint } from "./configuration.ts";
import { commandSpec } from "./executor.ts";
import { LocalRuntime } from "./runtime.ts";
import type { InputBindings } from "./runtime.ts";
import { profileStamp } from "../lib/profile-stamp.ts";
import type { ReconciliationService } from "./reconciliation.ts";
import { StateConflict } from "../lib/device-state.ts";
import { BindingsRecoveryService } from "./bindings-recovery.ts";
import type { RecoveryProfileStore } from "./bindings-recovery.ts";
import type { RecoveryFiles } from "./recovery-files.ts";
import type { BindingsRecoveryInput } from "../lib/bindings-recovery.ts";
const deploymentSchema = z.object({
  version: z.literal(1),
  mode: z.enum(APPLICATION_MODES),
  profile: profileSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  backup: z.string(),
  appliedAt: z.number(),
  restored: z.boolean().default(false),
  windowsSlots: z.array(z.number().int().min(0).max(74)).max(75)
    .refine(slots => new Set(slots).size === slots.length).optional(),
}).refine(deployment => deployment.mode !== "mixed" || deployment.windowsSlots !== undefined,
  "Um perfil misto precisa identificar as posições do Windows.");
type Deployment=z.infer<typeof deploymentSchema>;
function windowsPositionCount(deployment: Deployment): number {
  if (deployment.mode === "local") return 75;
  return deployment.mode === "mixed" ? deployment.windowsSlots?.length ?? 0 : 0;
}
function inputBindings(deployment: Deployment, map: HardwareMap): InputBindings {
  const windowsSlots = deployment.windowsSlots;
  const entries = windowsSlots ? map.entries.filter(entry => windowsSlots.includes((entry.layer - 1) * 25 + entry.slot - 1)) : map.entries;
  return { windowsSlots, pulses: readPulseBindings(entries), held: readHeldBindings(entries) };
}
interface Prepared {profile:Profile;plan:BindingPlan;fingerprint:string;expiresAt:number;}
export interface ApplicationPreview {token:string|null;mode:ApplicationMode;name:string;changed:number;windowsPositions:number;errors:string[];warnings:string[];expiresAt:number;}
export function profileActions(profile:Profile):Action[]{return profile.layers.flatMap(l=>l.controls.flatMap(c=>c.rules.flatMap(r=>[r.behavior.action,...(r.otherwise?[r.otherwise.action]:[])]))).concat(profile.events.flatMap(e=>e.states.flatMap(s=>[s.action,...(s.otherwise?[s.otherwise.action]:[])])));}
export class ApplicationService {
  private reader:ConfigurationReader;
  private runtime:LocalRuntime;
  private directory:string;
  private prepared=new Map<string,Prepared>();
  private busy=false;
  private verifying=false;
  private hardware:{at:number|null;matches:boolean|null;error:string}={at:null,matches:null,error:""};
  private message="";
  private stopRequested=false;
  private deviceState:ReconciliationService|null=null;
  private recoveryService:BindingsRecoveryService|null=null;
  get recoveryActive(){return this.recoveryService?.active??false;}
  configureRecovery(profiles:RecoveryProfileStore,files?:RecoveryFiles){
    if(!this.deviceState)throw new Error("Reconciliação não configurada.");
    this.recoveryService=new BindingsRecoveryService(this.directory,this.reader,this.deviceState,profiles,()=>{
      if(this.busy||this.verifying||this.runtime.status().active||this.runtime.status().pending)throw new StateConflict("Pare o motor e aguarde a operação, ações pendentes ou conferência física atual.");this.busy=true;this.runtime.stop();
    },()=>{this.busy=false;},files);
  }
  private assertAvailable(){if(this.busy||this.verifying||this.recoveryActive)throw new StateConflict("Encerre a conferência física ou aguarde a operação atual; preserve o rascunho.");}
  prepareBindingsRecovery(input:BindingsRecoveryInput){this.assertAvailable();if(this.runtime.status().active||this.runtime.status().pending)throw new StateConflict("Pare o motor e aguarde as ações pendentes antes de preparar a recuperação.");if(!this.recoveryService)throw new Error("Recuperação não configurada.");return this.recoveryService.prepare(input);}
  applyBindingsRecovery(token:string){if(!this.recoveryService)throw new Error("Recuperação não configurada.");return this.recoveryService.apply(token);}
  setDeviceState(state:ReconciliationService){this.deviceState=state;}
  constructor(directory:string,reader:ConfigurationReader,runtime:LocalRuntime){this.directory=directory;this.reader=reader;this.runtime=runtime;}
  private async deployment():Promise<Deployment|null>{try{const raw=JSON.parse(await readFile(join(this.directory,"deployment.json"),"utf8"));return raw===null?null:deploymentSchema.parse(raw);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
  private async save(deployment:Deployment){await mkdir(this.directory,{recursive:true});const temp=join(this.directory,`deployment-${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(deployment,null,2));await rename(temp,join(this.directory,"deployment.json"));}
  async status(){const deployed=await this.deployment(),deviceState=await this.deviceState?.snapshot();const observed=deviceState?.readStatus.bindings.current?deviceState.observed?.bindings?.value:null;return {busy:this.busy,message:this.message,bindingsRecovery:await this.recoveryService?.status()??null,hardware:deviceState?{at:observed?.readAt??null,matches:observed&&deployed?mapFingerprint(observed)===deployed.fingerprint:null,error:deviceState.readStatus.bindings.error}:{...this.hardware},deviceState:deviceState??null,deployment:deployed?{mode:deployed.mode,name:deployed.restored?"Configuração restaurada":deployed.profile.name,profileId:deployed.profile.id,profileStamp:await profileStamp(deployed.profile),appliedAt:deployed.appliedAt,backup:deployed.backup,restored:deployed.restored,windowsPositions:windowsPositionCount(deployed)}:null,runtime:this.runtime.status()};}
  async prepare(profile:Profile,mode:ApplicationMode):Promise<ApplicationPreview>{
    this.assertAvailable();
    const validated=profileSchema.parse(profile),plan=compileProfile(validated,mode);
    if(plan.windowsSlots.length)for(const action of profileActions(validated))if(action.kind==="command")try{await commandSpec(action);}catch(e){plan.errors.push((e as Error).message);}
    const expiresAt=Date.now()+300000;
    const windowsPositions = plan.windowsSlots.length;
    if(plan.errors.length)return {token:null,mode,name:profile.name,changed:0,windowsPositions,errors:[...new Set(plan.errors)],warnings:plan.warnings,expiresAt};
    const current=await this.reader.read(),fingerprint=mapFingerprint(current);
    if(current.protocolVersion!==11)throw new Error("Gravação disponível somente para a versão 11 confirmada.");
    const changed=plan.packets.filter(packet=>!current.entries.some(e=>e.raw===packet.replace(/^03FD/,"03FA"))).length;
    const token=randomUUID();this.prepared.clear();this.prepared.set(token,{profile:validated,plan,fingerprint,expiresAt});
    return {token,mode,name:profile.name,changed,windowsPositions,errors:[],warnings:plan.warnings,expiresAt};
  }
  apply(token:string){return this.reader.deviceOperation(()=>this.applyPrepared(token));}
  private async applyPrepared(token:string){
    this.assertAvailable();
    const selected=this.prepared.get(token);this.prepared.delete(token);
    if(!selected||selected.expiresAt<Date.now())throw new Error("Preparação expirada. Prepare o perfil novamente.");
    this.busy=true;this.stopRequested=false;this.runtime.stop();
    let appliedBackup:string|null=null,previous:Deployment|null=null;
    try{
      previous=await this.deployment();
      await this.deviceState?.chooseBindings(selected.profile,selected.plan.mode,selected.plan.packets);
      const applied=await this.reader.apply(selected.plan.packets,selected.fingerprint);
      appliedBackup=applied.backup;
      const restoreBackup = previous && previous.mode !== "device" && !previous.restored ? previous.backup : applied.backup;
      const deployment: Deployment = {
        version: 1, mode: selected.plan.mode, profile: selected.profile,
        fingerprint: mapFingerprint(applied.map), backup: restoreBackup, appliedAt: Date.now(), restored: false,
        ...(selected.plan.mode === "mixed" ? { windowsSlots: selected.plan.windowsSlots } : {}),
      };
      await this.save(deployment);
      this.hardware={at:applied.map.readAt,matches:true,error:""};
      if(windowsPositionCount(deployment)>0&&!this.stopRequested)await this.runtime.start(deployment.profile,inputBindings(deployment,applied.map));
      await this.deviceState?.bindingsResult(true,"",applied.changed>0);
      this.message=`${applied.changed} posições gravadas e confirmadas por releitura.`;
      return await this.status();
    }catch(e){
      this.runtime.stop();this.message=(e as Error).message;this.hardware={at:Date.now(),matches:null,error:this.message};
      if(appliedBackup)try{
        const original=parseHardwareMap(JSON.parse(await readFile(join(this.directory,"hardware-backups",appliedBackup),"utf8")));
        const recovered=await this.reader.apply(original.entries.map(entry=>entry.raw.replace(/^03FA/,"03FD")));
        this.hardware={at:recovered.map.readAt,matches:previous?mapFingerprint(recovered.map)===previous.fingerprint:null,error:""};
        if(previous)await this.save(previous);else await writeFile(join(this.directory,"deployment.json"),"null");
        this.message+=" Configuração anterior restaurada e relida.";
      }catch(recovery){this.message+=` Recuperação pendente: ${String(recovery)}. Backup ${appliedBackup}.`;}
      await this.deviceState?.bindingsResult(false,this.message);
      throw new Error(this.message);
    }
    finally{this.busy=false;}
  }
  restore(backup:string){return this.reader.deviceOperation(()=>this.restoreBackup(backup));}
  private async restoreBackup(backup:string){
    this.assertAvailable();
    if(!/^read-[A-Za-z0-9-]+\.json$/.test(backup))throw new Error("Backup inválido.");
    this.busy=true;this.runtime.stop();
    try{
      const raw=JSON.parse(await readFile(join(this.directory,"hardware-backups",backup),"utf8")),map=parseHardwareMap(raw,backup);
      const current=await this.reader.read();if(map.devicePath!==current.devicePath)throw new Error("Backup pertence a outro aparelho.");
      const result=await this.reader.apply(map.entries.map(e=>e.raw.replace(/^03FA/,"03FD")),mapFingerprint(current));
      this.message=`Backup restaurado: ${result.changed} posições confirmadas.`;
      this.hardware={at:result.map.readAt,matches:true,error:""};
      // Keep a deployment entry as a restoration record; it cannot resume a different map.
      const deployed=await this.deployment();if(deployed){await this.save({...deployed,mode:"device",windowsSlots:undefined,fingerprint:mapFingerprint(result.map),appliedAt:Date.now(),backup,restored:true});}
      await this.deviceState?.restored();
      return await this.status();
    }finally{this.busy=false;}
  }
  async start(){
    this.assertAvailable();
    this.busy=true;
    try{
      const deployment=await this.deployment();if(!deployment||!windowsPositionCount(deployment))throw new Error("Aplique um perfil com Automações no Windows primeiro.");
      if(this.runtime.status().active&&this.runtime.status().profileId===deployment.profile.id)return this.runtime.status();
      const current=await this.reader.read();this.hardware={at:current.readAt,matches:mapFingerprint(current)===deployment.fingerprint,error:""};
      if(!this.hardware.matches)throw new Error("O aparelho mudou. Aplique o perfil novamente antes de iniciar o motor.");
      if(this.deviceState){const state=await this.deviceState.read(false);if(state.session.phase!=="ready")throw new Error("A conexão ainda não está pronta para iniciar.");}
      await this.runtime.start(deployment.profile,inputBindings(deployment,current));return this.runtime.status();
    }finally{this.busy=false;}
  }
  async startOnLogin(map: HardwareMap) {
    if (this.stopRequested || this.busy || this.verifying || this.recoveryActive || this.runtime.status().active) return;
    this.busy = true;
    try {
      const deployment = await this.deployment();
      if (this.stopRequested || !deployment || deployment.restored || !windowsPositionCount(deployment)) return;
      if (mapFingerprint(map) !== deployment.fingerprint) {
        this.message = "O mapa do macropad diverge do perfil aplicado. A execução ficou parada.";
        return;
      }
      await this.runtime.start(deployment.profile, inputBindings(deployment, map), false);
      this.message = "Execução retomada com o Windows.";
    } catch (error) {
      if (!this.stopRequested) this.message = `Falha ao retomar execução: ${(error as Error).message}`;
    } finally {
      this.busy = false;
    }
  }
  stop(){this.stopRequested=true;this.runtime.stop();return this.runtime.status();}
  async pauseForVerification(){
    this.assertAvailable();
    this.busy=true;this.verifying=true;
    try{
      const deployment=await this.deployment();
      if(!deployment||deployment.mode!=="local"||!this.runtime.status().active)throw new Error("A conferência de todos os controles exige o modo Automações no Windows ativo.");
      const current = await this.reader.read();
      if(mapFingerprint(current)!==deployment.fingerprint)throw new Error("O mapa mudou. Aplique o perfil antes de conferir os controles.");
      this.runtime.pauseInputs();return { fingerprint: deployment.fingerprint, input: inputBindings(deployment,current) };
    }catch(e){this.verifying=false;throw e;}finally{this.busy=false;}
  }
  resumeAfterVerification(){this.verifying=false;if(this.runtime.status().active&&this.runtime.status().paused)this.runtime.resumeInputs();}
  async verify(){
    this.assertAvailable();
    this.busy=true;
    try{
      const deployment=await this.deployment(),map=await this.reader.read();
      this.hardware={at:map.readAt,matches:deployment?mapFingerprint(map)===deployment.fingerprint:null,error:""};
      if(this.hardware.matches===false){this.runtime.stop();this.message="A configuração real divergiu do perfil aplicado. Motor parado. Leia o mapa ou aplique o perfil novamente.";}
      return await this.status();
    }catch(e){this.hardware={at:Date.now(),matches:null,error:(e as Error).message};throw e;}finally{this.busy=false;}
  }
}
