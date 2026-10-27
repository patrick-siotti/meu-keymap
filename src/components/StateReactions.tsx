import { Trash2, ArrowUpRight, Keyboard } from "lucide-react";
import type { EventState, Profile } from "../../lib/model";
import { actionLabel } from "../../lib/model";
interface StateReactionsProps {
  profile: Profile;
  state: Pick<EventState, "action" | "lights">;
  onChange: (state: Pick<EventState, "action" | "lights">) => void;
  onAction: () => void;
}
export function StateReactions({state,onChange,onAction}:StateReactionsProps){
  return <div className="state-reactions">
      <div className="section-heading">
        <h3>
          <Keyboard size={16} />
          Ação ao entrar neste estado
        </h3>
        {state.action.kind !== "none" && (
          <button
            className="icon-button"
            aria-label="Remover ação do estado"
            onClick={() => onChange({ ...state, action: { kind: "none" } })}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <button className="state-action-button" onClick={onAction}>
        <span>
          {state.action.kind === "none"
            ? "Escolher uma ação"
            : actionLabel(state.action)}
        </span>
        <ArrowUpRight size={16} />
      </button>
  </div>;
}
