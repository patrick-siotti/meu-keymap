import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { bindingsRecoveryInputSchema, bindingsRecoveryJournalSchema, exactBindings, recoveryPlan } from "../lib/bindings-recovery.ts";
import type { BindingsRecoveryInput, BindingsRecoveryJournal } from "../lib/bindings-recovery.ts";
import { sameDevice, StateConflict } from "../lib/device-state.ts";
import type { StateDocument } from "../lib/device-state.ts";
import { parseHardwareMap } from "../lib/hardware-map.ts";
import type { HardwareMap } from "../lib/hardware-map.ts";
import type { Envelope } from "../lib/model.ts";
import { profileStamp } from "../lib/profile-stamp.ts";
import { mapFingerprint } from "./configuration.ts";
import type { ConfigurationReader } from "./configuration.ts";
import type { ReconciliationService } from "./reconciliation.ts";
import { fileHash, recoveryFiles, valueHash } from "./recovery-files.ts";
import type { RecoveryFiles } from "./recovery-files.ts";

export interface RecoveryProfileStore {
  load(): Promise<Envelope>;
  maintain<T>(operation: () => Promise<T>): Promise<T>;
}
const JOURNAL = "bindings-recovery.json";
const flagSchema = z.object({ at: z.number(), reason: z.string().startsWith("Bindings:"), backups: z.array(z.string()) });
function conflict(message: string): never { throw new StateConflict(message); }
const protectedState = (state: StateDocument) => ({ desired: state.desired, policy: state.policy, recovery: state.recovery, rgb: state.delivery.rgb });
const committedState = (journal: BindingsRecoveryJournal) => ({ ...protectedState(journal.beforeState), policy: { enabled: true }, recovery: null });

export class BindingsRecoveryService {
  private readonly sessionId = randomUUID();
  private inFlight: { hash: string; promise: Promise<unknown> } | null = null;
  private preparing = false;
  private files: RecoveryFiles;
  private directory: string;
  private reader: ConfigurationReader;
  private state: ReconciliationService;
  private profiles: RecoveryProfileStore;
  private enter: () => void;
  private leave: () => void;
  constructor(
    directory: string, reader: ConfigurationReader, state: ReconciliationService,
    profiles: RecoveryProfileStore, enter: () => void, leave: () => void,
    files?: RecoveryFiles,
  ) {
    this.directory = directory; this.reader = reader; this.state = state; this.profiles = profiles;
    this.enter = enter; this.leave = leave; this.files = files ?? recoveryFiles(directory);
  }

