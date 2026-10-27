import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  deviceInventorySchema,
  deviceEventSchema,
  isTargetDevice,
} from "../lib/device.ts";
import type { DeviceInventory } from "../lib/device.ts";
import { ProfileStore, createApiHandler } from "../server.ts";

const path = "\\\\?\\HID#VID_514C&PID_8850&MI_01&Col03#sample";
test("device filtering excludes other keyboards and similar product IDs", () => {
  assert.ok(isTargetDevice(path));
  assert.ok(isTargetDevice(path.toLowerCase()));
  for (const other of [
    path.replace("8850", "88500"),
    path.replace("514C", "1234"),
    path.replace("VID_", "OTHER_VID_"),
    "keyboard",
    "",
  ]) {
    assert.equal(isTargetDevice(other), false);
    assert.equal(
      deviceEventSchema.safeParse({
        type: "input",
        at: Date.now(),
        devicePath: other,
        kind: "keyboard",
        data: { vkey: 65, released: false },
      }).success,
      false,
    );
  }
});
test("device contracts validate read-only discovery and raw event bounds", () => {
  const inventory = {
    type: "inventory",
    at: Date.now(),
    platform: "win32",
    devices: [
      {
        path,
        kind: "keyboard",
        product: "USB Composite Device",
        manufacturer: "",
        usagePage: 1,
        usage: 6,
        inputBytes: 9,
        outputBytes: 2,
        featureBytes: 0,
        version: 256,
      },
    ],
  };
  assert.ok(deviceInventorySchema.safeParse(inventory).success);
  assert.equal(
    deviceInventorySchema.safeParse({
      ...inventory,
      devices: [{ ...inventory.devices[0], inputBytes: -1 }],
    }).success,
    false,
  );
  assert.equal(
    deviceEventSchema.safeParse({
      type: "input",
      at: Date.now(),
      devicePath: path,
      kind: "hid",
      data: { hex: "00".repeat(129) },
    }).success,
    false,
  );
  assert.equal(
    deviceEventSchema.safeParse({ type: "apply", at: Date.now() }).success,
    false,
  );
});
test("device discovery routes are read-only and foreign origins cannot start monitoring", async () => {
  let reads = 0,
    subscriptions = 0;
  const inventory: DeviceInventory = {
    type: "inventory",
    at: Date.now(),
    platform: "win32",
    devices: [],
  };
  const handler = createApiHandler(
    new ProfileStore("outputs/unused-device-test"),
    {
      inventory: async () => {
        reads++;
        return inventory;
      },
      subscribe: (res) => {
        subscriptions++;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`data: ${JSON.stringify(inventory)}\n\n`);
      },
      recent: () => [],
    },
  );
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const route of [
      "/api/device",
      "/api/device/events",
      "/api/device/recent",
    ])
      assert.equal(
        (
          await fetch(base + route, {
            headers: { Origin: "https://foreign.example" },
          })
        ).status,
        403,
      );
    assert.equal(reads, 0);
    assert.equal(subscriptions, 0);
    assert.equal(
      (await fetch(base + "/api/device", { method: "POST" })).status,
      404,
    );
    assert.equal((await fetch(base + "/api/device")).status, 200);
    assert.equal(reads, 1);
    assert.match(
      await (await fetch(base + "/api/device/events")).text(),
      /inventory/,
    );
    assert.equal(subscriptions, 1);
    assert.deepEqual(await (await fetch(base + "/api/device/recent")).json(), {
      events: [],
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
