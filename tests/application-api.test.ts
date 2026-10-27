import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { ProfileStore,createApiHandler } from "../server.ts";
import { makeProfile } from "../lib/model.ts";
test("application routes reject foreign origins, malformed modes, arbitrary bytes and unprepared tokens",async()=>{
  const handler=createApiHandler(new ProfileStore(await mkdtemp(join(tmpdir(),"keymap-api-execution-"))));
  const server=createServer((req,res)=>{void handler(req,res);});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
  const post=(path:string,data:unknown,origin?:string)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",...(origin?{Origin:origin}:{})},body:JSON.stringify(data)});
  try{
    for(const route of ["/api/application/prepare","/api/application/apply","/api/application/restore","/api/runtime/start","/api/runtime/stop"])assert.equal((await post(route,{},"https://foreign.example")).status,403);
    assert.equal((await fetch(base+"/api/profiles/sync",{method:"PUT",headers:{"Content-Type":"application/json",Origin:"https://foreign.example"},body:"{}"})).status,403);
    assert.equal((await fetch(base+"/api/profiles/sync",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:0,document:{}})})).status,400);
    const profile=makeProfile("mode-required","Mode required"),document={version:3,activeProfile:profile.id,profiles:[profile]};
    for(const mode of [undefined,"auto",["local"]]){
      const response=await fetch(base+"/api/profiles/sync",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:0,document,mode})});
      assert.equal(response.status,400);assert.match((await response.json()).error,/Escolha onde executar/);
    }
    assert.equal((await post("/api/application/prepare",{profile:makeProfile("test","Test"),mode:["local"]})).status,400);
    assert.equal((await post("/api/application/apply",{packets:["03FD"],token:"not-prepared"})).status,400);
    assert.equal((await post("/api/application/restore",{backup:"../../profiles.json"})).status,400);
    assert.equal((await post("/api/runtime/start",{})).status,400);
    assert.equal((await post("/api/device/rgb/apply",{packet:"03FEB0"})).status,400);
    assert.equal((await post("/api/device/verification/target",{slot:26,layer:0})).status,400);
    assert.equal((await fetch(base+"/api/obs",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:true,port:4455,microphone:"",url:"https://foreign.example"})})).status,400);
    assert.equal((await fetch(base+"/api/startup",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:"yes"})})).status,400);
    assert.equal((await fetch(base+"/api/device/rgb/read",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://foreign.example"},body:"{}"})).status,403);
    const status=await (await fetch(base+"/api/application/status")).json();assert.equal(status.runtime.active,false);assert.equal(status.deployment,null);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
