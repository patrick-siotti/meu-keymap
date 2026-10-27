import { useState } from "react";
import { Plus, Play, Trash2, ArrowRight } from "lucide-react";
import type { NamedEvent, Profile } from "../../lib/model";
import { EntityDialog } from "./EntityDialog";
import { StateConditionalEffects } from "./StateConditionalEffects";
import { always } from "../../lib/conditions";
import { eventInUse } from "../../lib/profile-references";
interface EventDetailsProps {
  event: NamedEvent;
  profile: Profile;
  runtimeState: string;
  previewResult: string;
  onChange: (event: NamedEvent) => void;
  onRemove: () => void;
  onPreview: (stateId: string) => void;
  onAction: (stateId: string, branch: "then" | "else") => void;
}
export function EventDetails({
  event,
  profile,
  runtimeState,
  previewResult,
  onChange,
  onRemove,
  onPreview,
  onAction,
}: EventDetailsProps) {
  const [selected, setSelected] = useState(event.initialStateId),
    [creating, setCreating] = useState(false),
    [testedState, setTestedState] = useState("");
  const state = event.states.find((s) => s.id === selected) ?? event.states[0]!;
  const used = eventInUse(profile, event.id, state.id);
  const nameError =
    !event.name.trim() ||
    profile.events.some(
      (e) =>
        e.id !== event.id &&
        e.name.toLocaleLowerCase() === event.name.toLocaleLowerCase(),
    );
  const stateError =
    !state.name.trim() ||
    event.states.some(
      (s) =>
        s.id !== state.id &&
        s.name.toLocaleLowerCase() === state.name.toLocaleLowerCase(),
    );
  return (
    <section className="event-details">
      <div className="event-definition-heading">
        <label className="field">
          Nome do evento
          <input
            maxLength={40}
            aria-invalid={nameError}
            value={event.name}
            onChange={(e) => onChange({ ...event, name: e.target.value })}
          />
        </label>
        <label className="field">
          Começar no estado
          <select
            value={event.initialStateId}
            onChange={(e) =>
              onChange({ ...event, initialStateId: e.target.value })
            }
          >
            {event.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button"
          title="Excluir evento"
          aria-label="Excluir evento"
          onClick={onRemove}
        >
          <Trash2 size={17} />
        </button>
      </div>
      {nameError && (
        <p className="error-text">O evento precisa de um nome único.</p>
      )}
      <div className="states-heading">
        <h2>Estados</h2>
        <button className="button" onClick={() => setCreating(true)}>
          <Plus size={15} />
          Adicionar estado
        </button>
      </div>
      <div className="states-strip" aria-label="Estados do evento">
        {event.states.map((s, i) => (
          <div className="state-step" key={s.id}>
            {i > 0 && <ArrowRight size={13} />}
            <button
              className={s.id === state.id ? "selected" : ""}
              aria-pressed={s.id === state.id}
              onClick={() => setSelected(s.id)}
            >
              {s.name}
              {runtimeState === s.id && <i title="Estado atual na prévia" />}
            </button>
          </div>
        ))}
      </div>
      <div className="state-edit-header">
        <label className="field">
          Nome deste estado
          <input
            aria-invalid={stateError}
            value={state.name}
            maxLength={40}
            onChange={(e) =>
              onChange({
                ...event,
                states: event.states.map((s) =>
                  s.id === state.id ? { ...s, name: e.target.value } : s,
                ),
              })
            }
          />
        </label>
        <button
          className="button"
          onClick={() => {
            setTestedState(state.id);
            onPreview(state.id);
          }}
        >
          <Play size={14} />
          Testar este estado
        </button>
        <button
          className="icon-button"
          aria-label="Excluir estado"
          disabled={
            event.states.length === 1 ||
            state.id === event.initialStateId ||
            used
          }
          title={
            used
              ? "Remova os vínculos e condições que usam este estado antes de excluí-lo"
              : state.id === event.initialStateId
                ? "Escolha outro estado inicial para remover este"
                : "Excluir estado"
          }
          onClick={() => {
            onChange({
              ...event,
              states: event.states.filter((s) => s.id !== state.id),
            });
            setSelected(event.initialStateId);
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
      {testedState === state.id && previewResult && (
        <p className="state-preview-result" role="status">
          {previewResult}
        </p>
      )}
      {stateError && (
        <p className="error-text">
          O estado precisa de um nome único neste evento.
        </p>
      )}
      <StateConditionalEffects
        profile={profile}
        state={state}
        onChange={(next) =>
          onChange({
            ...event,
            states: event.states.map((s) => (s.id === state.id ? next : s)),
          })
        }
        onAction={(branch) => onAction(state.id, branch)}
      />
      {creating && (
        <EntityDialog
          title="Adicionar estado"
          label="Nome do estado"
          existing={event.states.map((s) => s.name)}
          onClose={() => setCreating(false)}
          onSubmit={(name) => {
            const id = crypto.randomUUID();
            onChange({
              ...event,
              states: [
                ...event.states,
                {
                  id,
                  name,
                  action: { kind: "none" },
                  lights: [],
                  condition: always(),
                },
              ],
            });
            setSelected(id);
            setCreating(false);
          }}
        />
      )}
    </section>
  );
}
