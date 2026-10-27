import { useState } from "react";
import type { FormEvent } from "react";
import { Check } from "lucide-react";
import { actionSchema } from "../../lib/model";
import type { Action, CommandAction } from "../../lib/model";
import { ShortcutCapture } from "./ShortcutCapture";
import { CommandFields } from "./CommandFields";
import { parseChord } from "../../lib/keys";
import { actionPresentation } from "../../lib/action-presentation";
import { ActionIcon } from "./ActionIcon";
import type { ApplicationMode } from "../../lib/bindings";
type FormKind = "shortcut" | "text" | "macro" | "layer" | "command";
interface CustomActionFormProps {
  initial: Action;
  onApply: (action: Action, label: string) => void;
  showLabel?: boolean;
  initialLabel?: string;
  mode?: ApplicationMode;
}
export function CustomActionForm({
  initial,
  onApply,
  showLabel = true,
  initialLabel = "",
  mode,
}: CustomActionFormProps) {
  const [kind, setKind] = useState<FormKind>(
      ["shortcut", "text", "macro", "layer", "command"].includes(initial.kind)
        ? (initial.kind as FormKind)
        : "shortcut",
    ),
    [label, setLabel] = useState(initialLabel),
    [keys, setKeys] = useState(initial.kind === "shortcut" ? initial.keys : ""),
    [text, setText] = useState(initial.kind === "text" ? initial.value : ""),
    [steps, setSteps] = useState(
      initial.kind === "macro"
        ? initial.steps.map((s) => `${s.keys} | ${s.delay}`).join("\n")
        : "",
    ),
    [layer, setLayer] = useState(initial.kind === "layer" ? initial.value : 0),
    [error, setError] = useState("");
  const [command, setCommand] = useState<CommandAction>(
    initial.kind === "command"
      ? initial
      : {
          kind: "command",
          runner: "powershell",
          path: "",
          arguments: [],
          cwd: "",
          timeoutMs: 60000,
        },
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    const candidate =
      kind === "command"
        ? command
        : kind === "shortcut"
          ? { kind, keys }
          : kind === "text"
            ? { kind, value: text }
            : kind === "layer"
              ? { kind, value: layer }
              : {
                  kind,
                  steps: steps
                    .split("\n")
                    .filter((l) => l.trim())
                    .map((line) => {
                      const [keys, delay = "0"] = line.split("|");
                      return {
                        keys: keys?.trim(),
                        delay: Number(delay.trim()),
                      };
                    }),
                };
    const result = actionSchema.safeParse(candidate);
    if (!result.success) {
      setError("Confira os campos, o caminho e os limites dos valores.");
      return;
    }
    try{
      if(result.data.kind==="shortcut")parseChord(result.data.keys);
      if(result.data.kind==="macro")for(const step of result.data.steps)parseChord(step.keys);
    }catch(e){setError((e as Error).message);return;}
    onApply(result.data, label.trim());
  }
  return (
    <form className="custom-form" onSubmit={submit}>
      <div className="form-row">
        <label className="field">
          Tipo de ação
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as FormKind);
              setError("");
            }}
          >
            <option value="shortcut">Atalho de teclado</option>
            <option value="command">Comando / script</option>
            <option value="text">Escrever texto</option>
            <option value="macro">Sequência de atalhos</option>
            <option value="layer">Trocar camada</option>
          </select>
        </label>
        {showLabel && (
          <label className="field">
            Nome no botão
            <input
              maxLength={30}
              value={label}
              placeholder="Opcional"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        )}
      </div>
      {kind === "shortcut" && (
        <><ShortcutCapture value={keys} onChange={value=>{setKeys(value);setError("");}} /><p className="shortcut-presentation"><ActionIcon name={actionPresentation({kind:"shortcut",keys}).icon} size={20}/>{keys?actionPresentation({kind:"shortcut",keys}).label:"Atalho de teclado"}</p></>
      )}
      {kind === "command" && (
        <CommandFields command={command} onChange={setCommand} />
      )}
      {kind === "text" && (
        <label className="field">
          Texto a escrever
          <textarea
            rows={5}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      {kind === "macro" && (
        <>
          <label className="field">
            Sequência
            <textarea
              rows={6}
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder={"Ctrl+C | 100\nAlt+Tab | 200\nCtrl+V | 0"}
            />
          </label>
          <p className="helper">
            Um atalho por linha; use | para a pausa em milissegundos.
          </p>
        </>
      )}
      {kind === "layer" && (
        <>
        <label className="field">
          Camada de destino
          <select
            value={layer}
            onChange={(e) => setLayer(Number(e.target.value))}
          >
            {[0, 1, 2].map((i) => (
              <option key={i} value={i}>
                Camada {i + 1}
              </option>
            ))}
          </select>
        </label>
        {mode === "device" && <p className="helper">Trocar camada requer Automações. No modo direto, use o seletor do aparelho.</p>}
        </>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <footer className="form-footer form-footer-end">
        <button className="button primary" type="submit">
          <Check size={16} />
          Usar esta ação
        </button>
      </footer>
    </form>
  );
}
