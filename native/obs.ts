import { createHash,randomUUID } from "node:crypto";
import { z } from "zod";
import { OBS_KEYS } from "../lib/obs.ts";
import type { Value } from "../lib/conditions.ts";
export const obsSettingsSchema=z.object({enabled:z.boolean(),port:z.number().int().min(1024).max(65535),microphone:z.string().max(200),password:z.string().max(1000).optional()}).strict();
export type ObsSettings=z.infer<typeof obsSettingsSchema>;
interface ObsSocket {send(data:string):void;close():void;addEventListener(type:string,listener:(event:MessageEvent)=>void):void;}
const object=z.record(z.string(),z.unknown()),wire=z.object({op:z.number().int(),d:object});
export function obsAuthentication(password:string,salt:string,challenge:string):string {const secret=createHash("sha256").update(password+salt).digest("base64");return createHash("sha256").update(secret+challenge).digest("base64");}
export class ObsSource {
  private socket:ObsSocket|null=null;private enabled=false;private connected=false;private port=4455;private microphone="";private password="";private message="Desconectado";private inputNames:string[]=[];
  private pending=new Map<string,{type:string;at:number}>();private values=new Map<string,{value:Value;at:number}>();private listeners=new Set<()=>void>();private timer:ReturnType<typeof setInterval>|null=null;private retry:ReturnType<typeof setTimeout>|null=null;private helloTimeout:ReturnType<typeof setTimeout>|null=null;
  private factory:(url:string)=>ObsSocket;
  constructor(factory:(url:string)=>ObsSocket=url=>new WebSocket(url) as unknown as ObsSocket){this.factory=factory;}
  onChange(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private emit(){for(const listener of this.listeners)listener();}
  snapshot(now=Date.now()):Record<string,Value|null>{return Object.fromEntries(OBS_KEYS.map(key=>{const sample=this.values.get(key);return [key,this.connected&&sample&&now-sample.at<=2500?sample.value:null];}));}
  status(){return {enabled:this.enabled,connected:this.connected,port:this.port,microphone:this.microphone,inputNames:[...this.inputNames],message:this.message,values:this.snapshot()};}
  configure(input:ObsSettings){const parsed=obsSettingsSchema.parse(input);this.close();this.port=parsed.port;this.microphone=parsed.microphone;this.password=parsed.password??this.password;this.enabled=parsed.enabled;if(this.enabled)this.connect();else {this.password="";this.message="Desconectado";}return this.status();}
  private set(key:string,value:unknown){if(typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value)||typeof value==="string")this.values.set(key,{value,at:Date.now()});}
  private request(type:string){
    if(!this.socket||!this.connected||[...this.pending.values()].some(p=>p.type===type))return;
    const allowed=["GetRecordStatus","GetStreamStatus","GetInputList","GetInputMute","GetInputVolume"];if(!allowed.includes(type))throw new Error("Consulta OBS fora do escopo.");
    const requestId=randomUUID();this.pending.set(requestId,{type,at:Date.now()});this.socket.send(JSON.stringify({op:6,d:{requestType:type,requestId,...(type==="GetInputMute"||type==="GetInputVolume"?{requestData:{inputName:this.microphone}}:{})}}));
  }
  private poll(){if([...this.pending.values()].some(p=>Date.now()-p.at>2500)){this.failed("OBS sem resposta; valores desconhecidos.");return;}this.request("GetRecordStatus");this.request("GetStreamStatus");if(this.microphone){this.request("GetInputMute");this.request("GetInputVolume");}this.emit();}
  private connect(){
    if(!this.enabled)return;this.message="Conectando ao OBS local…";const socket=this.factory(`ws://127.0.0.1:${this.port}`);this.socket=socket;
    this.helloTimeout=setTimeout(()=>{if(this.socket===socket)this.failed("OBS não confirmou a conexão.");},3000);this.helloTimeout.unref();
    socket.addEventListener("message",event=>{if(this.socket!==socket||typeof event.data!=="string"||event.data.length>256000)return;
      try{const packet=wire.parse(JSON.parse(event.data)),data=packet.d;
        if(packet.op===0){const auth=data.authentication===undefined?null:z.object({salt:z.string(),challenge:z.string()}).parse(data.authentication);socket.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:(1<<16)|8|64,...(auth?{authentication:obsAuthentication(this.password,auth.salt,auth.challenge)}:{})}}));}
        else if(packet.op===2){if(data.negotiatedRpcVersion!==1)throw new Error("Versão OBS não suportada.");if(this.helloTimeout)clearTimeout(this.helloTimeout);this.helloTimeout=null;this.connected=true;this.message="OBS conectado; leitura de estados ativa.";this.request("GetInputList");this.poll();this.timer=setInterval(()=>this.poll(),1000);this.timer.unref();}
        else if(packet.op===7&&this.connected){const id=z.string().parse(data.requestId),pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);const result=z.object({result:z.boolean()}).parse(data.requestStatus);if(result.result)this.response(pending.type,object.parse(data.responseData??{}));else {this.message=`OBS recusou ${pending.type}; fonte sem dados.`;if(pending.type==="GetInputMute")this.values.delete("obs.microphone.muted");if(pending.type==="GetInputVolume")this.values.delete("obs.microphone.volume");}}
        else if(packet.op===5&&this.connected)this.event(z.string().parse(data.eventType),object.parse(data.eventData??{}));this.emit();
      }catch{this.failed("Resposta OBS desconhecida; fontes sem dados.");}
    });
    socket.addEventListener("close",()=>{if(this.socket===socket)this.failed("OBS desconectado ou autenticação recusada.");});socket.addEventListener("error",()=>{if(this.socket===socket)this.failed("OBS indisponível. Confira a porta e o servidor WebSocket no OBS.");});
  }
  private response(type:string,data:Record<string,unknown>){
    if(type==="GetRecordStatus"){this.set("obs.recording",data.outputActive);this.set("obs.recording.paused",data.outputPaused);}
    if(type==="GetStreamStatus")this.set("obs.streaming",data.outputActive);
    if(type==="GetInputMute")this.set("obs.microphone.muted",data.inputMuted);
    if(type==="GetInputVolume"&&typeof data.inputVolumeMul==="number")this.set("obs.microphone.volume",data.inputVolumeMul*100);
    if(type==="GetInputList"){this.inputNames=z.array(z.object({inputName:z.string()})).parse(data.inputs).map(i=>i.inputName);}
  }
  private event(type:string,data:Record<string,unknown>){
    if(type==="RecordStateChanged")this.set("obs.recording",data.outputActive);
    if(type==="StreamStateChanged")this.set("obs.streaming",data.outputActive);
    if(data.inputName===this.microphone&&type==="InputMuteStateChanged")this.set("obs.microphone.muted",data.inputMuted);
    if(type==="InputVolumeMeters"){
      const inputs=z.array(z.object({inputName:z.string(),inputLevelsMul:z.array(z.array(z.number()))})).parse(data.inputs),input=inputs.find(i=>i.inputName===this.microphone);
      if(input){const peaks=input.inputLevelsMul.map(c=>c[1]).filter((v):v is number=>v!==undefined&&Number.isFinite(v));if(peaks.length)this.set("obs.microphone.level",Math.min(100,Math.max(0,Math.max(...peaks)*100)));}
    }
  }
  private failed(message:string){const enabled=this.enabled;this.close();this.enabled=enabled;this.message=message;this.emit();if(enabled){this.retry=setTimeout(()=>{this.retry=null;this.connect();},5000);this.retry.unref();}}
  close(){this.enabled=false;this.connected=false;this.values.clear();this.pending.clear();if(this.timer)clearInterval(this.timer);if(this.retry)clearTimeout(this.retry);if(this.helloTimeout)clearTimeout(this.helloTimeout);this.timer=null;this.retry=null;this.helloTimeout=null;const socket=this.socket;this.socket=null;socket?.close();this.emit();}
}
