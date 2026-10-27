import { Check, Layers, RotateCcw, RotateCw } from "lucide-react";
import { channelLabel, conflicts, signalLabel } from "../../lib/calibration";
import type { Calibration } from "../../lib/calibration";
interface CalibrationBoardProps {
  calibration: Calibration;
  layer: number;
  selected: string;
  disabled: boolean;
  onSelect: (channel: string) => void;
}
export function CalibrationBoard({
  calibration,
  layer,
  selected,
  disabled,
  onSelect,
}: CalibrationBoardProps) {
  function status(channel: string) {
    const binding = calibration.bindings.find(
      (b) => b.layer === layer && b.channel === channel,
    );
    const duplicate = conflicts(calibration, layer, channel).length > 0;
    return {
      binding,
      duplicate,
      css: `${selected === channel ? "selected" : ""} ${binding ? "captured" : ""} ${duplicate ? "duplicate" : ""}`,
    };
  }
  return (
    <div className="calibration-board-wrap">
      <div
        className="calibration-board"
        aria-label="Macropad completo para identificação"
      >
        <div className="calibration-keys">
          {Array.from({ length: 16 }, (_, i) => {
            const channel = `key-${i + 1}:press`,
              s = status(channel);
            return (
              <button
                key={channel}
                className={`calibration-key ${s.css}`}
                aria-label={`Identificar ${channelLabel(channel)}`}
                aria-pressed={selected === channel}
                disabled={disabled}
                onClick={() => onSelect(channel)}
                title={
                  s.binding
                    ? signalLabel(s.binding.samples)
                    : "Clique e pressione esta tecla no aparelho"
                }
              >
                <strong>{String(i + 1).padStart(2, "0")}</strong>
                <small>
                  {s.binding ? signalLabel(s.binding.samples) : "—"}
                </small>
                {s.binding && <Check size={11} />}
              </button>
            );
          })}
        </div>
        <div className="calibration-encoders">
          {[1, 2, 3].map((number) => (
            <section
              key={number}
              className={`calibration-encoder ${number === 3 ? "large" : ""}`}
              aria-label={`Encoder ${number}`}
            >
              <span className="calibration-encoder-label">E{number}</span>
              <div className="calibration-encoder-actions">
                {(["left", "press", "right"] as const).map((action) => {
                  const channel = `knob-${number}:${action}`,
                    s = status(channel);
                  return (
                    <button
                      key={action}
                      className={`${action === "press" ? "calibration-dial" : "calibration-turn"} ${s.css}`}
                      disabled={disabled}
                      aria-label={`Identificar ${channelLabel(channel)}`}
                      aria-pressed={selected === channel}
                      title={
                        s.binding
                          ? signalLabel(s.binding.samples)
                          : channelLabel(channel)
                      }
                      onClick={() => onSelect(channel)}
                    >
                      {action === "left" ? (
                        <RotateCcw size={17} />
                      ) : action === "right" ? (
                        <RotateCw size={17} />
                      ) : (
                        <span className="dial-mark" />
                      )}
                      {s.binding && <i />}
                    </button>
                  );
                })}
              </div>
              <div className="calibration-encoder-captions">
                <span>Esquerda</span>
                <span>Clique</span>
                <span>Direita</span>
              </div>
            </section>
          ))}
        </div>
      </div>
      <button
        className={`calibration-layer-control ${status("layer:press").css}`}
        disabled={disabled}
        aria-label="Identificar Botão de trocar camada"
        aria-pressed={selected === "layer:press"}
        onClick={() => onSelect("layer:press")}
      >
        <Layers size={16} />
        Botão de trocar camada
        <small>
          {calibration.layerSwitch === "internal"
            ? "troca interna indicada"
            : status("layer:press").binding
              ? "código registrado"
              : "controle extra"}
        </small>
      </button>
    </div>
  );
}
