import type { Behavior, Control, Profile } from "../../lib/model";
import { controlName } from "../../lib/model";
import { EffectFields } from "./EffectFields";
interface LightingEditorProps {
  control: Control;
  behavior: Behavior;
  profile: Profile;
  layer: number;
  onBehavior: (patch: Partial<Behavior>) => void;
}
export function LightingEditor({
  control,
  behavior,
  profile,
  layer,
  onBehavior,
}: LightingEditorProps) {
  return (
    <div className="editor-content">
      <label className="field">
        Mudar a luz de
        <select
          value={behavior.light.target}
          onChange={(e) =>
            onBehavior({ light: { ...behavior.light, target: e.target.value } })
          }
        >
          <option value="self">Este controle</option>
          <option value="all">Todos nesta camada</option>
          {profile.layers[layer]!.controls.filter(
            (c) => c.id !== control.id,
          ).map((c) => (
            <option key={c.id} value={c.id}>
              {controlName(c)}
            </option>
          ))}
        </select>
      </label>
      <EffectFields
        profile={profile}
        effect={behavior.light.effect}
        onChange={(effect) =>
          onBehavior({ light: { ...behavior.light, effect } })
        }
      />
    </div>
  );
}
