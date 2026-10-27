import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WindowsExecutor } from "../native/executor.ts";
import type { Action } from "../lib/model.ts";

interface NativeKey {type:number;key:number;scan:number;flags:number;time:number;extra:number;hex:string;}
interface NativeCall {count:number;size:number;inputs:NativeKey[];}
interface NativeResult {pointerBytes:number;inputBytes:number;unionOffset:number;keyboardBytes:number;extraOffset:number;calls:NativeCall[];reply:string;}
async function dryActionHost(batches:unknown[]):Promise<NativeResult[]> {
  const script=fileURLToPath(new URL("./fixtures/action-host-dry-run.ps1",import.meta.url)),source=fileURLToPath(new URL("../native/ActionHost.cs",import.meta.url));
  return new Promise((resolve,reject)=>{
    const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-File",script,"-Source",source],{windowsHide:true,stdio:"pipe"});let output="",error="";
    child.stdout.on("data",bytes=>output+=bytes);child.stderr.on("data",bytes=>error+=bytes);child.on("error",reject);child.on("exit",code=>{if(code)reject(new Error(error));else try{resolve(JSON.parse(output));}catch(e){reject(e);}});child.stdin.end(JSON.stringify(batches));
  });
}
test("WindowsExecutor serializes Ctrl aliases, ordered modifiers and macros to exact virtual keys without a worker",async()=>{
  const executor=new WindowsExecutor(),sent:unknown[]=[];
  Object.assign(executor,{send:async(payload:unknown)=>{sent.push(payload);}});
  const actions:Action[]=[{kind:"shortcut",keys:"Ctrl+C"},{kind:"shortcut",keys:"Control+V"},{kind:"shortcut",keys:"ctrl+x"},{kind:"shortcut",keys:"Shift+Win+S"},{kind:"shortcut",keys:"RightCtrl+RightAlt+Delete"},{kind:"macro",steps:[{keys:"Ctrl+C",delay:0},{keys:"Ctrl+V",delay:0}]}];
  for(const action of actions)await executor.execute(action,new AbortController().signal);
  assert.deepEqual(sent,[{kind:"keys",keys:[162,67]},{kind:"keys",keys:[162,86]},{kind:"keys",keys:[162,88]},{kind:"keys",keys:[160,91,83]},{kind:"keys",keys:[163,165,46]},{kind:"keys",keys:[162,67]},{kind:"keys",keys:[162,86]}]);
});
test("actual C# Run marshals exact virtual-key flags/releases/structs through fake Win32 imports only",{skip:process.platform!=="win32"},async()=>{
  const requests=[67,86,88].map((key,i)=>({id:i,kind:"keys",keys:[162,key]}));
  const results=await dryActionHost([
    {requests:[...requests,{id:3,kind:"keys",keys:[160,91,83]},{id:4,kind:"keys",keys:[163,165,46]},{id:5,kind:"text",text:"á😀"}],held:[],partial:false},
    {requests:[requests[0]],held:[162],partial:false},
    {requests:[requests[0]],held:[],partial:true},
  ]);
  const normal=results[0]!;assert.equal(normal.pointerBytes,8);assert.equal(normal.inputBytes,40);assert.equal(normal.unionOffset,8);assert.equal(normal.keyboardBytes,24);assert.equal(normal.extraOffset,16);
  for(let i=0;i<3;i++){
    const call=normal.calls[i]!,key=[67,86,88][i];assert.equal(call.size,40);assert.equal(call.count,4);
    assert.deepEqual(call.inputs.map(v=>[v.type,v.key,v.scan,v.flags,v.extra]),[[1,162,0,0,0],[1,key,0,0,0],[1,key,0,2,0],[1,162,0,2,0]]);
    for(const input of call.inputs){const bytes=Buffer.from(input.hex,"hex");assert.equal(bytes.length,40);assert.equal(bytes.readUInt32LE(0),1);assert.equal(bytes.readUInt16LE(8),input.key);assert.equal(bytes.readUInt16LE(10),0);assert.equal(bytes.readUInt32LE(12),input.flags);assert.equal(bytes.readBigUInt64LE(24),0n);}
  }
  assert.deepEqual(normal.calls[3]!.inputs.map(v=>[v.key,v.flags]),[[160,0],[91,1],[83,0],[83,2],[91,3],[160,2]]);
  assert.deepEqual(normal.calls[4]!.inputs.map(v=>[v.key,v.flags]),[[163,1],[165,1],[46,1],[46,3],[165,3],[163,3]]);
  assert.deepEqual(normal.calls[5]!.inputs.map(v=>[v.key,v.scan,v.flags]),[[0,225,4],[0,225,6],[0,55357,4],[0,55357,6],[0,56832,4],[0,56832,6]]);
  assert.deepEqual(results[1]!.calls[0]!.inputs.map(v=>[v.key,v.flags]),[[67,0],[67,2]],"held physical Ctrl must not be released");
  assert.equal(results[2]!.calls.length,2);assert.ok(results[2]!.calls[1]!.inputs.every(v=>v.flags&2));assert.match(results[2]!.reply,/"ok":false/);
});
