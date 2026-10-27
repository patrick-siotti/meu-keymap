import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rename} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DeviceStateStore} from "../native/device-state.ts";

test("concurrent state readers and separate store instances preserve atomic replacements and revisions",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-state-concurrent-")),a=new DeviceStateStore(directory),b=new DeviceStateStore(directory);await a.update(0,current=>current);
  let running=true;const readers=[a,b].map(store=>(async()=>{let last=0;while(running){const value=await store.load();assert.ok(value.revision>=last);last=value.revision;await new Promise(resolve=>setTimeout(resolve,2));}})());
  try{for(let index=0;index<40;index++)await (index%2?a:b).update(undefined,current=>current);assert.equal((await a.load()).revision,41);}
  finally{running=false;await Promise.all(readers);}
});

test("revision conflicts remain atomic across state store instances",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-state-revision-")),a=new DeviceStateStore(directory),b=new DeviceStateStore(directory);
  const results=await Promise.allSettled([a.update(0,current=>current),b.update(0,current=>current)]);
  assert.equal(results.filter(value=>value.status==="fulfilled").length,1);assert.equal(results.filter(value=>value.status==="rejected").length,1);assert.equal((await a.load()).revision,1);
});

test("transient sharing failures retry only atomic replace; persistent failure preserves the old state",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-state-replace-"));await new DeviceStateStore(directory).update(0,current=>current);
  let attempts=0,persistent=false;
  const store=new DeviceStateStore(directory,{read:path=>readFile(path,"utf8"),write:async(path,data)=>{await writeFile(path,data,{flag:"wx"});},rename:async(from,to)=>{attempts++;if(persistent||attempts<3)throw Object.assign(new Error("synthetic sharing violation"),{code:"EPERM"});await rename(from,to);}});
  assert.equal((await store.update(1,current=>current)).revision,2);assert.equal(attempts,3);
  const before=await readFile(join(directory,"device-state.json"),"utf8");persistent=true;attempts=0;
  await assert.rejects(store.update(2,current=>current),/sharing violation/);assert.equal(attempts,5);assert.equal(await readFile(join(directory,"device-state.json"),"utf8"),before);
});
