import { Check, Monitor, Usb } from "lucide-react";
import { Modal } from "./Modal";
interface CapabilitiesProps {
  onClose: () => void;
}
export function Capabilities({ onClose }: CapabilitiesProps) {
  return (
    <Modal title="Ajuda" onClose={onClose}>
      <div className="capabilities">
        <div className="capability-device"><Usb size={20} /><span>16 teclas · 3 encoders · 3 camadas</span></div>
        <h3><Monitor size={17} />Configurar controles</h3>
        <ul>
          {[
            "Selecione uma tecla ou gesto do encoder e escolha uma ação.",
            "Monte atalhos pelos seletores ou pesquise na Biblioteca.",
            "Use Salvar e aplicar para ativar as alterações.",
            "Importe e exporte perfis para reutilizar suas configurações.",
          ].map(text => <li key={text}><Check size={16} />{text}</li>)}
        </ul>
        <h3>Escolher o modo</h3>
        <ul>
          <li><Check size={16} />Direto no aparelho: atalhos, mídia e macros básicas, inclusive com o app fechado.</li>
          <li><Check size={16} />Automações no Windows: texto, scripts, condições e eventos; requer execução ativa e app aberto.</li>
        </ul>
        <h3>LEDs</h3>
        <p>Selecione posições e camadas, escolha a cor e use Gravar LEDs.</p>
      </div>
    </Modal>
  );
}
