import { always } from "../lib/conditions.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultDocument as legacyDocument } from "../lib/legacy-model.ts";
import {
  defaultDocument,
  documentSchema,
  parseDocument,
  makeProfile,
  makeEvent,
  makeRule,
  emptyEffect,
} from "../lib/model.ts";
import {
  startRuntime,
  simulate,
  simulateRule,
  changeEvent,
  activateLayer,
  eventState,
  ledState,
  previewEventState,
} from "../lib/engine.ts";

test("v1 migration preserves shortcuts, layers, names, colors and flag references", () => {
  const old = legacyDocument();
  old.profiles[0]!.name = "Meu perfil";
  old.profiles[0]!.layers[1]!.controls[2]!.events.double.action = {
    kind: "shortcut",
    keys: "Ctrl+Alt+H",
  };
  old.profiles[0]!.layers[1]!.controls[2]!.events.double.when = {
    id: "Gravando",
    value: true,
  };
  const next = parseDocument(old),
    p = next.profiles[0]!;
  assert.equal(next.version, 3);
  assert.equal(p.name, "Meu perfil");
  assert.equal(p.layers.length, 3);
  assert.equal(p.layers[0]!.controls.length, 19);
  const rule = p.layers[1]!.controls[2]!.rules.find(
    (r) => r.trigger === "double",
  )!;
  assert.deepEqual(rule.behavior.action, {
    kind: "shortcut",
    keys: "Ctrl+Alt+H",
  });
  assert.equal(rule.condition.kind, "test");
  assert.equal(p.events[0]!.states.length, 2);
  assert.equal(
    p.layers[0]!.controls[0]!.rules.find((r) => r.trigger === "activate")!
      .behavior.light.effect.colors[0],
    old.profiles[0]!.layers[0]!.controls[0]!.led.color,
  );
  assert.ok(documentSchema.safeParse(next).success);
});
test("independent triggers and partner-key/modifier rules do not overwrite or fire together", () => {
  const p = makeProfile("p", "Teste");
  const c = p.layers[0]!.controls[0]!;
  const simple = c.rules.find((r) => r.trigger === "press")!;
  simple.behavior.action = { kind: "shortcut", keys: "Ctrl+C" };
  const double = makeRule("double", "double");
  double.behavior.action = { kind: "shortcut", keys: "Ctrl+V" };
  const chord = makeRule("chord", "press", {
    controlId: "key-2",
    modifiers: [],
  });
  chord.behavior.action = { kind: "shortcut", keys: "Alt+H" };
  const modified = makeRule("modified", "press", {
    controlId: "",
    modifiers: ["Shift"],
  });
  modified.behavior.action = { kind: "shortcut", keys: "Ctrl+S" };
  c.rules.push(double, chord, modified);
  const initial = startRuntime(p, 0);
  const normal = simulate(p, initial, 0, c.id, "press", undefined, 10);
  assert.ok(normal.logs.some((l) => l.includes("Ctrl + C")));
  assert.ok(!normal.logs.some((l) => l.includes("Alt + H")));
  const combo = simulate(
    p,
    initial,
    0,
    c.id,
    "press",
    { controlId: "key-2", modifiers: [] },
    10,
  );
  assert.ok(combo.logs.some((l) => l.includes("Alt + H")));
  assert.ok(!combo.logs.some((l) => l.includes("Ctrl + C")));
  const shift = simulate(
    p,
    initial,
    0,
    c.id,
    "press",
    { controlId: "", modifiers: ["Shift"] },
    10,
  );
  assert.ok(shift.logs.some((l) => l.includes("Ctrl + S")));
  assert.equal(
    p.layers[1]!.controls[0]!.rules.find((r) => r.trigger === "press")!.behavior
      .action.kind,
    "none",
  );
});
test("custom event cycles through any states and another key resets it; entry action runs once", () => {
  const p = makeProfile("p", "Teste"),
    e = makeEvent("record", "Gravando");
  e.states = [
    {
      id: "stopped",
      name: "Parado",
      action: { kind: "none" },
      lights: [],
      condition: always(),
    },
    {
      id: "recording",
      name: "Gravando",
      action: { kind: "shortcut", keys: "Ctrl+R" },
      lights: [],
      condition: always(),
    },
    {
      id: "paused",
      name: "Pausado",
      action: { kind: "none" },
      lights: [],
      condition: always(),
    },
  ];
  e.initialStateId = "stopped";
  p.events = [e];
  const a = p.layers[0]!.controls[0]!.rules.find((r) => r.trigger === "press")!,
    b = p.layers[0]!.controls[1]!.rules.find((r) => r.trigger === "press")!;
  a.behavior.transition = { eventId: e.id, operation: "next", stateId: "" };
  b.behavior.transition = { eventId: e.id, operation: "reset", stateId: "" };
  let state = startRuntime(p, 0);
  state = simulateRule(p, state, 0, "key-1", a, 0);
  assert.equal(eventState(p, state, e.id), "recording");
  assert.equal(state.logs.filter((l) => l.includes("Ctrl + R")).length, 1);
  const same = changeEvent(p, state, e.id, "recording", 10);
  assert.equal(same.logs.length, state.logs.length);
  state = simulateRule(p, state, 0, "key-1", a, 20);
  assert.equal(eventState(p, state, e.id), "paused");
  state = simulateRule(p, state, 0, "key-2", b, 30);
  assert.equal(eventState(p, state, e.id), "stopped");
});
test("legacy event lighting is inert across event and layer changes", () => {
  const p = makeProfile("p", "Teste"),
    event = p.events[0]!;
  for (const s of event.states)
    s.lights = [
      {
        id: "r",
        target: "key-2",
        layer: "all",
        effect: {
          ...emptyEffect(),
          mode: s.id === "active" ? "blink" : "off",
          colors: ["#ff0000"],
          periodMs: 1000,
        },
      },
    ];
  let state = startRuntime(p, 0);
  assert.equal(ledState(p, state, 0, "key-2", 0).on, false);
  state = changeEvent(p, state, event.id, "active", 0);
  assert.equal(ledState(p, state, 0, "key-2", 100).on, false);
  assert.equal(ledState(p, state, 0, "key-2", 600).on, false);
  state = activateLayer(p, state, 1, 1000);
  assert.equal(ledState(p, state, 1, "key-2", 1100).color, "#555158");
  state = changeEvent(p, state, event.id, "inactive", 1200);
  assert.equal(ledState(p, state, 0, "key-2", 1200).on, false);
  assert.equal(ledState(p, state, 1, "key-2", 1200).on, false);
});
test("legacy pulse, cycle and breathing data never run in the active engine", () => {
  const p = makeProfile("p", "Teste"),
    r = p.layers[0]!.controls[0]!.rules.find((r) => r.trigger === "press")!;
  r.behavior.light = {
    target: "key-2",
    effect: {
      ...emptyEffect(),
      mode: "pulse",
      colors: ["#ff0000"],
      durationMs: 500,
    },
  };
  let state = startRuntime(p, 0);
  const before = ledState(p, state, 0, "key-2", 0);
  state = simulateRule(p, state, 0, "key-1", r, 0);
  assert.equal(ledState(p, state, 0, "key-2", 100).color, "#555158");
  assert.deepEqual(ledState(p, state, 0, "key-2", 600), before);
  r.behavior.light.effect = {
    ...emptyEffect(),
    mode: "cycle",
    colors: ["#ff0000", "#00ff00"],
    periodMs: 1000,
  };
  state = simulateRule(p, state, 0, "key-1", r, 0);
  assert.equal(ledState(p, state, 0, "key-2", 1100).color, "#555158");
  r.behavior.light.effect.mode = "breathe";
  state = simulateRule(p, state, 0, "key-1", r, 0);
  assert.equal(ledState(p, state, 0, "key-2", 0).brightness, 0);
  assert.equal(ledState(p, state, 0, "key-2", 500).brightness, 0);
});
test("conditions use input snapshot and event preview ignores legacy lighting", () => {
  const p = makeProfile("p", "Teste"),
    c = p.layers[0]!.controls[0]!,
    r = c.rules.find((r) => r.trigger === "press")!,
    event = p.events[0]!;
  r.behavior.transition = { eventId: event.id, operation: "next", stateId: "" };
  const conditional = makeRule("conditional", "press");
  conditional.behavior.when = { eventId: event.id, stateId: "active" };
  conditional.behavior.action = { kind: "shortcut", keys: "Ctrl+H" };
  c.rules.push(conditional);
  let state = startRuntime(p, 0);
  state = simulate(p, state, 0, c.id, "press", undefined, 0);
  assert.ok(!state.logs.some((l) => l.includes("Ctrl + H")));
  event.states[1]!.lights = [
    {
      id: "light",
      target: "key-3",
      layer: 0,
      effect: { ...emptyEffect(), mode: "on", colors: ["#0000ff"] },
    },
  ];
  state = previewEventState(p, state, event.id, "active", 10);
  assert.equal(ledState(p, state, 0, "key-3", 10).color, "#555158");
});
test("schema rejects dangling event/state references, self-combinations and duplicate states", () => {
  const doc = defaultDocument(),
    p = doc.profiles[0]!,
    r = p.layers[0]!.controls[0]!.rules[0]!;
  r.behavior.when = { eventId: "missing", stateId: "active" };
  assert.equal(documentSchema.safeParse(doc).success, false);
  r.behavior.when = { eventId: "", stateId: "" };
  r.qualifier.controlId = "key-1";
  assert.equal(documentSchema.safeParse(doc).success, false);
  r.qualifier.controlId = "";
  p.events[0]!.states[1]!.name = p.events[0]!.states[0]!.name;
  assert.equal(documentSchema.safeParse(doc).success, false);
});
