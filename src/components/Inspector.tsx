import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  Keyboard,
  Workflow,
  ArrowUpRight,
  Search,
  Plus,
  RotateCcw,
  Play,
  Trash2,
} from "lucide-react";
import type { Behavior, Control, Profile, Rule } from "../../lib/model";
import { actionLabel, ruleLabel, emptyBehavior } from "../../lib/model";
import { conditionCount } from "../../lib/conditions";
import { hardwareAddress } from "../../lib/hardware-map";
import type { Condition } from "../../lib/conditions";
import { ConditionEditor } from "./ConditionEditor";
import { EventBindingEditor } from "./EventBindingEditor";
import { actionPresentation,controlPresentation,usesCustomLabel } from "../../lib/action-presentation";
import { ActionIcon } from "./ActionIcon";
import { ControlIconEditor } from "./ControlIconEditor";
import type { ApplicationMode } from "../../lib/bindings";
interface InspectorProps {
  control: Control;
  profile: Profile;
  layer: number;
  rule: Rule | undefined;
  virtual?:boolean;
  mode?:ApplicationMode;
  onRule: (id: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  onControl: (patch: Partial<Control>) => void;
  onBehavior: (patch: Partial<Behavior>, branch: "then" | "else") => void;
  onCondition: (condition: Condition) => void;
  onLibrary: (custom?: boolean, branch?: "then" | "else") => void;
  onTest: () => void;
  onManageEvents: () => void;
}
export function Inspector({
  control,
  profile,
  layer,
  rule,
  virtual=false,
  mode,
  onRule,
  onAdd,
  onRemove,
  onControl,
  onBehavior,
  onLibrary,
  onTest,
  onManageEvents,
  onCondition,
}: InspectorProps) {
  const [tab, setTab] = useState<"action" | "event">("action");
  const [flow, setFlow] = useState<"if" | "then" | "else">("then");
  const branch = flow === "else" ? "else" : "then";
  const address = hardwareAddress(control.id, rule?.trigger ?? "press", layer);
  const behavior = rule
    ? branch === "else"
      ? (rule.otherwise ?? emptyBehavior())
      : rule.behavior
    : emptyBehavior();
  const updateBehavior = (patch: Partial<Behavior>) =>
    onBehavior(patch, branch);
  function navigate(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const tabs = ["action", "event"] as const,
      index = tabs.indexOf(tab),
      next =
        tabs[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? 1
              : (index + 1) % 2
        ]!;
    setTab(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`#tab-${next}`)?.focus();
  }
  return (
    <aside className="inspector" aria-label="Editor do controle selecionado">
      <div className="inspector-heading">
        <div className="selection-icon">
          {control.kind === "key" ? (
            <Keyboard size={20} />
          ) : (
            <RotateCcw size={20} />
          )}
        </div>
        <div>
          <h2>
            {control.kind === "key" ? "Tecla" : "Encoder"}{" "}
            {control.id.split("-")[1]?.padStart(2, "0")}
          </h2>
          <p>
            Camada {layer + 1} · {profile.layers[layer]!.name}
          </p>
          {address && <code className="hardware-address">Código {address.slot} · 0x{address.slot.toString(16).toUpperCase().padStart(2, "0")}</code>}
        </div>
      </div>
      <div className="inspector-name">
        <label className="field">
          Nome do controle
          <input
            maxLength={30}
            value={usesCustomLabel(control)?control.label:""}
            placeholder={controlPresentation(control,profile).label}
            onChange={(e) => onControl({ label: e.target.value,labelMode:e.target.value?"custom":"auto" })}
          />
        </label>
        <ControlIconEditor key={`${profile.id}:${layer}:${control.id}`} control={control} automatic={controlPresentation(control,profile).icon} onChange={icon=>onControl({icon})}/>
        <div className="trigger-heading">
          <label htmlFor="rule-selector">
            Gatilhos desta tecla <small>{control.rules.length}</small>
          </label>
          <button className="text-button" onClick={onAdd}>
            <Plus size={14} />
            Adicionar gatilho
          </button>
        </div>
        <div className="rule-select-row">
          <select
            id="rule-selector"
            aria-label="Gatilho selecionado"
            value={rule?.id ?? ""}
            onChange={(e) => onRule(e.target.value)}
          >
            {virtual&&rule&&<option value={rule.id}>Clique (padrão)</option>}
            {!rule && <option value="">Selecione um gatilho</option>}
            {control.rules.map((r) => (
              <option key={r.id} value={r.id}>
                {ruleLabel(r, profile)}
              </option>
            ))}
          </select>
          {rule && !virtual && (
            <button
              className="icon-button"
              title="Remover este gatilho"
              aria-label="Remover gatilho"
              onClick={onRemove}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      {rule ? (
        <>
          <nav className="flow-navigation" aria-label="Fluxo do gatilho">
            <button
              aria-pressed={flow === "if"}
              className={flow === "if" ? "active" : ""}
              onClick={() => setFlow("if")}
            >
              Se <small>{conditionCount(rule.condition) || "sempre"}</small>
            </button>
            <span>→</span>
            <button
              aria-pressed={flow === "then"}
              className={flow === "then" ? "active" : ""}
              onClick={() => setFlow("then")}
            >
              Então
            </button>
            <span>/</span>
            <button
              aria-pressed={flow === "else"}
              className={flow === "else" ? "active" : ""}
              onClick={() => setFlow("else")}
            >
              Senão
            </button>
          </nav>
          {flow === "if" ? (
            <div className="editor-content condition-panel">
              <ConditionEditor
                condition={rule.condition}
                profile={profile}
                onChange={onCondition}
              />
            </div>
          ) : (
            <>
              <div
                className="editor-tabs"
                role="tablist"
                aria-label="Configuração do gatilho"
                onKeyDown={navigate}
              >
                {(["action", "event"] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    id={`tab-${t}`}
                    tabIndex={t === tab ? 0 : -1}
                    aria-controls="editor-panel"
                    aria-selected={t === tab}
                    className={t === tab ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t === "action" ? (
                      <Keyboard size={15} />
                    ) : (
                      <Workflow size={15} />
                    )}
                    {t === "action" ? "Ação" : "Evento"}
                  </button>
                ))}
              </div>
              <div
                id="editor-panel"
                role="tabpanel"
                aria-labelledby={`tab-${tab}`}
              >
                {tab === "action" && (
                  <div className="editor-content">
                    <button
                      className={`current-action ${behavior.action.kind === "none" ? "empty-action" : ""}`}
                      onClick={() => onLibrary(true, branch)}
                    >
                      <span className="action-type-icon">
                        <ActionIcon name={actionPresentation(behavior.action).icon} size={23}/>
                      </span>
                      <strong>{actionLabel(behavior.action)}</strong>
                      <span>
                        {behavior.action.kind === "none"
                          ? "Escolher ação"
                          : "Editar ação"}
                      </span>
                    </button>
                    {behavior.action.kind === "layer" && mode === "device" && <p className="helper">Trocar camada requer Automações. No modo direto, use o seletor do aparelho.</p>}
                    <button
                      className="library-launch"
                      onClick={() => onLibrary(false, branch)}
                    >
                      <span className="library-launch-icon">
                        <Search size={19} />
                      </span>
                      <span>
                        <strong>Explorar ações e atalhos</strong>
                        <small>Biblioteca e ações personalizadas</small>
                      </span>
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                )}
                {tab === "event" && (
                  <EventBindingEditor
                    profile={profile}
                    behavior={behavior}
                    onBehavior={updateBehavior}
                    onManage={onManageEvents}
                  />
                )}
              </div>
            </>
          )}
          <footer className="inspector-footer">
            <span className="rule-summary" title={ruleLabel(rule, profile)}>
              {ruleLabel(rule, profile)}
            </span>
            {!virtual&&<button className="button" onClick={onTest}>
              <Play size={14} />
              Simular gatilho
            </button>}
          </footer>
        </>
      ) : (
        <div className="editor-content empty-inspector">
          <Keyboard size={25} />
          <p>Este gesto ainda não tem um gatilho configurado.</p>
          {control.rules.some(r=>r.trigger==="activate")&&<p className="helper">“Ao ativar a camada” executa na ativação, não ao clicar. Adicione um gatilho de clique para esta tecla.</p>}
          <button className="button" onClick={onAdd}>
            <Plus size={15} />
            Adicionar gatilho
          </button>
        </div>
      )}
    </aside>
  );
}
