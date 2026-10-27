import { test } from "node:test";
import assert from "node:assert/strict";
import {
  always,
  conditionSchema,
  evaluateCondition,
  INPUTS,
  readSource,
} from "../lib/conditions.ts";
import type { Condition, ConditionContext, Source } from "../lib/conditions.ts";
import { actionSchema } from "../lib/actions.ts";
import {
  makeProfile,
  makeRule,
  makeEvent,
  emptyBehavior,
  emptyEffect,
  defaultDocument,
  documentSchema,
  parseDocument,
} from "../lib/model.ts";
import {
  activateLayer,
  startRuntime,
  ledState,
  simulate,
  simulateRule,
  previewEventState,
  eventState,
} from "../lib/engine.ts";
import { eventInUse } from "../lib/profile-references.ts";

const leaf = (
  source: Source,
  value: boolean | string | number,
  operator: "eq" | "neq" | "gte" = "eq",
): Condition => ({
  id: crypto.randomUUID(),
  kind: "test",
  source,
  value,
  operator,
});
const processSource: Source = { kind: "process", name: "obs64.exe" };
const safety: Source = { kind: "key", controlId: "key-2" };
const mic = INPUTS[0]!,
  muted = INPUTS[1]!;
const ctx = (): ConditionContext => ({
  events: { recording: "idle" },
  held: [],
  signals: {},
  observed: null,
  now: 1000,
});

test("nested E / OU preserves unknown, numeric comparisons and negative conditions", () => {
  const context = ctx();
  const condition: Condition = {
    id: "root",
    kind: "all",
    children: [
      leaf(processSource, true),
      {
        id: "or",
        kind: "any",
        children: [leaf(muted, false), leaf(mic, 20, "gte")],
      },
    ],
  };
  assert.equal(evaluateCondition(condition, context), null);
  assert.equal(evaluateCondition(leaf(muted, true, "neq"), context), null);
  assert.equal(evaluateCondition(leaf(safety, false), context), null);
  context.observed = {
    at: 1000,
    processNames: ["obs64"],
    values: { [mic.key]: 30 },
  };
  assert.equal(evaluateCondition(condition, context), true);
  context.observed.values[mic.key] = 5;
  assert.equal(evaluateCondition(condition, context), null);
  context.observed.values[muted.key] = true;
  assert.equal(evaluateCondition(condition, context), false);
  context.observed.processNames = [];
  assert.equal(evaluateCondition(leaf(processSource, false), context), true);
  context.now = 4000;
  assert.equal(readSource(mic, context), null);
  assert.equal(evaluateCondition(leaf(processSource, false), context), null);
});

test("Então / Senão use the same input snapshot and scripts remain simulation text", () => {
  const p = makeProfile("p", "Teste"),
    c = p.layers[0]!.controls[0]!;
  const r = makeRule("conditional", "press");
  r.condition = {
    id: "root",
    kind: "all",
    children: [
      leaf(processSource, true),
      leaf(muted, false),
      leaf(safety, true),
    ],
  };
  r.behavior.action = {
    kind: "command",
    runner: "powershell",
    path: "C:\\Scripts\\compress.ps1",
    arguments: ["C:\\Videos\\my video.mp4", "$(never-execute)"],
    cwd: "C:\\Videos",
    timeoutMs: 60000,
  };
  r.otherwise = emptyBehavior();
  r.otherwise.light.effect = {
    ...emptyEffect(),
    mode: "blink",
    colors: ["#ff0000"],
  };
  c.rules = [r];
  const initial = startRuntime(p, 1000);
  const rejected = simulate(p, initial, 0, c.id, "press", undefined, 1000);
  assert.equal(ledState(p, rejected, 0, c.id, 1000).color, "#555158");
  assert.ok(!rejected.logs.some((l) => l.includes("Comando preparado")));
  assert.deepEqual(
    simulate(p, initial, 0, c.id, "double", undefined, 1000).lights,
    initial.lights,
  );
  initial.signals = {
    "process:obs64": true,
    [muted.key]: false,
    "key:key-2": true,
  };
  const accepted = simulateRule(p, initial, 0, c.id, r, 1000);
  assert.ok(
    accepted.logs.some(
      (l) =>
        l.includes("Comando preparado, sem executar") &&
        l.includes("my video.mp4"),
    ),
  );
  assert.equal(accepted.lights["0:key-1"], undefined);
  const event = makeEvent("recording", "Gravando");
  p.events = [event];
  const a = makeRule("first", "press"),
    b = makeRule("second", "press");
  a.behavior.transition = { eventId: event.id, operation: "next", stateId: "" };
  b.condition = leaf({ kind: "event", eventId: event.id }, "inactive");
  b.behavior.action = { kind: "text", value: "snapshot original" };
  c.rules = [a, b];
  const next = simulate(
    p,
    startRuntime(p, 1000),
    0,
    c.id,
    "press",
    undefined,
    1000,
  );
  assert.equal(eventState(p, next, event.id), "active");
  assert.ok(next.logs.some((l) => l.includes("snapshot original")));
});

