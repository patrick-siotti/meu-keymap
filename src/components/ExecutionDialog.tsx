import { useEffect,useState } from "react";
import { Play,Square,RotateCcw,LoaderCircle } from "lucide-react";
import { applicationStatus,startExecution,stopExecution,restoreApplication,verifyApplication } from "../services/application";
import type { ApplicationStatus } from "../services/application";
import { Modal } from "./Modal";
import { StartupSettings } from "./StartupSettings";
import { ObsSettings } from "./ObsSettings";
import { DeviceStatePanel } from "./DeviceStatePanel";
interface ExecutionDialogProps {onClose:()=>void;}
export function ExecutionDialog({onClose}:ExecutionDialogProps){
  const [status,setStatus]=useState<ApplicationStatus|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[confirmRestore,setConfirmRestore]=useState(false),[typed,setTyped]=useState("");
  useEffect(()=>{let disposed=false;const controller=new AbortController();async function refresh(){try{const value=await applicationStatus(controller.signal);if(!disposed)setStatus(value);}catch(e){if(!disposed)setError((e as Error).message);}}void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{disposed=true;controller.abort();clearInterval(timer);};},[]);
  async function run(action:()=>Promise<unknown>){setBusy(true);setError("");try{await action();setStatus(await applicationStatus());setConfirmRestore(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal wide title="Execução" onClose={onClose}><div className="application-content">
    {!status?<div className="helper"><LoaderCircle size={17} className="spin"/> Carregando execução…</div>:<>
      <div className="execution-status"><i className={status.runtime.active?"on":""}/><div><strong>{status.runtime.active?status.runtime.paused?"Execução pausada":"Execução ativa":status.deployment?.mode==="device"?"Modo direto":"Execução parada"}</strong><p>{status.runtime.profileName??status.deployment?.name??"Nenhum perfil aplicado"}</p></div>{status.runtime.active?<button className="button" disabled={busy} onClick={()=>void run(stopExecution)}><Square size={14}/>Parar</button>:status.deployment?.mode==="local"?<button className="button primary" disabled={busy||status.busy} onClick={()=>void run(startExecution)}><Play size={14}/>Iniciar</button>:null}</div>
      {status.runtime.active && <p className="helper">Camada do perfil: {status.runtime.runtimeLayer+1}.</p>}
      <DeviceStatePanel/>
      <div className="section-heading"><p className="helper">{status.hardware?.matches===true?`75 posições conferidas no aparelho às ${new Date(status.hardware.at!).toLocaleTimeString("pt-BR")}.`:status.hardware?.matches===false?"A configuração do aparelho divergiu do perfil aplicado.":"Configuração atual ainda sem confirmação nesta sessão."}</p><button className="button" disabled={busy||status.busy||status.runtime.paused} onClick={()=>void run(verifyApplication)}>Reler e conferir atalhos</button></div>
      <details className="typing-test"><summary>Testar digitação</summary><label className="field">Resultado das teclas<input aria-label="Teste de digitação" value={typed} onChange={e=>setTyped(e.target.value)} placeholder="Clique aqui e pressione as teclas configuradas para letras."/></label><button className="text-button" onClick={()=>setTyped("")}>Limpar teste</button></details>
      <StartupSettings/>
      <ObsSettings/>
      {!!status.runtime.states.length&&<div className="execution-states">{status.runtime.states.map(state=><span key={state.name}>{state.name}<b>{state.value}</b></span>)}</div>}
      <div className="execution-log" role="log" aria-label="Registro de execução">{status.runtime.logs.length?status.runtime.logs.map((line,i)=><p key={i}>{line}</p>):<p>As ações executadas aparecerão aqui.</p>}</div>
      {status.message&&<p className="helper">{status.message}</p>}
      {status.deployment&&!status.deployment.restored&&<div className="execution-recovery">{confirmRestore?<><p>Restaurar os atalhos anteriores? Isso interrompe a execução e substitui os atalhos atuais.</p><button className="button" disabled={busy} onClick={()=>setConfirmRestore(false)}>Cancelar</button><button className="button primary" disabled={busy||status.busy} onClick={()=>void run(()=>restoreApplication(status.deployment!.backup))}>{busy?<LoaderCircle size={14} className="spin"/>:<RotateCcw size={14}/>}Restaurar e conferir</button></>:<button className="text-button" disabled={busy||status.busy} onClick={()=>setConfirmRestore(true)}><RotateCcw size={14}/>Restaurar atalhos anteriores</button>}</div>}
    </>}{error&&<p role="alert" className="error-text">{error}</p>}
  </div></Modal>;
}
