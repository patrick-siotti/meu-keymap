import type { HeldBinding } from "./bindings.ts";
import type { DeviceInput } from "./device.ts";
import { HARDWARE_CHANNELS } from "./hardware-map.ts";
import type { DecodedMarker } from "./marker-decoder.ts";

export class HeldInput {
  private readonly bindings: Map<number, HeldBinding>;
  private readonly pendingReleases = new Map<number, { path: string; marker: DecodedMarker }>();

  constructor(bindings: readonly HeldBinding[]) {
    this.bindings = new Map(bindings.map(binding => [binding.virtualKey, binding]));
  }

  reset() {
    this.pendingReleases.clear();
  }

  releaseAll(): DecodedMarker[] {
    const markers = [...this.pendingReleases.values()].map(entry => entry.marker);
    this.reset();
    return markers;
  }

  accept(input: DeviceInput): { marker: DecodedMarker; released: boolean } | null {
    if (input.kind !== "keyboard") return null;
    const key = Number(input.data.vkey);
    const released = input.data.released === true;
    const binding = this.bindings.get(key);
    if (!binding) return null;
    const active = this.pendingReleases.get(key);
    const path = input.devicePath.toLowerCase();
    if (released) {
      if (active?.path !== path) return null;
      this.pendingReleases.delete(key);
      return { marker: active.marker, released: true };
    }
    if (active) return null;
    const channel = HARDWARE_CHANNELS[binding.index % 25]!;
    const modifiers = (["Ctrl", "Shift", "Alt", "Win"] as const).filter((_, index) =>
      Number(input.data.modifiers ?? 0) & (1 << index));
    const marker: DecodedMarker = {
      index: binding.index, layer: Math.floor(binding.index / 25),
      controlId: channel.controlId, trigger: channel.trigger, modifiers,
    };
    this.pendingReleases.set(key, { path, marker });
    return { marker, released: false };
  }
}
