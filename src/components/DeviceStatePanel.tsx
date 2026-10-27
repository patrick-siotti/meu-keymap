import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useDeviceState } from "../hooks/useDeviceState";
import { readDeviceState,reconcileDeviceState,setDevicePolicy,recoverDeviceState } from "../services/device-state";
import type { ConnectionPhase, DomainDelivery } from "../../lib/device-state";
const phases:Record<ConnectionPhase,string>={disconnected:"Desconectado",identifying:"Identificando aparelho…",reading:"Lendo configuração…",reconciling:"Reaplicando configuração…",ready:"Conexão pronta",degraded:"Conferência necessária","recovery-required":"Recuperação necessária"};
function deliveryLabel(value:DomainDelivery|null){
  if(!value)return "Sem aplicação registrada";
  return ({unknown:"Resultado desconhecido",sent:"Enviado, sem confirmação por leitura",confirmed:"Configuração conferida por leitura",divergent:"Leitura divergente",failed:"Aplicação falhou",partial:"Aplicação parcial; recuperação necessária",restored:"Backup restaurado; política desativada"})[value.status];
}
interface DeviceStatePanelProps {editingLayer?:number;}
export function DeviceStatePanel({editingLayer}:DeviceStatePanelProps){
  const {state,error,busy,run}=useDeviceState(),[bindingsBackup,setBindingsBackup]=useState(""),[rgbBackup,setRgbBackup]=useState("");
  const time=(at:number)=>new Date(at).toLocaleString("pt-BR");
  return <section className="device-next-step device-state-panel" aria-label={editingLayer === undefined ? "Estado do aparelho" : `Estado do aparelho · camada ${editingLayer+1}`}>
    <div className="section-heading"><h3>Estado do aparelho</h3><button className="button" disabled={busy} onClick={()=>void run(readDeviceState)}>{busy?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>}Ler estado atual</button></div>
    {!state?<p>{error?"Estado indisponível.":"Consultando estado…"}</p>:<>
      <p role="status"><strong>{phases[state.session.phase]}</strong>{state.session.error&&` · ${state.session.error}`}</p>
      <p className="helper">{state.desired?`Configuração vinculada: ${state.desired.profile?.name??"LEDs"}.`:"Escolha um perfil em Salvar e aplicar."}</p>
      <dl className="device-state-values">
        {(["bindings","rgb"] as const).map(domain=>{const observed=state.observed?.[domain],value=observed?.value,at=value?(domain==="bindings"?state.observed!.bindings!.value.readAt:state.observed!.rgb!.value.at):null;return <div key={domain}><dt>{domain==="bindings"?"Atalhos":"LEDs"}</dt><dd>{at?`${state.readStatus[domain].current?"Lido":"Histórico"} em ${time(at)}`:"Sem leitura"}<br/>{deliveryLabel(state.delivery[domain])}{state.delivery[domain]?.error&&<span className="error-text"> · {state.delivery[domain]?.error}</span>}</dd></div>;})}
      </dl>
      {((state.differences.bindings??0)>0 || (state.differences.rgbBanks??0)>0) && <p className="error-text">Diferenças: {state.differences.bindings??"—"} atalhos; {state.differences.rgbBanks??"—"} camadas de LEDs.</p>}
      <label className="check-field"><input type="checkbox" checked={state.policy.enabled} disabled={busy||!state.desired?.bindings} onChange={event=>void run(()=>setDevicePolicy(state.revision,event.target.checked))}/>Reaplicar atalhos ao conectar este aparelho</label>
      <div className="device-mode-actions"><button className="button" disabled={busy||!state.desired?.bindings||state.session.phase==="recovery-required"} onClick={()=>void run(()=>reconcileDeviceState(state.revision))}>Comparar e reaplicar atalhos</button></div>
      {state.session.phase==="recovery-required"&&<details className="execution-recovery"><summary>Recuperar configuração com backups</summary><p>Isso interrompe a execução e substitui atalhos e LEDs. Escolha backups deste aparelho.</p><label className="field">Backup de atalhos<input value={bindingsBackup} onChange={event=>setBindingsBackup(event.target.value)} placeholder="read-….json"/></label><label className="field">Backup RGB<input value={rgbBackup} onChange={event=>setRgbBackup(event.target.value)} placeholder="rgb-….json"/></label><button className="button" disabled={busy||!state.session.observedCurrent||!bindingsBackup||!rgbBackup} onClick={()=>void run(()=>recoverDeviceState({revision:state.revision,bindingsBackup,rgbBackup,bindingsFingerprint:state.observed?.bindings?.fingerprint??"",rgbFingerprint:state.observed?.rgb?.value.fingerprint??""}))}>Restaurar backups e conferir</button></details>}
    </>}
    {error&&<p role="alert" className="error-text">{error}</p>}
  </section>;
}


