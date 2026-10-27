import { Trash2 } from "lucide-react";
import { Modal } from "./Modal";
interface DeleteProfileDialogProps {
  name: string;
  onClose: () => void;
  onConfirm: () => void;
}
export function DeleteProfileDialog({
  name,
  onClose,
  onConfirm,
}: DeleteProfileDialogProps) {
  return (
    <Modal title={`Excluir perfil “${name}”?`} onClose={onClose}>
      <div className="import-confirm">
        <p>
          O perfil e suas configurações serão removidos do rascunho.
        </p>
        <div className="form-footer">
          <button autoFocus className="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="button danger-button" onClick={onConfirm}>
            <Trash2 size={15} />
            Excluir perfil
          </button>
        </div>
      </div>
    </Modal>
  );
}
