import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const fileHash = (text: string) => createHash("sha256").update(text).digest("hex");
export const valueHash = (value: unknown) => fileHash(JSON.stringify(value));
export interface RecoveryFiles {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  archive(from: string, to: string): Promise<void>;
  append(name: string, text: string): Promise<void>;
}
export function recoveryFiles(directory: string): RecoveryFiles {
  const path = (name: string) => {
    if (!/^[A-Za-z0-9.-]+$/.test(name)) throw new Error("Nome de registro inválido.");
    return join(directory, name);
  };
  return {
    async read(name) {
      try { return await readFile(path(name), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async write(name, text) {
      await mkdir(directory, { recursive: true });
      const temporary = path(`bindings-recovery-${randomUUID()}.tmp`);
      await writeFile(temporary, text, { flag: "wx", flush: true });
      await rename(temporary, path(name));
    },
    async archive(from, to) {
      if (await this.read(to) !== null) throw new Error("Arquivo de evidência já existe.");
      await rename(path(from), path(to));
    },
    async append(name, text) { await appendFile(path(name), text, { flush: true }); },
  };
}
