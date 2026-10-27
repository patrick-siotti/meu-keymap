import type { CommandAction } from "../../lib/model";
interface CommandFieldsProps {
  command: CommandAction;
  onChange: (command: CommandAction) => void;
}
export function CommandFields({ command, onChange }: CommandFieldsProps) {
  return (
    <div className="command-fields">
      <label className="field">
        Executar como
        <select
          value={command.runner}
          onChange={(e) =>
            onChange({
              ...command,
              runner: e.target.value as CommandAction["runner"],
            })
          }
        >
          <option value="program">Programa / executável</option>
          <option value="powershell">Script PowerShell (.ps1)</option>
          <option value="python">Script Python (.py)</option>
          <option value="batch">Script de lote (.bat / .cmd)</option>
        </select>
      </label>
      <label className="field">
        {command.runner === "program" ? "Programa" : "Caminho do script"}
        <input
          required
          value={command.path}
          maxLength={1024}
          placeholder={
            command.runner === "program"
              ? "Ex.: C:\\Programas\\ffmpeg.exe"
              : "Ex.: C:\\Scripts\\compactar-video.ps1"
          }
          onChange={(e) => onChange({ ...command, path: e.target.value })}
        />
      </label>
      <label className="field">
        Argumentos · um por linha
        <textarea
          rows={4}
          value={command.arguments.join("\n")}
          placeholder={"C:\\Videos\\entrada.mp4\nC:\\Videos\\compactado.mp4"}
          onChange={(e) =>
            onChange({ ...command, arguments: e.target.value.split("\n") })
          }
        />
      </label>
      <div className="form-row">
        <label className="field">
          Pasta de trabalho
          <input
            value={command.cwd}
            maxLength={1024}
            placeholder="Padrão do aplicativo"
            onChange={(e) => onChange({ ...command, cwd: e.target.value })}
          />
        </label>
        <label className="field">
          Tempo máximo (segundos)
          <input
            type="number"
            min={1}
            max={3600}
            value={command.timeoutMs / 1000}
            onChange={(e) =>
              onChange({
                ...command,
                timeoutMs: Math.max(
                  1000,
                  Math.min(3600000, Number(e.target.value) * 1000),
                ),
              })
            }
          />
        </label>
      </div>
    </div>
  );
}
