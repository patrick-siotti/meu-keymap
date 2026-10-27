import {
  Grid2X2,
  HelpCircle,
  Download,
  Upload,
  Save,
  Check,
  LoaderCircle,
  Keyboard,
  Workflow,
  Usb,
  Play,
  Lightbulb,
} from "lucide-react";
import type { KeymapDocument } from "../../lib/model";
import type { ApplicationMode } from "../../lib/bindings";
import { ProfileBar } from "./ProfileBar";
interface AppHeaderProps {
  document: KeymapDocument;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onSaveOnly: () => void;
  applied: boolean;
  applicationLabel:string;
  mode:ApplicationMode;
  onMode:(mode:ApplicationMode)=>void;
  onSelect: (id: string) => void;
  onProfile: (mode: "new" | "rename" | "duplicate") => void;
  onDeleteProfile: () => void;
  onExport: () => void;
  onImport: () => void;
  onHelp: () => void;
  onDevice: () => void;
  onApply: () => void;
  onExecution: () => void;
  screen: "keys" | "events" | "leds";
  onScreen: (screen: "keys" | "events" | "leds") => void;
}
export function AppHeader({
  document,
  dirty,
  saving,
  onSave,
  onSaveOnly,
  applied,
  applicationLabel,
  mode,
  onMode,
  onSelect,
  onProfile,
  onDeleteProfile,
  onExport,
  onImport,
  onHelp,
  onDevice,
  onApply,
  onExecution,
  screen,
  onScreen,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <Grid2X2 size={23} strokeWidth={1.7} />
        </span>
        <strong>
          meu keymap<span>seu teclado, suas regras</span>
        </strong>
      </div>
      <span className="header-spacer" />
      <button className="button device-connect" onClick={onDevice}>
        <Usb size={15} />
        Conectar macropad
      </button>
      <button className="text-button" onClick={onHelp}>
        <HelpCircle size={14} />
        Ajuda
      </button>
      {screen!=="leds"&&<><span className="save-status">
        {saving ? (
          "Salvando e aplicando…"
        ) : dirty ? (
          "Alterações pendentes"
        ) : (
          <>
            <Check size={14} />
            {applicationLabel}
          </>
        )}
      </span>
      <button
        className="icon-button"
        onClick={onApply}
        title="Opções de aplicação"
        aria-label="Opções de aplicação"
      ><Usb size={15}/></button>
      <div className="save-mode-actions"><button
        className="button primary save-button"
        onClick={onSave}
        disabled={saving || (!dirty&&applied)}
      >
        {saving ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Save size={16} />
        )}
        Salvar e aplicar
      </button><label className="execution-mode"><select aria-label="Executar perfil em" title="Modo de execução de Salvar e aplicar" value={mode} disabled={saving} onChange={e=>onMode(e.target.value as ApplicationMode)}><option value="local">Automações no Windows</option><option value="device">Direto no aparelho</option></select></label></div></>}
      <div className="header-tools">
        <nav className="app-navigation" aria-label="Área do aplicativo">
          <button
            className={screen === "keys" ? "active" : ""}
            aria-current={screen === "keys" ? "page" : undefined}
            onClick={() => onScreen("keys")}
          >
            <Keyboard size={15} />
            Teclas
          </button>
          <button
            className={screen === "events" ? "active" : ""}
            aria-current={screen === "events" ? "page" : undefined}
            onClick={() => onScreen("events")}
          >
            <Workflow size={15} />
            Eventos
          </button>
          <button className={screen==="leds"?"active":""} aria-current={screen==="leds"?"page":undefined} onClick={()=>onScreen("leds")}><Lightbulb size={15}/>LEDs</button>
        </nav>
        <button className="text-button" onClick={onExecution}><Play size={14}/>Execução</button>
        {screen!=="leds"&&<button className="text-button" disabled={saving||!dirty} onClick={onSaveOnly}>Guardar sem aplicar</button>}
        <ProfileBar
          document={document}
          onSelect={onSelect}
          onAction={onProfile}
          onDelete={onDeleteProfile}
        />
        <button className="text-button" onClick={onImport}>
          <Upload size={14} />
          Importar
        </button>
        <button className="text-button" onClick={onExport}>
          <Download size={14} />
          Exportar
        </button>
      </div>
    </header>
  );
}
