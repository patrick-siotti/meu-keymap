import { useState } from "react";
import { Check } from "lucide-react";
import { Modal } from "./Modal";
interface ProfileDialogProps {
  mode: "new" | "rename" | "duplicate";
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}
export function ProfileDialog({
  mode,
  initial,
  onClose,
  onSubmit,
}: ProfileDialogProps) {
  const [name, setName] = useState(
    mode === "new"
      ? ""
      : mode === "duplicate"
        ? `${initial} (cópia)`.slice(0, 40)
        : initial,
  );
  return (
    <Modal
      title={
        mode === "new"
          ? "Novo perfil"
          : mode === "rename"
            ? "Renomear perfil"
            : "Duplicar perfil"
      }
      onClose={onClose}
    >
      <form
        className="profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <label className="field">
          Nome do perfil
          <input
            autoFocus
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Trabalho, edição ou jogos"
          />
        </label>
        <button
          className="button primary"
          disabled={!name.trim()}
          type="submit"
        >
          <Check size={16} />
          {mode === "rename" ? "Renomear" : "Criar perfil"}
        </button>
      </form>
    </Modal>
  );
}
