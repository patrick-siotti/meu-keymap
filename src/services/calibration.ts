import { calibrationSchema } from "../../lib/calibration";
import type { Calibration, CalibrationEnvelope } from "../../lib/calibration";
async function parseResponse(response: Response): Promise<CalibrationEnvelope> {
  const data = (await response.json()) as CalibrationEnvelope & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(data.error ?? "Não foi possível salvar a identificação.");
  if (!Number.isSafeInteger(data.revision) || data.revision < 0)
    throw new Error("Revisão de identificação inválida.");
  return {
    revision: data.revision,
    document: calibrationSchema.parse(data.document),
  };
}
export async function loadCalibration(
  signal: AbortSignal,
): Promise<CalibrationEnvelope> {
  return parseResponse(await fetch("/api/device/calibration", { signal }));
}
export async function saveCalibration(
  document: Calibration,
  revision: number,
): Promise<CalibrationEnvelope> {
  return parseResponse(
    await fetch("/api/device/calibration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document, revision }),
    }),
  );
}
