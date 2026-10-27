import { Plus, X } from "lucide-react";
import type { LightEffect, Profile } from "../../lib/model";
import { DynamicLightFields } from "./DynamicLightFields";
export const EFFECT_NAMES: Record<LightEffect["mode"], string> = {
  none: "Não alterar a luz",
  on: "Ligar · cor fixa",
  off: "Desligar",
  toggle: "Alternar ligado / desligado",
  pulse: "Acender por um tempo",
  blink: "Piscar",
  breathe: "Respirar",
  cycle: "Alternar cores",
};
interface EffectFieldsProps {
  effect: LightEffect;
  onChange: (effect: LightEffect) => void;
  allowNone?: boolean;
  profile: Profile;
}
export function EffectFields({
  effect,
  onChange,
  allowNone = true,
  profile,
}: EffectFieldsProps) {
  const hasColor = !["none", "off"].includes(effect.mode),
    timed = ["blink", "breathe", "cycle"].includes(effect.mode);
  return (
    <div className="effect-fields">
      <label className="field">
        Comportamento
        <select
          value={effect.mode}
          onChange={(e) =>
            onChange({ ...effect, mode: e.target.value as LightEffect["mode"] })
          }
        >
          {Object.entries(EFFECT_NAMES)
            .filter(([key]) => allowNone || key !== "none")
            .map(([key, name]) => (
              <option value={key} key={key}>
                {name}
              </option>
            ))}
        </select>
      </label>
      {hasColor && (
        <>
          <div className="field">
            <span>
              {effect.mode === "cycle" ? "Sequência de cores" : "Cor"}
            </span>
            <div className="effect-colors">
              {(effect.mode === "cycle"
                ? effect.colors
                : effect.colors.slice(0, 1)
              ).map((color, index) => (
                <div className="effect-color" key={index}>
                  <input
                    type="color"
                    aria-label={`Cor ${index + 1}`}
                    value={color}
                    onChange={(e) =>
                      onChange({
                        ...effect,
                        colors: effect.colors.map((c, i) =>
                          i === index ? e.target.value : c,
                        ),
                      })
                    }
                  />
                  <span>{color.toUpperCase()}</span>
                  {effect.mode === "cycle" && effect.colors.length > 1 && (
                    <button
                      className="icon-button"
                      title="Remover cor"
                      aria-label={`Remover cor ${index + 1}`}
                      onClick={() =>
                        onChange({
                          ...effect,
                          colors: effect.colors.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              {effect.mode === "cycle" && effect.colors.length < 24 && (
                <button
                  className="button add-color"
                  onClick={() =>
                    onChange({
                      ...effect,
                      colors: [...effect.colors, "#eeeeee"],
                    })
                  }
                >
                  <Plus size={14} />
                  Cor
                </button>
              )}
            </div>
          </div>
          <label className="field range-label">
            <span>
              {effect.intensity.source ? "Brilho máximo" : "Brilho"}
              <output>{effect.brightness}%</output>
            </span>
            <input
              aria-label="Brilho"
              type="range"
              min={0}
              max={100}
              value={effect.brightness}
              onChange={(e) =>
                onChange({ ...effect, brightness: Number(e.target.value) })
              }
            />
          </label>
        </>
      )}
      {timed && (
        <label className="field">
          {effect.mode === "cycle"
            ? "Tempo em cada cor (ms)"
            : "Duração do ciclo (ms)"}
          <input
            type="number"
            min={100}
            max={60000}
            step={100}
            value={effect.periodMs}
            onChange={(e) =>
              onChange({
                ...effect,
                periodMs: Math.max(
                  100,
                  Math.min(60000, Number(e.target.value)),
                ),
              })
            }
          />
        </label>
      )}
      {effect.mode === "pulse" && (
        <label className="field">
          Duração (ms)
          <input
            type="number"
            min={100}
            max={60000}
            step={100}
            value={effect.durationMs}
            onChange={(e) =>
              onChange({
                ...effect,
                durationMs: Math.max(
                  100,
                  Math.min(60000, Number(e.target.value)),
                ),
              })
            }
          />
        </label>
      )}
      {hasColor && (
        <DynamicLightFields
          effect={effect}
          profile={profile}
          onChange={onChange}
        />
      )}
    </div>
  );
}
