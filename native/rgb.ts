import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir,readFile,writeFile,rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash,randomUUID } from "node:crypto";
import { equalRgb,parseRgb,rgbPacket,rgbSnapshotSchema } from "../lib/rgb.ts";
import type { RgbLayer,RgbSnapshot } from "../lib/rgb.ts";
import { ConfigurationReader,mapFingerprint } from "./configuration.ts";
const execute=promisify(execFile);
export interface RgbTransport {read(signal?:AbortSignal):Promise<unknown>;write(packets:string[],expectedPath?:string,signal?:AbortSignal):Promise<void>;}
const nativeTransport:RgbTransport={
  async read(signal){const {stdout}=await execute("powershell.exe",["-NoProfile","-NonInteractive","-File",fileURLToPath(new URL("./read-lights.ps1",import.meta.url))],{windowsHide:true,timeout:10000,maxBuffer:64000,signal});return JSON.parse(stdout.trim()) as unknown;},
  async write(packets,expectedPath,signal){await new Promise<void>((resolve,reject)=>{const worker=execFile("powershell.exe",["-NoProfile","-NonInteractive","-File",fileURLToPath(new URL("./write-lights.ps1",import.meta.url))],{windowsHide:true,timeout:10000,maxBuffer:64000,signal},(error,stdout)=>{if(error){reject(error);return;}try{if(JSON.parse(stdout.trim()).written!==packets.length)throw new Error("RGB incompleto.");resolve();}catch(e){reject(e);}});worker.stdin?.end(JSON.stringify({packets,expectedPath}));});}
};
export class RgbService {
  onRead:((snapshot:RgbSnapshot,raw:unknown)=>Promise<void>)|null=null;
  onWrite:((phase:"sending"|"sent")=>Promise<void>)|null=null;
  onReadError:((error:unknown)=>void)|null=null;
  private directory:string;private configuration:ConfigurationReader;private transport:RgbTransport;
  constructor(directory:string,configuration:ConfigurationReader,transport:RgbTransport=nativeTransport){this.directory=directory;this.configuration=configuration;this.transport=transport;}
  private async snapshot():Promise<RgbSnapshot>{
    try{return await this.captureSnapshot();}catch(error){this.onReadError?.(error);throw error;}
  }
  private async captureSnapshot():Promise<RgbSnapshot>{
    this.configuration.usb.assertCurrent();const raw=await this.transport.read(this.configuration.usb.signal());this.configuration.usb.assertCurrent();const backup=`rgb-${Date.now()}-${randomUUID()}.json`;
    await mkdir(join(this.directory,"rgb-backups"),{recursive:true});
    await writeFile(join(this.directory,"rgb-backups",backup),JSON.stringify(raw,null,2),{flag:"wx"});
    const parsed=parseRgb(raw),fingerprint=createHash("sha256").update(parsed.devicePath+JSON.stringify(parsed.layers)).digest("hex");
    const snapshot={...parsed,backup,fingerprint},temporary=join(this.directory,`rgb-${randomUUID()}.tmp`);
    await writeFile(temporary,JSON.stringify(snapshot,null,2));await rename(temporary,join(this.directory,"rgb-latest.json"));if(this.onRead)await this.onRead(snapshot,raw);return snapshot;
  }
  async latest():Promise<RgbSnapshot|null>{try{return rgbSnapshotSchema.parse(JSON.parse(await readFile(join(this.directory,"rgb-latest.json"),"utf8")));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
  read():Promise<RgbSnapshot>{return this.configuration.deviceOperation(()=>this.snapshot());}
  apply(layer:number,settings:RgbLayer,expected:string):Promise<RgbSnapshot>{
    rgbPacket(layer,settings);
    return this.configuration.deviceOperation(async()=>{const before=await this.snapshot();if(before.fingerprint!==expected)throw new Error("O RGB do aparelho mudou. Leia novamente antes de gravar.");return this.applyLayers(before.layers.map((current,index)=>index===layer?settings:current),expected);});
  }
  applyLayers(settings:RgbLayer[],expected:string,recover=false):Promise<RgbSnapshot>{
    if(settings.length!==3)throw new Error("RGB exige três bancos.");settings.forEach((value,index)=>rgbPacket(index,value));
    return this.configuration.deviceOperation(async readBindings=>{
      if(!recover)await this.configuration.usb.assertWritable();
      const bindings=await readBindings(),before=await this.snapshot();
      if(bindings.devicePath!==before.devicePath)throw new Error("O aparelho mudou entre as leituras. Nenhuma gravação enviada.");
      if(before.fingerprint!==expected)throw new Error("O RGB do aparelho mudou. Leia novamente antes de gravar.");
      const changed=settings.map((value,index)=>!equalRgb(value,before.layers[index]!));
      const matches=(after:RgbSnapshot,restore=false)=>after.devicePath===before.devicePath&&after.layers.every((l,i)=>equalRgb(l,restore?before.layers[i]!:settings[i]!));
      try{
        this.configuration.usb.assertCurrent();if(changed.some(Boolean)){await this.onWrite?.("sending");this.configuration.usb.assertCurrent();await this.transport.write(settings.flatMap((current,index)=>changed[index]?[rgbPacket(index,current)]:[]),before.devicePath,this.configuration.usb.signal());await this.onWrite?.("sent");}
        const after=await this.snapshot();
        if(!matches(after))throw new Error("Releitura RGB divergiu da configuração enviada.");
        if(mapFingerprint(await readBindings())!==mapFingerprint(bindings))throw new Error("Bindings divergiram durante RGB; preserve os backups.");
        return after;
      }catch(error){
        try{
          this.configuration.usb.assertCurrent();
          const currentBindings=await readBindings(),currentRgb=await this.snapshot();
          if(mapFingerprint(currentBindings)!==mapFingerprint(bindings))throw new Error("Bindings mudaram externamente; nenhuma restauração automática autorizada.");
          if(currentRgb.devicePath!==before.devicePath||currentRgb.layers.some((value,index)=>!equalRgb(value,before.layers[index]!)&&!equalRgb(value,settings[index]!)))throw new Error("RGB externo/identidade divergente preservados; recuperação explícita necessária.");
          if(changed.some(Boolean))await this.transport.write(before.layers.flatMap((current,index)=>changed[index]?[rgbPacket(index,current)]:[]),before.devicePath,this.configuration.usb.signal());
          if(!matches(await this.snapshot(),true)||mapFingerprint(await readBindings())!==mapFingerprint(bindings))throw new Error("Restauração/releitura completa divergente.");
        }
        catch(recovery){await this.configuration.usb.requireRecovery(`RGB: ${String(error)}; ${String(recovery)}`,[before.backup,bindings.backup]);throw new Error(`Falha e recuperação RGB pendente. Backup: ${before.backup}.`);}
        throw new Error(`RGB não confirmado; configuração anterior restaurada e relida. ${(error as Error).message}`);
      }
    });
  }
}
