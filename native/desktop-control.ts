import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { processBirth } from "./usb-coordinator.ts";
import { BrowserSession } from "./browser-session.ts";

export interface DesktopIdentity {
  app: "meu-keymap";
  version: 1;
  instance: string;
  root: string;
  dataDirectory: string;
  port: number;
  pid: number;
  birth: string;
  mode: "desktop" | "technical";
}
export class DesktopControl {
  readonly identity: DesktopIdentity;
  private token: string;
  private path: string;
  private stopping = false;
  browser:BrowserSession|null=null;
  startBrowserSession(shutdown:()=>Promise<void>){if(this.identity.mode==="desktop")this.browser??=new BrowserSession(this.identity.port,shutdown);}
  constructor(identity: DesktopIdentity, directory: string, token = randomBytes(32).toString("hex")) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Token desktop inválido.");
    this.identity = identity;
    this.token = token;
    this.path = join(directory, `server-${identity.port}.json`);
  }
  static async create(root: string, dataDirectory: string, port: number, directory: string, desktop: boolean) {
    const birth = await processBirth(process.pid);
    if (!birth) throw new Error("Não foi possível confirmar a identidade do servidor.");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      // Windows ignores POSIX modes. Only the current user and SYSTEM get this directory.
      await promisify(execFile)("icacls.exe", [directory, "/inheritance:r", "/grant:r",
        `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`, "/grant:r", "*S-1-5-18:(OI)(CI)F"], { windowsHide: true });
    }
    return new DesktopControl({ app: "meu-keymap", version: 1, instance: randomUUID(), root, dataDirectory,
      port, pid: process.pid, birth, mode: desktop ? "desktop" : "technical" }, directory, process.env.KEYMAP_DESKTOP_TOKEN);
  }
  async publish() {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ ...this.identity, token: this.token }), { mode: 0o600, flag: "wx" });
    await rename(temporary, this.path);
  }
  async remove() {
    this.browser?.close();
    try {
      const current = JSON.parse(await readFile(this.path, "utf8"));
      if (current.instance === this.identity.instance) await rm(this.path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  handle(req: IncomingMessage, res: ServerResponse, status: () => unknown, shutdown: () => Promise<void>): boolean {
    if(this.browser?.handle(req,res))return true;
    if (!req.url?.startsWith("/api/desktop/")) return false;
    const provided = req.headers["x-keymap-desktop-token"];
    const validToken = typeof provided === "string" && /^[a-f0-9]{64}$/.test(provided)
      && timingSafeEqual(Buffer.from(provided), Buffer.from(this.token));
    const valid = req.socket.remoteAddress === "127.0.0.1"
      && req.headers.host === `127.0.0.1:${this.identity.port}` && !req.headers.origin && validToken;
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (!valid) { send(403, { error: "Controle desktop não autorizado." }); return true; }
    if (req.method === "GET" && req.url === "/api/desktop/status") {
      void Promise.resolve().then(status).then(value=>send(200, { ...this.identity, stopping: this.stopping, browser:this.browser?.snapshot()??null, status: value }))
        .catch(()=>send(503,{error:"Estado local indisponível; preserve os dados."}));
    } else if(req.method==="POST"&&req.url==="/api/desktop/open"){
      this.browser?.opened();send(200,{url:`http://127.0.0.1:${this.identity.port}/`});
    } else if (req.method === "POST" && req.url === "/api/desktop/shutdown") {
      if (this.stopping) send(409, { error: "Encerramento em andamento." });
      else {
        this.stopping = true;
        send(202, { instance: this.identity.instance, stopping: true });
        // Complete the acknowledgement before closing all HTTP connections.
        setImmediate(() => { void shutdown().catch(error => { console.error("Falha no encerramento:", error); process.exitCode = 1; }); });
      }
    } else send(404, { error: "Controle inexistente." });
    return true;
  }
}
