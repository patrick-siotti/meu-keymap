import { startRuntime,simulate } from "../lib/engine.ts";
import type { Runtime } from "../lib/engine.ts";
import { MarkerDecoder } from "../lib/marker-decoder.ts";
import type { DecodedMarker } from "../lib/marker-decoder.ts";
import type { Observations } from "../lib/conditions.ts";
import type { Profile,Action } from "../lib/model.ts";
import type { DeviceConnection } from "./device.ts";
import { WindowsExecutor } from "./executor.ts";
import type { ActionExecutor } from "./executor.ts";
export interface RuntimeSources {observe(listener:(sample:Observations)=>void):()=>void;}
export interface RuntimeStatus {active:boolean;paused:boolean;profileId:string|null;profileName:string|null;layer:number;runtimeLayer:number;physicalLayer:null;lastObservedLayer:number|null;lastObservedLayerAt:number|null;events:Record<string,string>;states:{name:string;value:string}[];logs:string[];pending:number;lastInput:number|null;}
export class LocalRuntime {
  private profile:Profile|null=null;
  private state:Runtime|null=null;
  private decoder=new MarkerDecoder();
  private unsubscribe:(()=>void)[]=[];
  private controller:AbortController|null=null;
  private jobs:{action:Action;at:number}[]=[];
  private draining=false;
  private drainWork:Promise<void>=Promise.resolve();
  private generation=0;
  private logs:string[]=[];
  private physicalLayer:number|null=null;
  private layerObservedAt:number|null=null;
  private suspended=false;
  private lifecycle:{onLayer:(layer:number,at:number)=>void;ready:()=>boolean}|null=null;
  private paused=false;
  private lastInput:number|null=null;
  private clicks=new Map<string,{timer:ReturnType<typeof setTimeout>;marker:DecodedMarker}>();
  private device:DeviceConnection;
  private sources:RuntimeSources;
  private executor:ActionExecutor;
  constructor(device:DeviceConnection,sources:RuntimeSources,executor:ActionExecutor=new WindowsExecutor()){this.device=device;this.sources=sources;this.executor=executor;}
  status():RuntimeStatus{return {active:!!this.profile,paused:this.paused||this.suspended,profileId:this.profile?.id??null,profileName:this.profile?.name??null,layer:this.state?.layer??0,runtimeLayer:this.state?.layer??0,physicalLayer:null,lastObservedLayer:this.physicalLayer,lastObservedLayerAt:this.layerObservedAt,events:this.state?.eventStates??{},states:this.profile?.events.map(e=>({name:e.name,value:e.states.find(s=>s.id===this.state?.eventStates[e.id])?.name??"Desconhecido"}))??[],logs:[...this.logs],pending:this.jobs.length+(this.draining?1:0),lastInput:this.lastInput};}
  setLifecycle(lifecycle:NonNullable<LocalRuntime["lifecycle"]>){this.lifecycle=lifecycle;}
  private log(message:string){this.logs=[`${new Date().toLocaleTimeString("pt-BR")} · ${message}`,...this.logs].slice(0,80);}
  async start(profile:Profile){
    this.stop();const generation=this.generation;
    if(!this.device.observe)throw new Error("Leitor físico indisponível.");
    this.controller=new AbortController();await this.executor.start();
    if(generation!==this.generation){this.executor.stop();throw new Error("Inicialização cancelada.");}
    let sample:Observations|null=null;
    this.unsubscribe.push(this.sources.observe(value=>{sample=value;if(this.state)this.state.observed=value;}));
    await new Promise<void>(resolve=>setTimeout(resolve,700));
    if(generation!==this.generation)throw new Error("Inicialização cancelada.");
    this.profile=structuredClone(profile);this.state=startRuntime(this.profile,Date.now(),true,sample);
    this.log(`Motor iniciado: ${profile.name}. LEDs estáticos configurados separadamente.`);this.collect();
    this.unsubscribe.push(this.device.observe(event=>{
      if(event.type==="error"){this.log(event.message);if(this.lifecycle)this.suspendConnection();else this.stop();return;}
      if(event.type==="inventory"&&!event.devices.length){this.log("Macropad desconectado. Entradas suspensas.");if(this.lifecycle)this.suspendConnection();else this.stop();return;}
      if(event.type!=="input"||Date.now()-event.at>2000||event.at>Date.now()+1000)return;
      if(this.paused||this.suspended||this.lifecycle&&!this.lifecycle.ready()){this.decoder.reset();return;}
      const marker=this.decoder.accept(event);if(marker)this.receive(marker);
    }));
  }
  private receive(marker:DecodedMarker){
    if(!this.profile||!this.state)return;
    this.lastInput=Date.now();
    if(this.physicalLayer!==marker.layer){for(const click of this.clicks.values())clearTimeout(click.timer);this.clicks.clear();this.physicalLayer=marker.layer;this.layerObservedAt=Date.now();this.lifecycle?.onLayer(marker.layer,this.layerObservedAt);this.state.layer=marker.layer;}
    const layer=this.state.layer,control=this.profile.layers[layer]!.controls.find(c=>c.id===marker.controlId)!;
    const hasDouble=marker.trigger==="press"&&control.rules.some(r=>r.trigger==="double"&&!r.qualifier.controlId&&r.qualifier.modifiers.length===marker.modifiers.length&&r.qualifier.modifiers.every(m=>marker.modifiers.includes(m)));
    const key=`${layer}:${marker.controlId}:${marker.modifiers.join("+")}`;
    if(hasDouble){const pending=this.clicks.get(key);if(pending){clearTimeout(pending.timer);this.clicks.delete(key);this.dispatch(marker,"double");}else{const timer=setTimeout(()=>{this.clicks.delete(key);if(this.state?.layer===layer)this.dispatch(marker,"press");},400);this.clicks.set(key,{timer,marker});}}
    else this.dispatch(marker,marker.trigger);
  }
  private dispatch(marker:DecodedMarker,trigger:"press"|"double"|"left"|"right"){
    if(!this.profile||!this.state||this.paused||this.suspended||this.lifecycle&&!this.lifecycle.ready())return;
    const priorLayer=this.state.layer;
    this.state=simulate(this.profile,this.state,this.state.layer,marker.controlId,trigger,{controlId:"",modifiers:marker.modifiers});
    if(this.state.layer!==priorLayer){for(const click of this.clicks.values())clearTimeout(click.timer);this.clicks.clear();}
    this.log(`${marker.controlId} · ${trigger} · camada ${this.state.layer+1}`);this.collect();
  }
  private collect(){
    if(!this.state)return;for(const message of [...this.state.logs].reverse())this.log(message);this.state.logs=[];const effects=this.state.effects?.splice(0)??[];
    for(const action of effects)if(action.kind!=="none"&&action.kind!=="layer"){
      if(this.jobs.length>=32){this.log("Fila cheia: ação descartada.");continue;}this.jobs.push({action,at:Date.now()});
    }
    if(!this.draining)this.drainWork=this.drain();
  }
  private async drain(){
    if(this.draining)return;this.draining=true;const generation=this.generation;
    try{while(this.jobs.length&&generation===this.generation&&!this.controller?.signal.aborted){const job=this.jobs.shift()!;if(Date.now()-job.at>10000){this.log("Ação antiga descartada.");continue;}try{const result=await this.executor.execute(job.action,this.controller!.signal);if(generation===this.generation)this.log(result.slice(0,800));}catch(e){if(generation===this.generation)this.log(`Falha: ${(e as Error).message.slice(0,800)}`);}}}
    finally{this.draining=false;if(this.jobs.length)void this.drain();}
  }
  stop(){
    this.generation++;this.profile=null;this.paused=false;this.suspended=false;this.controller?.abort();this.controller=null;this.jobs=[];
    for(const cancel of this.unsubscribe.splice(0))cancel();
    for(const click of this.clicks.values())clearTimeout(click.timer);this.clicks.clear();this.decoder.reset();this.physicalLayer=null;this.layerObservedAt=null;
    this.executor.stop();
  }
  async close(){this.stop();await this.drainWork;await this.executor.close?.();}
  pauseInputs(){
    if(!this.profile||this.status().pending)throw new Error("Inicie o motor e aguarde as ações terminarem antes do teste.");
    this.paused=true;for(const click of this.clicks.values())clearTimeout(click.timer);this.clicks.clear();this.decoder.reset();this.log("Ações pausadas para conferência física.");
  }
  resumeInputs(){this.paused=false;this.decoder.reset();this.physicalLayer=null;this.log("Conferência encerrada; entrada normal retomada.");}
  suspendConnection(){
    if(!this.profile||this.suspended)return;this.suspended=true;this.generation++;this.controller?.abort();this.jobs=[];
    for(const click of this.clicks.values())clearTimeout(click.timer);this.clicks.clear();this.decoder.reset();this.physicalLayer=null;this.layerObservedAt=null;
    if(this.state){this.state.held=[];this.state.effects=[];this.state.observed=null;}this.executor.stop();
    this.log("Conexão não pronta; entradas e ações pendentes descartadas.");
  }
  async resumeConnection(){
    if(!this.profile||!this.suspended)return;const generation=this.generation;
    await this.executor.start();if(generation!==this.generation){this.executor.stop();return;}
    this.controller=new AbortController();this.decoder.reset();this.suspended=false;this.log("Bindings confirmados; somente novas entradas retomadas.");
  }
}
