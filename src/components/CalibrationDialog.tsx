import {
  Check,
  ChevronRight,
  LoaderCircle,
  Radio,
  RotateCcw,
} from "lucide-react";
import {
  channelLabel,
  conflicts,
  emptyCalibration,
  signalLabel,
} from "../../lib/calibration";
import { useCalibration } from "../hooks/useCalibration";
import { CalibrationBoard } from "./CalibrationBoard";
import { Modal } from "./Modal";
interface CalibrationDialogProps {
  onClose: () => void;
}
export function CalibrationDialog({ onClose }: CalibrationDialogProps) {
  const model = useCalibration(),
    map = model.envelope?.document ?? emptyCalibration();
  const binding = map.bindings.find(
      (b) => b.layer === model.layer && b.channel === model.selected,
    ),
    duplicate = conflicts(map, model.layer, model.selected);
  const count = map.bindings.filter(
    (b) => b.layer === model.layer && b.channel !== "layer:press",
  ).length;
  const disabled =
    !model.device.ready ||
    !model.envelope ||
    model.saving ||
    model.hasPending ||
    model.mismatch;
  function close() {
    if (model.saving || model.hasPending) return;
    model.cancel();
    onClose();
  }
  return (
    <Modal
      wide
      className="calibration-modal"
      title="Diagnóstico das saídas atuais"
      onClose={close}
    >
      <div className="calibration-content">
        <div className="calibration-toolbar">
          <div
            className="calibration-layers"
            role="group"
            aria-label="Camada física em identificação"
          >
            {[0, 1, 2].map((layer) => (
              <button
                key={layer}
                disabled={model.saving || model.hasPending}
                aria-pressed={model.layer === layer}
                className={model.layer === layer ? "active" : ""}
                onClick={() => model.changeLayer(layer)}
              >
                Camada {layer + 1}
              </button>
            ))}
          </div>
          <span>{count}/25 capturados</span>
        </div>
        <p className="calibration-layer-help">
          Selecione a camada ativa no aparelho. Os atalhos gravados continuam ativos durante o teste.
        </p>
        <div className="calibration-target" role="status">
          <div>
            <strong>{channelLabel(model.selected)}</strong>
            <p>
              {model.needLayer
                ? "Confira e selecione acima a camada ativa no aparelho para continuar."
                : model.saving
                  ? "Salvando captura…"
                  : model.capturing
                    ? `Faça a ação no macropad${model.packets ? " · recebendo sinal…" : "…"}`
                    : binding
                      ? `Sinal: ${signalLabel(binding.samples)}`
                      : model.device.ready
                        ? "Clique no controle desejado e faça a ação no aparelho."
                        : "Conectando ao leitor do macropad…"}
            </p>
          </div>
          {model.capturing || model.saving ? (
            <LoaderCircle size={19} className="spin" />
          ) : binding ? (
            <Check size={19} />
          ) : (
            <Radio size={19} />
          )}
        </div>
        {model.error && (
          <p className="error-text" role="alert">
            {model.error}
          </p>
        )}
        {model.mismatch && (
          <p className="error-text" role="alert">
            O mapa salvo pertence a outra configuração USB. Preserve esse
            arquivo antes de iniciar outro mapeamento.
          </p>
        )}
        {duplicate.length > 0 && (
          <p className="calibration-warning" role="alert">
            Mesmo sinal de {duplicate.map(channelLabel).join(", ")}. Ainda não
            será possível distinguir esses controles.
          </p>
        )}
        <CalibrationBoard
          calibration={map}
          layer={model.layer}
          selected={model.selected}
          disabled={disabled || model.needLayer}
          onSelect={model.select}
        />
        <div className="calibration-bottom">
          <small>
            {model.hasPending
              ? "Antes de fechar, salve ou descarte a tentativa que ficou pendente."
              : model.notice}
          </small>
          <div>
            {model.hasPending ? (
              <>
                <button
                  className="button"
                  disabled={model.saving}
                  onClick={model.discard}
                >
                  Descartar tentativa
                </button>
                <button
                  className="button primary"
                  disabled={model.saving}
                  onClick={model.retry}
                >
                  Tentar salvar
                </button>
              </>
            ) : (
              <>
                <button
                  className="button"
                  disabled={disabled || model.needLayer}
                  onClick={() => model.arm()}
                >
                  <RotateCcw size={14} />
                  {binding ? "Capturar novamente" : "Capturar sinal"}
                </button>
                <button
                  className="button"
                  disabled={disabled || model.needLayer}
                  onClick={model.next}
                >
                  Próximo
                  <ChevronRight size={14} />
                </button>
              </>
            )}
          </div>
        </div>
        {model.selected === "layer:press" && (
          <div className="layer-switch-help">
            <p>
              Se não houver sinal, indique a camada ativa acima.
            </p>
            <button
              className="text-button"
              disabled={disabled}
              onClick={model.markInternal}
            >
              Marcar como troca interna, sem código
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
