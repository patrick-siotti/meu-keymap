import { MARKERS } from "./bindings.ts";

export const CAPTURE_MARKER_TIMEOUT_MS=500;
export interface ShortcutKeyEvent {
  key:string;code:string;ctrlKey:boolean;altKey:boolean;shiftKey:boolean;metaKey:boolean;repeat?:boolean;
}
export interface CapturePending {prefix:number[];first:string|null;}
export type CaptureDecision =
  | {kind:"ignore"|"wait"|"marker"|"cancel";pending:CapturePending}
  | {kind:"capture";pending:CapturePending;chord:string};
export const emptyCapture=():CapturePending=>({prefix:[],first:null});
const markers=MARKERS.slice(0,75).map(keys=>keys.map(code=>code+20));
function chord(event:ShortcutKeyEvent):string {
  const key=event.code==="Space"?"Space":event.key.length===1?event.key.toUpperCase():event.key;
  return [event.ctrlKey&&"Ctrl",event.altKey&&"Alt",event.shiftKey&&"Shift",event.metaKey&&"Win",key].filter(Boolean).join("+");
}
export function captureShortcutKey(pending:CapturePending,event:ShortcutKeyEvent):CaptureDecision {
  if(event.key==="Escape")return {kind:"cancel",pending:emptyCapture()};
  if(event.repeat||["Control","Alt","Shift","Meta"].includes(event.key))return {kind:"ignore",pending};
  const noModifiers=!event.ctrlKey&&!event.altKey&&!event.shiftKey&&!event.metaKey;
  const f=/^F([1-9]|1\d|2[0-4])$/.exec(event.code||event.key),code=f?111+Number(f[1]):0;
  if(pending.prefix.length){
    const prefix=[...pending.prefix,code];
    if(noModifiers&&markers.some(keys=>prefix.every((value,index)=>keys[index]===value))){
      return prefix.length===4?{kind:"marker",pending:emptyCapture()}:{kind:"wait",pending:{prefix,first:pending.first}};
    }
    return {kind:"capture",pending:emptyCapture(),chord:pending.first!};
  }
  if(code===135&&noModifiers)return {kind:"wait",pending:{prefix:[code],first:chord(event)}};
  return {kind:"capture",pending:emptyCapture(),chord:chord(event)};
}
