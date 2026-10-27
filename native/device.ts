import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ServerResponse } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { deviceInventorySchema, deviceEventSchema } from "../lib/device.ts";
import { ChildLifecycle } from "./child-lifecycle.ts";
import type {
  DeviceInventory,
  DeviceInput,
  DeviceEvent,
} from "../lib/device.ts";
const execute = promisify(execFile);
const script = fileURLToPath(new URL("./read-device.ps1", import.meta.url));
const args = ["-NoProfile", "-NonInteractive", "-File", script];
export interface DeviceConnection {
  inventory(): Promise<DeviceInventory>;
  subscribe(res: ServerResponse): void;
  recent(): DeviceInput[];
  observe?(listener:(event:DeviceEvent)=>void):()=>void;
  close?():Promise<void>;
}
export class DeviceBridge implements DeviceConnection {
  private clients = new Set<ServerResponse>();
  private observers=new Set<(event:DeviceEvent)=>void>();
  private worker: ChildProcessWithoutNullStreams | null = null;
  private inputs: DeviceInput[] = [];
  private pending: Promise<DeviceInventory> | null = null;
  private children=new ChildLifecycle();
  recent() {
    return [...this.inputs];
  }
  inventory(): Promise<DeviceInventory> {
    if (process.platform !== "win32")
      return Promise.resolve({
        type: "inventory",
        at: Date.now(),
        platform: process.platform,
        devices: [],
      });
    if (!this.pending) {
      this.pending = execute("powershell.exe", [...args, "-Once"], {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 512000,
      })
        .then(({ stdout }) =>
          deviceInventorySchema.parse(JSON.parse(stdout.trim())),
        )
        .finally(() => {
          this.pending = null;
        });
    }
    return this.pending;
  }
  subscribe(res: ServerResponse) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": meu keymap device input\n\n");
    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
      if (!this.clients.size&&!this.observers.size) this.stop();
    });
    if (!this.worker) this.start();
  }
  private publish(event: DeviceEvent) {
    if (event.type === "input")
      this.inputs = [event, ...this.inputs].slice(0, 100);
    for (const client of this.clients)
      client.write(`data: ${JSON.stringify(event)}\n\n`);
    for(const observer of this.observers)observer(event);
  }
  observe(listener:(event:DeviceEvent)=>void){this.observers.add(listener);if(!this.worker)this.start();return()=>{this.observers.delete(listener);if(!this.clients.size&&!this.observers.size)this.stop();};}
  private error(message: string) {
    this.publish({ type: "error", at: Date.now(), message });
  }
  private start() {
    if (process.platform !== "win32") {
      this.error("Este leitor requer Windows.");
      return;
    }
    let buffer = "";
    const worker = spawn(
      "powershell.exe",
      [...args, "-KeymapOwnerPid", String(process.pid)],
      { windowsHide: true, stdio: "pipe" },
    );
    this.worker = worker;
    this.children.track(worker);
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk: string) => {
      if (this.worker !== worker) return;
      buffer += chunk;
      if (buffer.length > 512000) {
        this.error("O leitor excedeu o limite de resposta.");
        this.stop();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        try {
          const result = deviceEventSchema.safeParse(JSON.parse(line));
          if (result.success) this.publish(result.data);
        } catch {}
      }
    });
    worker.stderr.on("data", () => {
      if (this.worker === worker)
        this.error("O Windows não conseguiu iniciar o monitor do macropad.");
    });
    worker.on("error", () => {
      if (this.worker === worker) {
        this.worker = null;
        this.error("Não foi possível abrir o leitor local.");
      }
    });
    worker.on("exit", () => {
      if (this.worker === worker) {
        this.worker = null;
        this.error("O monitor do macropad foi encerrado.");
      }
    });
  }
  stop() {
    const worker = this.worker;
    this.worker = null;
    worker?.kill();
  }
  async close(){
    for(const client of this.clients)client.end();this.clients.clear();this.observers.clear();
    this.stop();await this.children.close();
    await this.pending?.catch(()=>{});
  }
}
