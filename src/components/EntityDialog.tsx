import { useState } from "react";
import { Check } from "lucide-react";
import { Modal } from "./Modal";
interface EntityDialogProps {
  title: string;
  label: string;
  initial?: string;
  existing: string[];
  onClose: () => void;
  onSubmit: (name: string) => void;
}
export function EntityDialog({
  title,
  label,
  initial = "",
  existing,
  onClose,
  onSubmit,
}: EntityDialogProps) {
  const [name, setName] = useState(initial),
    [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          const value = name.trim();
          if (
            !value ||
            existing.some(
              (n) => n.toLocaleLowerCase() === value.toLocaleLowerCase(),
            )
          ) {
            setError("Use um nome diferente dos existentes.");
            return;
          }
          onSubmit(value);
        }}
      >
        <label className="field">
          {label}
          <input
            autoFocus
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={!name.trim()}>
          <Check size={15} />
          Criar
        </button>
      </form>
    </Modal>
  );
}
