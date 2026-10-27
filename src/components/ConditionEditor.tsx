import { Plus, Trash2, GitBranch } from "lucide-react";
import { useState } from "react";
import type { Profile } from "../../lib/model";
import type { Condition } from "../../lib/conditions";
import { ConditionRow } from "./ConditionRow";
interface ConditionEditorProps {
  condition: Condition;
  profile: Profile;
  onChange: (condition: Condition) => void;
  depth?: number;
  onRemove?: () => void;
  expanded?: boolean;
  onExpanded?: (expanded: boolean) => void;
}
export function ConditionEditor({
  condition,
  profile,
  onChange,
  depth = 0,
  onRemove,
  expanded,
  onExpanded,
}: ConditionEditorProps) {
  const [expandedId, setExpandedId] = useState("");
  if (condition.kind === "test")
    return (
      <ConditionRow
        condition={condition}
        profile={profile}
        onChange={onChange}
        expanded={expanded}
        onExpanded={onExpanded}
        onRemove={
          onRemove ??
          (() => onChange({ id: condition.id, kind: "all", children: [] }))
        }
      />
    );
  const group = condition;
  function add() {
    const event = profile.events[0];
    const leaf: Condition = {
      id: crypto.randomUUID(),
      kind: "test",
      source: event
        ? { kind: "event", eventId: event.id }
        : {
            kind: "input",
            key: `custom.${crypto.randomUUID()}`,
            label: "Nova fonte",
            type: "boolean",
            provider: "custom",
          },
      operator: "eq",
      value: event ? event.initialStateId : true,
    };
    onChange({ ...group, children: [...group.children, leaf] });
    setExpandedId(leaf.id);
  }
  return (
    <div
      className={`condition-group ${depth ? "nested" : ""}`}
      role="group"
      aria-label={
        group.kind === "all" ? "Todas as condições" : "Qualquer condição"
      }
    >
      <div className="condition-group-header">
        <select
          aria-label="Combinar condições"
          value={group.kind}
          onChange={(e) =>
            onChange({ ...group, kind: e.target.value as "all" | "any" })
          }
        >
          <option value="all">Todas as condições · E</option>
          <option value="any">Qualquer condição · OU</option>
        </select>
        {onRemove && (
          <button
            className="icon-button"
            aria-label="Remover grupo"
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {!group.children.length && (
        <p className="condition-empty">
          {group.kind === "all"
            ? "Sem condições: sempre permite."
            : "Adicione uma condição para permitir este ramo."}
        </p>
      )}
      <div className="condition-children">
        {group.children.map((child, index) => (
          <div key={child.id}>
            <span className="condition-join">
              {index > 0 ? (group.kind === "all" ? "E" : "OU") : ""}
            </span>
            <ConditionEditor
              condition={child}
              profile={profile}
              depth={depth + 1}
              expanded={expandedId === child.id}
              onExpanded={(open) => setExpandedId(open ? child.id : "")}
              onChange={(next) =>
                onChange({
                  ...group,
                  children: group.children.map((c) =>
                    c.id === child.id ? next : c,
                  ),
                })
              }
              onRemove={() =>
                onChange({
                  ...group,
                  children: group.children.filter((c) => c.id !== child.id),
                })
              }
            />
          </div>
        ))}
      </div>
      <div className="condition-add">
        <button
          className="text-button"
          onClick={add}
          disabled={group.children.length >= 64}
        >
          <Plus size={14} />
          Condição
        </button>
        {depth < 4 && (
          <button
            className="text-button"
            onClick={() =>
              onChange({
                ...group,
                children: [
                  ...group.children,
                  { id: crypto.randomUUID(), kind: "all", children: [] },
                ],
              })
            }
            disabled={group.children.length >= 64}
          >
            <GitBranch size={14} />
            Grupo E/OU
          </button>
        )}
      </div>
    </div>
  );
}
