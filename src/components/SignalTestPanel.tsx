import { Radio, FlaskConical } from "lucide-react";
import type { Profile } from "../../lib/model";
import type { Runtime } from "../../lib/engine";
import { profileSources, conditionContext } from "../../lib/engine";
import { readSource, sourceKey, sourceLabel } from "../../lib/conditions";
import type { Value } from "../../lib/conditions";
interface SignalTestPanelProps {
  profile: Profile;
  runtime: Runtime;
  live: boolean;
  status: string;
  onLive: (live: boolean) => void;
  onValue: (key: string, value: Value | null) => void;
}
export function SignalTestPanel({
  profile,
  runtime,
  live,
  status,
  onLive,
  onValue,
}: SignalTestPanelProps) {
  const sources = [
    ...new Map(
      profileSources(profile)
        .filter((s) => s.kind !== "event")
        .map((s) => [sourceKey(s), s]),
    ).values(),
  ];
  if (!sources.length) return null;
  const context = conditionContext(profile, runtime);
  return (
    <details className="signal-test-panel" open>
      <summary>
        <span>
          <Radio size={15} />
          Fontes das condições
        </span>
      </summary>
      <div className="signal-test-body">
        <div className="segmented" aria-label="Origem dos valores">
          <button
            className={!live ? "active" : ""}
            onClick={() => onLive(false)}
          >
            <FlaskConical size={13} />
            Simulação
          </button>
          <button className={live ? "active" : ""} onClick={() => onLive(true)}>
            <Radio size={13} />
            Windows ao vivo
          </button>
        </div>
        {live && (status === "connecting" || status === "error") && (
          <p className="helper">
            {status === "connecting"
              ? "Conectando…"
              : status === "error"
                ? "Fonte indisponível."
                : ""}
          </p>
        )}
        <div className="signal-test-values">
          {sources.map((source) => {
            const key = sourceKey(source),
              value = readSource(source, context),
              type = source.kind === "input" ? source.type : "boolean";
            return (
              <label key={key} className="signal-test-value">
                <span>{sourceLabel(source)}</span>
                {type === "boolean" ? (
                  <select
                    aria-label={sourceLabel(source)}
                    disabled={live}
                    value={value === null ? "unknown" : String(value)}
                    onChange={(e) =>
                      onValue(
                        key,
                        e.target.value === "unknown"
                          ? null
                          : e.target.value === "true",
                      )
                    }
                  >
                    <option value="unknown">Sem dados</option>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                ) : (
                  <div className="signal-number">
                    <input
                      aria-label={sourceLabel(source)}
                      disabled={live}
                      type={type === "number" ? "number" : "text"}
                      value={value === null ? "" : String(value)}
                      placeholder="Sem dados"
                      onChange={(e) =>
                        onValue(
                          key,
                          e.target.value === ""
                            ? null
                            : type === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                        )
                      }
                    />
                    {type === "number" && typeof value === "number" && (
                      <meter
                        min={0}
                        max={100}
                        value={Math.min(100, Math.max(0, value))}
                      />
                    )}
                  </div>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </details>
  );
}
