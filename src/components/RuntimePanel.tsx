import { Terminal, RotateCcw } from "lucide-react";
import type { Profile } from "../../lib/model";
import type { Runtime } from "../../lib/engine";
import { eventState } from "../../lib/engine";
import { SignalTestPanel } from "./SignalTestPanel";
import type { Value } from "../../lib/conditions";
interface RuntimePanelProps {
  profile: Profile;
  runtime: Runtime;
  onState: (eventId: string, stateId: string) => void;
  onReset: () => void;
  live: boolean;
  status: string;
  onLive: (live: boolean) => void;
  onValue: (key: string, value: Value | null) => void;
}
export function RuntimePanel({
  profile,
  runtime,
  onState,
  onReset,
  live,
  status,
  onLive,
  onValue,
}: RuntimePanelProps) {
  return (
    <section className="runtime-panel" aria-label="Monitor de teste">
      <header>
        <h3>
          <Terminal size={16} />
          Teste
        </h3>
        <button className="text-button" onClick={onReset}>
          <RotateCcw size={13} />
          Reiniciar
        </button>
      </header>
      {!!profile.events.length && (
        <div className="runtime-event-list">
          {profile.events.map((event) => (
            <label key={event.id}>
              <span>{event.name}</span>
              <select
                aria-label={`Estado de ${event.name}`}
                value={eventState(profile, runtime, event.id)}
                onChange={(e) => onState(event.id, e.target.value)}
              >
                {event.states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <div
        className="event-log"
        role="log"
        aria-live="polite"
        aria-label="Resultado da simulação"
      >
        {runtime.logs.length ? (
          runtime.logs.slice(0, 5).map((log, i) => (
            <div key={`${i}:${log}`} className={i === 0 ? "latest" : ""}>
              {log}
            </div>
          ))
        ) : (
          <p>Aguardando um gatilho.</p>
        )}
      </div>
      <SignalTestPanel
        profile={profile}
        runtime={runtime}
        live={live}
        status={status}
        onLive={onLive}
        onValue={onValue}
      />
    </section>
  );
}