  get active() { return this.inFlight !== null; }
  private async load(): Promise<BindingsRecoveryJournal | null> {
    const text = await this.files.read(JOURNAL);
    if (text === null) return null;
    const journal = bindingsRecoveryJournalSchema.parse(JSON.parse(text));
    const plan = recoveryPlan(journal.profile, journal.baseline, journal.originalBackup);
    if (valueHash(plan.target) !== valueHash(journal.target) || valueHash(plan.steps) !== valueHash(journal.steps) ||
      journal.deployment.fingerprint !== mapFingerprint(journal.target) || journal.deployment.backup !== journal.input.incident.backup ||
      valueHash(journal.deployment.profile) !== valueHash(journal.profile)) conflict("Diário diverge do plano fechado.");
    return journal;
  }
  private async persist(journal: BindingsRecoveryJournal) {
    journal.updatedAt = Date.now();
    await this.files.write(JOURNAL, JSON.stringify(bindingsRecoveryJournalSchema.parse(journal), null, 2));
  }
  async status() {
    const journal = await this.load();
    return journal ? {
      operationId: journal.operationId, phase: journal.phase, confirmedSteps: journal.confirmed,
      lastConfirmedFingerprint: mapFingerprint(journal.confirmed ? journal.steps[journal.confirmed - 1]!.map : journal.baseline),
      state: journal.phase === "complete" ? "confirmed" : journal.phase === "prepared" ? "awaiting-apply" : "recovery-required",
      error: journal.error,
    } : null;
  }
  private async incident(input: BindingsRecoveryInput, previous?: BindingsRecoveryJournal) {
    for (const name of ["rgb-recovery.json", "application-recovery.json"])
      if (await this.files.read(name) !== null) conflict("Outra recuperação pendente; este fluxo aceita somente bindings.");
    const reference = input.incident;
    const flag = await this.files.read("device-recovery.json") ?? (previous ? await this.files.read(`device-recovery.json.resolved-${previous.operationId}`) : null);
    if (flag === null || fileHash(flag) !== reference.flagHash) conflict("Flag do incidente mudou.");
    const parsed = flagSchema.parse(JSON.parse(flag));
    if (!parsed.backups.includes(reference.backup)) conflict("Backup não pertence ao incidente aprovado.");
    const ledger = await this.files.read("device-recovery-ledger.jsonl");
    if (ledger === null) conflict("Ledger do incidente ausente.");
    const last: unknown = JSON.parse(ledger.trim().split("\n").at(-1)!);
    const pending = z.object({ pending: z.literal(true), reason: z.string(), backups: z.array(z.string()) }).safeParse(last);
    const terminal = previous?.commitStarted && z.object({ pending: z.literal(false), operationId: z.literal(previous.operationId), incident: z.literal(reference.flagHash) }).safeParse(last).success;
    if (!terminal && (fileHash(ledger) !== reference.ledgerHash || !pending.success || pending.data.reason !== parsed.reason || !pending.data.backups.includes(reference.backup)))
      conflict("Ledger não corresponde ao incidente aprovado.");
    const raw = await readFile(join(this.directory, "hardware-backups", reference.backup), "utf8");
    if (fileHash(raw) !== reference.backupHash) conflict("Backup original mudou.");
    return parseHardwareMap(JSON.parse(raw), reference.backup);
  }
  private assertState(journal: BindingsRecoveryJournal, state: StateDocument, begun: boolean) {
    if(journal.preparedGeneration!==this.reader.usb.currentGeneration())conflict("A geração USB mudou; prepare novamente.");
    const actual = valueHash(protectedState(state));
    if (actual !== valueHash(protectedState(journal.beforeState)) &&
      !(journal.commitStarted && actual === valueHash(committedState(journal)))) conflict("Desired, política ou recuperação mudou durante a operação.");
    const desired = state.desired, observed = state.observed;
    if (!desired || desired.mode !== "device" || !observed || observed.generation !== this.reader.usb.currentGeneration() ||
      !sameDevice(desired.identity, observed.identity) || desired.identity.path !== observed.identity.path ||
      observed.identity.path !== journal.baseline.devicePath) conflict("Identidade ou geração não corresponde à preparação.");
    if (begun && (state.delivery.bindings?.attempt !== journal.operationId || state.delivery.bindings.generation !== this.reader.usb.currentGeneration() ||
      state.delivery.bindings.desiredRevision !== desired.revision)) conflict("Attempt de bindings mudou.");
  }
  private async guard(journal: BindingsRecoveryJournal, begun: boolean) {
    this.reader.usb.assertCurrent();
    const document = await this.profiles.load();
    if (document.revision !== journal.input.revision || valueHash(document) !== journal.documentHash) conflict("Perfis mudaram; preserve o rascunho e prepare novamente.");
    await this.incident(journal.input, journal);
    const deployment = await this.files.read("deployment.json");
    if (fileHash(deployment ?? "") !== journal.beforeDeploymentHash &&
      !(journal.commitStarted && deployment !== null && valueHash(JSON.parse(deployment)) === valueHash(journal.deployment))) conflict("Deployment mudou.");
    const current = await this.state.store.load();
    this.assertState(journal, current, begun); this.reader.usb.assertCurrent();
    return current;
  }
  private async observe(journal: BindingsRecoveryJournal, map: HardwareMap) {
    journal.observations.push({ revision: (await this.state.store.load()).revision, fingerprint: mapFingerprint(map), backup: map.backup });
    await this.persist(journal);
  }

