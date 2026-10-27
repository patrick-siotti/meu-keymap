import { useEffect,useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Circle, Keyboard } from "lucide-react";
import { captureShortcutKey,emptyCapture,CAPTURE_MARKER_TIMEOUT_MS } from "../../lib/shortcut-capture";
import { ShortcutBuilder } from "./ShortcutBuilder";
interface ShortcutCaptureProps {
  value: string;
  onChange: (value: string) => void;
}
export function ShortcutCapture({ value, onChange }: ShortcutCaptureProps) {
  const [recording, setRecording] = useState(false),
    input = useRef<HTMLInputElement>(null);
  const active=useRef(false),pending=useRef(emptyCapture()),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  function clearTimer(){if(timer.current!==null)clearTimeout(timer.current);timer.current=null;}
  function stop(){active.current=false;pending.current=emptyCapture();clearTimer();setRecording(false);}
  function finish(chord:string){stop();onChange(chord);}
  useEffect(()=>()=>{active.current=false;if(timer.current!==null)clearTimeout(timer.current);},[]);
  function capture(event: KeyboardEvent<HTMLInputElement>) {
    if (!active.current) return;
    event.preventDefault();
    event.stopPropagation();
    const decision=captureShortcutKey(pending.current,event);pending.current=decision.pending;
    if(decision.kind==="ignore")return;
    clearTimer();
    if(decision.kind==="cancel"){stop();return;}
    if(decision.kind==="capture"){finish(decision.chord);return;}
    if(decision.kind==="wait")timer.current=setTimeout(()=>{const first=pending.current.first;if(active.current&&first)finish(first);},CAPTURE_MARKER_TIMEOUT_MS);
  }
  return (
    <>
      <ShortcutBuilder value={value} onChange={onChange} />
      <label className="field">
        Combinação de teclas
        <div className="capture-row">
          <input
            aria-label="Combinação de teclas"
            ref={input}
            value={value}
            maxLength={100}
            placeholder={
              recording ? "Pressione seu atalho…" : "Ex.: Ctrl+Shift+S"
            }
            readOnly={recording}
            onKeyDown={capture}
            onBlur={stop}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className={`button ${recording ? "recording" : ""}`}
            onClick={() => {
              clearTimer();pending.current=emptyCapture();active.current=true;
              setRecording(true);
              input.current?.focus();
            }}
          >
            {recording ? <Circle size={14} /> : <Keyboard size={16} />}
            {recording ? "Ouvindo" : "Capturar"}
          </button>
        </div>
      </label>
      {recording && <p className="helper">O Windows pode executar atalhos reservados. Esc cancela.</p>}
    </>
  );
}
