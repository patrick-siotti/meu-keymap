import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile, rename, mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultDocument, documentSchema, parseDocument } from "./lib/model.ts";
import type { Envelope, KeymapDocument } from "./lib/model.ts";
import { SignalHub } from "./native/signals.ts";
import { DeviceBridge } from "./native/device.ts";
import type { DeviceConnection } from "./native/device.ts";
import {
  CalibrationStore,
  CalibrationConflict,
} from "./native/calibration-store.ts";
import { calibrationSchema } from "./lib/calibration.ts";
import { ConfigurationReader } from "./native/configuration.ts";
import { ApplicationService } from "./native/application.ts";
import { LocalRuntime } from "./native/runtime.ts";
import { profileSchema } from "./lib/model.ts";
import { ProfileSynchronizer } from "./native/profile-sync.ts";
import { RgbService } from "./native/rgb.ts";
import { rgbLayerSchema, staticRgbSchema } from "./lib/rgb.ts";
import { z } from "zod";
import { HardwareVerifier } from "./native/verification.ts";
import { startupStatus } from "./native/startup.ts";
import { ObsSource,obsSettingsSchema } from "./native/obs.ts";
import { ReconciliationService } from "./native/reconciliation.ts";
import { StateConflict } from "./lib/device-state.ts";
import { DesktopControl } from "./native/desktop-control.ts";
import { bindingsRecoveryInputSchema } from "./lib/bindings-recovery.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export class ProfileStore {
  directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  private maintenance = false;
  constructor(directory: string) {
    this.directory = directory;
  }
  maintain<T>(operation:()=>Promise<T>):Promise<T>{
    if(this.maintenance)return Promise.reject(new StateConflict("Perfis em manutenção; preserve o rascunho."));
    this.maintenance=true;
    const result=this.queue.catch(()=>{}).then(operation);
    this.queue=result;
    return result.finally(()=>{this.maintenance=false;});
  }
  async load(): Promise<Envelope> {
    try {
      const data: unknown = JSON.parse(
        await readFile(join(this.directory, "profiles.json"), "utf8"),
      );
      if (
        typeof data !== "object" ||
        !data ||
        !("revision" in data) ||
        !Number.isSafeInteger(data.revision) ||
        Number(data.revision) < 0 ||
        !("document" in data)
      )
        throw new Error(
          "Arquivo de perfis inválido. Preserve-o e restaure o backup.",
        );
      return {
        revision: Number(data.revision),
        document: parseDocument(data.document),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { revision: 0, document: defaultDocument() };
      throw error;
    }
  }
  save(document: KeymapDocument, revision: number): Promise<Envelope> {
    if(this.maintenance)return Promise.reject(new StateConflict("Recuperação em manutenção; preserve o rascunho e aguarde."));
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        if(this.maintenance)throw new StateConflict("Recuperação em manutenção; preserve o rascunho e aguarde.");
        const current = await this.load();
        if (current.revision !== revision)
          throw new HttpError(
            409,
            "Outra janela salvou alterações. Exporte seu rascunho antes de recarregar.",
          );
        const next = {
          revision: current.revision + 1,
          document: documentSchema.parse(document),
        };
        await mkdir(this.directory, { recursive: true });
        const temporary = join(this.directory, `profiles-${randomUUID()}.tmp`);
        await writeFile(
          temporary,
          `${JSON.stringify(next, null, 2)}\n`,
          "utf8",
        );
        try {
          await copyFile(
            join(this.directory, "profiles.json"),
            join(this.directory, "profiles.previous.json"),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(temporary, join(this.directory, "profiles.json"));
        return next;
      });
    this.queue = operation;
    return operation;
  }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new HttpError(413, "Arquivo maior que 2 MB.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}
export function createApiHandler(
  store: ProfileStore,
  device: DeviceConnection = new DeviceBridge(),
  options:{configuration?:ConfigurationReader;rgb?:RgbService;runtime?:LocalRuntime;desktop?:boolean}={},
) {
  const obs=new ObsSource();
  const signals = new SignalHub(obs);
  const calibration = new CalibrationStore(store.directory);
  const configuration=options.configuration??new ConfigurationReader(store.directory);
  const runtime=options.runtime??new LocalRuntime(device,signals);
  const application=new ApplicationService(store.directory,configuration,runtime);
  const synchronizer=new ProfileSynchronizer(store,application);
  const rgb=options.rgb??new RgbService(store.directory,configuration);
  const state=new ReconciliationService(store.directory,configuration,rgb,device,runtime);
  if(options.desktop)state.suppressAutomaticReapply();
  application.setDeviceState(state);
  application.configureRecovery(store);
  const verification=new HardwareVerifier(store.directory,device,application);
  let closing=false;
  const pending=new Set<Promise<boolean>>();
  const dispatch=async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    if (!req.url?.startsWith("/api/")) return false;
    if(closing){send(res,503,{error:"Aplicativo encerrando."});return true;}
    try {
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? ""))
        throw new HttpError(403, "Host não permitido.");
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`)
        throw new HttpError(403, "Origem não permitida.");
      const assertMaintenance=()=>{
        if(application.recoveryActive&&req.method!=="GET"&&req.url!=="/api/runtime/stop"&&req.url!=="/api/application/recover-bindings/apply")
          throw new StateConflict("Recuperação de bindings em manutenção; preserve o rascunho e aguarde.");
      };
      assertMaintenance();
      const readRequestBody=async()=>{const value=await readBody(req);assertMaintenance();return value;};
      if (req.method === "GET" && req.url === "/api/health")
        send(res, 200, {
          app: "meu-keymap",
          hardware: "bindings-available",
          execution: "available",
          build: "desktop-browser-e5-r2",
          schemaVersion: 1,
        });
      else if(req.method==="GET"&&req.url==="/api/device/state")send(res,200,await state.snapshot());
      else if(["/api/device/state/read","/api/device/state/reconcile","/api/device/state/policy","/api/device/state/recover"].includes(req.url)&&((req.method==="PUT"&&req.url.endsWith("/policy"))||(req.method==="POST"&&!req.url.endsWith("/policy")))){
        if(!req.headers["content-type"]?.startsWith("application/json"))throw new HttpError(415,"Envie application/json.");
        try{
          const body=await readRequestBody();
          if(req.url.endsWith("/read")){z.object({}).strict().parse(body);send(res,200,await state.read());}
          else if(req.url.endsWith("/policy")){const input=z.object({revision:z.number().int().nonnegative(),enabled:z.boolean()}).strict().parse(body);send(res,200,await state.policy(input.revision,input.enabled));}
          else if(req.url.endsWith("/recover")){const input=z.object({revision:z.number().int().nonnegative(),bindingsBackup:z.string(),rgbBackup:z.string(),bindingsFingerprint:z.string().regex(/^[a-f0-9]{64}$/),rgbFingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(body);send(res,200,await state.recover(input));}
          else{const input=z.object({revision:z.number().int().nonnegative()}).strict().parse(body);send(res,200,await state.reconcile(input.revision));}
        }catch(error){if(error instanceof StateConflict)throw error;throw new HttpError(400,(error as Error).message);}
      }
      else if(req.method==="GET"&&req.url==="/api/obs")send(res,200,obs.status());
      else if(req.method==="PUT"&&req.url==="/api/obs"){
        if(!req.headers["content-type"]?.startsWith("application/json"))throw new HttpError(415,"Envie application/json.");
        const parsed=obsSettingsSchema.safeParse(await readRequestBody());if(!parsed.success)throw new HttpError(400,"Configuração OBS inválida.");send(res,200,obs.configure(parsed.data));
      }
      else if(req.method==="GET"&&req.url==="/api/startup")send(res,200,await startupStatus());
      else if(req.method==="PUT"&&req.url==="/api/startup"){
        if(!req.headers["content-type"]?.startsWith("application/json"))throw new HttpError(415,"Envie application/json.");
        const input=z.object({enabled:z.boolean()}).strict().safeParse(await readRequestBody());if(!input.success)throw new HttpError(400,"Escolha ativar ou desativar a inicialização.");
        send(res,200,await startupStatus(input.data.enabled?"enable":"disable"));
      }
      else if (req.method === "GET" && req.url === "/api/profiles")
        send(res, 200, await store.load());
      else if (req.method === "GET" && req.url === "/api/signals")
        signals.subscribe(res);
      else if (req.method === "GET" && req.url === "/api/device") {
        try {
          send(res, 200, await device.inventory());
        } catch {
          throw new HttpError(
            503,
            "Não foi possível consultar o macropad no Windows.",
          );
        }
      } else if (req.method === "GET" && req.url === "/api/device/events")
        device.subscribe(res);
      else if (req.method === "GET" && req.url === "/api/device/recent")
        send(res, 200, { events: device.recent() });
      else if(req.method==="GET"&&req.url==="/api/device/configuration")send(res,200,{snapshot:await configuration.latest()});
      else if(req.method==="POST"&&req.url==="/api/device/configuration/read"){
        if(!req.headers["content-type"]?.startsWith("application/json"))throw new HttpError(415,"Envie application/json.");
        try {send(res,200,{snapshot:await configuration.read()});}
        catch(error){throw new HttpError(503,(error as Error).message);}
      }
      else if(req.method==="GET"&&req.url==="/api/device/rgb")send(res,200,{snapshot:await rgb.latest(),historical:true,live:false});
      else if(req.method==="POST"&&["/api/device/rgb/read","/api/device/rgb/apply","/api/device/rgb/static"].includes(req.url)){
        if(!req.headers["content-type"]?.startsWith("application/json"))throw new HttpError(415,"Envie application/json.");
        try{
          const body=await readRequestBody();
          if(req.url.endsWith("/read")){z.object({}).strict().parse(body);send(res,200,{snapshot:await rgb.read()});}
          else if(req.url.endsWith("/static")){const input=staticRgbSchema.parse(body);send(res,200,{snapshot:await state.applyStaticRgb(input),state:await state.snapshot()});}
          else {const input=z.object({layer:z.number().int().min(0).max(2),settings:rgbLayerSchema.refine(value=>value.mode===1,"Novas gravações aceitam somente cor estática (modo 1)."),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(body);send(res,200,{snapshot:await state.applyRgb(input.layer,input.settings,input.fingerprint),state:await state.snapshot()});}
        }catch(e){if(e instanceof StateConflict)throw e;throw new HttpError(400,(e as Error).message);}
      }
      else if(req.method==="GET"&&req.url==="/api/device/verification")send(res,200,verification.status(true));
      else if(req.method==="POST"&&["/api/device/verification/start","/api/device/verification/stop","/api/device/verification/target"].includes(req.url)){
        if(!req.headers["content-type"]?.startsWith("application/json"))throw new HttpError(415,"Envie application/json.");
        try{const body=await readRequestBody();if(req.url.endsWith("/target")){const input=z.object({layer:z.number().int().min(0).max(2),slot:z.number().int().min(1).max(25)}).strict().parse(body);send(res,200,verification.select(input.layer,input.slot));}
        else {z.object({}).strict().parse(body);send(res,200,req.url.endsWith("/start")?await verification.start():await verification.stop());}}
        catch(e){if(e instanceof StateConflict)throw e;throw new HttpError(400,(e as Error).message);}
      }
      else if(req.method==="GET"&&req.url==="/api/application/status")send(res,200,await application.status());
      else if(req.method==="POST"&&["/api/application/recover-bindings/prepare","/api/application/recover-bindings/apply"].includes(req.url)){
        if(!req.headers["content-type"]?.startsWith("application/json"))throw new HttpError(415,"Envie application/json.");
        const value=await readRequestBody();
        try{
          if(req.url.endsWith("/prepare"))send(res,200,await application.prepareBindingsRecovery(bindingsRecoveryInputSchema.parse(value)));
          else send(res,200,await application.applyBindingsRecovery(z.object({token:z.uuid()}).strict().parse(value).token));
        }catch(error){if(error instanceof StateConflict)throw error;throw new HttpError(400,(error as Error).message);}
      }
      else if(req.method==="GET"&&req.url==="/api/runtime/status")send(res,200,runtime.status());
      else if(req.method==="POST"&&["/api/application/prepare","/api/application/apply","/api/application/restore","/api/application/verify","/api/runtime/start","/api/runtime/stop"].includes(req.url)){
        if(!req.headers["content-type"]?.startsWith("application/json"))throw new HttpError(415,"Envie application/json.");
        const body=await readRequestBody();
        if(!body||typeof body!=="object")throw new HttpError(400,"Requisição inválida.");
        try{
          if(req.url==="/api/runtime/start")send(res,200,await application.start());
          else if(req.url==="/api/application/verify")send(res,200,await application.verify());
          else if(req.url==="/api/runtime/stop")send(res,200,application.stop());
          else if(req.url==="/api/application/prepare"){
            if(!("profile" in body)||!("mode" in body)||(body.mode!=="device"&&body.mode!=="local"))throw new Error("Perfil e modo obrigatórios.");
            const parsed=profileSchema.safeParse(body.profile);if(!parsed.success)throw new Error("Perfil inválido.");
            send(res,200,await application.prepare(parsed.data,body.mode as "device"|"local"));
          }else if(req.url==="/api/application/apply"){
            if(!("token" in body)||typeof body.token!=="string")throw new Error("Prepare o perfil antes de aplicar.");
            send(res,200,await application.apply(body.token));
          }else{
            if(!("backup" in body)||typeof body.backup!=="string")throw new Error("Backup obrigatório.");
            send(res,200,await application.restore(body.backup));
          }
        }catch(e){if(e instanceof StateConflict)throw e;throw new HttpError(400,(e as Error).message);}
      }
      else if (req.method === "GET" && req.url === "/api/device/calibration")
        send(res, 200, await calibration.load());
      else if (req.method === "PUT" && req.url === "/api/device/calibration") {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new HttpError(415, "Envie application/json.");
        const body = await readRequestBody();
        if (
          !body ||
          typeof body !== "object" ||
          !("revision" in body) ||
          !Number.isSafeInteger(body.revision) ||
          !("document" in body)
        )
          throw new HttpError(400, "Identificação e revisão obrigatórias.");
        const parsed = calibrationSchema.safeParse(body.document);
        if (!parsed.success)
          throw new HttpError(
            400,
            "Identificação inválida. Repita a captura do controle.",
          );
        try {
          send(
            res,
            200,
            await calibration.save(parsed.data, Number(body.revision)),
          );
        } catch (error) {
          if (error instanceof CalibrationConflict)
            throw new HttpError(409, error.message);
          throw error;
        }
      } else if (req.method === "PUT" && (req.url === "/api/profiles"||req.url==="/api/profiles/sync")) {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new HttpError(415, "Envie application/json.");
        const body = await readRequestBody();
        if (
          !body ||
          typeof body !== "object" ||
          !("revision" in body) ||
          !Number.isSafeInteger(body.revision) ||
          !("document" in body)
        )
          throw new HttpError(400, "Documento e revisão obrigatórios.");
        const parsed = documentSchema.safeParse(body.document);
        if (!parsed.success)
          throw new HttpError(
            400,
            `Configuração inválida: ${parsed.error.issues[0]?.message??"confira perfis, camadas, controles e estados."}`,
          );
        const mode="mode" in body?body.mode:undefined;
        if(req.url==="/api/profiles/sync"&&mode!=="device"&&mode!=="local")throw new HttpError(400,"Escolha onde executar o perfil antes de salvar e aplicar.");
        send(res, 200, req.url==="/api/profiles/sync"?await synchronizer.sync(parsed.data,Number(body.revision),mode as "device"|"local"):await store.save(parsed.data, Number(body.revision)));
      } else throw new HttpError(404, "Rota não encontrada.");
    } catch (error) {
      const status = error instanceof HttpError||error instanceof StateConflict ? error.status : 500;
      send(res, status, {
        error:
          status === 500
            ? "Não foi possível ler ou salvar os perfis. Preserve os arquivos em .data e confira o servidor."
            : (error as Error).message,
      });
    }
    return true;
  };
  const handler=(req:IncomingMessage,res:ServerResponse)=>{
    const operation=dispatch(req,res);pending.add(operation);
    void operation.finally(()=>pending.delete(operation));return operation;
  };
  let shutdown:Promise<void>|null=null;
  return Object.assign(handler,{start:()=>state.start(),desktopStatus:async()=>({runtime:runtime.status(),application:await application.status()}),close:()=>shutdown??=(async()=>{
    closing=true;application.stop();
    await verification.close();
    await state.close();
    await runtime.close();
    await Promise.allSettled([...pending]);
    await Promise.all([signals.close(),device.close?.()]);
    obs.close();
  })(),state});
}
async function main() {
  const production = process.argv.includes("--production");
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4173;
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Porta inválida.");
  const dataIndex = process.argv.indexOf("--data-dir");
  const dataDirectory =
    dataIndex >= 0
      ? resolve(ROOT, process.argv[dataIndex + 1] ?? "outputs/ui-test-data")
      : join(ROOT, ".data");
  const desktop=process.argv.includes("--desktop");
  const control=await DesktopControl.create(ROOT,dataDirectory,port,join(ROOT,".desktop"),desktop);
  delete process.env.KEYMAP_DESKTOP_TOKEN;
  const api = createApiHandler(new ProfileStore(dataDirectory),undefined,{desktop});
  const vite = production
    ? null
    : await (
        await import("vite")
      ).createServer({
        root: ROOT,
        server: { middlewareMode: true },
        appType: "spa",
      });
  const server = createServer(async (req, res) => {
    if(control.handle(req,res,()=>api.desktopStatus(),stop))return;
    if (await api(req, res)) return;
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const allowed =
      pathname === "/" ||
      pathname === "/favicon.svg" ||
      /^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname);
    if (!allowed || req.method !== "GET") {
      res.writeHead(404);
      res.end("Não encontrado");
      return;
    }
    try {
      let body = await readFile(
        join(ROOT, "dist", pathname === "/" ? "index.html" : pathname.slice(1)),
      );
      if(pathname==="/"&&control.browser)body=Buffer.from(control.browser.html(body.toString("utf8")));
      const type = pathname.endsWith(".js")
        ? "text/javascript"
        : pathname.endsWith(".css")
          ? "text/css"
          : pathname.endsWith(".svg")
            ? "image/svg+xml"
            : "text/html";
      res.writeHead(200, {
        "Content-Type": `${type}; charset=utf-8`,
        "X-Content-Type-Options": "nosniff",
        ...(pathname==="/"?{"Cache-Control":"no-store","X-Frame-Options":"DENY","Content-Security-Policy":"frame-ancestors 'none'","Referrer-Policy":"no-referrer"}:{}),
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Execute npm run build antes de iniciar.");
    }
  });
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    void stop();
  });
  server.listen(port, "127.0.0.1", () =>{void (async()=>{
    control.startBrowserSession(stop);
    await control.publish();api.start();console.log(
      `meu keymap · http://127.0.0.1:${port} · configuração e execução locais`,
    );})().catch(error=>{console.error(error);process.exitCode=1;void stop();});},
  );
  let stopping:Promise<void>|null=null;
  const stop = ():Promise<void> => stopping??=(async()=>{
    const httpClosed=new Promise<void>(resolveClose=>server.close(()=>resolveClose()));
    await api.close();
    server.closeAllConnections();
    await Promise.all([httpClosed,vite?.close(),control.remove()]);
    console.log("meu keymap · sessão encerrada; motor, leitores e servidor fechados");
  })();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  try{await main();}catch(error){
    if(process.argv.includes("--desktop"))await writeFile(join(ROOT,".desktop","server-error.log"),`${new Date().toISOString()} ${String(error)}\n`,{flag:"a"});
    console.error(error);process.exitCode=1;
  }
