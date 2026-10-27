import test from "node:test";
import assert from "node:assert/strict";
import { ObsSource,obsAuthentication,obsSettingsSchema } from "../native/obs.ts";
class Socket {
  sent:{op:number;d:Record<string,unknown>}[]=[];listeners=new Map<string,((event:MessageEvent)=>void)[]>();
  addEventListener(type:string,listener:(event:MessageEvent)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  send(data:string){this.sent.push(JSON.parse(data));}
  close(){}
  emit(op:number,d:Record<string,unknown>){for(const listener of this.listeners.get("message")??[])listener(new MessageEvent("message",{data:JSON.stringify({op,d})}));}
  disconnect(){for(const listener of this.listeners.get("close")??[])listener(new MessageEvent("close"));}
}
test("OBS v5 validates protocol responses, isolates microphone, expires stale fields and clears them on disconnect",()=>{
  const socket=new Socket();let destination="";const source=new ObsSource(url=>{destination=url;return socket;});
  try{
    source.configure({enabled:true,port:4455,microphone:"Mic",password:"session-secret"});assert.equal(destination,"ws://127.0.0.1:4455");
    socket.emit(0,{rpcVersion:1,authentication:{salt:"salt",challenge:"challenge"}});assert.equal(socket.sent[0]!.op,1);assert.equal(socket.sent[0]!.d.authentication,obsAuthentication("session-secret","salt","challenge"));
    socket.emit(2,{negotiatedRpcVersion:1});
    const responses:Record<string,Record<string,unknown>>={GetInputList:{inputs:[{inputName:"Mic"},{inputName:"Desktop"}]},GetRecordStatus:{outputActive:true,outputPaused:false},GetStreamStatus:{outputActive:false},GetInputMute:{inputMuted:false},GetInputVolume:{inputVolumeMul:0.4}};
    for(const request of socket.sent.filter(p=>p.op===6)){const type=String(request.d.requestType);assert.ok(type.startsWith("Get"));socket.emit(7,{requestId:request.d.requestId,requestStatus:{result:true},responseData:responses[type]});}
    assert.equal(source.snapshot()["obs.recording"],true);assert.equal(source.snapshot()["obs.streaming"],false);assert.equal(source.snapshot()["obs.microphone.muted"],false);assert.equal(source.snapshot()["obs.microphone.volume"],40);assert.equal(source.snapshot()["obs.microphone.level"],null);
    socket.emit(5,{eventType:"InputVolumeMeters",eventData:{inputs:[{inputName:"Desktop",inputLevelsMul:[[0.9,1,1]]},{inputName:"Mic",inputLevelsMul:[[0.02,0.15,0.2],[0.01,0.1,0.2]]}]}});assert.equal(source.snapshot()["obs.microphone.level"],15);
    assert.ok(Object.values(source.snapshot(Date.now()+3000)).every(v=>v===null));assert.ok(!JSON.stringify(source.status()).includes("session-secret"));
    socket.disconnect();assert.equal(source.status().connected,false);assert.ok(Object.values(source.snapshot()).every(v=>v===null));
    assert.throws(()=>obsSettingsSchema.parse({enabled:true,port:4455,microphone:"",url:"ws://remote"}));
  }finally{source.close();}
});
