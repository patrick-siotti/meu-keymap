import { z } from "zod";
export function isTargetDevice(path: string): boolean {
  return /(?:^|[#\\])VID_514C&PID_8850(?:[&#\\]|$)/i.test(path);
}
const pathSchema = z
  .string()
  .max(4096)
  .refine(isTargetDevice, "Dispositivo fora do macropad selecionado");
export const deviceInventorySchema = z.object({
  type: z.literal("inventory"),
  at: z.number().int().positive(),
  platform: z.string().max(30),
  devices: z
    .array(
      z.object({
        path: pathSchema,
        kind: z.enum(["keyboard", "mouse", "hid"]),
        product: z.string().max(300),
        manufacturer: z.string().max(300),
        serial:z.string().max(300).optional(),
        usagePage: z.number().int().min(0).max(65535),
        usage: z.number().int().min(0).max(65535),
        inputBytes: z.number().int().min(0).max(65535),
        outputBytes: z.number().int().min(0).max(65535),
        featureBytes: z.number().int().min(0).max(65535),
        version: z.number().int().min(0).max(65535),
      }),
    )
    .max(100),
});
export const deviceInputSchema = z.object({
  type: z.literal("input"),
  at: z.number().int().positive(),
  devicePath: pathSchema,
  kind: z.enum(["keyboard", "mouse", "hid"]),
  data: z.record(
    z.string().max(40),
    z.union([z.number().finite(), z.boolean(), z.string().max(256)]),
  ),
});
export const deviceEventSchema = z.discriminatedUnion("type", [
  deviceInventorySchema,
  deviceInputSchema,
  z.object({ type: z.literal("heartbeat"), at: z.number().int().positive() }),
  z.object({
    type: z.literal("error"),
    at: z.number().int().positive(),
    message: z.string().max(1000),
  }),
]);
export type DeviceInventory = z.infer<typeof deviceInventorySchema>;
export type DeviceEvent = z.infer<typeof deviceEventSchema>;
export type DeviceInput = Extract<DeviceEvent, { type: "input" }>;
export function inputDescription(input: DeviceInput): string {
  if (input.kind === "keyboard")
    return `Teclado · código ${input.data.vkey} · ${input.data.released ? "soltar" : "pressionar"}`;
  if (input.kind === "mouse")
    return `Mouse · botões ${input.data.buttons} · roda ${input.data.wheel}`;
  return `HID · ${input.data.reportBytes} bytes · ${input.data.hex}`;
}
