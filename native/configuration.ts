import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile,writeFile,mkdir,rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID,createHash } from "node:crypto";
import { parseHardwareMap } from "../lib/hardware-map.ts";
import type { HardwareMap } from "../lib/hardware-map.ts";
import { UsbCoordinator } from "./usb-coordinator.ts";
import { exactBindings } from "../lib/bindings-recovery.ts";
const execute=promisify(execFile);
export function mapFingerprint(map:HardwareMap):string {
  return createHash("sha256").update(map.devicePath+map.entries.map(e=>e.raw).join("")).digest("hex");
}
export interface ConfigurationTransport {read(signal?:AbortSignal):Promise<unknown>;write(packets:string[],expectedPath?:string,signal?:AbortSignal):Promise<void>;}
const transport:ConfigurationTransport={
  async read(signal){const script=fileURLToPath(new URL("./read-configuration.ps1",import.meta.url));const {stdout}=await execute("powershell.exe",["-NoProfile","-NonInteractive","-File",script],{windowsHide:true,timeout:15000,maxBuffer:512000,signal});return JSON.parse(stdout.trim()) as unknown;},
  async write(packets,expectedPath,signal){
    const script=fileURLToPath(new URL("./write-configuration.ps1",import.meta.url));
    await new Promise<void>((resolve,reject)=>{
      const worker=execFile("powershell.exe",["-NoProfile","-NonInteractive","-File",script],{windowsHide:true,timeout:45000,maxBuffer:512000,signal},(error,stdout)=>{if(error){reject(new Error("Falha no transporte de gravação: "+error.message.slice(0,400)));return;}try{const result=JSON.parse(stdout.trim());if(result.written!==packets.length)throw new Error("Gravação incompleta.");resolve();}catch(e){reject(e);}});
      worker.stdin?.end(JSON.stringify({packets,expectedPath}));
    });
  },
};
export class ConfigurationReader {
  readonly usb:UsbCoordinator;
  onRead:((map:HardwareMap,raw:unknown)=>Promise<void>)|null=null;
  onWrite:((phase:"sending"|"sent")=>Promise<void>)|null=null;
  onReadError:((error:unknown)=>void)|null=null;
  readonly directory:string;
  private transport:ConfigurationTransport;
  constructor(directory:string,adapter:ConfigurationTransport=transport){this.directory=directory;this.transport=adapter;this.usb=UsbCoordinator.shared(directory,adapter===transport);}
  // RGB shares the same USB exclusion and can verify bindings without nesting locks.
  deviceOperation<T>(operation:(readBindings:()=>Promise<HardwareMap>)=>Promise<T>):Promise<T>{return this.usb.run(()=>operation(()=>this.perform()));}
  recoveryPreview<T>(operation:()=>Promise<T>):Promise<T>{return this.usb.preview(operation);}
  async latest():Promise<HardwareMap|null>{
    try {const saved=JSON.parse(await readFile(join(this.directory,"hardware-latest.json"),"utf8"));return parseHardwareMap(saved.raw,saved.backup);}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
  }
  read():Promise<HardwareMap>{
    return this.usb.run(()=>this.perform());
  }
  // A single journalled NULL/media transition. Failure deliberately has no rollback.
  recoverBindingStep(packet:string,before:HardwareMap,expected:HardwareMap,guard:()=>Promise<void>):Promise<HardwareMap>{
    return this.usb.run(async()=>{
      if(!/^03FD(?:[0-9A-F]{2}){63}$/.test(packet)||before.protocolVersion!==11)throw new Error("Binding de recuperação inválido.");
      const slot=parseInt(packet.slice(4,6),16),layer=parseInt(packet.slice(6,8),16);
      const predicted=structuredClone(before),entry=predicted.entries.find(value=>value.slot===slot&&value.layer===layer);
      if(!entry)throw new Error("Endereço de recuperação inválido.");
      entry.raw=packet.replace(/^03FD/,"03FA");
      if(!exactBindings(predicted,expected))throw new Error("O estágio altera endereços fora do plano.");
      await this.onWrite?.("sending");await guard();this.usb.assertCurrent();
      await this.transport.write([packet],before.devicePath,this.usb.signal());
      this.usb.assertCurrent();await this.onWrite?.("sent");
      const after=await this.perform();
      if(!exactBindings(after,expected))throw new Error("Releitura de recuperação divergiu: exigidos 75 registros exatos.");
      return after;
    });
  }
  apply(packets:string[],expected?:string,recover=false):Promise<{map:HardwareMap;backup:string;changed:number}>{
    return this.usb.run(async()=>{
      if(!recover)await this.usb.assertWritable();
      const before=await this.perform();
      if(before.protocolVersion!==11)throw new Error("Gravação disponível somente para a versão 11 confirmada do aparelho.");
      if(expected&&expected!==mapFingerprint(before))throw new Error("O aparelho mudou desde a preparação. Leia e prepare o perfil novamente.");
      const changed=new Map<string,string>(),seen=new Set<string>();
      for(const packet of packets){
        if(!/^03FD(?:[0-9A-F]{2}){63}$/.test(packet))throw new Error("Binding inválido.");
        const slot=parseInt(packet.slice(4,6),16),layer=parseInt(packet.slice(6,8),16),key=`${layer}:${slot}`;
        const old=before.entries.find(e=>e.slot===slot&&e.layer===layer);
        if(!old||seen.has(key))throw new Error("Endereço inválido ou duplicado.");seen.add(key);
        if(old.raw!==packet.slice(0,2)+"FA"+packet.slice(4))changed.set(key,packet);
      }
      const verify=(after:HardwareMap,restore=false)=>after.devicePath===before.devicePath&&after.protocolVersion===before.protocolVersion&&before.entries.every(old=>after.entries.find(e=>e.slot===old.slot&&e.layer===old.layer)?.raw===(restore?old.raw:(changed.get(`${old.layer}:${old.slot}`)?.replace(/^03FD/,"03FA")??old.raw)));
      try{
        this.usb.assertCurrent();if(changed.size){await this.onWrite?.("sending");this.usb.assertCurrent();await this.transport.write([...changed.values()],before.devicePath,this.usb.signal());await this.onWrite?.("sent");}
        const after=await this.perform();if(!verify(after))throw new Error("A releitura divergiu do plano gravado.");
        return {map:after,backup:before.backup,changed:changed.size};
      }catch(error){
        try{
          this.usb.assertCurrent();
          const current=await this.perform();
          if(current.devicePath!==before.devicePath||current.protocolVersion!==before.protocolVersion)throw new Error("Identidade mudou; restauração automática proibida.");
          // Restore only bytes that are still either the baseline or our own intended bytes.
          if(current.entries.some(e=>{const old=before.entries.find(b=>b.layer===e.layer&&b.slot===e.slot)!;return e.raw!==old.raw&&e.raw!==changed.get(`${e.layer}:${e.slot}`)?.replace(/^03FD/,"03FA");}))throw new Error("Alteração externa preservada; reconciliação explícita necessária.");
          const originals=before.entries.filter(e=>changed.has(`${e.layer}:${e.slot}`)).map(e=>e.raw.replace(/^03FA/,"03FD"));
          if(originals.length)await this.transport.write(originals,before.devicePath,this.usb.signal());
          if(!verify(await this.perform(),true))throw new Error("Releitura de restauração divergente.");
        }catch(recovery){await this.usb.requireRecovery(`Bindings: ${String(error)}; ${String(recovery)}`,[before.backup]);throw new Error(`Gravação e restauração falharam. Pare de usar e preserve o backup ${before.backup}.`);}
        throw new Error(`Gravação não confirmada; configuração original restaurada e relida. ${(error as Error).message}`);
      }
    });
  }
  private async perform():Promise<HardwareMap>{
    try{return await this.performRead();}catch(error){this.onReadError?.(error);throw error;}
  }
  private async performRead():Promise<HardwareMap>{
    this.usb.assertCurrent();const raw:unknown=await this.transport.read(this.usb.signal());this.usb.assertCurrent();
    const backup=`read-${new Date().toISOString().replace(/[:.]/g,"-")}-${randomUUID()}.json`;
    await mkdir(join(this.directory,"hardware-backups"),{recursive:true});
    await writeFile(join(this.directory,"hardware-backups",backup),JSON.stringify(raw,null,2)+"\n",{encoding:"utf8",flag:"wx"});
    let map:HardwareMap;
    try {map=parseHardwareMap(raw,backup);}catch{throw new Error("O aparelho respondeu em formato incompleto ou desconhecido. A resposta foi preservada no backup; nenhum mapeamento foi presumido.");}
    const temporary=join(this.directory,`hardware-${randomUUID()}.tmp`);
    await writeFile(temporary,JSON.stringify({raw,backup},null,2)+"\n","utf8");
    await rename(temporary,join(this.directory,"hardware-latest.json"));
    if(this.onRead)await this.onRead(map,raw);return map;
  }
}
