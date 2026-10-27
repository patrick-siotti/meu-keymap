import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { observationsSchema } from "../lib/conditions.ts";
import type { Observations } from "../lib/conditions.ts";
import type { ObsSource } from "./obs.ts";
import { ChildLifecycle } from "./child-lifecycle.ts";
export class SignalHub {
  private obs:ObsSource|null;private latestWindows:Observations|null=null;
  constructor(obs:ObsSource|null=null){this.obs=obs;obs?.onChange(()=>this.publish(this.latestWindows??{at:Date.now(),processNames:null,values:{}}));}
  private clients = new Set<ServerResponse>();
  private observers=new Set<(sample:Observations)=>void>();
  private worker: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private children=new ChildLifecycle();
  subscribe(res: ServerResponse) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": meu keymap signals\n\n");
    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
      if (!this.clients.size&&!this.observers.size) this.stop();
    });
    if (!this.worker) this.start();
  }
  private publish(data: unknown) {
    const source=observationsSchema.safeParse(data);if(!source.success)return;
    this.latestWindows=source.data;const fresh=Date.now()-source.data.at<=2500;
    data={at:Date.now(),processNames:fresh?source.data.processNames:null,values:{...(fresh?source.data.values:{}),...(this.obs?.snapshot()??{})},...(source.data.error?{error:source.data.error}:{})};
    for (const client of this.clients)
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    const parsed=observationsSchema.safeParse(data);if(parsed.success)for(const observer of this.observers)observer(parsed.data);
  }
  observe(listener:(sample:Observations)=>void){this.observers.add(listener);if(!this.worker)this.start();return()=>{this.observers.delete(listener);if(!this.clients.size&&!this.observers.size)this.stop();};}
  private unavailable(message: string) {
    this.publish({
      at: Date.now(),
      processNames: null,
      values: {},
      error: message,
    });
  }
  private start() {
    if (process.platform !== "win32") {
      this.unavailable("Leitura Windows indisponível neste sistema.");
      return;
    }
    const script = fileURLToPath(
      new URL("./read-signals.ps1", import.meta.url),
    );
    this.buffer = "";
    const worker = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        script,
        "-KeymapOwnerPid",
        String(process.pid),
      ],
      { windowsHide: true, stdio: "pipe" },
    );
    this.worker = worker;
    this.children.track(worker);
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk: string) => {
      if (this.worker !== worker) return;
      this.buffer += chunk;
      if (this.buffer.length > 1_000_000) {
        this.unavailable("Resposta da fonte excedeu o limite.");
        this.stop();
        return;
      }
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        try {
          const parsed = observationsSchema.safeParse(JSON.parse(line));
          if (parsed.success) this.publish(parsed.data);
        } catch {}
      }
    });
    worker.stderr.on("data", () => {
      if (this.worker === worker)
        this.unavailable("Não foi possível iniciar a leitura Windows.");
    });
    worker.on("error", () => {
      if (this.worker === worker) {
        this.unavailable("Leitor Windows indisponível.");
        this.worker = null;
      }
    });
    worker.on("exit", () => {
      if (this.worker === worker) {
        this.worker = null;
        if (this.clients.size)
          this.unavailable("A conexão com a fonte Windows foi encerrada.");
      }
    });
  }
  stop() {
    const worker = this.worker;
    this.worker = null;
    worker?.kill();
    this.buffer = "";
  }
  async close(){
    for(const client of this.clients)client.end();this.clients.clear();this.observers.clear();
    this.stop();await this.children.close();
  }
}
