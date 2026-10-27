import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  bindingSchema,
  calibrationSchema,
  conflicts,
  emptyCalibration,
  normalizedSignal,
  signalLabel,
  CHANNELS,
} from "../lib/calibration.ts";
import type { DeviceInput } from "../lib/device.ts";
import { CalibrationStore } from "../native/calibration-store.ts";
import { ProfileStore, createApiHandler } from "../server.ts";
const path = "\\\\?\\HID#VID_514C&PID_8850&MI_01&Col01#fixture";
const key = (code: number, released = false, at = 1000): DeviceInput => ({
  type: "input",
  at,
  devicePath: path,
  kind: "keyboard",
  data: { vkey: code, scan: code, flags: released ? 1 : 0, released },
});
const sample = {
  layer: 0,
  channel: "key-1:press",
  capturedAt: 1000,
  samples: [key(17), key(67), key(67, true), key(17, true)],
};
test("calibration preserves chords, ignores releases and normalizes repeated wheel or key pulses", () => {
  assert.equal(CHANNELS.length, 26);
  assert.equal(signalLabel(sample.samples), "Ctrl + C");
  assert.deepEqual(
    normalizedSignal([key(65), key(65, true), key(65), key(65, true)]),
    ["key:65:65:0:MI_01&COL01"],
  );
  assert.deepEqual(normalizedSignal([key(65, true)]), []);
  const wheel: DeviceInput = {
    type: "input",
    at: 1000,
    devicePath: path,
    kind: "mouse",
    data: { buttons: 1024, wheel: 120 },
  };
  assert.deepEqual(
    normalizedSignal([
      wheel,
      { ...wheel, data: { buttons: 1024, wheel: 240 } },
    ]),
    ["mouse:1024:1:MI_01&COL01"],
  );
  assert.deepEqual(
    normalizedSignal([{ ...wheel, data: { buttons: 2, wheel: 0 } }]),
    [],
  );
  const hid: DeviceInput = {
    type: "input",
    at: 1000,
    devicePath: path,
    kind: "hid",
    data: { hex: "040000" },
  };
  assert.deepEqual(normalizedSignal([hid]), []);
  assert.deepEqual(
    normalizedSignal([{ ...hid, data: { hex: "04E900" } }, hid]),
    ["hid:04E900:MI_01&COL01"],
  );
});
test("layer maps stay independent and duplicate signals remain explicit conflicts", () => {
  const map = {
    ...emptyCalibration(),
    fingerprint: "device",
    bindings: [
      sample,
      { ...sample, channel: "key-2:press" },
      { ...sample, layer: 1, channel: "knob-1:left" },
    ],
  };
  assert.deepEqual(conflicts(map, 0, "key-1:press"), ["key-2:press"]);
  assert.deepEqual(conflicts(map, 1, "knob-1:left"), []);
  assert.ok(calibrationSchema.safeParse(map).success);
  assert.equal(
    calibrationSchema.safeParse({ ...map, bindings: [sample, sample] }).success,
    false,
  );
  assert.equal(bindingSchema.safeParse({ ...sample, layer: 3 }).success, false);
  assert.equal(
    bindingSchema.safeParse({ ...sample, channel: "key-17:press" }).success,
    false,
  );
  assert.equal(
    bindingSchema.safeParse({ ...sample, samples: [key(65, true)] }).success,
    false,
  );
  assert.ok(
    bindingSchema.safeParse({ ...sample, channel: "layer:press" }).success,
  );
});
test("calibration saves atomically, retains backup, rejects stale writers and leaves profiles untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keymap-calibration-"));
  try {
    await writeFile(join(dir, "profiles.json"), "original profiles");
    const store = new CalibrationStore(dir);
    assert.equal((await store.load()).revision, 0);
    const map = {
      ...emptyCalibration(),
      fingerprint: "device",
      bindings: [sample],
    };
    await store.save(map, 0);
    const next = {
      ...map,
      bindings: [...map.bindings, { ...sample, layer: 1 }],
    };
    const attempts = await Promise.allSettled([
      store.save(next, 1),
      store.save(map, 1),
    ]);
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await new CalibrationStore(dir).load()).revision, 2);
    const backup = JSON.parse(
      await readFile(join(dir, "device-calibration.previous.json"), "utf8"),
    );
    assert.equal(backup.revision, 1);
    assert.equal(
      await readFile(join(dir, "profiles.json"), "utf8"),
      "original profiles",
    );
    await writeFile(join(dir, "device-calibration.json"), "broken");
    await assert.rejects(store.save(map, 2));
    assert.equal(
      await readFile(join(dir, "device-calibration.json"), "utf8"),
      "broken",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("calibration HTTP enforces revision, schema and origin before writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keymap-calibration-http-"));
  const handler = createApiHandler(new ProfileStore(dir));
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/device/calibration`;
  const body = {
    revision: 0,
    document: {
      ...emptyCalibration(),
      fingerprint: "device",
      bindings: [sample],
    },
  };
  const save = (value: unknown, origin?: string) =>
    fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(value),
    });
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await save(body, "https://foreign.example")).status, 403);
    assert.equal(
      (
        await save({
          ...body,
          document: {
            ...body.document,
            bindings: [{ ...sample, channel: "other" }],
          },
        })
      ).status,
      400,
    );
    assert.equal((await save(body)).status, 200);
    assert.equal((await save(body)).status, 409);
    const restored = await (await fetch(url)).json();
    assert.equal(restored.document.bindings[0].channel, "key-1:press");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
