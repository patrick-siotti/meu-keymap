import { Folder, Plus } from "lucide-react";
import type { KeymapDocument } from "../../lib/model";
import { ProfileActions } from "./ProfileActions";
import type { ProfileOperation } from "./ProfileActions";

interface ProfileBarProps {
  document: KeymapDocument;
  onSelect: (id: string) => void;
  onAction: (mode: ProfileOperation) => void;
  onDelete: () => void;
}
export function ProfileBar({
  document,
  onSelect,
  onAction,
  onDelete,
}: ProfileBarProps) {
  const canAdd = document.profiles.length < 20;
  return (
    <section className="profile-bar" aria-label="Perfis">
      <span className="profile-bar-label">Perfis</span>
      <div className="profile-tabs" role="group" aria-label="Selecionar perfil">
        {document.profiles.map((profile) => {
          const active = document.activeProfile === profile.id;
          return (
            <div
              key={profile.id}
              className={`profile-item ${active ? "active" : ""}`}
            >
              <button
                className="profile-tab"
                title={profile.name}
                aria-pressed={active}
                aria-label={`Perfil ${profile.name}`}
                onClick={() => {
                  if (!active) onSelect(profile.id);
                }}
              >
                <Folder size={15} />
                <span>{profile.name}</span>
              </button>
              {active && (
                <ProfileActions
                  name={profile.name}
                  canAdd={canAdd}
                  canDelete={document.profiles.length > 1}
                  onAction={onAction}
                  onDelete={onDelete}
                />
              )}
            </div>
          );
        })}
        <button
          className="text-button new-profile"
          disabled={!canAdd}
          onClick={() => onAction("new")}
        >
          <Plus size={15} />
          Novo perfil
        </button>
      </div>
    </section>
  );
}
