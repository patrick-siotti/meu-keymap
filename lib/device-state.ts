import { z } from "zod";
import { profileSchema } from "./model.ts";
import { hardwareMapSchema, rawConfigurationSchema } from "./hardware-map.ts";
import { rgbLayerSchema, rgbRawSchema, rgbSnapshotSchema } from "./rgb.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const deviceIdentitySchema = z.object({
  path: z.string().min(1).max(4096), protocolVersion: z.literal(11),
  keys: z.literal(16), encoders: z.literal(3),
  serial: z.string().nullable(), container: z.string().nullable(),
  provenance: z.string(),
});
export type DeviceIdentity = z.infer<typeof deviceIdentitySchema>;
export const capabilitySchema = z.object({
  read: z.enum(["available", "unsupported", "unknown"]),
  write: z.enum(["available", "unsupported", "unknown"]),
  physical: z.enum(["available", "unsupported", "unknown", "divergent"]),
  provenance: z.string().min(1), variant: z.string(),
});
export type Capability = z.infer<typeof capabilitySchema>;
export function capabilities(): Record<string, Capability> {
  const variant = "FB 16+3 / firmware 11";
  return {
    bindings: {read:"available",write:"available",physical:"unknown",variant,provenance:"VENDOR_PROTOCOL.md; FB/FA 75 endereços e FD/read-back verificados"},
    rgb: {read:"available",write:"available",physical:"divergent",variant,provenance:"FA B0/FE B0; E4 limita novas gravações a cores estáticas explícitas. Histórico E3 com saída divergente/congelamento preservado. Read-back confirma configuração, não luz."},
    opticalState: {read:"unknown",write:"unknown",physical:"unknown",variant,provenance:"Nenhum sensor óptico ou consulta validada"},
    physicalLayer: {read:"unknown",write:"unknown",physical:"unknown",variant,provenance:"Sem consulta de camada ativa validada; marcador informa somente última camada observada"},
    pressedKeys: {read:"unknown",write:"unknown",physical:"unknown",variant,provenance:"Sem bitmap de teclas mantidas validado"},
    dynamicRgb: {read:"unknown",write:"unsupported",physical:"unknown",variant,provenance:"Efeitos e reações RGB desativados no produto por decisão E4; campos legados preservados, sem loop de escrita"},
  };
}
export const desiredSchema = z.object({
  revision: z.number().int().positive(), hash, chosenAt: z.number(),
  profile: profileSchema.nullable(), profileHash: hash.nullable(),
  mode: z.enum(["device", "local"]), identity: deviceIdentitySchema,
  bindings: z.array(z.string().regex(/^03FD[0-9A-F]{126}$/)).length(75).nullable(),
  rgb: z.array(rgbLayerSchema).length(3).nullable(),
});
export type DesiredState = z.infer<typeof desiredSchema>;
export const observedSchema = z.object({
  at: z.number(), generation: z.number().int().nonnegative(), identity: deviceIdentitySchema,
  bindings: z.object({value: hardwareMapSchema, raw: rawConfigurationSchema,fingerprint:hash}).nullable(),
  rgb: z.object({value: rgbSnapshotSchema, raw: rgbRawSchema}).nullable(),
});
export type ObservedState = z.infer<typeof observedSchema>;
const confirmationSchema = z.object({desiredRevision:z.number(),generation:z.number(),at:z.number(),fingerprint:hash});
export const domainDeliverySchema = z.object({
  desiredRevision:z.number(), generation:z.number(), attempt:z.string(), startedAt:z.number(), finishedAt:z.number().nullable(),
  status:z.enum(["unknown","sent","confirmed","divergent","failed","partial","restored"]),
  sent:z.boolean().nullable(), confirmedByRead:z.boolean(), error:z.string(),
  lastConfirmation:confirmationSchema.nullable(),
});
export type DomainDelivery = z.infer<typeof domainDeliverySchema>;
export const recoverySchema = z.object({at:z.number(),reason:z.string(),backups:z.array(z.string()),identity:deviceIdentitySchema.nullable()});
export const stateDocumentSchema = z.object({
  schemaVersion:z.literal(1), revision:z.number().int().nonnegative(),
  desired:desiredSchema.nullable(), policy:z.object({enabled:z.boolean()}),
  observed:observedSchema.nullable(), delivery:z.object({bindings:domainDeliverySchema.nullable(),rgb:domainDeliverySchema.nullable()}),
  recovery:recoverySchema.nullable(),
});
export type StateDocument = z.infer<typeof stateDocumentSchema>;
export function emptyDeviceState(): StateDocument {
  return {schemaVersion:1,revision:0,desired:null,policy:{enabled:false},observed:null,delivery:{bindings:null,rgb:null},recovery:null};
}
export function sameDevice(a: DeviceIdentity,b: DeviceIdentity): boolean {
  if(a.protocolVersion!==b.protocolVersion||a.keys!==b.keys||a.encoders!==b.encoders)return false;
  if(a.serial&&b.serial)return a.serial===b.serial;
  if(a.container&&b.container)return a.container===b.container;
  return a.path.toLowerCase()===b.path.toLowerCase();
}
export type ConnectionPhase = "disconnected"|"identifying"|"reading"|"reconciling"|"ready"|"degraded"|"recovery-required";
export interface DeviceStateSnapshot extends StateDocument {
  capabilities:Record<string,Capability>;
  session:{phase:ConnectionPhase;generation:number;identity:DeviceIdentity|null;error:string;observedCurrent:boolean};
  physicalLayer:null;
  lastObservedLayer:{layer:number;at:number;generation:number;provenance:string}|null;
  physicalOutputPending:string;
  differences:{bindings:number|null;rgbBanks:number|null};
  readStatus:{bindings:{current:boolean;error:string};rgb:{current:boolean;error:string}};
}
export class StateConflict extends Error { readonly status=409; }
