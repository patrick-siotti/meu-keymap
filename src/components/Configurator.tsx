import type { ComponentProps } from "react";
import { MousePointer2, Play } from "lucide-react";
import type { Profile, Trigger } from "../../lib/model";
import type { Runtime } from "../../lib/engine";
import { DeviceBoard } from "./DeviceBoard";
import { RuntimePanel } from "./RuntimePanel";
import { Inspector } from "./Inspector";
import type { Value } from "../../lib/conditions";
interface ConfiguratorProps {
  profile: Profile;
  runtime: Runtime;
  selected: string;
  trigger: Trigger;
  now: number;
  testing: boolean;
  onTesting: (value: boolean) => void;
  onSelect: (id: string, trigger: Trigger) => void;
  onLayer: (layer: number) => void;
  onState: (eventId: string, stateId: string) => void;
  onReset: () => void;
  inspector: ComponentProps<typeof Inspector>;
  live: boolean;
  status: string;
  onLive: (live: boolean) => void;
  onValue: (key: string, value: Value | null) => void;
}
export function Configurator({
  profile,
  runtime,
  selected,
  trigger,
  now,
  testing,
  onTesting,
  onSelect,
  onLayer,
  onState,
  onReset,
  inspector,
  live,
  status,
  onLive,
  onValue,
}: ConfiguratorProps) {
  return (
    <main className="app-main">
      <section className="workspace" aria-label="Configuração do macropad">
        <div className="workspace-toolbar">
          <div className="layer-tabs" role="group" aria-label="Camadas">
            {profile.layers.map((layer, i) => (
              <button
                key={i}
                aria-pressed={i === runtime.layer}
                className={i === runtime.layer ? "active" : ""}
                onClick={() => onLayer(i)}
              >
                <span>{i + 1}</span>
                <span>
                  Camada {i + 1}
                  <small>{layer.name}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="segmented" aria-label="Modo do painel">
            <button
              className={!testing ? "active" : ""}
              onClick={() => onTesting(false)}
            >
              <MousePointer2 size={14} />
              Editar
            </button>
            <button
              className={testing ? "active" : ""}
              onClick={() => onTesting(true)}
            >
              <Play size={14} />
              Testar
            </button>
          </div>
        </div>
        <DeviceBoard
          profile={profile}
          layer={runtime.layer}
          selected={selected}
          event={trigger}
          runtime={runtime}
          testing={testing}
          now={now}
          onSelect={onSelect}
        />
        {testing && (
          <RuntimePanel
            profile={profile}
            runtime={runtime}
            onState={onState}
            onReset={onReset}
            live={live}
            status={status}
            onLive={onLive}
            onValue={onValue}
          />
        )}
      </section>
      <Inspector {...inspector} />
    </main>
  );
}
