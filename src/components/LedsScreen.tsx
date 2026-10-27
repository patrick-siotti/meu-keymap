import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Save } from "lucide-react";
import { equalRgb, staticRgbLayers } from "../../lib/rgb";
import type { RgbSnapshot, StaticRgbInput } from "../../lib/rgb";
import { readRgb, applyStaticRgb } from "../services/rgb";

interface LedsScreenProps { active: boolean; onDirty: (dirty: boolean) => void; }
const allSlots=Array.from({length:16},(_,index)=>index);
export function LedsScreen({active,onDirty}:LedsScreenProps){
  const [snapshot,setSnapshot]=useState<RgbSnapshot|null>(null),[fresh,setFresh]=useState(false);
  const [target,setTarget]=useState("all"),[view,setView]=useState(0),[slots,setSlots]=useState<number[]>(allSlots);
  const [color,setColor]=useState("#060710"),[staged,setStaged]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const validColor=/^#[0-9A-Fa-f]{6}$/.test(color),layers=target==="all"?[0,1,2]:[Number(target)];
  const patch:StaticRgbInput={layers,slots,color,fingerprint:snapshot?.fingerprint??""};
  const draft=snapshot&&staged&&validColor&&slots.length?staticRgbLayers(snapshot.layers,patch):snapshot?.layers;
  const dirty=staged&&!!snapshot&&(!validColor||!!draft?.some((bank,index)=>!equalRgb(bank,snapshot.layers[index]!)));
  useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  useEffect(()=>{if(active&&!snapshot&&!busy&&!error)void read();},[active]);
  async function read(){
    if(dirty&&!window.confirm("Descartar o rascunho de LEDs e ler novamente?"))return;
    setBusy(true);setError("");setMessage("");
    try{const result=await readRgb();setSnapshot(result);setStaged(false);setFresh(true);}
    catch(cause){setFresh(false);setError((cause as Error).message);}
    finally{setBusy(false);}
  }
  async function save(){
    if(!snapshot||!fresh||!dirty||!validColor||!slots.length)return;
    setBusy(true);setError("");setMessage("");
    try{const result=await applyStaticRgb(patch);setSnapshot(result);setStaged(false);setFresh(true);setMessage("Configuração gravada e conferida.");}
    catch(cause){setFresh(false);setError((cause as Error).message);}
    finally{setBusy(false);}
  }
  return <main className="leds-screen" hidden={!active}>
    <div className="section-heading"><h1>LEDs</h1><div className="device-mode-actions"><button className="button" disabled={busy} onClick={()=>void read()}>{busy?<LoaderCircle size={15} className="spin"/>:<RefreshCw size={15}/>}Ler do aparelho</button><button className="button primary" disabled={busy||!fresh||!dirty||!validColor||!slots.length} onClick={()=>void save()}>{busy?<LoaderCircle size={15} className="spin"/>:<Save size={15}/>}Gravar LEDs</button></div></div>
    {error&&<p role="alert" className="error-text">{error}</p>}
    {message&&<p role="status" className="rgb-read-status">{message}</p>}
    {!snapshot?<p role="status">{busy?"Lendo as três camadas…":"Configuração desconhecida. Leia o aparelho para editar."}</p>:<>
      <p className="rgb-read-status">{fresh?"Configuração lida":"Leitura desatualizada; releia antes de gravar"} às {new Date(snapshot.at).toLocaleTimeString("pt-BR")}. {dirty&&"Rascunho de LEDs ainda não gravado."}</p>
      <fieldset disabled={busy||!fresh} className="leds-editor">
        <div className="leds-controls">
          <label className="field">Aplicar na camada<select aria-label="Aplicar na camada" value={target} onChange={event=>setTarget(event.target.value)}><option value="all">Todas as camadas</option>{[0,1,2].map(index=><option value={index} key={index}>Camada {index+1}</option>)}</select></label>
          <label className="field">Cor estática<input type="color" aria-label="Seletor de cor estática" value={validColor?color:"#000000"} onChange={event=>{setColor(event.target.value.toUpperCase());setStaged(true);setMessage("");}}/></label>
          <label className="field">Cor hexadecimal<input value={color} maxLength={7} aria-invalid={!validColor} spellCheck={false} onChange={event=>{setColor(event.target.value.toUpperCase());setStaged(true);setMessage("");}}/></label>
          <button className="button" onClick={()=>{setColor("#000000");setStaged(true);setMessage("");}}>Apagar selecionadas</button>
          <button className="button" disabled={!validColor||!slots.length} onClick={()=>{setStaged(true);setMessage("");}}>Preparar cor</button>
        </div>
        {!validColor&&<p className="error-text">Use uma cor como #060710.</p>}
        <div className="section-heading"><label className="field">Visualizar camada<select aria-label="Visualizar camada" value={view} onChange={event=>setView(Number(event.target.value))}>{[0,1,2].map(index=><option value={index} key={index}>Camada {index+1}</option>)}</select></label><div className="device-mode-actions"><button className="button" onClick={()=>setSlots(allSlots)}>Selecionar todas</button><button className="button" onClick={()=>setSlots([])}>Limpar seleção</button></div></div>
        <div className="rgb-device-grid" aria-label="16 posições LED">{draft?.[view]!.colors.map((value,index)=><button key={index} className={slots.includes(index)?"selected":""} aria-pressed={slots.includes(index)} aria-label={`LED ${index+1}: ${value}`} onClick={()=>setSlots(current=>current.includes(index)?current.filter(slot=>slot!==index):[...current,index].sort((a,b)=>a-b))}><span>{String(index+1).padStart(2,"0")}</span><i style={{background:value}}/><small>{value}</small></button>)}</div>
        <p className="helper">{slots.length} posições · {layers.length} camadas. Cor estática nas camadas selecionadas; preto apaga.</p>
      </fieldset>
    </>}
  </main>;
}
