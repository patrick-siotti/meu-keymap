import { useEffect,useRef,useState } from "react";
import { ImagePlus,LoaderCircle } from "lucide-react";
import { ICON_LIBRARY } from "../../lib/control-icon";
import type { ActionIconName,ControlIcon } from "../../lib/control-icon";
import type { Control } from "../../lib/model";
import { normalizeIconImage } from "../services/icon-image";
import { ActionIcon } from "./ActionIcon";

interface ControlIconEditorProps {
  control:Control;
  automatic:ActionIconName;
  onChange:(icon:ControlIcon|undefined)=>void;
}
export function ControlIconEditor({control,automatic,onChange}:ControlIconEditorProps){
  const [library,setLibrary]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const input=useRef<HTMLInputElement>(null),request=useRef(0);
  useEffect(()=>()=>{request.current++;},[]);
  async function upload(file:File|undefined){
    if(!file)return;
    const current=++request.current;setBusy(true);setError("");
    try{const dataUrl=await normalizeIconImage(file);if(current===request.current){onChange({kind:"image",dataUrl});setLibrary(false);}}
    catch(e){if(current===request.current)setError((e as Error).message);}
    finally{if(current===request.current){setBusy(false);if(input.current)input.current.value="";}}
  }
  return <div className="control-icon-editor" aria-label="Ícone do controle">
    <div className="control-icon-heading"><span className="control-icon-preview"><ActionIcon name={automatic} icon={control.icon} size={26}/></span><span>Ícone<small>{control.icon?.kind==="image"?"Imagem personalizada":control.icon?.kind==="library"?"Biblioteca":"Automático pela ação"}</small></span></div>
    <div className="control-icon-tools" role="group" aria-label="Origem do ícone">
      <button className="button" disabled={busy} aria-pressed={!control.icon} onClick={()=>{onChange(undefined);setLibrary(false);setError("");}}>Automático</button>
      <button className="button" disabled={busy} aria-expanded={library} onClick={()=>setLibrary(!library)}>Escolher ícone</button>
      <button className="button" disabled={busy} onClick={()=>input.current?.click()}>{busy?<LoaderCircle size={14} className="spin"/>:<ImagePlus size={14}/>}Enviar imagem</button>
    </div>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Imagem do ícone" onChange={e=>void upload(e.target.files?.[0])}/>
    {library&&<div className="control-icon-library" role="group" aria-label="Biblioteca de ícones">{ICON_LIBRARY.map(([name,label])=><button key={name} className="icon-button" aria-label={label} title={label} aria-pressed={control.icon?.kind==="library"&&control.icon.name===name} onClick={()=>{onChange({kind:"library",name});setError("");}}><ActionIcon name={name} size={20}/></button>)}</div>}
    {control.icon&&<button className="text-button" disabled={busy} onClick={()=>{onChange(undefined);setLibrary(false);setError("");}}>Remover personalização</button>}
    {error&&<p role="alert" className="error-text">{error}</p>}
  </div>;
}
