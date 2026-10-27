import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindingPacket } from "../lib/bindings.ts";
import { makeProfile, emptyBehavior } from "../lib/model.ts";
import type { Action } from "../lib/model.ts";
import type { DeviceEvent, DeviceInventory } from "../lib/device.ts";
import type { RgbLayer } from "../lib/rgb.ts";
import { ConfigurationReader } from "../native/configuration.ts";
import { RgbService } from "../native/rgb.ts";
import { LocalRuntime } from "../native/runtime.ts";
import { ReconciliationService } from "../native/reconciliation.ts";
import { ApplicationService } from "../native/application.ts";
export async function reconciliationFixture(suppliedDirectory?:string){
  const directory=suppliedDirectory??await mkdtemp(join(tmpdir(),"keymap-reconciliation-"));
  let path="\\\\?\\HID#VID_514C&PID_8850&MI_00#synthetic-e2",connected=true;
  const identity="03FB10030B"+"00".repeat(60);
  const raw={at:Date.now(),devicePath:path,identity,error:null,layers:[1,2,3].map(layer=>({layer,reports:Array.from({length:25},(_,i)=>bindingPacket(i+1,layer,{kind:"none"}).replace(/^03FD/,"03FA"))}))};
  let layers:RgbLayer[]=Array.from({length:3},()=>({mode:1,colors:Array<string>(16).fill("#000000")}));
  let writes=0,rgbWrites=0,reads=0,rgbReads=0,readFailure=false,rgbFailure=false,writeFailure=false,partial=false,rgbPartial=false,rgbWriteFailure=false;
  const rgbPackets:string[][]=[];
  let hold:(()=>Promise<void>)|null=null;
  const listeners=new Set<(event:DeviceEvent)=>void>(),performed:Action[]=[];
  const inventory=():DeviceInventory=>({type:"inventory",at:Date.now(),platform:"synthetic QA adapter",devices:connected?[{path,kind:"hid",product:"SYNTHETIC E2",manufacturer:"test only",usagePage:0xff00,usage:1,inputBytes:65,outputBytes:65,featureBytes:0,version:11}]:[]});
  const device={inventory:async()=>inventory(),recent:()=>[],subscribe:()=>{},observe:(listener:(event:DeviceEvent)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};}};
  const configuration=new ConfigurationReader(directory,{read:async()=>{reads++;if(hold)await hold();if(readFailure||!connected)throw new Error("synthetic read timeout");return {...structuredClone(raw),at:Date.now(),devicePath:path};},write:async(packets,expected)=>{if(expected!==path)throw new Error("synthetic identity changed");writes++;if(writeFailure)throw new Error("synthetic write failure");for(const packet of partial?packets.slice(0,1):packets)raw.layers[parseInt(packet.slice(6,8),16)-1]!.reports[parseInt(packet.slice(4,6),16)-1]=packet.replace(/^03FD/,"03FA");}});
  const rgb=new RgbService(directory,configuration,{read:async()=>{rgbReads++;if(rgbFailure||!connected)throw new Error("synthetic RGB timeout");return {at:Date.now(),devicePath:path,identity,layers:layers.map((value,layer)=>({layer,raw:"03FA"+value.mode.toString(16).padStart(2,"0")+value.colors.map(color=>color.slice(1)).join("")+"00".repeat(14)}))};},write:async(packets,expected)=>{if(expected!==path)throw new Error("synthetic RGB identity changed");rgbWrites++;rgbPackets.push([...packets]);if(rgbWriteFailure)throw new Error("synthetic RGB write failure");for(const packet of rgbPartial?packets.slice(0,1):packets)layers[parseInt(packet.slice(6,8),16)]={mode:parseInt(packet.slice(8,10),16),colors:Array.from({length:16},(_,i)=>"#"+packet.slice(10+i*6,16+i*6))};}});
  const runtime=new LocalRuntime(device,{observe:next=>{next({at:Date.now(),processNames:[],values:{}});return()=>{};}},{start:async()=>{},execute:async action=>{performed.push(action);return "synthetic executed";},stop:()=>{}});
  const state=new ReconciliationService(directory,configuration,rgb,device,runtime),application=new ApplicationService(directory,configuration,runtime);application.setDeviceState(state);
  const profile=makeProfile("e2-qa","QA sintético E2");profile.events=[];
  for(const layer of profile.layers)for(const control of layer.controls)for(const rule of control.rules)rule.behavior=emptyBehavior();
  const emit=(event:DeviceEvent)=>{for(const listener of [...listeners])listener(event);};
  return {directory,raw,device,configuration,rgb,runtime,state,application,profile,performed,inventory,emit,rgbPackets,
    counters:()=>({writes,rgbWrites,reads,rgbReads}),
    setReadFailure:(value:boolean)=>{readFailure=value;},setRgbFailure:(value:boolean)=>{rgbFailure=value;},setWriteFailure:(value:boolean)=>{writeFailure=value;},setPartial:(value:boolean)=>{partial=value;},setHold:(value:(()=>Promise<void>)|null)=>{hold=value;},
    setPath:(value:string)=>{path=value;},setConnected:(value:boolean)=>{connected=value;emit(inventory());},
    setRgb:(value:RgbLayer[])=>{layers=structuredClone(value);},
    setRgbPartial:(value:boolean)=>{rgbPartial=value;},setRgbWriteFailure:(value:boolean)=>{rgbWriteFailure=value;},
  };
}
