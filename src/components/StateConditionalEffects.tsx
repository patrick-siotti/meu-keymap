import { useState } from "react";
import type { EventState, Profile } from "../../lib/model";
import { conditionCount } from "../../lib/conditions";
import { ConditionEditor } from "./ConditionEditor";
import { StateReactions } from "./StateReactions";
interface StateConditionalEffectsProps {
  state: EventState;
  profile: Profile;
  onChange: (state: EventState) => void;
  onAction: (branch: "then" | "else") => void;
}
export function StateConditionalEffects({
  state,
  profile,
  onChange,
  onAction,
}: StateConditionalEffectsProps) {
  const [flow, setFlow] = useState<"if" | "then" | "else">("then");
  const branch = flow === "else" ? "else" : "then",
    effects =
      branch === "else"
        ? (state.otherwise ?? { action: { kind: "none" as const }, lights: [] })
        : state;
  return (
    <div className="state-conditional">
      <nav className="flow-navigation" aria-label="Fluxo de entrada no estado">
        <button
          aria-pressed={flow === "if"}
          className={flow === "if" ? "active" : ""}
          onClick={() => setFlow("if")}
        >
          Se <small>{conditionCount(state.condition) || "sempre"}</small>
        </button>
        <span>→</span>
        <button
          aria-pressed={flow === "then"}
          className={flow === "then" ? "active" : ""}
          onClick={() => setFlow("then")}
        >
          Então
        </button>
        <span>/</span>
        <button
          aria-pressed={flow === "else"}
          className={flow === "else" ? "active" : ""}
          onClick={() => setFlow("else")}
        >
          Senão
        </button>
      </nav>
      {flow === "if" ? (
        <div className="state-condition-panel">
          <p className="helper">Só entra neste estado se as condições forem atendidas. Senão, mantém o estado atual e executa o outro ramo.</p>
          <ConditionEditor
            condition={state.condition}
            profile={profile}
            onChange={(condition) => onChange({ ...state, condition })}
          />
        </div>
      ) : (
        <StateReactions
          profile={profile}
          state={effects}
          onChange={(next) =>
            onChange(
              branch === "else"
                ? { ...state, otherwise: next }
                : { ...state, ...next },
            )
          }
          onAction={() => onAction(branch)}
        />
      )}
    </div>
  );
}
