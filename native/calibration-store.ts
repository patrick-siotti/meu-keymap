import { readFile, writeFile, mkdir, copyFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { calibrationSchema, emptyCalibration } from "../lib/calibration.ts";
import type { Calibration, CalibrationEnvelope } from "../lib/calibration.ts";
export class CalibrationConflict extends Error {}
export class CalibrationStore {
  private queue: Promise<unknown> = Promise.resolve();
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  async load(): Promise<CalibrationEnvelope> {
    try {
      const data = JSON.parse(
        await readFile(join(this.directory, "device-calibration.json"), "utf8"),
      ) as CalibrationEnvelope;
      if (!Number.isSafeInteger(data.revision) || data.revision < 0)
        throw new Error("Revisão de identificação inválida");
      return {
        revision: data.revision,
        document: calibrationSchema.parse(data.document),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { revision: 0, document: emptyCalibration() };
      throw error;
    }
  }
  save(document: Calibration, revision: number): Promise<CalibrationEnvelope> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const current = await this.load();
        if (current.revision !== revision)
          throw new CalibrationConflict(
            "Outra janela salvou a identificação. Descarte esta tentativa e reabra a tela antes de continuar.",
          );
        const next = {
          revision: current.revision + 1,
          document: calibrationSchema.parse(document),
        };
        await mkdir(this.directory, { recursive: true });
        const temporary = join(
          this.directory,
          `calibration-${randomUUID()}.tmp`,
        );
        await writeFile(
          temporary,
          JSON.stringify(next, null, 2) + "\n",
          "utf8",
        );
        try {
          await copyFile(
            join(this.directory, "device-calibration.json"),
            join(this.directory, "device-calibration.previous.json"),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(
          temporary,
          join(this.directory, "device-calibration.json"),
        );
        return next;
      });
    this.queue = task;
    return task;
  }
}
