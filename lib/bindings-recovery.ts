import { z } from "zod";
import { bindingPacket, compileProfile } from "./bindings.ts";
import { hardwareMapSchema } from "./hardware-map.ts";
import type { HardwareMap } from "./hardware-map.ts";
import { profileSchema } from "./model.ts";
import type { Profile } from "./model.ts";
import { stateDocumentSchema } from "./device-state.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const bindingsIncidentSchema = z.object({
  flagHash: hash, ledgerHash: hash, recoveryHash: hash,
  backup: z.string().regex(/^read-[A-Za-z0-9-]+\.json$/), backupHash: hash,
}).strict();
export const bindingsRecoveryInputSchema = z.object({
  profileId: z.string().min(1), revision: z.number().int().nonnegative(), profileStamp: hash,
  fingerprint: hash, incident: bindingsIncidentSchema, operationId: z.uuid().optional(),
}).strict();
export type BindingsRecoveryInput = z.infer<typeof bindingsRecoveryInputSchema>;
export const recoveryDeploymentSchema = z.object({
  version: z.literal(1), mode: z.literal("device"), profile: profileSchema,
  fingerprint: hash, backup: z.string(), appliedAt: z.number(), restored: z.literal(false),
});
export const bindingsRecoveryJournalSchema = z.object({
  version: z.literal(1), operationId: z.uuid(), tokenHash: hash, expiresAt: z.number(),
  preparedGeneration: z.number().int().nonnegative(), preparedSession: z.uuid(),
  phase: z.enum(["prepared", "running", "failed", "committing", "complete"]),
  createdAt: z.number(), updatedAt: z.number(), error: z.string(),
  input: bindingsRecoveryInputSchema, profile: profileSchema, documentHash: hash,
  beforeState: stateDocumentSchema, beforeDeploymentHash: hash,
  baseline: hardwareMapSchema, originalBackup: hardwareMapSchema, target: hardwareMapSchema,
  steps: z.array(z.object({ slot: z.number().int(), kind: z.enum(["null", "media"]), packet: z.string(), map: hardwareMapSchema })).length(12),
  confirmed: z.number().int().min(0).max(12), writing: z.number().int().min(1).max(12).nullable(),
  commitStarted: z.boolean(), deployment: recoveryDeploymentSchema,
  observations: z.array(z.object({ revision: z.number(), fingerprint: hash, backup: z.string() })),
});
export type BindingsRecoveryJournal = z.infer<typeof bindingsRecoveryJournalSchema>;
const media = ["previous", "playPause", "next", "volumeDown", "mute", "volumeUp"] as const;
const order = [25, 20, 21, 22, 23, 24] as const;
const retentionOffsets = new Set([11, 14, 15, 17, 18, 20]);

// This is an admission rule for the known incident, never a success comparator.
export function recoveryPlan(profile: Profile, baseline: HardwareMap, original: HardwareMap) {
  hardwareMapSchema.parse(baseline); hardwareMapSchema.parse(original);
  if (baseline.protocolVersion !== 11 || original.protocolVersion !== 11 || baseline.devicePath !== original.devicePath)
    throw new Error("Recuperação exige o mesmo aparelho FB16+3/v11 do backup.");
  const compiled = compileProfile(profile, "device");
  if (compiled.errors.length) throw new Error(compiled.errors.join(" "));
  const packets = [1, 2, 3].flatMap(layer => Array.from({ length: 25 }, (_, index) => {
    const slot = index + 1;
    return bindingPacket(slot, layer, layer !== 1 ? { kind: "none" } : slot <= 3
      ? { kind: "shortcut", keys: ["Ctrl+C", "Ctrl+V", "Ctrl+X"][index]! }
      : slot >= 20 ? { kind: "media", command: media[slot - 20]! } : { kind: "none" });
  }));
  if (compiled.packets.length !== 75 || packets.some((packet, index) => packet !== compiled.packets[index]))
    throw new Error("O perfil não corresponde ao mapa aprovado de nove ações e 66 NULL.");
  const target: HardwareMap = structuredClone(baseline);
  target.entries = baseline.entries.map((entry, index) => ({ ...entry, raw: packets[index]!.replace(/^03FD/, "03FA") }));
  for (const entry of baseline.entries) {
    const wanted = target.entries.find(next => next.layer === entry.layer && next.slot === entry.slot)!;
    const old = original.entries.find(next => next.layer === entry.layer && next.slot === entry.slot)!;
    if (entry.raw === wanted.raw) continue;
    if (entry.layer !== 1 || entry.slot < 20) throw new Error("Divergência fora das seis mídias aprovadas.");
    const actual = entry.raw.match(/../g)!, expected = wanted.raw.match(/../g)!, previous = old.raw.match(/../g)!;
    if (actual.length !== 65 || actual.some((byte, offset) => byte !== expected[offset] &&
      (!retentionOffsets.has(offset) || expected[offset] !== "00" || byte !== previous[offset])))
      throw new Error("Bytes da mídia divergem do incidente de retenção conhecido.");
  }
  let current = structuredClone(baseline);
  const steps = order.flatMap(slot => (["null", "media"] as const).map(kind => {
    const packet = kind === "null" ? bindingPacket(slot, 1, { kind: "none" }) : packets[slot - 1]!;
    current = structuredClone(current);
    const entry = current.entries.find(value => value.layer === 1 && value.slot === slot)!;
    entry.raw = packet.replace(/^03FD/, "03FA");
    return { slot, kind, packet, map: structuredClone(current) };
  }));
  return { target, steps };
}

export function exactBindings(actual: HardwareMap, expected: HardwareMap): boolean {
  return actual.protocolVersion === 11 && actual.devicePath === expected.devicePath && actual.entries.length === 75 &&
    expected.entries.every(entry => actual.entries.find(next => next.layer === entry.layer && next.slot === entry.slot)?.raw === entry.raw);
}
