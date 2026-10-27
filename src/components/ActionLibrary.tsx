import { useState } from "react";
import {
  Search,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import { CATALOG } from "../../lib/catalog";
import { actionLabel } from "../../lib/model";
import type { Action } from "../../lib/model";
import { Modal } from "./Modal";
import { CustomActionForm } from "./CustomActionForm";
import { actionPresentation } from "../../lib/action-presentation";
import { ActionIcon } from "./ActionIcon";
import type { ApplicationMode } from "../../lib/bindings";
interface ActionLibraryProps {
  current: Action;
  onSelect: (action: Action, label: string,customName?:boolean) => void;
  onClose: () => void;
  custom?: boolean;
  showLabel?: boolean;
  initialLabel?: string;
  mode?: ApplicationMode;
}
export function ActionLibrary({
  current,
  onSelect,
  onClose,
  custom = false,
  showLabel = true,
  initialLabel = "",
  mode,
}: ActionLibraryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [creating, setCreating] = useState(custom);
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const items = CATALOG.filter(
    (i) =>
      (category === "Todas" || i.category === category) &&
      normalize(
        `${i.title} ${i.description} ${i.context ?? ""} ${actionLabel(i.action)}`,
      ).includes(normalize(query)),
  );
  return (
    <Modal
      wide
      title="O que este controle vai fazer?"
      onClose={onClose}
    >
      <div className="library-mode">
        <button
          className={!creating ? "selected" : ""}
          onClick={() => setCreating(false)}
        >
          <Search size={16} />
          Biblioteca
        </button>
        <button
          className={creating ? "selected" : ""}
          onClick={() => setCreating(true)}
        >
          <Plus size={16} />
          Criar ação
        </button>
      </div>
      {creating ? (
        <CustomActionForm
          initial={current}
          onApply={(action,label)=>onSelect(action,label,!!label)}
          showLabel={showLabel}
          initialLabel={initialLabel}
          mode={mode}
        />
      ) : (
        <>
          <label className="search-box">
            <Search size={18} />
            <input
              autoFocus
              aria-label="Buscar ações"
              placeholder="Buscar ação, atalho ou função…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>buscar</kbd>
          </label>
          <div className="library-categories" aria-label="Categorias">
            {["Todas", ...new Set(CATALOG.map(item => item.category))].map((c) => (
              <button
                key={c}
                className={category === c ? "active" : ""}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="library-results">
            <div className="results-label">
              {items.length} ações disponíveis
            </div>
            {items.length ? (
              items.map((item) => (
                <button
                  key={item.id}
                  className="action-result"
                  onClick={() => onSelect(item.action, item.title)}
                >
                  <span className="result-icon">
                    <ActionIcon name={actionPresentation(item.action).icon} size={18}/>
                  </span>
                  <span className="result-copy">
                    <strong>{item.title}</strong>
                    {item.category === "Explorador" ? <small>Explorador de Arquivos{item.context?.includes("Windows 11") && " · Windows 11"}</small>
                      : item.category === "Navegador" ? <small>Microsoft Edge</small>
                      : item.context?.startsWith("Windows 11") ? <small>Windows 11</small> : null}
                  </span>
                  <span className="result-shortcut">
                    {item.action.kind === "shortcut"
                      ? item.action.keys
                      : item.category}
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))
            ) : (
              <div className="empty-results">
                <Search size={24} />
                <h3>Nenhuma ação encontrada</h3>
                <p>Tente outro termo ou crie um atalho personalizado.</p>
                <button className="button" onClick={() => setCreating(true)}>
                  <Plus size={16} />
                  Criar ação
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