  async prepare(value: BindingsRecoveryInput) {
    if (this.active || this.preparing) conflict("Recuperação em andamento.");
    this.preparing = true;
    try {
      const input = bindingsRecoveryInputSchema.parse(value), previous = await this.load();
      if (input.operationId && previous?.operationId !== input.operationId) conflict("OperationId de retomada não encontrado.");
      if (!input.operationId && previous && !["prepared", "complete"].includes(previous.phase)) conflict("Retome explicitamente o operationId interrompido.");
      if (input.operationId && previous?.phase === "complete") conflict("A recuperação já terminou; consulte o status.");
      const original = await this.incident(input, input.operationId ? previous! : undefined);
      const document = await this.profiles.load(), profile = document.document.profiles.find(item => item.id === input.profileId);
      if (!profile || document.revision !== input.revision || await profileStamp(profile) !== input.profileStamp) conflict("Revisão ou stamp do perfil mudou.");
      return await this.reader.recoveryPreview(async () => {
        const map = await this.reader.read();
        if (mapFingerprint(map) !== input.fingerprint) conflict("Mapa mudou desde a revisão; nenhuma escrita permitida.");
        const state = await this.state.store.load();
        const token = randomUUID(), now = Date.now();
        let journal: BindingsRecoveryJournal;
        if (input.operationId) {
          journal = previous!;
          if (valueHash(input.incident) !== valueHash(journal.input.incident) || valueHash(document) !== journal.documentHash || valueHash(profile) !== valueHash(journal.profile)) conflict("A retomada não pode substituir o contrato do incidente.");
          // A write with a lost result can be adopted only at one of its two exact boundaries.
          const confirmedMap = journal.confirmed ? journal.steps[journal.confirmed - 1]!.map : journal.baseline;
          if (journal.writing && exactBindings(map, journal.steps[journal.writing - 1]!.map)) journal.confirmed = journal.writing;
          else if (!exactBindings(map, confirmedMap)) conflict("Mapa intermediário desconhecido; retomada recusada.");
          journal.writing = null;
          journal.input = { ...journal.input, fingerprint: input.fingerprint, operationId: journal.operationId };
          journal.preparedGeneration = this.reader.usb.currentGeneration(); journal.preparedSession = this.sessionId;
          // A new USB lease needs a fresh attempt generation, never acceptance of an old confirmation.
          this.assertState(journal, state, false);
        } else {
          if (!state.recovery || fileHash(JSON.stringify(state.recovery)) !== input.incident.recoveryHash || state.policy.enabled ||
            state.desired?.mode !== "device" || state.desired.profileHash !== input.profileStamp || valueHash(state.desired.profile) !== valueHash(profile) ||
            !state.desired.bindings || state.delivery.bindings?.confirmedByRead || !["partial", "failed"].includes(state.delivery.bindings?.status ?? "") ||
            state.recovery.reason !== flagSchema.parse(JSON.parse((await this.files.read("device-recovery.json"))!)).reason)
            conflict("Estado não corresponde ao incidente de bindings aprovado.");
          const rgb = state.delivery.rgb;
          if ((rgb && !rgb.confirmedByRead) || (state.desired.rgb && !rgb?.confirmedByRead)) conflict("Delivery RGB pendente; recuperação escopada recusada.");
          const plan = recoveryPlan(profile, map, original);
          if (state.desired.bindings.some((packet, index) => packet.replace(/^03FD/, "03FA") !== plan.target.entries[index]?.raw)) conflict("Desired não corresponde ao alvo canônico.");
          journal = {
            version: 1, operationId: randomUUID(), tokenHash: fileHash(token), expiresAt: now + 300000,
            preparedGeneration: this.reader.usb.currentGeneration(), preparedSession: this.sessionId,
            phase: "prepared", createdAt: now, updatedAt: now, error: "", input, profile, documentHash: valueHash(document),
            beforeState: state, beforeDeploymentHash: fileHash(await this.files.read("deployment.json") ?? ""),
            baseline: map, originalBackup: original, ...plan, confirmed: 0, writing: null, commitStarted: false,
            deployment: { version: 1, mode: "device", profile, fingerprint: mapFingerprint(plan.target), backup: input.incident.backup, appliedAt: now, restored: false }, observations: [],
          };
          this.assertState(journal, state, false);
          if (previous) await this.files.write(`bindings-recovery-history-${previous.operationId}.json`, JSON.stringify(previous, null, 2));
        }
        journal.tokenHash = fileHash(token); journal.expiresAt = now + 300000; journal.phase = "prepared"; journal.error = "";
        // Detect an editor save during preview before issuing a token.
        await this.guard(journal, false); await this.observe(journal, map);
        return { operationId: journal.operationId, token, expiresAt: journal.expiresAt, targetFingerprint: mapFingerprint(journal.target),
          confirmedSteps: journal.confirmed, steps: journal.steps.map(({ slot, kind, map: expected }) => ({ layer: 1, slot, kind, fingerprint: mapFingerprint(expected) })) };
      });
    } finally { this.preparing = false; }
  }
  apply(token: string): Promise<unknown> {
    const hash = fileHash(token);
    if (this.inFlight) {
      if (this.inFlight.hash !== hash) return Promise.reject(new StateConflict("Outra recuperação está em andamento."));
      return this.inFlight.promise;
    }
    const promise = this.applyToken(hash);
    this.inFlight = { hash, promise };
    void promise.finally(() => { this.inFlight = null; }).catch(() => {});
    return promise;
  }
  private async applyToken(hash: string) {
    const journal = await this.load();
    if (!journal || journal.tokenHash !== hash) conflict("Token de recuperação inválido.");
    if (journal.phase === "complete") return this.status();
    if(journal.preparedSession!==this.sessionId||journal.preparedGeneration!==this.reader.usb.currentGeneration())conflict("A sessão ou geração mudou; prepare a retomada explicitamente.");
    if (journal.phase !== "prepared" || journal.expiresAt < Date.now()) conflict("Preparação expirada ou interrompida; prepare a retomada explícita.");
    this.enter(); this.state.setBindingsMaintenance(true);
    try {
      return await this.profiles.maintain(() => this.reader.deviceOperation(async () => {
        try {
          let current = await this.reader.read();
          if (mapFingerprint(current) !== journal.input.fingerprint) conflict("O mapa mudou após a preparação.");
          let state = await this.guard(journal, false);
          journal.phase = journal.commitStarted ? "committing" : "running";
          await this.observe(journal, current); // durable intent before the first physical write
          const alreadyCommitted = journal.commitStarted && valueHash(protectedState(state)) === valueHash(committedState(journal)) &&
            state.delivery.bindings?.attempt === journal.operationId && state.delivery.bindings.confirmedByRead;
          if (!alreadyCommitted) {
            state = await this.state.store.update(state.revision, value => {
              this.assertState(journal, value, false);
              return { ...value, delivery: { ...value.delivery, bindings: {
                desiredRevision: value.desired!.revision, generation: this.reader.usb.currentGeneration(), attempt: journal.operationId,
                startedAt: Date.now(), finishedAt: null, status: "unknown", sent: false, confirmedByRead: false, error: "",
                lastConfirmation: value.delivery.bindings?.lastConfirmation ?? null,
              } } };
            });
          }
          for (let index = journal.confirmed; index < journal.steps.length; index++) {
            await this.guard(journal, true);
            const step = journal.steps[index]!;
            journal.writing = index + 1; await this.persist(journal);
            current = await this.reader.recoverBindingStep(step.packet, current, step.map, async () => { await this.guard(journal, true); });
            journal.confirmed = index + 1; journal.writing = null;
            await this.observe(journal, current);
          }
          current = await this.reader.read(); // independent final 75/75 gate
          if (!exactBindings(current, journal.target)) conflict("Mapa final divergiu dos 75 registros canônicos.");
          await this.observe(journal, current); await this.guard(journal, !alreadyCommitted);
          journal.commitStarted = true; journal.phase = "committing"; await this.persist(journal);
          await this.files.write("deployment.json", JSON.stringify(journal.deployment, null, 2));
          state = await this.guard(journal, !alreadyCommitted);
          await this.state.store.update(state.revision, value => {
            this.assertState(journal, value, !alreadyCommitted);
            if (!value.observed?.bindings || !exactBindings(value.observed.bindings.value, journal.target)) conflict("Leitura final não consta no estado persistido.");
            return { ...value, policy: { enabled: true }, recovery: null, delivery: { ...value.delivery, bindings: {
              ...value.delivery.bindings!, attempt: journal.operationId, desiredRevision: value.desired!.revision, generation: this.reader.usb.currentGeneration(),
              status: "confirmed", sent: true, confirmedByRead: true, error: "", finishedAt: Date.now(),
              lastConfirmation: { desiredRevision: value.desired!.revision, generation: this.reader.usb.currentGeneration(), at: Date.now(), fingerprint: mapFingerprint(current) },
            } } };
          });
          const verifyCore = async () => {
            const value = await this.guard(journal, true);
            if (valueHash(protectedState(value)) !== valueHash(committedState(journal)) || !value.delivery.bindings?.confirmedByRead ||
              value.delivery.bindings.status !== "confirmed" || value.delivery.bindings.lastConfirmation?.fingerprint !== mapFingerprint(journal.target) ||
              !value.observed?.bindings || !exactBindings(value.observed.bindings.value, journal.target) ||
              valueHash(JSON.parse(await this.files.read("deployment.json") ?? "null")) !== valueHash(journal.deployment)) conflict("Commit persistido incompleto; recuperação permanece pendente.");
          };
          await this.reader.usb.completeBindingsRecovery({ operationId: journal.operationId, ...journal.input.incident,
            evidence: { operationId: journal.operationId, incident: journal.input.incident, fingerprint: mapFingerprint(current), observations: journal.observations } }, verifyCore, this.files);
          journal.phase = "complete"; journal.error = ""; await this.persist(journal);
          await verifyCore(); await this.reader.usb.releaseBindingsRecovery(journal.operationId, this.files);
          this.state.bindingsRecovered();
          return this.status();
        } catch (error) {
          // No implicit hardware rollback and no change to the original incident/backup.
          journal.phase = "failed"; journal.error = String(error);
          try { await this.persist(journal); } catch { /* Last durable running/committing intent still blocks startup. */ }
          throw error;
        }
      }));
    } finally { this.state.setBindingsMaintenance(false); this.leave(); }
  }
}
