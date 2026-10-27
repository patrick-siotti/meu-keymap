import { deviceInventorySchema } from "../../lib/device";
import type { DeviceInventory } from "../../lib/device";
export async function loadDevice(
  signal: AbortSignal,
): Promise<DeviceInventory> {
  const response = await fetch("/api/device", { signal });
  if (!response.ok)
    throw new Error(
      "Não foi possível consultar o macropad. Verifique o servidor local.",
    );
  return deviceInventorySchema.parse(await response.json());
}
