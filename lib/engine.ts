import { actionLabel, ruleLabel,controlName } from "./model.ts";
import { commandPreview } from "./actions.ts";
import {
  conditionSources,
  evaluateCondition,
  readSource,
  conditionCount,
} from "./conditions.ts";
import type {
  ConditionContext,
  Observations,
  Source,
  Value,
} from "./conditions.ts";
import type {
  Action,
  Behavior,
  LightEffect,
  Profile,
  Qualifier,
  Rule,
  Trigger,
} from "./model.ts";
export interface ActiveLight {
  effect: LightEffect;
  since: number;
  previous: ActiveLight | null;
}
export interface Runtime {
  layer: number;
  eventStates: Record<string, string>;
  lights: Record<string, ActiveLight>;
  logs: string[];
  signals: Record<string, Value | null>;
  held: string[];
  observed: Observations | null;
  effects?: Action[];
}
export interface LedState {
  on: boolean;
  color: string;
  brightness: number;
}
export function freshRuntime(): Runtime {
  return {
    layer: 0,
    eventStates: {},
    lights: {},
    logs: [],
    signals: {},
    held: [],
    observed: null,
  };
}
export function conditionContext(
  profile: Profile,
  state: Runtime,
  now = Date.now(),
): ConditionContext {
  return {
    events: Object.fromEntries(
      profile.events.map((e) => [e.id, eventState(profile, state, e.id)]),
    ),
    held: state.held,
    signals: state.signals,
    observed: state.observed,
    now,
  };
}
export function profileSources(profile: Profile): Source[] {
  const result: Source[] = [];
  for(const layer of profile.layers)for(const control of layer.controls)for(const rule of control.rules)result.push(...conditionSources(rule.condition));
  for(const event of profile.events)for(const state of event.states)result.push(...conditionSources(state.condition));
  return result;
}
function log(state: Runtime, text: string) {
  state.logs = [text, ...state.logs].slice(0, 40);
}
export function eventState(
  profile: Profile,
  state: Runtime,
  eventId: string,
): string {
  const event = profile.events.find((e) => e.id === eventId);
  const current = state.eventStates[eventId];
  return event?.states.some((s) => s.id === current)
    ? current!
    : (event?.initialStateId ?? "");
}
function sample(
  light: ActiveLight | undefined,
  now: number,
  context: ConditionContext,
): LedState {
  if (!light) return { on: false, color: "#555158", brightness: 0 };
  const e = light.effect,
    elapsed = Math.max(0, now - light.since);
  if (e.mode === "pulse" && elapsed >= e.durationMs)
    return sample(light.previous ?? undefined, now, context);
  if (evaluateCondition(e.visibility, context) !== true)
    return { on: false, color: e.colors[0]!, brightness: 0 };
  const raw = e.intensity.source
    ? readSource(e.intensity.source, context)
    : null;
  if (
    e.intensity.source &&
    (typeof raw !== "number" ||
      !Number.isFinite(raw) ||
      e.intensity.inputMax <= e.intensity.inputMin)
  )
    return { on: false, color: e.colors[0]!, brightness: 0 };
  const maximum = e.intensity.source
    ? e.brightness *
      Math.min(
        1,
        Math.max(
          0,
          (Number(raw) - e.intensity.inputMin) /
            (e.intensity.inputMax - e.intensity.inputMin),
        ),
      )
    : e.brightness;
  const color =
    e.colors[
      e.mode === "cycle"
        ? Math.floor(elapsed / e.periodMs) % e.colors.length
        : 0
    ]!;
  const brightness =
    e.mode === "breathe"
      ? (maximum * (1 - Math.cos((elapsed / e.periodMs) * Math.PI * 2))) / 2
      : maximum;
  return {
    on:
      e.mode !== "off" &&
      e.mode !== "none" &&
      (e.mode !== "blink" || elapsed % e.periodMs < e.periodMs / 2),
    color,
    brightness,
  };
}
export function ledState(
  profile: Profile,
  state: Runtime,
  layer: number,
  id: string,
  now = Date.now(),
): LedState {
  return sample(
    state.lights[`${layer}:${id}`],
    now,
    conditionContext(profile, state, now),
  );
}
export function animated(state: Runtime, now: number): boolean {
  return Object.values(state.lights).some(
    (l) =>
      ["blink", "breathe", "cycle"].includes(l.effect.mode) ||
      !!l.effect.intensity.source ||
      conditionCount(l.effect.visibility) > 0 ||
      (l.effect.mode === "pulse" && now - l.since < l.effect.durationMs),
  );
}
function applyLight(
  _profile: Profile,
  _state: Runtime,
  _layer: number,
  _target: string,
  _effect: LightEffect,
  _now: number,
) {
  // Legacy light data remains serializable; the active engine never runs profile lighting.
  return;
}

