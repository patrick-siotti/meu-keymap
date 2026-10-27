import {
  LoaderCircle,
  Radio,
  RefreshCw,
  Square,
  Usb,
} from "lucide-react";
import { inputDescription } from "../../lib/device";
import { useDeviceConnection } from "../hooks/useDeviceConnection";
import { Modal } from "./Modal";
import { DeviceStatePanel } from "./DeviceStatePanel";
interface DeviceDialogProps {
  onClose: () => void;
  onIdentify: () => void;
  onMap: () => void;
  onRgb: () => void;
  onVerify: () => void;
}
export function DeviceDialog({ onClose, onIdentify,onMap,onRgb,onVerify }: DeviceDialogProps) {
  const device = useDeviceConnection();
  const connected = !!device.inventory?.devices.length;
  return (
    <Modal
      wide
      title="Conectar macropad"
      onClose={onClose}
    >
      <div className="device-setup">
        <DeviceStatePanel/>
        <section className="device-connection-summary" aria-label="Conexão USB">
          <div className="device-connection-icon">
            <Usb size={25} />
          </div>
          <div>
            <h3>
              {device.loading
                ? "Procurando macropad…"
                : connected
                  ? "Macropad detectado"
                  : "Macropad não encontrado"}
            </h3>
            {!connected && <p>Conecte o macropad pelo cabo USB e atualize a conexão.</p>}
          </div>
          <button
            className="icon-button"
            disabled={device.loading}
            aria-label="Atualizar conexão"
            title="Atualizar conexão"
            onClick={device.reload}
          >
            <RefreshCw size={16} />
          </button>
        </section>
        {device.error && (
          <p role="alert" className="error-text">
            {device.error}
          </p>
        )}
        {connected && (
          <>
            <div className="device-mode-actions"><button className="button primary" onClick={onMap}>Mapear por código</button><button className="button" onClick={onRgb}>LEDs estáticos</button><button className="button" onClick={onVerify}>Conferir controles físicos</button><button className="text-button" onClick={onIdentify}>Diagnóstico das saídas atuais</button></div>
            <section
              className="device-input-test"
              aria-label="Teste de entrada física"
            >
              <div className="section-heading">
                <h3>1. Conferir os controles</h3>
                <span className="device-test-status">
                  {device.listening
                    ? device.ready
                      ? "Ouvindo o macropad"
                      : "Iniciando leitor…"
                    : "Teste parado"}
                </span>
              </div>
              <p>
                Inicie o teste e acione uma tecla ou encoder.
              </p>
              <p className="helper">
                Os atalhos gravados no aparelho continuam ativos durante o teste.
              </p>
              <div className="device-test-actions">
                {device.listening ? (
                  <button className="button" onClick={device.stop}>
                    <Square size={14} />
                    Parar teste
                  </button>
                ) : (
                  <button className="button primary" onClick={device.start}>
                    <Radio size={15} />
                    Iniciar teste de entrada
                  </button>
                )}
              </div>
              <div
                className="device-input-log"
                role="log"
                aria-label="Sinais físicos recebidos"
                aria-live="polite"
              >
                {!device.events.length ? (
                  <p>
                    {device.listening ? (
                      <>
                        <LoaderCircle size={15} className="spin" />
                        Aguardando uma tecla ou encoder do macropad…
                      </>
                    ) : (
                      "Nenhum sinal recebido nesta sessão."
                    )}
                  </p>
                ) : (
                  device.events.map((event, i) => (
                    <div key={`${event.at}:${i}`}>
                      <time>
                        {new Date(event.at).toLocaleTimeString("pt-BR")}
                      </time>
                      <span>{inputDescription(event)}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
            <details className="device-technical">
              <summary>Detalhes da conexão</summary>
              <ul>
                {device.inventory!.devices.map((d) => (
                  <li key={d.path}>
                    <strong>
                      {d.kind === "keyboard"
                        ? "Teclado"
                        : d.kind === "mouse"
                          ? "Mouse"
                          : d.usagePage === 0xff00
                            ? "Configuração"
                            : "Mídia / HID"}
                    </strong>
                    <span>
                      Uso {d.usagePage.toString(16).toUpperCase()}:
                      {d.usage.toString(16).toUpperCase()} · entrada{" "}
                      {d.inputBytes} B · saída {d.outputBytes} B
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}
