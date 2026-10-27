import { useEffect,useState,useCallback } from "react";
import { profileStamp } from "../../lib/profile-stamp";
import type { Profile } from "../../lib/model";
import { applicationStatus } from "../services/application";
import type { ApplicationStatus } from "../services/application";
export function useApplicationState(profile:Profile){
  const [status,setStatus]=useState<ApplicationStatus|null>(null),[stamp,setStamp]=useState(""),[failed,setFailed]=useState(false);
  const refresh=useCallback(async()=>{try{setStatus(await applicationStatus());setFailed(false);}catch{setFailed(true);}},[]);
  useEffect(()=>{let current=true;setStamp("");void profileStamp(profile).then(value=>{if(current)setStamp(value);});return()=>{current=false;};},[profile]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),2000);return()=>clearInterval(timer);},[refresh]);
  const matches=!!stamp&&status?.deployment?.profileId===profile.id&&status.deployment.profileStamp===stamp&&!status.deployment.restored;
  const applied=!!matches&&!failed&&!status?.busy&&!status?.runtime.paused&&status?.hardware?.matches===true&&(status?.deployment?.mode==="device"||status?.runtime.active===true&&status.runtime.profileId===profile.id);
  const label=failed?"Sem conexão":status?.hardware?.matches===false?"Aparelho divergiu do perfil":status?.runtime.paused?"Entradas suspensas · conferência necessária":status?.busy?"Operação em andamento…":matches&&status?.hardware?.matches==null?"Sem releitura nesta sessão":applied?status?.deployment?.mode==="device"?"Atalhos aplicados no aparelho":"Atalhos conferidos · motor ativo":matches?"Salvo · motor parado":"Salvo · não aplicado";
  return {applied,label,refresh,status};
}
