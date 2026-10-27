import { useState } from "react";
import { Plus, Workflow } from "lucide-react";
import type { Profile } from "../../lib/model";
import { makeEvent } from "../../lib/model";
import type { Runtime } from "../../lib/engine";
import { eventState } from "../../lib/engine";
import { EventDetails } from "./EventDetails";
import { EntityDialog } from "./EntityDialog";
import { Modal } from "./Modal";
import { eventInUse } from "../../lib/profile-references";
interface EventsScreenProps {
  profile: Profile;
  runtime: Runtime;
  onChange: (profile: Profile) => void;
  onPreview: (eventId: string, stateId: string) => void;
  onAction: (eventId: string, stateId: string, branch: "then" | "else") => void;
}
export function EventsScreen({
  profile,
  runtime,
  onChange,
  onPreview,
  onAction,
}: EventsScreenProps) {
  const [selected, setSelected] = useState(profile.events[0]?.id ?? ""),
    [creating, setCreating] = useState(false),
    [removing, setRemoving] = useState(false);
  const event =
    profile.events.find((e) => e.id === selected) ?? profile.events[0];
  const used = event ? eventInUse(profile, event.id) : false;
  function remove() {
    if (!event || used) return;
    const next = structuredClone(profile);
    next.events = next.events.filter((e) => e.id !== event.id);
    for (const l of next.layers)
      for (const c of l.controls)
        for (const r of c.rules) {
          if (r.behavior.when.eventId === event.id)
            r.behavior.when = { eventId: "", stateId: "" };
          if (r.behavior.transition.eventId === event.id)
            r.behavior.transition = {
              eventId: "",
              operation: "next",
              stateId: "",
            };
        }
    onChange(next);
    setRemoving(false);
    setSelected(next.events[0]?.id ?? "");
  }
  return (
    <main className="events-page">
      <header className="events-page-heading">
        <div>
          <h1>Eventos</h1>
          <p>Crie os estados que conectam suas teclas e ações.</p>
        </div>
      </header>
      <div className="events-layout">
        <aside className="events-list">
          <div className="section-heading">
            <span>{profile.events.length} eventos</span>
          </div>
          {profile.events.map((e) => (
            <button
              key={e.id}
              className={`event-list-item ${event?.id === e.id ? "selected" : ""}`}
              onClick={() => setSelected(e.id)}
            >
              <Workflow size={18} />
              <span>
                <strong>{e.name}</strong>
                <small>
                  {e.states.length} estados ·{" "}
                  {
                    e.states.find(
                      (s) => s.id === eventState(profile, runtime, e.id),
                    )?.name
                  }
                </small>
              </span>
            </button>
          ))}
          <button
            className="button new-event"
            onClick={() => setCreating(true)}
          >
            <Plus size={15} />
            Criar evento
          </button>
        </aside>
        {event ? (
          <EventDetails
            key={event.id}
            event={event}
            profile={profile}
            runtimeState={eventState(profile, runtime, event.id)}
            previewResult={runtime.logs[0] ?? ""}
            onChange={(next) =>
              onChange({
                ...profile,
                events: profile.events.map((e) =>
                  e.id === event.id ? next : e,
                ),
              })
            }
            onRemove={() => setRemoving(true)}
            onPreview={(state) => onPreview(event.id, state)}
            onAction={(state, branch) => onAction(event.id, state, branch)}
          />
        ) : (
          <div className="events-empty">
            <Workflow size={36} />
            <h2>Seu primeiro evento</h2>
            <p>
              Por exemplo, “Gravando” pode ter os estados Parado, Gravando e
              Pausado.
            </p>
            <button
              className="button primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} />
              Criar evento
            </button>
          </div>
        )}
      </div>
      {creating && (
        <EntityDialog
          title="Criar evento"
          label="Nome do evento"
          existing={profile.events.map((e) => e.name)}
          onClose={() => setCreating(false)}
          onSubmit={(name) => {
            const id = crypto.randomUUID();
            onChange({
              ...profile,
              events: [...profile.events, makeEvent(id, name)],
            });
            setSelected(id);
            setCreating(false);
          }}
        />
      )}
      {removing && event && (
        <Modal
          title={`Excluir ${event.name}?`}
          onClose={() => setRemoving(false)}
        >
          <div className="import-confirm">
            <p>
              {used
                ? "Este evento é usado por teclas ou condições. Remova esses vínculos antes de excluí-lo."
                : "O evento e suas reações serão removidos deste perfil."}
            </p>
            <div className="form-footer">
              <button className="button" onClick={() => setRemoving(false)}>
                Cancelar
              </button>
              <button
                className="button danger-button"
                onClick={remove}
                disabled={used}
              >
                Excluir evento
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
