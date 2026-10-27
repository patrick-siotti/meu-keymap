import { RotateCcw,RotateCw } from "lucide-react";
import type { CSSProperties } from "react";
import type { Control, Profile, Trigger } from "../../lib/model";
import { actionLabel } from "../../lib/model";
import type { Runtime } from "../../lib/engine";
import { controlPresentation,primaryRule as primary } from "../../lib/action-presentation";
import { ActionIcon } from "./ActionIcon";
interface DeviceBoardProps {
  profile: Profile;
  layer: number;
  selected: string;
  event: Trigger;
  runtime: Runtime;
  testing: boolean;
  now: number;
  onSelect: (id: string, event: Trigger) => void;
}
function summary(c: Control, trigger: Trigger = "press") {
  const r = primary(c, trigger);
  return r ? actionLabel(r.behavior.action) : "Sem ação";
}
export function DeviceBoard({
  profile,
  layer,
  selected,
  event,
  testing,
  onSelect,
}: DeviceBoardProps) {
  const controls = profile.layers[layer]!.controls;
  function color(): CSSProperties {
    return {
      "--led": "#4d4d51",
      "--led-opacity": 0.15,
    } as CSSProperties;
  }
  return (
    <div
      className={`device ${testing ? "is-testing" : ""}`}
      aria-label="Macropad com 16 teclas e 3 encoders"
    >
      <div className="device-top">
        <span className="device-wordmark">
          mk<span> / 16.3</span>
        </span>
        <div
          className="layer-indicators"
          aria-label={`Camada ${layer + 1} selecionada`}
        >
          {[0, 1, 2].map((i) => (
            <i className={i === layer ? "on" : ""} key={i} />
          ))}
        </div>
      </div>
      <div className="device-body">
        <div className="key-grid">
          {controls
            .filter((c) => c.kind === "key")
            .map((c, i) => {
              const view=controlPresentation(c,profile),r = primary(c),
                a = r?.behavior.action;
              return (
                <button
                  key={c.id}
                  className={`keycap ${selected === c.id ? "selected" : ""}`}
                  style={color()}
                  aria-label={`Tecla ${i + 1}: ${view.label}`}
                  aria-pressed={selected === c.id}
                  title={`${view.label} · ${summary(c)}`}
                  onClick={() => onSelect(c.id, "press")}
                >
                  <span className="key-meta">
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <i className="led-dot" />
                  </span>
                  <ActionIcon name={view.icon} icon={view.customIcon} className="key-icon" size={22}/>
                  <span className={`key-label ${view.icon==="plus" ? "unassigned" : ""}`}>
                    {view.label}
                  </span>
                  <span className="key-binding">
                    {r?.behavior.transition.eventId
                      ? profile.events.find(
                          (e) => e.id === r.behavior.transition.eventId,
                        )?.name
                      : a?.kind === "shortcut"
                        ? a.keys.replaceAll("+", " + ")
                        : a?.kind === "media"
                          ? "MÍDIA"
                          : a?.kind === "layer"
                            ? `CAMADA ${a.value + 1}`
                            : "—"}
                  </span>
                  <i className="key-light" />
                </button>
              );
            })}
        </div>
        <div className="encoder-stack">
          {controls
            .filter((c) => c.kind === "knob")
            .map((c, i) => {
              const view=controlPresentation(c,profile);
              return (
                <div
                  className={`encoder ${i === 2 ? "encoder-large" : ""}`}
                  style={color()}
                  key={c.id}
                >
                  <div className="encoder-info">
                    <span>E{i + 1}</span>
                    <span>{view.icon==="plus"?`Encoder ${i+1}`:view.label}</span>
                  </div>
                  <div className="dial-row">
                    <button
                      className={`turn-target ${selected === c.id && event === "left" ? "active" : ""}`}
                      aria-label={`Encoder ${i + 1}: girar à esquerda`}
                      title={summary(c, "left")}
                      onClick={() => onSelect(c.id, "left")}
                    >
                      <RotateCcw size={18} />
                    </button>
                    <button
                      className={`dial ${selected === c.id && event === "press" ? "active" : ""}`}
                      aria-label={`Encoder ${i + 1}: clique`}
                      title={summary(c)}
                      onClick={() => onSelect(c.id, "press")}
                    >
                      <i className="dial-notch" />
                      <ActionIcon name={view.icon} icon={view.customIcon} size={i===2?25:20}/>
                    </button>
                    <button
                      className={`turn-target ${selected === c.id && event === "right" ? "active" : ""}`}
                      aria-label={`Encoder ${i + 1}: girar à direita`}
                      title={summary(c, "right")}
                      onClick={() => onSelect(c.id, "right")}
                    >
                      <RotateCw size={18} />
                    </button>
                  </div>
                  <div className="encoder-actions">
                    {(["left", "press", "right"] as const).map((trigger, j) => {
                      const a = primary(c, trigger)?.behavior.action;
                      return (
                        <button
                          key={trigger}
                          className={
                            selected === c.id && event === trigger
                              ? "active"
                              : ""
                          }
                          onClick={() => onSelect(c.id, trigger)}
                          title={summary(c, trigger)}
                        >
                          <small>{["Esquerda", "Clique", "Direita"][j]}</small>
                          <span>
                            {a?.kind === "shortcut"
                              ? a.keys
                              : a?.kind === "media"
                                ? {
                                    volumeDown: "Vol −",
                                    volumeUp: "Vol +",
                                    mute: "Mudo",
                                    previous: "Anterior",
                                    next: "Próxima",
                                    playPause: "Play",
                                  }[a.command]
                                : !a || a.kind === "none"
                                  ? "Definir"
                                  : "Ação"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      <div className="device-bottom">
        <span>MEU KEYMAP</span>
        <span>16 TECLAS / 3 ENCODERS / 3 CAMADAS</span>
      </div>
    </div>
  );
}
