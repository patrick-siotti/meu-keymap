import { useEffect,useState } from "react";
import { LoaderCircle,Play,Check } from "lucide-react";
import { HARDWARE_CHANNELS } from "../../lib/hardware-map";
import { verificationRequest } from "../services/verification";
import type { VerificationStatus } from "../services/verification";
import { HardwareMapBoard } from "./HardwareMapBoard";
import { Modal } from "./Modal";
interface VerificationDialogProps {onClose:()=>void;}
export function VerificationDialog({onClose}:VerificationDialogProps){
  const [status,setStatus]=useState<VerificationStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{let live=true;async function refresh(){try{const result=await verificationRequest();if(live)setStatus(result);}catch(e){if(live)setError((e as Error).message);}}void refresh();const timer=setInterval(()=>void refresh(),600);return()=>{live=false;clearInterval(timer);};},[]);
  async function action(path:string,body:unknown={}){setBusy(true);setError("");try{setStatus(await verificationRequest(path,body));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function close(){if(status?.active){setBusy(true);try{await verificationRequest("/stop",{});}catch(e){setError((e as Error).message);setBusy(false);return;}}onClose();}
  const layer=status?.target.layer??0,slot=status?.target.slot??1,channel=HARDWARE_CHANNELS[slot-1]!,labels=Object.fromEntries(HARDWARE_CHANNELS.map(c=>[c.slot,status?.confirmed[`${layer}:${c.slot}`]?"Conferido":"A conferir"]));
  return <Modal wide title="Conferir controles físicos" subtitle="Selecione no desenho e acione o mesmo controle no macropad." onClose={()=>void close()} dismissible={!busy}>
    <div className="rgb-device-panel">
      {error&&<p role="alert" className="error-text">{error}</p>}
      <div className="section-heading"><strong>{Object.keys(status?.confirmed??{}).length}/75 posições conferidas</strong>{!status?.active&&<button className="button primary" disabled={busy} onClick={()=>void action("/start")}>{busy?<LoaderCircle size={15} className="spin"/>:<Play size={15}/>}Pausar ações e iniciar teste</button>}</div>
      <p className="field-hint">O teste pausa as automações; os atalhos do aparelho continuam ativos.</p>
      {status?.message&&<p role="status" className="rgb-read-status">{status.message}</p>}
      {status?.active&&<>
        <div className="segmented" aria-label="Camada em teste">{[0,1,2].map(value=><button key={value} className={layer===value?"active":""} disabled={busy} onClick={()=>void action("/target",{layer:value,slot})}>Camada {value+1}</button>)}</div>
        <div className="calibration-target"><strong>Camada física {layer+1} · {channel.label}</strong><p>Use o botão do aparelho para mudar a camada. Depois, {slot>16&&channel.trigger!=="press"?`gire o encoder para a ${channel.trigger==="left"?"esquerda":"direita"}`:"pressione uma vez"}.</p></div>
        <HardwareMapBoard map={null} layer={layer+1} selected={slot} labels={labels} onSelect={value=>void action("/target",{layer,slot:value})}/>
        {status.lastReceived&&<p>Recebido: <strong>{status.lastReceived}</strong></p>}
        <div className="verification-encoder-results">{HARDWARE_CHANNELS.slice(16).map(c=><span key={c.slot}>{status.confirmed[`${layer}:${c.slot}`]&&<Check size={13}/>} {c.label}: {labels[c.slot]}</span>)}</div>
        <p className="field-hint">Duplo clique: mantenha o mesmo controle selecionado e pressione duas vezes rapidamente. {status.confirmed[`${layer}:${slot}`]?.double?"Dois pulsos em até 400 ms confirmados.":"Ainda não confirmado para este controle."}</p>
        <div className="modal-actions"><button className="button primary" disabled={busy} onClick={()=>void close()}>Encerrar teste e retomar ações</button></div>
      </>}
    </div>
  </Modal>;
}