test("state guard keeps prior state and applies Senão, including layer changes", () => {
  const p = makeProfile("p", "Teste");
  const e = makeEvent("recording", "Gravando");
  p.events = [e];
  const state = e.states[1]!;
  state.condition = leaf(safety, true);
  state.otherwise = { action: { kind: "layer", value: 1 }, lights: [] };
  let runtime = previewEventState(
    p,
    startRuntime(p, 1000),
    e.id,
    state.id,
    1000,
  );
  assert.equal(eventState(p, runtime, e.id), e.initialStateId);
  assert.equal(runtime.layer, 1);
  runtime.signals["key:key-2"] = true;
  runtime = previewEventState(p, runtime, e.id, state.id, 1000);
  assert.equal(eventState(p, runtime, e.id), state.id);
});

test("legacy intensity and visibility remain inert as signal values change", () => {
  const p = makeProfile("p", "Teste"),
    c = p.layers[0]!.controls[0]!;
  const r = makeRule("initial", "activate");
  r.behavior.light.effect = {
    ...emptyEffect(),
    mode: "on",
    brightness: 80,
    intensity: { source: mic, inputMin: 10, inputMax: 90 },
    visibility: leaf(muted, false),
  };
  c.rules = [r];
  const runtime = startRuntime(p, 1000);
  runtime.observed = {
    at: 1000,
    processNames: [],
    values: { [mic.key]: 30, [muted.key]: false },
  };
  assert.equal(ledState(p, runtime, 0, c.id, 1000).brightness, 0);
  runtime.observed.values[mic.key] = 70;
  assert.equal(ledState(p, runtime, 0, c.id, 1000).brightness, 0);
  runtime.observed.values[muted.key] = true;
  assert.equal(ledState(p, runtime, 0, c.id, 1000).on, false);
  runtime.observed.values[muted.key] = false;
  runtime.observed.values[mic.key] = 120;
  assert.equal(ledState(p, runtime, 0, c.id, 1000).brightness, 0);
  runtime.observed.values[mic.key] = -10;
  assert.equal(ledState(p, runtime, 0, c.id, 1000).brightness, 0);
  assert.equal(ledState(p, runtime, 0, c.id, 4000).on, false);
  r.behavior.light.effect.intensity.inputMax = 10;
  assert.equal(
    ledState(p, activateLayer(p, runtime, 0, 1000), 0, c.id, 1000).on,
    false,
  );
});

test("v2 data migrates old conditions in memory without changing the original document", () => {
  const old = structuredClone(defaultDocument()) as unknown as Record<
    string,
    unknown
  >;
  const raw = JSON.parse(JSON.stringify(old)) as ReturnType<
    typeof defaultDocument
  >;
  const r = raw.profiles[0]!.layers[0]!.controls[0]!.rules[0]!;
  const e = raw.profiles[0]!.events[0]!;
  r.behavior.when = { eventId: e.id, stateId: e.states[0]!.id };
  const v2 = { ...raw, version: 2 };
  const original = JSON.stringify(v2);
  const next = parseDocument(v2),
    migrated = next.profiles[0]!.layers[0]!.controls[0]!.rules[0]!;
  assert.equal(next.version, 3);
  assert.equal(migrated.condition.kind, "test");
  assert.equal(migrated.behavior.when.eventId, "");
  assert.equal(JSON.stringify(v2), original);
});

test("validation bounds conditions, resolves states and rejects malformed command configuration", () => {
  let nested: Condition = always();
  for (let i = 0; i < 8; i++)
    nested = { id: String(i), kind: "all", children: [nested] };
  assert.equal(conditionSchema.safeParse(nested).success, false);
  assert.equal(
    conditionSchema.safeParse(leaf(muted, 15, "gte")).success,
    false,
  );
  const doc = defaultDocument(),
    p = doc.profiles[0]!,
    r = p.layers[0]!.controls[0]!.rules[0]!;
  r.condition = leaf(
    { kind: "event", eventId: p.events[0]!.id },
    "absent-state",
  );
  assert.equal(documentSchema.safeParse(doc).success, false);
  const command = {
    kind: "command",
    runner: "program",
    path: "C:\\Tools\\app.exe",
    arguments: ["one argument with spaces", "literal $()"],
    cwd: "",
    timeoutMs: 30000,
  };
  assert.equal(actionSchema.safeParse(command).success, true);
  assert.equal(
    actionSchema.safeParse({ ...command, path: "bad\npath" }).success,
    false,
  );
  assert.equal(
    actionSchema.safeParse({ ...command, arguments: ["\0"] }).success,
    false,
  );
});

test("event references include nested conditions and both light branches", () => {
  const p = makeProfile("p", "Teste"),
    e = makeEvent("guard", "Proteção");
  p.events = [e];
  const r = p.layers[0]!.controls[0]!.rules[0]!;
  assert.equal(eventInUse(p, e.id), false);
  r.otherwise = emptyBehavior();
  r.otherwise.light.effect.visibility = {
    id: "group",
    kind: "any",
    children: [leaf({ kind: "event", eventId: e.id }, "active")],
  };
  assert.equal(eventInUse(p, e.id), true);
  assert.equal(eventInUse(p, e.id, "active"), true);
  assert.equal(eventInUse(p, e.id, "inactive"), false);
});
