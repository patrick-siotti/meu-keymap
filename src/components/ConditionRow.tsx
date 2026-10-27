import { Trash2, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Profile } from "../../lib/model";
import type { Condition, Source, Operator } from "../../lib/conditions";
import { sourceLabel } from "../../lib/conditions";
import { SourcePicker } from "./SourcePicker";
interface ConditionRowProps {
  condition: Extract<Condition, { kind: "test" }>;
  profile: Profile;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
  expanded?: boolean;
  onExpanded?: (expanded: boolean) => void;
}
export function ConditionRow({
  condition: c,
  profile,
  onChange,
  onRemove,
  expanded,
  onExpanded,
}: ConditionRowProps) {
  const [localOpen, setLocalOpen] = useState(true);
  const type =
    c.source.kind === "event"
      ? "text"
      : c.source.kind === "input"
        ? c.source.type
        : "boolean";
  const eventSource = c.source;
  const event =
    eventSource.kind === "event"
      ? profile.events.find((e) => e.id === eventSource.eventId)
      : null;
  const expected =
    typeof c.value === "boolean"
      ? c.value
        ? "Sim"
        : "Não"
      : (event?.states.find((s) => s.id === c.value)?.name ?? String(c.value));
  const symbols = {
    eq: "",
    neq: "≠ ",
    gt: "> ",
    gte: "≥ ",
    lt: "< ",
    lte: "≤ ",
  };
  function changeSource(source: Source) {
    const nextType =
      source.kind === "event"
        ? "text"
        : source.kind === "input"
          ? source.type
          : "boolean";
    const value =
      source.kind === "event"
        ? (profile.events.find((e) => e.id === source.eventId)
            ?.initialStateId ?? "")
        : nextType === "boolean"
          ? true
          : nextType === "number"
            ? 50
            : "";
    onChange({ ...c, source, operator: "eq", value });
  }
  return (
    <details className="condition-row" open={expanded ?? localOpen}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          const next = !(expanded ?? localOpen);
          if (onExpanded) onExpanded(next);
          else setLocalOpen(next);
        }}
      >
        <span>
          {event?.name ?? sourceLabel(c.source)}{" "}
          <strong>
            · {symbols[c.operator]}
            {expected}
          </strong>
        </span>
        <ChevronDown size={14} />
      </summary>
      <div className="condition-row-editor">
        <div className="condition-row-fields">
          <SourcePicker
            source={c.source}
            profile={profile}
            onChange={changeSource}
          />
          <div className="condition-comparison">
            {type === "boolean" ? (
              <label className="field">
                Deve ser
                <select
                  value={String(c.value)}
                  onChange={(e) =>
                    onChange({
                      ...c,
                      operator: "eq",
                      value: e.target.value === "true",
                    })
                  }
                >
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </select>
              </label>
            ) : (
              <>
                <label className="field">
                  Comparação
                  <select
                    value={c.operator}
                    onChange={(e) =>
                      onChange({ ...c, operator: e.target.value as Operator })
                    }
                  >
                    <option value="eq">Igual a</option>
                    <option value="neq">Diferente de</option>
                    {type === "number" && (
                      <>
                        <option value="gt">Maior que</option>
                        <option value="gte">Maior ou igual a</option>
                        <option value="lt">Menor que</option>
                        <option value="lte">Menor ou igual a</option>
                      </>
                    )}
                  </select>
                </label>
                <label className="field">
                  Valor
                  {event ? (
                    <select
                      value={String(c.value)}
                      onChange={(e) =>
                        onChange({ ...c, value: e.target.value })
                      }
                    >
                      {event.states.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={type === "number" ? "number" : "text"}
                      value={String(c.value)}
                      maxLength={200}
                      onChange={(e) =>
                        onChange({
                          ...c,
                          value:
                            type === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                        })
                      }
                    />
                  )}
                </label>
              </>
            )}
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="Remover condição"
          title="Remover condição"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </details>
  );
}