function action(state: Runtime, value: Action) {
  if (value.kind === "none") return;
  if (value.kind === "layer") state.layer = value.value;
  if(state.effects)state.effects.push(structuredClone(value));
  log(state, `${state.effects?"Ação solicitada":"Ação simulada"}: ${actionLabel(value)}`);
  if (value.kind === "command"&&!state.effects)
    log(state, `Comando preparado, sem executar: ${commandPreview(value)}`);
  if (value.kind === "macro")
    for (const step of value.steps)
      log(state, `Passo: ${step.keys} · pausa ${step.delay} ms`);
}
function stateLights(
  profile: Profile,
  state: Runtime,
  eventId: string,
  stateId: string,
  now: number,
  onlyLayer?: number,
) {
  const entry = profile.events
    .find((e) => e.id === eventId)
    ?.states.find((s) => s.id === stateId);
  if (!entry) return;
  const selected =
    evaluateCondition(
      entry.condition,
      conditionContext(profile, state, now),
    ) === true
      ? entry
      : entry.otherwise;
  for (const rule of selected?.lights ?? []) {
    const layers = rule.layer === "all" ? [0, 1, 2] : [rule.layer];
    for (const layer of layers)
      if (onlyLayer === undefined || layer === onlyLayer)
        applyLight(profile, state, layer, rule.target, rule.effect, now);
  }
}
function transition(
  profile: Profile,
  state: Runtime,
  t: Behavior["transition"],
  now: number,
) {
  const event = profile.events.find((e) => e.id === t.eventId);
  if (!event) return;
  const current = eventState(profile, state, event.id),
    index = Math.max(
      0,
      event.states.findIndex((s) => s.id === current),
    );
  const next =
    t.operation === "set"
      ? t.stateId
      : t.operation === "reset"
        ? event.initialStateId
        : event.states[
            (index +
              (t.operation === "previous" ? event.states.length - 1 : 1)) %
              event.states.length
          ]!.id;
  if (next === current || !event.states.some((s) => s.id === next)) return;
  const entry = event.states.find((s) => s.id === next)!;
  const accepted = evaluateCondition(
    entry.condition,
    conditionContext(profile, state, now),
  );
  if (accepted !== true) {
    log(
      state,
      `${event.name}: condição ${accepted === null ? "sem dados" : "não atendida"} → Senão`,
    );
    if (entry.otherwise) {
      for (const l of entry.otherwise.lights)
        for (const layer of l.layer === "all" ? [0, 1, 2] : [l.layer])
          applyLight(profile, state, layer, l.target, l.effect, now);
      action(state, entry.otherwise.action);
    }
    return;
  }
  state.eventStates[event.id] = next;
  log(state, `${event.name} → ${entry.name}`);
  stateLights(profile, state, event.id, next, now);
  action(state, entry.action);
}
function condition(profile: Profile, state: Runtime, b: Behavior): boolean {
  return (
    !b.when.eventId ||
    eventState(profile, state, b.when.eventId) === b.when.stateId
  );
}
function run(
  profile: Profile,
  state: Runtime,
  layer: number,
  id: string,
  rule: Rule,
  now: number,
  input: Runtime = state,
) {
  const accepted =
    condition(profile, input, rule.behavior) &&
    evaluateCondition(rule.condition, conditionContext(profile, input, now)) ===
      true;
  const behavior = accepted ? rule.behavior : rule.otherwise;
  if (!accepted) log(state, "Condições não atendidas ou sem dados → Senão");
  if (!behavior) return;
  action(state, behavior.action);
  applyLight(
    profile,
    state,
    layer,
    behavior.light.target === "self" ? id : behavior.light.target,
    behavior.light.effect,
    now,
  );
  transition(profile, state, behavior.transition, now);
}
function activate(
  profile: Profile,
  state: Runtime,
  layer: number,
  now: number,
) {
  const visited = new Set<number>();
  let target = layer;
  while (!visited.has(target)) {
    visited.add(target);
    state.layer = target;
    const input = structuredClone(state);
    for (const c of profile.layers[target]!.controls)
      for (const r of c.rules)
        if (r.trigger === "activate")
          run(profile, state, target, c.id, r, now, input);
    for (const e of profile.events)
      stateLights(
        profile,
        state,
        e.id,
        eventState(profile, state, e.id),
        now,
        target,
      );
    if (state.layer === target) return;
    target = state.layer;
  }
  log(state, "Troca circular de camada interrompida.");
  state.layer = layer;
}
export function startRuntime(profile: Profile, now = Date.now(),live=false,observed:Observations|null=null): Runtime {
  const state = freshRuntime();
  if(live)state.effects=[];
  state.observed=observed;
  for (const e of profile.events) state.eventStates[e.id] = e.initialStateId;
  activate(profile, state, 0, now);
  state.logs = [];
  return state;
}
export function activateLayer(
  profile: Profile,
  current: Runtime,
  layer: number,
  now = Date.now(),
): Runtime {
  const state = structuredClone(current);
  activate(profile, state, layer, now);
  return state;
}
export function simulate(
  profile: Profile,
  current: Runtime,
  layer: number,
  id: string,
  trigger: Trigger,
  qualifier: Qualifier = { controlId: "", modifiers: [] },
  now = Date.now(),
): Runtime {
  const state = structuredClone(current),
    control = profile.layers[layer]!.controls.find((c) => c.id === id)!;
  const matches = control.rules.filter(
    (r) =>
      r.trigger === trigger &&
      r.qualifier.controlId === qualifier.controlId &&
      r.qualifier.modifiers.length === qualifier.modifiers.length &&
      r.qualifier.modifiers.every((m) => qualifier.modifiers.includes(m)),
  );
  if (!matches.length) {
    log(state, "Nenhuma regra corresponde a este gatilho e estado.");
    return state;
  }
  for (const r of matches) {
    log(state, `${controlName(control,profile)} · ${ruleLabel(r, profile)}`);
    run(profile, state, layer, id, r, now, current);
  }
  if (state.layer !== layer) activate(profile, state, state.layer, now);
  return state;
}
export function simulateRule(
  profile: Profile,
  current: Runtime,
  layer: number,
  id: string,
  rule: Rule,
  now = Date.now(),
): Runtime {
  const state = structuredClone(current);
  log(
    state,
    `${controlName(profile.layers[layer]!.controls.find((c) => c.id === id)!,profile)} · ${ruleLabel(rule, profile)}`,
  );
  run(profile, state, layer, id, rule, now, current);
  if (state.layer !== layer) activate(profile, state, state.layer, now);
  return state;
}
export function changeEvent(
  profile: Profile,
  current: Runtime,
  eventId: string,
  stateId: string,
  now = Date.now(),
): Runtime {
  const state = structuredClone(current);
  transition(profile, state, { eventId, stateId, operation: "set" }, now);
  if (state.layer !== current.layer) activate(profile, state, state.layer, now);
  return state;
}
export function previewEventState(
  profile: Profile,
  current: Runtime,
  eventId: string,
  stateId: string,
  now = Date.now(),
): Runtime {
  const event = profile.events.find((e) => e.id === eventId),
    entry = event?.states.find((s) => s.id === stateId);
  if (!event || !entry) return current;
  const state = structuredClone(current);
  if (
    evaluateCondition(
      entry.condition,
      conditionContext(profile, current, now),
    ) !== true
  ) {
    if (entry.otherwise) {
      for (const l of entry.otherwise.lights)
        for (const layer of l.layer === "all" ? [0, 1, 2] : [l.layer])
          applyLight(profile, state, layer, l.target, l.effect, now);
      action(state, entry.otherwise.action);
    }
    log(state, "Condição do estado não atendida ou sem dados → Senão");
    if (state.layer !== current.layer)
      activate(profile, state, state.layer, now);
    return state;
  }
  state.eventStates[eventId] = stateId;
  stateLights(profile, state, eventId, stateId, now);
  action(state, entry.action);
  log(state, `${event.name} → ${entry.name}`);
  if (state.layer !== current.layer) activate(profile, state, state.layer, now);
  return state;
}
