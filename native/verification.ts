import { mkdir,readFile,writeFile,rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MarkerDecoder } from "../lib/marker-decoder.ts";
import { HARDWARE_CHANNELS } from "../lib/hardware-map.ts";
import type { DeviceConnection } from "./device.ts";
import type { ApplicationService } from "./application.ts";
export interface VerifiedControl {count:number;lastAt:number;double:boolean;}
export interface VerificationStatus {active:boolean;fingerprint:string;target:{layer:number;slot:number};confirmed:Record<string,VerifiedControl>;lastReceived:string;message:string;}
export class HardwareVerifier {
  private directory:string;private device:DeviceConnection;private application:Pick<ApplicationService,"pauseForVerification"|"resumeAfterVerification">;
  private decoder=new MarkerDecoder();private cancel:(()=>void)|null=null;private expiry:ReturnType<typeof setInterval>|null=null;private queue:Promise<unknown>=Promise.resolve();private starting=false;private lastSeen=0;
  private state:VerificationStatus={active:false,fingerprint:"",target:{layer:0,slot:1},confirmed:{},lastReceived:"",message:""};
  constructor(directory:string,device:DeviceConnection,application:Pick<ApplicationService,"pauseForVerification"|"resumeAfterVerification">){this.directory=directory;this.device=device;this.application=application;}
  status(renew=false):VerificationStatus{if(renew)this.lastSeen=Date.now();return structuredClone(this.state);}
  private persist(){const saved=JSON.stringify({...this.state,active:false});this.queue=this.queue.catch(()=>{}).then(async()=>{await mkdir(this.directory,{recursive:true});const temp=join(this.directory,`verification-${randomUUID()}.tmp`);await writeFile(temp,saved);await rename(temp,join(this.directory,"hardware-verification.json"));}).catch(e=>{this.state.message=`Falha ao guardar a conferência: ${(e as Error).message}`;});}
  async start(){
    if(this.state.active||this.starting)throw new Error("A conferência já está em andamento.");
    if(!this.device.observe)throw new Error("Leitor físico indisponível.");this.starting=true;
    try{
      const fingerprint=await this.application.pauseForVerification();
      let confirmed:Record<string,VerifiedControl>={};
      try{const previous=JSON.parse(await readFile(join(this.directory,"hardware-verification.json"),"utf8"));if(previous.fingerprint===fingerprint)confirmed=previous.confirmed??{};}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
      this.state={active:true,fingerprint,target:{layer:0,slot:1},confirmed,lastReceived:"",message:"Ações pausadas. Selecione um controle e acione o correspondente no aparelho."};this.decoder.reset();
      this.cancel=this.device.observe(event=>{
        if(event.type==="error"||event.type==="inventory"&&!event.devices.length){this.state.message="Leitor ou aparelho desconectado. Conferência encerrada.";void this.stop();return;}
        if(!this.state.active||event.type!=="input"||Math.abs(Date.now()-event.at)>2000)return;
        const marker=this.decoder.accept(event);if(!marker)return;
        const channel=HARDWARE_CHANNELS.find(c=>c.controlId===marker.controlId&&c.trigger===marker.trigger)!;
        this.state.lastReceived=`${channel.label} · camada ${marker.layer+1} · código ${channel.slot}`;
        if(marker.layer!==this.state.target.layer||channel.slot!==this.state.target.slot){this.state.message="Recebido outro controle/camada. Selecione o correspondente ou repita o indicado.";return;}
        const key=`${marker.layer}:${channel.slot}`,previous=this.state.confirmed[key],now=Date.now();
        this.state.confirmed[key]={count:(previous?.count??0)+1,lastAt:now,double:!!previous?.double||!!previous&&now-previous.lastAt<=400};
        this.state.message="Controle conferido. Escolha o próximo; para testar duplo clique, pressione duas vezes rapidamente.";this.persist();
      });
      this.lastSeen=Date.now();this.expiry=setInterval(()=>{if(Date.now()-this.lastSeen>120000){this.state.message="Conferência encerrada após perder contato com a tela. Resultados preservados.";void this.stop();}},30000);this.expiry.unref();return this.status();
    }catch(e){this.application.resumeAfterVerification();throw e;}finally{this.starting=false;}
  }
  select(layer:number,slot:number){if(!this.state.active)throw new Error("Inicie a conferência primeiro.");this.state.target={layer,slot};this.decoder.reset();this.state.message="Acione este controle na camada física indicada.";return this.status();}
  async stop(){this.cancel?.();this.cancel=null;if(this.expiry)clearInterval(this.expiry);this.expiry=null;this.state.active=false;this.decoder.reset();this.application.resumeAfterVerification();this.persist();await this.queue;return this.status();}
  async close(){this.cancel?.();this.cancel=null;if(this.expiry)clearInterval(this.expiry);this.expiry=null;this.state.active=false;this.decoder.reset();await this.queue;}
}
