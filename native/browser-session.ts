import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

// A live HTTP stream survives background tabs and cancelled beforeunload dialogs.
// Loss of the last stream is a disconnect, not proof of the physical X gesture.
export class BrowserSession {
  private tickets = new Map<string, number>();
  private secret = randomBytes(32).toString("hex");
  private clients = new Set<ServerResponse>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private keepalive: ReturnType<typeof setInterval>;
  private deadline: number | null = null;
  private attached = false;
  private closed = false;
  private cookieName: string;
  private port:number;
  private shutdown:()=>Promise<void>;
  private graceMs:number;
  private initialMs:number;
  constructor(port: number, shutdown: () => Promise<void>, graceMs = 15_000, initialMs = 60_000) {
    this.port=port;this.shutdown=shutdown;this.graceMs=graceMs;this.initialMs=initialMs;
    this.cookieName = `meu_keymap_tab_${port}`;
    this.arm(initialMs);
    this.keepalive = setInterval(() => { for (const client of this.clients) client.write(": keepalive\n\n"); }, 5000);
    this.keepalive.unref();
  }
  private arm(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => { this.timer = null; this.deadline = null; void this.shutdown().catch(error => console.error("Falha ao encerrar sessão de abas:", error)); }, ms);
    this.timer.unref();
  }
  opened() { if (!this.closed && !this.clients.size) this.arm(this.attached ? this.graceMs : this.initialMs); }
  html(source: string): string {
    for (const [ticket, expiry] of this.tickets) if (expiry < Date.now()) this.tickets.delete(ticket);
    if (this.tickets.size >= 128) this.tickets.delete(this.tickets.keys().next().value!);
    const ticket = randomBytes(32).toString("hex"); this.tickets.set(ticket, Date.now() + this.initialMs);
    this.opened();
    return source.replace("</head>", `<meta name="keymap-browser-session" content="${ticket}"></head>`);
  }
  snapshot() { return { tabs: this.clients.size, attached: this.attached, deadline: this.deadline, graceMs: this.graceMs, initialMs: this.initialMs }; }
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.url !== "/api/desktop/bootstrap" && req.url !== "/api/desktop/tabs") return false;
    const origin = `http://127.0.0.1:${this.port}`;
    const sameOrigin = req.socket.remoteAddress === "127.0.0.1" && req.headers.host === `127.0.0.1:${this.port}`
      && req.headers["sec-fetch-site"] === "same-origin" && (!req.headers.origin || req.headers.origin === origin);
    const deny = () => { res.writeHead(403, { "Cache-Control": "no-store" }); res.end("Sessão de aba não autorizada."); };
    if (this.closed || !sameOrigin) { deny(); return true; }
    if (req.url.endsWith("bootstrap")) {
      const ticket = req.headers["x-keymap-tab-ticket"];
      if (req.method !== "POST" || req.headers.origin !== origin || typeof ticket !== "string" || (this.tickets.get(ticket) ?? 0) <= Date.now()) { deny(); return true; }
      this.tickets.delete(ticket);
      res.writeHead(204, { "Set-Cookie": `${this.cookieName}=${this.secret}; HttpOnly; SameSite=Strict; Path=/api/desktop/tabs`, "Cache-Control": "no-store" }); res.end();
      return true;
    }
    const cookie = req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${this.cookieName}=`))?.slice(this.cookieName.length + 1);
    if (req.method !== "GET" || !cookie || !/^[a-f0-9]{64}$/.test(cookie) || !timingSafeEqual(Buffer.from(cookie), Buffer.from(this.secret))) { deny(); return true; }
    if (this.timer) clearTimeout(this.timer); this.timer = null; this.deadline = null; this.attached = true;
    this.clients.add(res);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write('retry: 1000\ndata: {"connected":true}\n\n');
    res.on("close", () => { this.clients.delete(res); if (!this.closed && !this.clients.size) this.arm(this.graceMs); });
    return true;
  }
  close() {
    this.closed = true; if (this.timer) clearTimeout(this.timer); clearInterval(this.keepalive); this.timer = null;
    this.tickets.clear(); for (const client of this.clients) client.end(); this.clients.clear();
  }
}
