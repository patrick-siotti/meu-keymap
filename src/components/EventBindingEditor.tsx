import { ArrowUpRight } from "lucide-react";
import type { Behavior, Profile } from "../../lib/model";
interface EventBindingEditorProps {
  profile: Profile;
  behavior: Behavior;
  onBehavior: (patch: Partial<Behavior>) => void;
  onManage: () => void;
}
export function EventBindingEditor({
  profile,
  behavior,
  onBehavior,
  onManage,
}: EventBindingEditorProps) {
  const transition = behavior.transition,
    definition = profile.events.find((e) => e.id === transition.eventId);
  return (
    <div className="editor-content">
      <div className="section-heading">
        <h3>Alterar um evento</h3>
        <button className="text-button" onClick={onManage}>
          Gerenciar eventos
          <ArrowUpRight size={13} />
        </button>
      </div>
      <label className="field">
        Evento
        <select
          value={transition.eventId}
          onChange={(e) => {
            const event = profile.events.find((d) => d.id === e.target.value);
            onBehavior({
              transition: {
                ...transition,
                eventId: e.target.value,
                stateId: event?.initialStateId ?? "",
              },
            });
          }}
        >
          <option value="">Não alterar eventos</option>
          {profile.events.map((e) => (
            <option value={e.id} key={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {definition && (
        <>
          <label className="field">
            O que fazer
            <select
              value={transition.operation}
              onChange={(e) =>
                onBehavior({
                  transition: {
                    ...transition,
                    operation: e.target.value as typeof transition.operation,
                  },
                })
              }
            >
              <option value="next">Ir para o próximo estado</option>
              <option value="previous">Voltar um estado</option>
              <option value="set">Definir um estado</option>
              <option value="reset">Voltar ao estado inicial</option>
            </select>
          </label>
          {transition.operation === "set" && (
            <label className="field">
              Estado de destino
              <select
                value={transition.stateId}
                onChange={(e) =>
                  onBehavior({
                    transition: { ...transition, stateId: e.target.value },
                  })
                }
              >
                {definition.states.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="state-flow">
            {definition.states.map((s, i) => (
              <span key={s.id}>
                {i > 0 && <b>→</b>}
                {s.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
