import { mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { join,resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyDeviceState, stateDocumentSchema, StateConflict } from "../lib/device-state.ts";
import type { StateDocument } from "../lib/device-state.ts";

export interface StatePersistence {
  read(path:string):Promise<string>;
  write(path:string,data:string):Promise<void>;
  rename(from:string,to:string):Promise<void>;
}
const disk:StatePersistence={read:path=>readFile(path,"utf8"),write:async(path,data)=>{await writeFile(path,data,{flag:"wx",flush:true});},rename};
const queues=new Map<string,Promise<unknown>>();
export class DeviceStateStore {
  private readonly adapter:StatePersistence;
  readonly directory:string;
  constructor(directory:string,adapter:StatePersistence=disk){this.directory=directory;this.adapter=adapter;}
  private exclusive<T>(operation:()=>Promise<T>):Promise<T>{
    const absolute=resolve(this.directory),key=process.platform==="win32"?absolute.toLowerCase():absolute;
    const result=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(operation);queues.set(key,result);
    const release=()=>{if(queues.get(key)===result)queues.delete(key);};void result.then(release,release);return result;
  }
  load():Promise<StateDocument>{return this.exclusive(()=>this.readDisk());}
  private async readDisk():Promise<StateDocument>{
    try{return stateDocumentSchema.parse(JSON.parse(await this.adapter.read(join(this.directory,"device-state.json"))));}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return emptyDeviceState();throw new Error("Estado do aparelho inválido ou ilegível. Preserve device-state.json e os backups. "+(error as Error).message);}
  }
  update(expected:number|undefined,change:(current:StateDocument)=>StateDocument):Promise<StateDocument>{
    return this.exclusive(async()=>{
      const current=await this.readDisk();
      if(expected!==undefined&&expected!==current.revision)throw new StateConflict("O estado mudou. Atualize a leitura antes de tentar novamente.");
      const next=stateDocumentSchema.parse({...change(structuredClone(current)),schemaVersion:1,revision:current.revision+1});
      await mkdir(this.directory,{recursive:true});
      const temporary=join(this.directory,`device-state-${randomUUID()}.tmp`);
      await this.adapter.write(temporary,JSON.stringify(next,null,2)+"\n");
      // Never replace an invalid source, and retain an immutable copy before any update.
      try {await copyFile(join(this.directory,"device-state.json"),join(this.directory,`device-state-before-${current.revision}-${randomUUID()}.json`));}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      for(let attempt=0;;attempt++){
        try{await this.adapter.rename(temporary,join(this.directory,"device-state.json"));break;}
        catch(error){if(attempt>=4||!["EPERM","EACCES","EBUSY"].includes((error as NodeJS.ErrnoException).code??""))throw error;await new Promise(resolve=>setTimeout(resolve,10*2**attempt));}
      }
      return next;
    });
  }
}
