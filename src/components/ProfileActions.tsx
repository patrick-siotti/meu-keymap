import { useEffect, useRef, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export type ProfileOperation = "new" | "rename" | "duplicate";
interface ProfileActionsProps {
  name: string;
  canAdd: boolean;
  canDelete: boolean;
  onAction: (mode: ProfileOperation) => void;
  onDelete: () => void;
}
export function ProfileActions({
  name,
  canAdd,
  canDelete,
  onAction,
  onDelete,
}: ProfileActionsProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>(".profile-action-list button")
      ?.focus();
    const outside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("focusin", outside);
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("focusin", outside);
      window.removeEventListener("keydown", keyboard);
    };
  }, [open]);
  function choose(action: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action();
  }
  return (
    <div ref={root} className="profile-actions">
      <button
        ref={trigger}
        className="icon-button"
        aria-label={`Opções do perfil ${name}`}
        title="Opções do perfil"
        aria-expanded={open}
        aria-controls="profile-action-list"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div
          id="profile-action-list"
          className="profile-action-list"
          role="group"
          aria-label={`Ações de ${name}`}
        >
          <button onClick={() => choose(() => onAction("rename"))}>
            <Pencil size={15} />
            Editar nome
          </button>
          <button
            disabled={!canAdd}
            title={!canAdd ? "Limite de 20 perfis atingido" : undefined}
            onClick={() => choose(() => onAction("duplicate"))}
          >
            <Copy size={15} />
            Duplicar
          </button>
          <button
            className="danger-text"
            disabled={!canDelete}
            onClick={() => choose(onDelete)}
          >
            <Trash2 size={15} />
            Excluir perfil
          </button>
          {!canDelete && <small>É preciso manter pelo menos um perfil.</small>}
        </div>
      )}
    </div>
  );
}
