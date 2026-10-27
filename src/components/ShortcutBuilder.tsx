import { useState } from "react";
import { buildChord, chordSelection, KEY_OPTIONS, MODIFIER_OPTIONS } from "../../lib/keys";

interface ShortcutBuilderProps {
  value: string;
  onChange: (value: string) => void;
}
function selection(value: string) {
  try { return chordSelection(value); }
  catch { return { modifiers: [] as string[], key: "" }; }
}
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function ShortcutBuilder({ value, onChange }: ShortcutBuilderProps) {
  const [pending, setPending] = useState({ value, modifiers: [] as string[] });
  const [query, setQuery] = useState("");
  const parsed = selection(value);
  const selected = parsed.key ? parsed : { key: "", modifiers: pending.value === value ? pending.modifiers : [] };
  const matches = KEY_OPTIONS.filter(option => normalize(`${option.name} ${option.label} ${option.group}`).includes(normalize(query)));
  const current = KEY_OPTIONS.find(option => option.name === selected.key);
  const groups = [...new Set(matches.map(option => option.group))];
  function change(modifiers: string[], key: string) {
    if (!key) { setPending({ value, modifiers }); return; }
    const chord = buildChord(modifiers, key);
    setPending({ value: chord, modifiers: [] });
    onChange(chord);
  }
  return (
    <fieldset className="shortcut-builder">
      <legend>Montar atalho</legend>
      <div className="shortcut-modifiers" role="group" aria-label="Modificadores">
        {MODIFIER_OPTIONS.map(modifier => (
          <button key={modifier.name} type="button" className={`button ${selected.modifiers.includes(modifier.name) ? "selected" : ""}`}
            aria-pressed={selected.modifiers.includes(modifier.name)}
            onClick={() => change(selected.modifiers.includes(modifier.name)
              ? selected.modifiers.filter(name => name !== modifier.name)
              : [...selected.modifiers, modifier.name], selected.key)}>
            {modifier.label}
          </button>
        ))}
      </div>
      <div className="form-row">
        <label className="field">Buscar tecla
          <input type="search" value={query} placeholder="Letra, F24, seta, Print Screen…" onChange={event => setQuery(event.target.value)} />
        </label>
        <label className="field">Tecla principal
          <select aria-label="Tecla principal" value={selected.key} onChange={event => change(selected.modifiers, event.target.value)}>
            <option value="" disabled>Escolha uma tecla</option>
            {current && !matches.includes(current) && <optgroup label="Selecionada"><option value={current.name}>{current.label}</option></optgroup>}
            {groups.map(group => <optgroup key={group} label={group}>{matches.filter(option => option.group === group).map(option =>
              <option key={option.name} value={option.name}>{option.label}</option>)}</optgroup>)}
          </select>
        </label>
      </div>
      {matches.length === 0 && <p className="helper" role="status">Nenhuma tecla encontrada. Tente outro nome.</p>}
      {current?.group === "Pontuação" && <p className="helper">O símbolo pode variar com o layout do teclado.</p>}
    </fieldset>
  );
}
