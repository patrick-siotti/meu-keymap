import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { capabilities, sameDevice, StateConflict } from "../lib/device-state.ts";
import type { Capability, ConnectionPhase, DesiredState, DeviceIdentity, DeviceStateSnapshot, DomainDelivery, StateDocument } from "../lib/device-state.ts";
import { rawConfigurationSchema, parseHardwareMap } from "../lib/hardware-map.ts";
import type { HardwareMap } from "../lib/hardware-map.ts";
import { equalRgb, parseRgb, rgbRawSchema, staticRgbSchema, staticRgbLayers } from "../lib/rgb.ts";
import type { RgbLayer, RgbSnapshot, StaticRgbInput } from "../lib/rgb.ts";
import type { Profile } from "../lib/model.ts";
import type { DeviceEvent } from "../lib/device.ts";
import type { DeviceConnection } from "./device.ts";
import { ConfigurationReader, mapFingerprint } from "./configuration.ts";
import { RgbService } from "./rgb.ts";
import { DeviceStateStore } from "./device-state.ts";
import { profileStamp } from "../lib/profile-stamp.ts";
import type { LocalRuntime } from "./runtime.ts";

const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Domain="bindings"|"rgb";
const identityFor=(map:HardwareMap,serial:string|null):DeviceIdentity=>{
  if(map.protocolVersion!==11)throw new Error("Reconciliação disponível somente para FB16+3/v11.");
  return {path:map.devicePath,protocolVersion:11,keys:16,encoders:3,serial,container:null,provenance:serial?"FB16+3/v11 e serial HID informado pelo Windows":"FB16+3/v11; vínculo conservador ao caminho Windows, sem serial/container validados"};
};
function attempt(previous:DomainDelivery|null,revision:number,generation:number):DomainDelivery{
  return {desiredRevision:revision,generation,attempt:randomUUID(),startedAt:Date.now(),finishedAt:null,status:"unknown",sent:false,confirmedByRead:false,error:"",lastConfirmation:previous?.lastConfirmation??null};
}

// Generic fallback is deliberately exercised only by a labelled synthetic adapter.
export async function deliverCapability(capability:Capability,adapter:{read:()=>Promise<unknown>;write:()=>Promise<void>;matches:(value:unknown)=>boolean}):Promise<"confirmed"|"sent">{
  if(capability.write!=="available")throw new Error("Escrita não suportada ou desconhecida.");
  if(capability.read==="unknown")throw new Error("Leitura desconhecida não autoriza fallback.");
  if(capability.read==="unsupported"){await adapter.write();return "sent";}
  await adapter.read();await adapter.write();
  if(!adapter.matches(await adapter.read()))throw new Error("Releitura divergente.");
  return "confirmed";
}

