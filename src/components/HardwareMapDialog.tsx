import { useEffect,useState } from "react";
import { ArrowUpRight,Copy,LoaderCircle,RefreshCw } from "lucide-react";
import { HARDWARE_CHANNELS } from "../../lib/hardware-map";
import type { HardwareMap } from "../../lib/hardware-map";
import type { Trigger } from "../../lib/model";
import { loadHardwareMap } from "../services/hardware-map";
import { Modal } from "./Modal";
import { HardwareMapBoard } from "./HardwareMapBoard";
interface HardwareMapDialogProps {
  onClose:()=>void;
  onConfigure:(controlId:string,trigger:Trigger,layer:number)=>void;
  onImport:(map:HardwareMap)=>void;
  canImport:boolean;
}
export function HardwareMapDialog({onClose,onConfigure,onImport,canImport}:HardwareMapDialogProps) {
  const [map,setMap]=useState<HardwareMap|null>(null),[layer,setLayer]=useState(1),[slot,setSlot]=useState(1),[loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    loadHardwareMap(true,controller.signal).then(value=>{if(!controller.signal.aborted){setMap(value);setLoading(false);}}).catch(problem=>{if(!controller.signal.aborted){setError((problem as Error).message);setLoading(false);}});
    return()=>controller.abort();
  },[]);
  async function refresh(){setLoading(true);setError("");try{setMap(await loadHardwareMap(true));}catch(problem){setError((problem as Error).message);}finally{setLoading(false);}}
  const channel=HARDWARE_CHANNELS.find(c=>c.slot===slot)!,entry=map?.entries.find(e=>e.layer===layer&&e.slot===slot);
  return <Modal wide className="calibration-modal hardware-map-modal" title="Mapeamento por código" onClose={onClose}><div className="calibration-content">
    <div className="calibration-toolbar"><div className="calibration-layers" role="group" aria-label="Camada de configuração">{[1,2,3].map(value=><button key={value} className={layer===value?"active":""} aria-pressed={layer===value} onClick={()=>setLayer(value)}>Camada {value}</button>)}</div><span>{loading?"Lendo aparelho…":error?"Leitura atual indisponível; dados anteriores históricos":map?"75 posições lidas":"Leitura indisponível"}</span></div>
    {error&&<p className="error-text" role="alert">{error}</p>}
    <div className="calibration-target"><div><strong>{channel.label} · código {slot} (0x{slot.toString(16).toUpperCase().padStart(2,"0")})</strong><p>Camada {layer} · no aparelho: <b>{entry?.label??"sem leitura"}</b></p></div>{loading&&<LoaderCircle size={19} className="spin"/>}</div>
    <HardwareMapBoard map={map} layer={layer} selected={slot} onSelect={setSlot}/>
    {map?.entries.some(e=>e.action===null)&&<p className="calibration-warning">A leitura contém ações não reconhecidas; não é possível criar um perfil.</p>}
    {!canImport&&<p className="calibration-warning">Você já tem 20 perfis. Exclua um perfil para criar outro com esta leitura.</p>}
    <div className="hardware-map-actions"><button className="button" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={14}/>Ler novamente</button><button className="button primary" disabled={!map||loading||!canImport||map.entries.some(e=>e.action===null)} onClick={()=>map&&onImport(map)}><Copy size={14}/>Criar perfil com esta leitura</button><button className="button" disabled={!map||loading} onClick={()=>onConfigure(channel.controlId,channel.trigger,layer-1)}>Abrir no perfil atual<ArrowUpRight size={14}/></button></div>
    {map&&<small className="hardware-map-date">Lido em {new Date(map.readAt).toLocaleString("pt-BR")} · {map.entries.filter(e=>e.action?.kind==="none").length} posições NULL</small>}
  </div></Modal>;
}
