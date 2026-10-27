import { z } from "zod";
import { deviceInputSchema } from "./device.ts";
import type { DeviceInput, DeviceInventory } from "./device.ts";
export const CHANNELS = [
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `key-${i + 1}:press`,
    label: `Tecla ${String(i + 1).padStart(2, "0")}`,
  })),
  ...Array.from({ length: 3 }, (_, i) =>
    (["left", "press", "right"] as const).map((action) => ({
      id: `knob-${i + 1}:${action}`,
      label: `Encoder ${i + 1} · ${action === "left" ? "girar à esquerda" : action === "right" ? "girar à direita" : "clique"}`,
    })),
  ).flat(),
  { id: "layer:press", label: "Botão de trocar camada" },
];
export function channelLabel(channel: string): string {
  return CHANNELS.find((c) => c.id === channel)?.label ?? channel;
}
export function deviceFingerprint(inventory: DeviceInventory): string {
  return `514C:8850|${inventory.devices
    .map((d) =>
      [
        d.kind,
        d.usagePage,
        d.usage,
        d.inputBytes,
        d.outputBytes,
        d.version,
      ].join(":"),
    )
    .sort()
    .join("|")}`;
}
export function normalizedSignal(samples: DeviceInput[]): string[] {
  const result: string[] = [];
  for (const sample of samples) {
    const collection =
      sample.devicePath
        .match(/MI_[0-9A-F]{2}(?:&COL[0-9A-F]{2})?/i)?.[0]
        .toUpperCase() ?? "HID";
    let key = "";
    if (
      sample.kind === "keyboard" &&
      sample.data.released === false &&
      typeof sample.data.vkey === "number" &&
      sample.data.vkey > 0 &&
      sample.data.vkey < 255
    )
      key = `key:${sample.data.vkey}:${sample.data.scan ?? 0}:${Number(sample.data.flags ?? 0) & 6}`;
    if (sample.kind === "mouse") {
      const flags = Number(sample.data.buttons ?? 0) & 0xd55;
      if (flags)
        key = `mouse:${flags}:${Math.sign(Number(sample.data.wheel ?? 0))}`;
    }
    if (sample.kind === "hid" && typeof sample.data.hex === "string") {
      const hex = sample.data.hex.toUpperCase();
      if (/^(?:[0-9A-F]{2})+$/.test(hex) && !/^..(?:00)*$/.test(hex))
        key = `hid:${hex}`;
    }
    if (key) key += `:${collection}`;
    if (key && result.at(-1) !== key) result.push(key);
  }
  return result;
}
export function signalSignature(samples: DeviceInput[]): string {
  return JSON.stringify(normalizedSignal(samples));
}
function keyName(key: number): string {
  const names: Record<number, string> = {
    16: "Shift",
    17: "Ctrl",
    18: "Alt",
    91: "Win",
    92: "Win",
    13: "Enter",
    27: "Esc",
    32: "Espaço",
    9: "Tab",
    8: "Backspace",
    37: "←",
    38: "↑",
    39: "→",
    40: "↓",
    46: "Delete",
  };
  return (
    names[key] ??
    (key >= 48 && key <= 90
      ? String.fromCharCode(key)
      : key >= 112 && key <= 135
        ? `F${key - 111}`
        : `código ${key}`)
  );
}
export function signalLabel(samples: DeviceInput[]): string {
  return normalizedSignal(samples)
    .map((key) => {
      const [kind, first, second] = key.split(":");
      if (kind === "key") return keyName(Number(first));
      if (kind === "mouse")
        return Number(first) & 0xc00
          ? `Roda ${Number(second) > 0 ? "+" : "−"}`
          : `Botão do mouse ${first}`;
      return `HID ${first?.slice(0, 24)}${(first?.length ?? 0) > 24 ? "…" : ""}`;
    })
    .join(" + ");
}
export const bindingSchema = z
  .object({
    layer: z.number().int().min(0).max(2),
    channel: z
      .string()
      .refine((id) => CHANNELS.some((c) => c.id === id), "Controle inválido"),
    capturedAt: z.number().int().positive(),
    samples: z.array(deviceInputSchema).min(1).max(64),
  })
  .refine(
    (v) => normalizedSignal(v.samples).length > 0,
    "Captura sem sinal de ativação",
  );
export type DeviceBinding = z.infer<typeof bindingSchema>;
export const calibrationSchema = z
  .object({
    version: z.literal(1),
    fingerprint: z.string().max(2048),
    layerSwitch: z.enum(["unknown", "internal"]).default("unknown"),
    bindings: z.array(bindingSchema).max(78),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.bindings.map((b) => `${b.layer}:${b.channel}`)).size !==
      value.bindings.length
    )
      ctx.addIssue({ code: "custom", message: "Controle duplicado" });
    if (value.bindings.length && !value.fingerprint)
      ctx.addIssue({
        code: "custom",
        message: "Identificação do aparelho obrigatória",
      });
  });
export type Calibration = z.infer<typeof calibrationSchema>;
export interface CalibrationEnvelope {
  revision: number;
  document: Calibration;
}
export function emptyCalibration(): Calibration {
  return { version: 1, fingerprint: "", layerSwitch: "unknown", bindings: [] };
}
export function conflicts(
  calibration: Calibration,
  layer: number,
  channel: string,
): string[] {
  const binding = calibration.bindings.find(
    (b) => b.channel === channel && b.layer === layer,
  );
  if (!binding) return [];
  const signature = signalSignature(binding.samples);
  return calibration.bindings
    .filter(
      (b) =>
        b.layer === layer &&
        b.channel !== channel &&
        signalSignature(b.samples) === signature,
    )
    .map((b) => b.channel);
}
