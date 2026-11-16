import { useEffect,useState } from "react";
import type { StartupStatus } from "../../native/startup";
export function StartupSettings(){
  const [status,setStatus]=useState<StartupStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function request(enabled?:boolean){setBusy(true);setError("");try{const response=await fetch("/api/startup",enabled===undefined?{}:{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled})}),result=await response.json();if(!response.ok)throw new Error(result.error??"Não foi possível conferir a inicialização.");setStatus(result);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  useEffect(()=>{void request();},[]);
  return <details className="typing-test"><summary>Inicialização com o Windows</summary><p className="helper">Ao entrar no Windows, o Meu Keymap fica na bandeja e retoma o perfil aplicado assim que reconhecer o macropad.</p>{error&&<p role="alert" className="error-text">{error}</p>}{status&&<><p>{status.conflict?"Entrada de outro local detectada. Nenhuma alteração foi feita.":status.enabled?"Inicialização automática ativada.":"Inicialização automática desligada."}</p><button className="button" disabled={busy||status.conflict} onClick={()=>void request(!status.enabled)}>{busy?"Conferindo…":status.enabled?"Desativar inicialização automática":"Ativar inicialização automática"}</button></>}</details>;
}
