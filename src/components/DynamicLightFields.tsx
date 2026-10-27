import { always, INPUTS, conditionCount } from "../../lib/conditions";
import type { Condition, Source } from "../../lib/conditions";
import type { LightEffect, Profile } from "../../lib/model";
import { ConditionEditor } from "./ConditionEditor";
import { SourcePicker } from "./SourcePicker";
interface DynamicLightFieldsProps {
  effect: LightEffect;
  profile: Profile;
  onChange: (effect: LightEffect) => void;
}
export function DynamicLightFields({
  effect,
  profile,
  onChange,
}: DynamicLightFieldsProps) {
  function muteFor(source: Source | null): Source | null {
    if (
      source?.kind !== "input" ||
      !/^(windows|obs)\.microphone\.(level|volume)$/.test(source.key)
    )
      return null;
    return (
      INPUTS.find(
        (s) => s.key === source.key.replace(/\.(level|volume)$/, ".muted"),
      ) ?? null
    );
  }
  const muteSource = muteFor(effect.intensity.source);
  function hasMute(c: Condition): boolean {
    return c.kind === "test"
      ? c.id === "microphone-unmuted"
      : c.children.some(hasMute);
  }
  function removeMute(c: Condition): Condition {
    return c.kind === "test"
      ? c
      : {
          ...c,
          children: c.children
            .filter((v) => v.id !== "microphone-unmuted")
            .map(removeMute),
        };
  }
  function guard(c: Condition, source: Source): Condition {
    return {
      id: "microphone-gate",
      kind: "all",
      children: [
        c,
        {
          id: "microphone-unmuted",
          kind: "test",
          source,
          operator: "eq",
          value: false,
        },
      ],
    };
  }
  function changeSource(source: Source | null) {
    const muted = muteFor(source),
      base = removeMute(effect.visibility);
    onChange({
      ...effect,
      intensity: { ...effect.intensity, source },
      visibility:
        hasMute(effect.visibility) && muted ? guard(base, muted) : base,
    });
  }
  return (
    <div className="dynamic-light-fields">
      <label className="field">
        Intensidade
        <select
          value={effect.intensity.source ? "source" : "fixed"}
          onChange={(e) =>
            changeSource(e.target.value === "source" ? INPUTS[0]! : null)
          }
        >
          <option value="fixed">Brilho fixo</option>
          <option value="source">Acompanhar uma fonte numérica</option>
        </select>
      </label>
      {effect.intensity.source && (
        <>
          <SourcePicker
            inputOnly
            numericOnly
            source={effect.intensity.source}
            profile={profile}
            onChange={changeSource}
          />
          <div className="form-row">
            <label className="field">
              Entrada mínima
              <input
                type="number"
                value={effect.intensity.inputMin}
                onChange={(e) =>
                  onChange({
                    ...effect,
                    intensity: {
                      ...effect.intensity,
                      inputMin: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field">
              Entrada máxima
              <input
                type="number"
                value={effect.intensity.inputMax}
                onChange={(e) =>
                  onChange({
                    ...effect,
                    intensity: {
                      ...effect.intensity,
                      inputMax: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
          {effect.intensity.inputMax <= effect.intensity.inputMin && (
            <p role="alert" className="error-text">
              A entrada máxima deve ser maior que a mínima.
            </p>
          )}
          <p className="helper">
            O valor acompanha a fonte continuamente, do apagado até o brilho
            máximo escolhido.
          </p>
          {muteSource && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={hasMute(effect.visibility)}
                onChange={(e) =>
                  onChange({
                    ...effect,
                    visibility: e.target.checked
                      ? guard(removeMute(effect.visibility), muteSource)
                      : removeMute(effect.visibility),
                  })
                }
              />
              Apagar quando este microfone estiver em mudo
            </label>
          )}
        </>
      )}
      <details className="light-visibility">
        <summary>
          Ligar / desligar automaticamente
          {conditionCount(effect.visibility) > 0
            ? ` · ${conditionCount(effect.visibility)} condições`
            : ""}
        </summary>
        <p className="helper">
          A luz só aparece enquanto estas condições forem atendidas.
        </p>
        <ConditionEditor
          condition={effect.visibility}
          profile={profile}
          onChange={(visibility) => onChange({ ...effect, visibility })}
        />
        {conditionCount(effect.visibility) > 0 && (
          <button
            className="text-button"
            onClick={() => onChange({ ...effect, visibility: always() })}
          >
            Remover condições da luz
          </button>
        )}
      </details>
    </div>
  );
}
