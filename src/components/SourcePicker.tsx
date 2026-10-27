import type { Profile } from "../../lib/model";
import { controlName } from "../../lib/model";
import type { Source, InputSource } from "../../lib/conditions";
import { INPUTS } from "../../lib/conditions";
import { profileSources } from "../../lib/engine";
interface SourcePickerProps {
  source: Source;
  profile: Profile;
  onChange: (source: Source) => void;
  numericOnly?: boolean;
  inputOnly?: boolean;
}
export function SourcePicker({
  source,
  profile,
  onChange,
  numericOnly = false,
  inputOnly = false,
}: SourcePickerProps) {
  const seen = new Map<string, InputSource>();
  for (const s of [...INPUTS, ...profileSources(profile)])
    if (s.kind === "input" && (!numericOnly || s.type === "number"))
      seen.set(s.key, s);
  if (source.kind === "input" && (!numericOnly || source.type === "number"))
    seen.set(source.key, source);
  const inputOptions = [...seen.values()];
  function inputPicker() {
    if (source.kind !== "input") return null;
    const custom = source.provider === "custom";
    return (
      <>
        <label className="field">
          Fonte
          <select
            value={source.key}
            onChange={(e) =>
              onChange(
                e.target.value === "custom"
                  ? {
                      kind: "input",
                      key: `custom.${crypto.randomUUID()}`,
                      label: "Nova fonte",
                      type: numericOnly ? "number" : "boolean",
                      provider: "custom",
                    }
                  : inputOptions.find((s) => s.key === e.target.value)!,
              )
            }
          >
            {inputOptions
              .filter((s) => s.provider !== "custom")
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            {inputOptions
              .filter((s) => s.provider === "custom")
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            <option value="custom">Fonte personalizada…</option>
          </select>
        </label>
        {custom && (
          <div className="form-row">
            <label className="field">
              Nome da fonte
              <input
                maxLength={80}
                value={source.label}
                onChange={(e) => onChange({ ...source, label: e.target.value })}
              />
            </label>
            {!numericOnly && (
              <label className="field">
                Tipo de valor
                <select
                  value={source.type}
                  onChange={(e) =>
                    onChange({
                      ...source,
                      type: e.target.value as InputSource["type"],
                    })
                  }
                >
                  <option value="boolean">Sim / Não</option>
                  <option value="number">Número</option>
                  <option value="text">Texto</option>
                </select>
              </label>
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="source-picker">
      {!inputOnly && (
        <label className="field">
          Tipo de condição
          <select
            value={source.kind}
            onChange={(e) => {
              const kind = e.target.value;
              if (kind === "event" && profile.events[0])
                onChange({ kind, eventId: profile.events[0].id });
              else if (kind === "process")
                onChange({ kind, name: "obs64.exe" });
              else if (kind === "key") onChange({ kind, controlId: "key-1" });
              else onChange(INPUTS.find((s) => s.type === "boolean")!);
            }}
          >
            {!!profile.events.length && (
              <option value="event">Estado de um evento</option>
            )}
            <option value="process">Programa aberto</option>
            <option value="key">Tecla pressionada</option>
            <option value="input">Valor de uma fonte</option>
          </select>
        </label>
      )}
      {source.kind === "event" && (
        <label className="field">
          Evento
          <select
            value={source.eventId}
            onChange={(e) => onChange({ ...source, eventId: e.target.value })}
          >
            {profile.events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {source.kind === "process" && (
        <label className="field">
          Programa
          <input
            maxLength={120}
            value={source.name}
            placeholder="Ex.: obs64.exe"
            onChange={(e) => onChange({ ...source, name: e.target.value })}
          />
        </label>
      )}
      {source.kind === "key" && (
        <label className="field">
          Tecla
          <select
            value={source.controlId}
            onChange={(e) => onChange({ ...source, controlId: e.target.value })}
          >
            {profile.layers[0]!.controls.filter((c) => c.kind === "key").map(
              (c) => (
                <option value={c.id} key={c.id}>
                  {controlName(c,profile)}
                </option>
              ),
            )}
          </select>
        </label>
      )}
      {inputPicker()}
    </div>
  );
}
