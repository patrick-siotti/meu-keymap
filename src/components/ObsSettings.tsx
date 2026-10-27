import { useEffect,useState } from "react";
import type { ObsSource } from "../../native/obs";
type ObsStatus=ReturnType<ObsSource["status"]>;
export function ObsSettings(){
  const [status,setStatus]=useState<ObsStatus|null>(null),[port,setPort]=useState(4455),[microphone,setMicrophone]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{let active=true;async function refresh(){try{const response=await fetch("/api/obs"),result=await response.json();if(!response.ok)throw new Error(result.error??"Leitura OBS indisponível.");if(active)setStatus(result as ObsStatus);}catch(e){if(active)setError((e as Error).message);}}void refresh();const timer=setInterval(()=>void refresh(),1500);return()=>{active=false;clearInterval(timer);};},[]);
  async function configure(enabled:boolean){setBusy(true);setError("");try{const response=await fetch("/api/obs",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,port,microphone,...(password?{password}:{})})}),result=await response.json();if(!response.ok)throw new Error(result.error??"Conexão OBS não concluída.");setStatus(result as ObsStatus);setPassword("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const label=(value:unknown)=>value===null||value===undefined?"Sem dados":typeof value==="boolean"?value?"Sim":"Não":typeof value==="number"?`${value.toFixed(1)}%`:String(value);
  return <details className="typing-test"><summary>Fontes do OBS</summary><p className="helper">Ative o servidor WebSocket no OBS e informe a porta e a senha.</p>
    <div className="form-row"><label className="field">Porta<input type="number" min={1024} max={65535} value={port} onChange={e=>setPort(Number(e.target.value))}/></label><label className="field">Senha do WebSocket<input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label></div>
    <label className="field">Fonte de áudio no OBS<select value={microphone} onChange={e=>setMicrophone(e.target.value)}><option value="">Escolha depois de conectar</option>{[...new Set([...(status?.inputNames??[]),...(microphone?[microphone]:[])])].map(name=><option key={name} value={name}>{name}</option>)}</select></label>
    {error&&<p role="alert" className="error-text">{error}</p>}<p role="status" className="helper">{status?.message??"Consultando conexão…"}</p>
    <div className="modal-actions">{status?.enabled&&<button className="button" disabled={busy} onClick={()=>void configure(false)}>Desconectar</button>}<button className="button primary" disabled={busy} onClick={()=>void configure(true)}>{busy?"Conectando…":status?.connected?"Atualizar fonte":"Conectar e ler estados"}</button></div>
    {status?.connected&&<div className="execution-states">{[["Gravando","obs.recording"],["Gravação pausada","obs.recording.paused"],["Transmitindo","obs.streaming"],["Microfone em mudo","obs.microphone.muted"],["Nível do microfone","obs.microphone.level"],["Volume ajustado","obs.microphone.volume"]].map(([name,key])=><span key={key}>{name}<b>{label(status.values[key!])}</b></span>)}</div>}
  </details>;
}
