import { HARDWARE_CHANNELS } from "./hardware-map.ts";
import type { DeviceInput } from "./device.ts";
import { MARKERS } from "./bindings.ts";
export interface DecodedMarker {layer:number;controlId:string;trigger:"press"|"left"|"right";modifiers:("Ctrl"|"Shift"|"Alt"|"Win")[];}
export class MarkerDecoder {
  private paths=new Map<string,{codes:number[];at:number;down:Set<number>;invalid:boolean;mask:number}>();
  reset(){this.paths.clear();}
  accept(event:DeviceInput):DecodedMarker|null {
    if(event.kind!=="keyboard")return null;
    const key=Number(event.data.vkey),now=event.at;
    const current=this.paths.get(event.devicePath)??{codes:[],at:now,down:new Set<number>(),invalid:false,mask:0};this.paths.set(event.devicePath,current);
    if(event.data.released){
      current.down.delete(key);if(current.down.size)return null;
      if(!current.invalid&&current.codes.length<4)return null;
      const codes=current.codes;current.codes=[];const invalid=current.invalid;current.invalid=false;
      if(invalid||codes.length!==4)return null;
      const index=MARKERS.slice(0,75).findIndex(marker=>marker.every((code,i)=>code+20===codes[i]));
      if(index<0)return null;
      const channel=HARDWARE_CHANNELS[index%25]!;
      const modifiers=(["Ctrl","Shift","Alt","Win"] as const).filter((_,i)=>current.mask&(1<<i));
      return {layer:Math.floor(index/25),controlId:channel.controlId,trigger:channel.trigger,modifiers};
    }
    if(current.down.has(key))return null;current.down.add(key);
    if(now-current.at>2000){current.codes=[];current.invalid=false;}current.at=now;
    if(key===135){if(current.down.size>1)current.invalid=true;else {current.codes=[key];current.invalid=false;}return null;}
    if(current.codes.length===0)return null;
    if(key<124||key>134){current.invalid=true;return null;}
    current.codes.push(key);current.mask=Number(event.data.modifiers??0);if(current.codes.length>4)current.invalid=true;
    return null;
  }
}