export class ReconciliationService {
  readonly store:DeviceStateStore;
  private phase:ConnectionPhase="disconnected";
  private identity:DeviceIdentity|null=null;
  private error="";
  private pathSignature:string|null=null;
  private currentCandidates:string[]=[];
  private serials=new Map<string,string>();
  private trustedGeneration:number|null=null;
  private layer:DeviceStateSnapshot["lastObservedLayer"]=null;
  private unsubscribe:(()=>void)|null=null;
  private work:Promise<void>=Promise.resolve();
  private autoAttempted=new Set<string>();
  private liveRead=false;
  private closed=false;
  private automaticReapply=true;
  private bindingsMaintenance=false;
  setBindingsMaintenance(active:boolean){this.bindingsMaintenance=active;}
  private assertNotMaintaining(){if(this.bindingsMaintenance)throw new StateConflict("Recuperação de bindings em manutenção; preserve o rascunho e aguarde.");}
  bindingsRecovered(){this.configuration.usb.assertCurrent();this.phase="ready";this.error="";this.trustedGeneration=this.generation();this.automaticReapply=true;}
  suppressAutomaticReapply(){this.automaticReapply=false;}
  private readStatus={bindings:{current:false,error:""},rgb:{current:false,error:""}};
  private directory:string;
  private configuration:ConfigurationReader;
  private rgb:RgbService;
  private device:DeviceConnection;
  private runtime:LocalRuntime;
  constructor(directory:string,configuration:ConfigurationReader,rgb:RgbService,device:DeviceConnection,runtime:LocalRuntime,store?:DeviceStateStore){
    this.directory=directory;this.configuration=configuration;this.rgb=rgb;this.device=device;this.runtime=runtime;
    this.store=store??new DeviceStateStore(directory);
    configuration.onWrite=phase=>this.sending("bindings",phase);
    rgb.onWrite=phase=>this.sending("rgb",phase);
    configuration.onReadError=error=>{this.readStatus.bindings={current:false,error:String(error)};this.fail(String(error));};
    rgb.onReadError=error=>{this.readStatus.rgb={current:false,error:String(error)};};
    configuration.onRead=async(value,raw)=>{
      if(!this.currentCandidates.length)await this.inventory();
      const identity=identityFor(value,this.serials.get(value.devicePath.toLowerCase())??null);this.validatePath(identity.path);
      if(this.identity&&!sameDevice(this.identity,identity))throw new Error("Identidade mudou durante a operação.");
      this.identity=identity;const generation=configuration.usb.currentGeneration();
      const updated=await this.store.update(undefined,current=>{
        const previous=current.observed?.generation===generation&&sameDevice(current.observed.identity,identity)?current.observed:null;
        current.observed={at:Date.now(),generation,identity,bindings:{value,raw:rawConfigurationSchema.parse(raw),fingerprint:mapFingerprint(value)},rgb:previous?.rgb??null};return current;
      });
      this.readStatus.bindings={current:true,error:""};
      if(updated.desired?.bindings&&!this.bindingsMatch(updated)){this.phase="degraded";this.error="Atalhos lidos divergem da configuração desejada. Entradas suspensas.";this.runtime.suspendConnection();this.trustedGeneration=null;}
    };
    rgb.onRead=async(value,raw)=>{
      if(!this.currentCandidates.length)await this.inventory();
      this.validatePath(value.devicePath);const parsed=rgbRawSchema.parse(raw);
      const identity:DeviceIdentity={path:value.devicePath,protocolVersion:11,keys:16,encoders:3,serial:this.serials.get(value.devicePath.toLowerCase())??null,container:null,provenance:"FB16+3/v11; consulta RGB FA B0, identidade Windows"};
      if(this.identity&&!sameDevice(this.identity,identity))throw new Error("Identidade RGB diverge dos bindings.");
      this.identity=identity;const generation=configuration.usb.currentGeneration();
      await this.store.update(undefined,current=>{
        const previous=current.observed?.generation===generation&&sameDevice(current.observed.identity,identity)?current.observed:null;
        current.observed={at:Date.now(),generation,identity,bindings:previous?.bindings??null,rgb:{value,raw:parsed}};return current;
      });
      this.readStatus.rgb={current:true,error:""};
    };
    runtime.setLifecycle({onLayer:(layer,at)=>this.observeLayer(layer,at),ready:()=>this.phase==="ready"&&this.trustedGeneration===configuration.usb.currentGeneration()});
  }
  private validatePath(path:string){
    if(this.currentCandidates.length!==1||this.currentCandidates[0]?.toLowerCase()!==path.toLowerCase())throw new Error("Selecione exatamente um macropad compatível; caminho/porta ou identidade não reconhecidos.");
  }
  private generation(){return this.configuration.usb.currentGeneration();}
  async snapshot():Promise<DeviceStateSnapshot>{
    const document=await this.store.load(),recovery=await this.configuration.usb.recovery();
    const differences={bindings:document.desired?.bindings&&document.observed?.bindings?document.observed.bindings.value.entries.filter(entry=>!document.desired!.bindings!.includes(entry.raw.replace(/^03FA/,"03FD"))).length:null,rgbBanks:document.desired?.rgb&&document.observed?.rgb?document.observed.rgb.value.layers.filter((value,index)=>!equalRgb(value,document.desired!.rgb![index]!)).length:null};
    return {...document,capabilities:capabilities(),readStatus:structuredClone(this.readStatus),session:{phase:recovery||document.recovery?"recovery-required":this.phase,generation:this.generation(),identity:this.identity,error:this.error||recovery||"",observedCurrent:this.trustedGeneration===this.generation()},physicalLayer:null,lastObservedLayer:this.layer,differences,physicalOutputPending:"LEDs são cores estáticas gravadas explicitamente. Reconexão, perfis e eventos não gravam RGB. A leitura não confirma saída visível."};
  }
  start(){
    if(this.unsubscribe)return;this.closed=false;
    this.unsubscribe=this.device.observe?.(event=>this.handleEvent(event))??null;
    void this.device.inventory().then(inventory=>this.handleEvent(inventory)).catch(error=>this.fail(String(error)));
  }
  async close(){this.closed=true;this.unsubscribe?.();this.unsubscribe=null;this.configuration.usb.invalidate();this.runtime.stop();await this.work.catch(()=>{});await this.configuration.usb.close();}
  async idle(){await this.work;}
  handleEvent(event:DeviceEvent){
    if(this.closed)return;
    if(event.type==="error"){this.disconnected(event.message);return;}
    if(event.type!=="inventory")return;
    this.serials=new Map(event.devices.filter(item=>item.serial?.trim()&&!/^0+$/.test(item.serial)).map(item=>[item.path.toLowerCase(),item.serial!.trim()]));
    const paths=event.devices.filter(item=>item.usagePage===0xff00&&item.usage===1&&item.inputBytes===65&&item.outputBytes===65).map(item=>item.path).sort();
    const signature=paths.join("|").toLowerCase();if(this.pathSignature===signature)return;
    this.pathSignature=signature;this.currentCandidates=paths;
    this.configuration.usb.invalidate();this.trustedGeneration=null;this.layer=null;this.identity=null;this.runtime.suspendConnection();
    this.readStatus={bindings:{current:false,error:""},rgb:{current:false,error:""}};
    if(paths.length!==1){this.phase=paths.length?"degraded":"disconnected";this.error=paths.length?"Há mais de um macropad. Selecione/vincule somente um aparelho.":"Macropad desconectado.";return;}
    this.phase="identifying";this.error="";
    const generation=this.generation();
    this.work=this.work.catch(()=>{}).then(async()=>{
      if(generation!==this.generation())return;
      try{await this.read(false);if(generation!==this.generation())return;const current=await this.store.load();
        if(current.desired&&!sameDevice(current.desired.identity,this.identity!)){this.fail("O caminho/porta mudou. Aplique explicitamente para vincular este aparelho.");return;}
        if(current.desired&&current.policy.enabled&&this.automaticReapply){const key=`${generation}:${current.desired.revision}`;if(!this.autoAttempted.has(key)){this.autoAttempted.add(key);await this.reconcile(undefined,true);}}
        else if(current.desired){await this.resumeIfConfirmed(current);}
      }catch(error){if(generation===this.generation())this.fail((error as Error).message);}
    });
  }
  private disconnected(message:string){this.pathSignature=null;this.currentCandidates=[];this.identity=null;this.configuration.usb.invalidate();this.trustedGeneration=null;this.layer=null;this.phase="disconnected";this.error=message;this.readStatus={bindings:{current:false,error:message},rgb:{current:false,error:message}};this.runtime.suspendConnection();}
  private fail(message:string){this.phase="degraded";this.error=message;this.trustedGeneration=null;this.runtime.suspendConnection();}
  private async inventory(){
    const inventory=await this.device.inventory();
    this.serials=new Map(inventory.devices.filter(item=>item.serial?.trim()&&!/^0+$/.test(item.serial)).map(item=>[item.path.toLowerCase(),item.serial!.trim()]));
    const paths=inventory.devices.filter(item=>item.usagePage===0xff00&&item.usage===1&&item.inputBytes===65&&item.outputBytes===65).map(item=>item.path);
    this.currentCandidates=paths;
    if(paths.length!==1)throw new Error("Conecte exatamente um macropad compatível.");
    return inventory;
  }
  async read(includeRgb=true):Promise<DeviceStateSnapshot>{
    this.assertNotMaintaining();
    return this.configuration.deviceOperation(async()=>{
      this.assertNotMaintaining();
      this.phase="reading";this.error="";this.trustedGeneration=null;
      try{
        await this.inventory();const bindings=await this.configuration.read();
        if(includeRgb){try{const rgb=await this.rgb.read();if(bindings.devicePath!==rgb.devicePath)throw new Error("Identidade mudou entre as leituras.");}catch(error){this.readStatus.rgb={current:false,error:String(error)};this.configuration.usb.assertCurrent();}}
        this.configuration.usb.assertCurrent();this.trustedGeneration=this.generation();this.liveRead=true;
        this.phase=await this.configuration.usb.recovery()?"recovery-required":"ready";
        const state=await this.store.load();
        if(state.desired?.bindings&&!this.bindingsMatch(state)){this.phase="degraded";this.error="Atalhos lidos divergem da configuração desejada. Entradas suspensas até reconciliação.";this.runtime.suspendConnection();}
        if(state.recovery||await this.configuration.usb.recovery()){this.phase="recovery-required";this.runtime.suspendConnection();}
        return this.snapshot();
      }catch(error){this.fail((error as Error).message);throw error;}
    });
  }
  async chooseBindings(profile:Profile,mode:"device"|"local",packets:string[]):Promise<void>{
    this.assertNotMaintaining();
    await this.configuration.usb.assertWritable();await this.read(false);
    const state=await this.store.load(),observed=state.observed!;
    const bindings=observed.bindings!.value.entries.map(entry=>packets.find(packet=>packet.slice(4,8)===entry.raw.slice(4,8))??entry.raw.replace(/^03FA/,"03FD"));
    const revision=(state.desired?.revision??0)+1,identity=this.identity!;
    const previous=state.desired&&sameDevice(state.desired.identity,identity)?state.desired:null;
    const desired:DesiredState={revision,hash:digest({profile,mode,bindings,rgb:previous?.rgb??null}),profile,profileHash:await profileStamp(profile),mode,identity,bindings,rgb:previous?.rgb??null,chosenAt:Date.now()};
    await this.store.update(state.revision,current=>({...current,desired,policy:{enabled:false},delivery:{...current.delivery,bindings:attempt(current.delivery.bindings,revision,this.generation())}}));
    this.phase="reconciling";
  }
  async bindingsResult(success:boolean,error="",sent=false){
    if(success){await this.read(false);await this.confirm("bindings",sent);await this.store.update(undefined,current=>({...current,policy:{enabled:true}}));this.automaticReapply=true;}
    else {await this.failure("bindings",error);this.fail(error);}
  }
  async applyRgb(layer:number,settings:RgbLayer,fingerprint:string):Promise<RgbSnapshot>{
    if(settings.mode!==1)throw new Error("Novas gravações aceitam somente cor estática (modo 1).");
    return this.applyRgbSelection(fingerprint,before=>before.map((value,index)=>index===layer?settings:value));
  }
  async applyStaticRgb(input:StaticRgbInput):Promise<RgbSnapshot>{
    const parsed=staticRgbSchema.parse(input);
    return this.applyRgbSelection(parsed.fingerprint,before=>staticRgbLayers(before,parsed));
  }
  private async applyRgbSelection(fingerprint:string,select:(before:RgbLayer[])=>RgbLayer[]):Promise<RgbSnapshot>{
    this.assertNotMaintaining();
    return this.configuration.deviceOperation(async()=>{
      this.assertNotMaintaining();
      await this.configuration.usb.assertWritable();await this.read();
      if(!this.readStatus.rgb.current)throw new Error(this.readStatus.rgb.error||"Leitura RGB atual indisponível.");
      const current=await this.store.load(),before=current.observed!.rgb!.value;
      if(before.fingerprint!==fingerprint)throw new Error("O RGB mudou. Leia novamente antes de gravar.");
      const rgb=select(before.layers),revision=(current.desired?.revision??0)+1;
      const previous=current.desired&&sameDevice(current.desired.identity,this.identity!)?current.desired:null;
      const desired:DesiredState={revision,hash:digest({bindings:previous?.bindings??null,rgb}),chosenAt:Date.now(),identity:this.identity!,profile:previous?.profile??null,profileHash:previous?.profileHash??null,mode:previous?.mode??"device",bindings:previous?.bindings??null,rgb};
      await this.store.update(current.revision,state=>({...state,desired,delivery:{...state.delivery,rgb:attempt(state.delivery.rgb,revision,this.generation())}}));
      this.phase="reconciling";this.runtime.suspendConnection();
      try{const result=await this.rgb.applyLayers(rgb,fingerprint);await this.read(false);await this.confirm("rgb",!before.layers.every((v,i)=>equalRgb(v,rgb[i]!)));await this.resumeIfConfirmed(await this.store.load());return result;}
      catch(error){await this.failure("rgb",(error as Error).message);this.fail((error as Error).message);if(!await this.configuration.usb.recovery()){await this.read(false);await this.resumeIfConfirmed(await this.store.load());}throw error;}
    });
  }
  async policy(revision:number,enabled:boolean):Promise<DeviceStateSnapshot>{
    this.assertNotMaintaining();
    // Disabling is immediate: a queued automatic operation sees this persisted policy before sending.
    const state=await this.store.update(revision,current=>{
      this.assertNotMaintaining();
      if(enabled&&(!current.desired?.bindings||!this.identity||!sameDevice(current.desired.identity,this.identity)))throw new Error("Aplique e vincule uma configuração antes de habilitar a reaplicação.");
      return {...current,policy:{enabled}};
    });
    if(!state.policy.enabled)this.autoAttempted.add(`${this.generation()}:${state.desired?.revision??0}`);
    if(enabled)this.automaticReapply=true;
    return this.snapshot();
  }
  async reconcile(revision?:number,automatic=false):Promise<DeviceStateSnapshot>{
    this.assertNotMaintaining();
    return this.configuration.deviceOperation(async()=>{
      this.assertNotMaintaining();
      const initial=await this.store.load();if(revision!==undefined&&initial.revision!==revision)throw new StateConflict("O estado mudou. Atualize antes de reconciliar.");
      if(!initial.desired)throw new Error("Nenhuma configuração escolhida explicitamente para reaplicar.");
      if(automatic&&!initial.policy.enabled)return this.snapshot();
      await this.configuration.usb.assertWritable();this.runtime.suspendConnection();
      try{
        await this.read(false);let state=await this.store.load();const desired=state.desired!;
        if(!sameDevice(desired.identity,this.identity!))throw new Error("Outro caminho/porta; vínculo explícito necessário antes de aplicar.");
        this.phase="reconciling";
        for(const domain of ["bindings"] as const){
          if(desired[domain]===null)continue;
          if(automatic&&!(await this.store.load()).policy.enabled)break;
          state=await this.store.update(undefined,current=>({...current,delivery:{...current.delivery,[domain]:attempt(current.delivery[domain],desired.revision,this.generation())}}));
          const observed=state.observed!;
          const differs=!this.bindingsMatch(state);
          try{
            this.configuration.usb.assertCurrent();
            if(differs){
              await this.configuration.apply(desired.bindings!,mapFingerprint(observed.bindings!.value));
            }
            await this.read(false);await this.confirm(domain,differs);
          }catch(error){await this.failure(domain,(error as Error).message);throw error;}
        }
        this.phase="ready";await this.resumeIfConfirmed(await this.store.load());return this.snapshot();
      }catch(error){this.fail((error as Error).message);throw error;}
    });
  }
  private bindingsMatch(state:StateDocument):boolean {
    return !!state.desired?.bindings&&!!state.observed?.bindings&&state.observed.bindings.value.entries.every(entry=>state.desired!.bindings!.some(packet=>packet.replace(/^03FD/,"03FA")===entry.raw));
  }
  private async resumeIfConfirmed(state:StateDocument){
    if(this.bindingsMatch(state)&&this.trustedGeneration===this.generation()&&!(await this.configuration.usb.recovery())&&!state.recovery){this.phase="ready";await this.runtime.resumeConnection();}
    else if(this.runtime.status().active){this.phase="degraded";this.error="Bindings ainda não confirmados; novas entradas suspensas.";}
  }
  private async confirm(domain:Domain,sent:boolean){
    await this.store.update(undefined,current=>{
      const delivery=current.delivery[domain];if(!delivery)return current;
      if(delivery.generation!==this.generation())throw new Error("Confirmação de geração antiga rejeitada.");
      const matches=domain==="bindings"?this.bindingsMatch(current):!!current.desired?.rgb&&!!current.observed?.rgb&&current.observed.rgb.value.layers.every((value,index)=>equalRgb(value,current.desired!.rgb![index]!));
      if(!matches)throw new Error("Leitura independente divergiu do estado desejado.");
      const fingerprint=domain==="bindings"?mapFingerprint(current.observed!.bindings!.value):current.observed!.rgb!.value.fingerprint;
      current.delivery[domain]={...delivery,status:"confirmed",sent,confirmedByRead:true,finishedAt:Date.now(),lastConfirmation:{desiredRevision:delivery.desiredRevision,generation:this.generation(),at:Date.now(),fingerprint}};return current;
    });
  }
  private async failure(domain:Domain,error:string){
    const recovery=await this.configuration.usb.recovery();
    await this.store.update(undefined,current=>{
      const previous=current.delivery[domain];if(previous)current.delivery[domain]={...previous,status:recovery?"partial":"failed",confirmedByRead:false,error,finishedAt:Date.now()};
      if(recovery)current.recovery={at:Date.now(),reason:recovery,backups:[],identity:this.identity};return current;
    });
  }
  private async sending(domain:Domain,phase:"sending"|"sent"){
    await this.store.update(undefined,current=>{
      const previous=current.delivery[domain];if(previous)current.delivery[domain]={...previous,status:phase==="sent"?"sent":"unknown",sent:phase==="sent"?true:null,confirmedByRead:false};return current;
    });
  }
  observeLayer(layer:number,at:number){
    if(this.layer?.layer===layer&&this.layer.generation===this.generation())return;
    this.layer={layer,at,generation:this.generation(),provenance:"Marcador validado do controle; última camada observada, não consulta de camada ativa"};
    // Banks are preconfigured. No proven volatile output exists; no persistent writes here.
  }
  async restored(){
    await this.read();
    await this.store.update(undefined,current=>({...current,policy:{enabled:false},delivery:{...current.delivery,bindings:current.delivery.bindings?{...current.delivery.bindings,status:"restored",confirmedByRead:false,finishedAt:Date.now()}:null}}));
  }
  async recover(input:{revision:number;bindingsBackup:string;rgbBackup:string;bindingsFingerprint:string;rgbFingerprint:string}):Promise<DeviceStateSnapshot>{
    this.assertNotMaintaining();
    if(!/^read-[A-Za-z0-9-]+\.json$/.test(input.bindingsBackup)||!/^rgb-[0-9]+-[a-f0-9-]+\.json$/.test(input.rgbBackup))throw new Error("Backups inválidos.");
    return this.configuration.deviceOperation(async()=>{
      this.assertNotMaintaining();
      const state=await this.store.load();if(state.revision!==input.revision)throw new StateConflict("O estado mudou. Revise a recuperação.");
      this.runtime.stop();await this.read();if(!this.readStatus.rgb.current)throw new Error(this.readStatus.rgb.error||"Leitura RGB atual indisponível.");const before=(await this.store.load()).observed!;
      if(mapFingerprint(before.bindings!.value)!==input.bindingsFingerprint||before.rgb!.value.fingerprint!==input.rgbFingerprint)throw new Error("O aparelho mudou desde a revisão da recuperação.");
      const bindings=parseHardwareMap(JSON.parse(await readFile(join(this.directory,"hardware-backups",input.bindingsBackup),"utf8")),input.bindingsBackup);
      const rgb=parseRgb(JSON.parse(await readFile(join(this.directory,"rgb-backups",input.rgbBackup),"utf8")));
      if(bindings.devicePath!==before.identity.path||rgb.devicePath!==before.identity.path)throw new Error("Backup de outro aparelho.");
      const record={at:Date.now(),input,before};await mkdir(join(this.directory,"recovery-backups"),{recursive:true});await writeFile(join(this.directory,"recovery-backups",`${randomUUID()}.json`),JSON.stringify(record,null,2),{flag:"wx"});
      try{
        await this.configuration.apply(bindings.entries.map(entry=>entry.raw.replace(/^03FA/,"03FD")),input.bindingsFingerprint,true);
        const fresh=await this.rgb.read();await this.rgb.applyLayers(rgb.layers,fresh.fingerprint,true);
        await this.read();const after=(await this.store.load()).observed!;
        if(mapFingerprint(after.bindings!.value)!==mapFingerprint(bindings)||!after.rgb!.value.layers.every((value,index)=>equalRgb(value,rgb.layers[index]!)))throw new Error("Recuperação não confirmada.");
        await this.configuration.usb.completeRecovery({at:Date.now(),input,after});
        await this.store.update(undefined,current=>({...current,recovery:null,policy:{enabled:false},delivery:{bindings:current.delivery.bindings?{...current.delivery.bindings,status:"restored",confirmedByRead:false}:null,rgb:current.delivery.rgb?{...current.delivery.rgb,status:"restored",confirmedByRead:false}:null}}));
        this.phase="ready";return this.snapshot();
      }catch(error){await this.configuration.usb.requireRecovery(String(error),[input.bindingsBackup,input.rgbBackup]);this.fail(String(error));throw error;}
    });
  }
  hasLiveRead(){return this.liveRead;}
}
