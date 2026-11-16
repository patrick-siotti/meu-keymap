import { HARDWARE_CHANNELS } from "./hardware-map.ts";
import type { DeviceInput } from "./device.ts";
import { MARKERS } from "./bindings.ts";
export interface DecodedMarker {index:number;layer:number;controlId:string;trigger:"press"|"left"|"right";modifiers:("Ctrl"|"Shift"|"Alt"|"Win")[];}
const defaultBindings = new Map(MARKERS.slice(0, 75).map((keys, index) => [keys.map(key => key + 20).join(","), index]));
export class MarkerDecoder {
  private paths=new Map<string,{codes:number[];at:number;down:Set<number>;invalid:boolean;mask:number}>();
  private readonly bindings: ReadonlyMap<string, number>;
  constructor(bindings: ReadonlyMap<string, number> = defaultBindings) { this.bindings = bindings; }
  reset(){this.paths.clear();}
  accept(event:DeviceInput, heldKeys?: ReadonlySet<number>):DecodedMarker|null {
    if(event.kind!=="keyboard")return null;
    const key=Number(event.data.vkey),now=event.at;
    if (key < 124 || key > 135 || heldKeys?.has(key)) return null;
    const current=this.paths.get(event.devicePath)??{codes:[],at:now,down:new Set<number>(),invalid:false,mask:0};this.paths.set(event.devicePath,current);
    if(event.data.released){
      current.down.delete(key);if(current.down.size)return null;
      if(!current.invalid&&current.codes.length<4)return null;
      const codes=current.codes;current.codes=[];const invalid=current.invalid;current.invalid=false;
      if(invalid||codes.length!==4)return null;
      const index=this.bindings.get(codes.join(","));
      if(index===undefined)return null;
      const channel=HARDWARE_CHANNELS[index%25]!;
      const modifiers=(["Ctrl","Shift","Alt","Win"] as const).filter((_,i)=>current.mask&(1<<i));
      return {index,layer:Math.floor(index/25),controlId:channel.controlId,trigger:channel.trigger,modifiers};
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
