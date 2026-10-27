import type { ApplicationMode } from "../lib/bindings.ts";
import { profileStamp } from "../lib/profile-stamp.ts";
import type { KeymapDocument,Envelope } from "../lib/model.ts";
import type { ApplicationService } from "./application.ts";
export interface SyncResult {saved:Envelope;applied:boolean;mode:ApplicationMode;runtimeActive:boolean;warnings?:string[];error?:string;domains?:{bindings:string;rgb:string};}
interface ProfilePersistence {save(document:KeymapDocument,revision:number):Promise<Envelope>;}
export class ProfileSynchronizer {
  private queue:Promise<unknown>=Promise.resolve();
  private store:ProfilePersistence;
  private application:Pick<ApplicationService,"prepare"|"apply"|"status"|"verify"|"start">;
  constructor(store:ProfilePersistence,application:Pick<ApplicationService,"prepare"|"apply"|"status"|"verify"|"start">){this.store=store;this.application=application;}
  sync(document:KeymapDocument,revision:number,mode:ApplicationMode):Promise<SyncResult>{
    if(mode!=="local"&&mode!=="device")return Promise.reject(new Error("Escolha onde executar o perfil antes de salvar e aplicar."));
    const operation=this.queue.catch(()=>{}).then(async()=>{
      const saved=await this.store.save(document,revision);
      const profile=saved.document.profiles.find(p=>p.id===saved.document.activeProfile)!;
      try{
        const previous=await this.application.status();
        let warnings:string[]=[],reused=false;
        // Decoration-only saves cannot restart the motor or replay activation actions.
        if(!previous.busy&&!previous.runtime.paused&&!previous.deployment?.restored&&previous.deployment?.mode===mode&&previous.deployment.profileStamp===await profileStamp(profile)){
          const checked=await this.application.verify();
          if(checked.hardware.matches===true){
            if(mode==="local"&&!checked.runtime.active)await this.application.start();
            reused=true;
          }
        }
        if(!reused){
          const preview=await this.application.prepare(profile,mode);
          if(!preview.token)throw new Error(preview.errors.join(" ")||"Não foi possível preparar a aplicação.");
          await this.application.apply(preview.token);warnings=preview.warnings;
        }
        const status=await this.application.status();
        if(status.hardware.matches!==true||status.deployment?.mode!==mode||status.deployment.profileStamp!==await profileStamp(profile)||mode==="local"&&(!status.runtime.active||status.runtime.paused||status.runtime.profileId!==profile.id))throw new Error("A aplicação não ficou pronta. Confira o registro de execução.");
        return {saved,applied:true,mode,runtimeActive:status.runtime.active,warnings,domains:{bindings:"confirmed",rgb:"separate-native-settings"}};
      }catch(error){return {saved,applied:false,mode,runtimeActive:false,error:`Salvo no computador, mas NÃO aplicado: ${(error as Error).message}`};}
    });
    this.queue=operation;return operation;
  }
}
