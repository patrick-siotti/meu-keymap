import { useState } from "react";
import { Check,LoaderCircle,Usb,Workflow } from "lucide-react";
import type { Profile } from "../../lib/model";
import type { ApplicationMode } from "../../lib/bindings";
import type { ApplicationPreview } from "../../native/application";
import { prepareApplication,applyApplication } from "../services/application";
import { Modal } from "./Modal";
interface ApplyProfileDialogProps {profile:Profile;mode:ApplicationMode;onMode:(mode:ApplicationMode)=>void;onClose:()=>void;onApplied:()=>void;}
export function ApplyProfileDialog({profile,mode,onMode,onClose,onApplied}:ApplyProfileDialogProps){
  const [preview,setPreview]=useState<ApplicationPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function prepare(){setBusy(true);setError("");try{setPreview(await prepareApplication(profile,mode));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function apply(){if(!preview?.token)return;setBusy(true);setError("");try{await applyApplication(preview.token);onApplied();}catch(e){setError((e as Error).message);setPreview(null);}finally{setBusy(false);}}
  return <Modal title="Aplicar perfil" subtitle={profile.name} onClose={onClose} dismissible={!busy} wide><div className="application-content">
    <div className="application-modes" role="group" aria-label="Onde executar o perfil">{(["device","local"] as const).map(value=><button key={value} disabled={busy} aria-pressed={mode===value} className={mode===value?"active":""} onClick={()=>{onMode(value);setPreview(null);setError("");}}>{value==="device"?<Usb size={20}/>:<Workflow size={20}/>}<strong>{value==="device"?"Direto no aparelho":"Automações no Windows"}</strong><span>{value==="device"?"Atalhos, mídia e macros básicas; funciona com o app fechado.":"Texto, scripts, condições e eventos; requer execução ativa e app aberto."}</span></button>)}</div>
    {preview&&<section className="application-review" aria-label="Revisão da aplicação"><h3>{preview.errors.length?"Ajustes necessários":"Pronto para aplicar"}</h3>{!preview.errors.length&&<p><Check size={16}/> {preview.changed} posições serão alteradas · 3 camadas</p>}<ul>{preview.errors.map((message,i)=><li className="error-text" key={i}>{message}</li>)}{preview.warnings.map((message,i)=><li key={`w${i}`}>{message}</li>)}</ul></section>}
    {error&&<p role="alert" className="error-text">{error}</p>}
    <div className="form-footer"><button className="button" disabled={busy} onClick={onClose}>Cancelar</button>{preview?.token?<button className="button primary" disabled={busy} onClick={()=>void apply()}>{busy?<LoaderCircle size={15} className="spin"/>:<Usb size={15}/>} {busy?"Gravando e conferindo…":"Gravar e conferir"}</button>:<button className="button primary" disabled={busy} onClick={()=>void prepare()}>{busy&&<LoaderCircle size={15} className="spin"/>}{busy?"Conferindo…":"Conferir aplicação"}</button>}</div>
  </div></Modal>;
}
