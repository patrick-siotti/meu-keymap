import { useState } from "react";
import { Plus } from "lucide-react";
import type {
  Control,
  Profile,
  Qualifier,
  Rule,
  Trigger,
} from "../../lib/model";
import { EVENT_LABELS, controlName, makeRule } from "../../lib/model";
import { Modal } from "./Modal";
interface RuleDialogProps {
  control: Control;
  profile: Profile;
  layer: number;
  onClose: () => void;
  onAdd: (rule: Rule) => void;
}
export function RuleDialog({
  control,
  profile,
  layer,
  onClose,
  onAdd,
}: RuleDialogProps) {
  const [trigger, setTrigger] = useState<Trigger>("press"),
    [combination, setCombination] = useState("none"),
    [partner, setPartner] = useState(""),
    [modifiers, setModifiers] = useState<Qualifier["modifiers"]>([]);
  const available: Trigger[] =
    control.kind === "key"
      ? ["press", "double", "hold", "release", "activate"]
      : ["left", "press", "right", "double", "hold", "release", "activate"];
  const valid =
    combination === "none" ||
    trigger === "activate" ||
    (combination === "control" ? !!partner : modifiers.length > 0);
  return (
    <Modal
      title="Adicionar gatilho"
      subtitle={controlName(control)}
      onClose={onClose}
    >
      <form
        className="rule-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onAdd(
            makeRule(crypto.randomUUID(), trigger, {
              controlId:
                trigger !== "activate" && combination === "control"
                  ? partner
                  : "",
              modifiers:
                trigger !== "activate" && combination === "keyboard"
                  ? modifiers
                  : [],
            }),
          );
        }}
      >
        <label className="field">
          Quando
          <select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as Trigger)}
          >
            {available.map((t) => (
              <option key={t} value={t}>
                {EVENT_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {trigger !== "activate" && (
          <>
            <label className="field">
              Combinação
              <select
                value={combination}
                onChange={(e) => setCombination(e.target.value)}
              >
                <option value="none">Usar esta tecla sozinha</option>
                <option value="control">Com outra tecla do macropad</option>
                <option value="keyboard">Com Ctrl, Shift, Alt ou Win</option>
              </select>
            </label>
            {combination === "control" && (
              <label className="field">
                Enquanto esta outra tecla estiver pressionada
                <select
                  value={partner}
                  onChange={(e) => setPartner(e.target.value)}
                >
                  <option value="">Escolher tecla…</option>
                  {profile.layers[layer]!.controls.filter(
                    (c) => c.kind === "key" && c.id !== control.id,
                  ).map((c) => (
                    <option value={c.id} key={c.id}>
                      {controlName(c)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {combination === "keyboard" && (
              <div className="modifier-options">
                {(["Ctrl", "Shift", "Alt", "Win"] as const).map((m) => (
                  <label key={m}>
                    <input
                      type="checkbox"
                      checked={modifiers.includes(m)}
                      onChange={(e) =>
                        setModifiers(
                          e.target.checked
                            ? [...modifiers, m]
                            : modifiers.filter((v) => v !== m),
                        )
                      }
                    />
                    {m}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        <footer className="form-footer form-footer-end">
          <button className="button primary" disabled={!valid}>
            <Plus size={15} />
            Adicionar
          </button>
        </footer>
      </form>
    </Modal>
  );
}
