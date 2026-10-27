import { z } from "zod";
import {
  actionSchema,
  makeProfile as legacyProfile,
  documentSchema as legacySchema,
} from "./legacy-model.ts";
import type { Profile as LegacyProfile } from "./legacy-model.ts";
export {
  actionSchema,
  actionLabel,
  MEDIA,
  PALETTE,
  CONTROL_IDS,
} from "./legacy-model.ts";
export type { Action } from "./legacy-model.ts";
import { CONTROL_IDS } from "./legacy-model.ts";
export const EVENTS = [
  "press",
  "double",
  "hold",
  "release",
  "left",
  "right",
  "activate",
] as const;
export type Trigger = (typeof EVENTS)[number];
export const EVENT_LABELS: Record<Trigger, string> = {
  press: "Clique",
  double: "Duplo clique",
  hold: "Segurar",
  release: "Soltar",
  left: "Girar à esquerda",
  right: "Girar à direita",
  activate: "Ao ativar a camada",
};
const id = z.string().min(1).max(100);
const ref = z.string().max(100);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const effectSchema = z.object({
  mode: z.enum([
    "none",
    "on",
    "off",
    "toggle",
    "pulse",
    "blink",
    "breathe",
    "cycle",
  ]),
  colors: z.array(color).min(1).max(24),
  brightness: z.number().int().min(0).max(100),
  periodMs: z.number().int().min(100).max(60000),
  durationMs: z.number().int().min(100).max(60000),
});
export type LightEffect = z.infer<typeof effectSchema>;
export const qualifierSchema = z.object({
  controlId: z.enum(["", ...CONTROL_IDS]),
  modifiers: z.array(z.enum(["Ctrl", "Shift", "Alt", "Win"])).max(4),
});
export type Qualifier = z.infer<typeof qualifierSchema>;
export const behaviorSchema = z.object({
  action: actionSchema,
  when: z.object({ eventId: ref, stateId: ref }),
  light: z.object({
    target: z.enum(["self", "all", ...CONTROL_IDS]),
    effect: effectSchema,
  }),
  transition: z.object({
    eventId: ref,
    operation: z.enum(["set", "next", "previous", "reset"]),
    stateId: ref,
  }),
});
export type Behavior = z.infer<typeof behaviorSchema>;
export const ruleSchema = z.object({
  id,
  trigger: z.enum(EVENTS),
  qualifier: qualifierSchema,
  behavior: behaviorSchema,
});
export type Rule = z.infer<typeof ruleSchema>;
export const controlSchema = z.object({
  id: z.enum(CONTROL_IDS as [string, ...string[]]),
  kind: z.enum(["key", "knob"]),
  label: z.string().max(30),
  rules: z.array(ruleSchema).max(100),
});
export type Control = z.infer<typeof controlSchema>;
export const stateLightSchema = z.object({
  id,
  target: z.enum(["all", ...CONTROL_IDS]),
  layer: z.union([z.literal("all"), z.number().int().min(0).max(2)]),
  effect: effectSchema,
});
export type StateLight = z.infer<typeof stateLightSchema>;
export const eventStateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(40),
  action: actionSchema,
  lights: z.array(stateLightSchema).max(100),
});
export type EventState = z.infer<typeof eventStateSchema>;
export const namedEventSchema = z.object({
  id,
  name: z.string().trim().min(1).max(40),
  initialStateId: id,
  states: z.array(eventStateSchema).min(1),
});
export type NamedEvent = z.infer<typeof namedEventSchema>;
export const profileSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(40),
    events: z.array(namedEventSchema),
    layers: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(30),
          controls: z.array(controlSchema).length(19),
        }),
      )
      .length(3),
  })
  .superRefine((p, ctx) => {
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      new Set(p.events.map((e) => e.id)).size !== p.events.length ||
      new Set(p.events.map((e) => e.name.toLocaleLowerCase())).size !==
        p.events.length
    )
      problem("Eventos duplicados");
    for (const event of p.events) {
      if (!event.states.some((s) => s.id === event.initialStateId))
        problem("Estado inicial inválido");
      if (
        new Set(event.states.map((s) => s.id)).size !== event.states.length ||
        new Set(event.states.map((s) => s.name.toLocaleLowerCase())).size !==
          event.states.length
      )
        problem("Estados duplicados");
      for (const s of event.states)
        if (new Set(s.lights.map((l) => l.id)).size !== s.lights.length)
          problem("Reações de luz duplicadas");
    }
    const knownState = (eventId: string, stateId: string) =>
      !!p.events
        .find((e) => e.id === eventId)
        ?.states.some((s) => s.id === stateId);
    for (const l of p.layers) {
      if (new Set(l.controls.map((c) => c.id)).size !== 19)
        problem("Controles duplicados");
      for (const c of l.controls) {
        if ((c.id.startsWith("key-") ? "key" : "knob") !== c.kind)
          problem("Tipo de controle inválido");
        if (new Set(c.rules.map((r) => r.id)).size !== c.rules.length)
          problem("Gatilhos duplicados");
        for (const r of c.rules) {
          if (
            r.qualifier.controlId === c.id ||
            new Set(r.qualifier.modifiers).size !== r.qualifier.modifiers.length
          )
            problem("Combinação inválida");
          if (
            r.trigger === "activate" &&
            (r.qualifier.controlId || r.qualifier.modifiers.length)
          )
            problem("Ativação de camada não aceita combinação");
          if (
            c.kind === "key" &&
            (r.trigger === "left" || r.trigger === "right")
          )
            problem("Tecla não tem giro");
          if (
            r.behavior.when.eventId
              ? !knownState(r.behavior.when.eventId, r.behavior.when.stateId)
              : !!r.behavior.when.stateId
          )
            problem("Condição de evento inválida");
          const t = r.behavior.transition;
          if (
            t.eventId &&
            (!p.events.some((e) => e.id === t.eventId) ||
              (t.operation === "set" && !knownState(t.eventId, t.stateId)))
          )
            problem("Transição de evento inválida");
        }
      }
    }
  });
export type Profile = z.infer<typeof profileSchema>;
export const documentSchema = z
  .object({
    version: z.literal(2),
    activeProfile: id,
    profiles: z.array(profileSchema).min(1).max(20),
  })
  .superRefine((d, ctx) => {
    if (
      new Set(d.profiles.map((p) => p.id)).size !== d.profiles.length ||
      !d.profiles.some((p) => p.id === d.activeProfile)
    )
      ctx.addIssue({
        code: "custom",
        message: "Perfil ativo ou IDs inválidos",
      });
  });
export type KeymapDocument = z.infer<typeof documentSchema>;
export interface Envelope {
  revision: number;
  document: KeymapDocument;
}
export function emptyEffect(): LightEffect {
  return {
    mode: "none",
    colors: ["#d2bee9", "#65c8ce"],
    brightness: 75,
    periodMs: 1000,
    durationMs: 500,
  };
}
export function emptyBehavior(): Behavior {
  return {
    action: { kind: "none" },
    when: { eventId: "", stateId: "" },
    light: { target: "self", effect: emptyEffect() },
    transition: { eventId: "", operation: "next", stateId: "" },
  };
}
export function makeRule(
  ruleId: string,
  trigger: Trigger,
  qualifier: Qualifier = { controlId: "", modifiers: [] },
): Rule {
  return { id: ruleId, trigger, qualifier, behavior: emptyBehavior() };
}
export function makeEvent(eventId: string, name: string): NamedEvent {
  return {
    id: eventId,
    name,
    initialStateId: "inactive",
    states: [
      { id: "inactive", name: "Inativo", action: { kind: "none" }, lights: [] },
      { id: "active", name: "Ativo", action: { kind: "none" }, lights: [] },
    ],
  };
}
export function controlName(c: Pick<Control, "id" | "label" | "kind">): string {
  return `${c.kind === "key" ? "Tecla" : "Encoder"} ${c.id.split("-")[1]}${c.label ? ` · ${c.label}` : ""}`;
}
export function ruleLabel(rule: Rule, profile?: Profile): string {
  let label = EVENT_LABELS[rule.trigger];
  if (rule.qualifier.controlId) {
    const target = profile?.layers[0]?.controls.find(
      (c) => c.id === rule.qualifier.controlId,
    );
    label += ` + ${target?.kind === "knob" ? "Encoder" : "Tecla"} ${rule.qualifier.controlId.split("-")[1]}`;
  }
  if (rule.qualifier.modifiers.length)
    label += ` + ${rule.qualifier.modifiers.join(" + ")}`;
  return label;
}
export function migrateProfile(old: LegacyProfile): Profile {
  const named = old.flags.map((f) => makeEvent(f, f));
  const layers = old.layers.map((l, layer) => ({
    name: l.name,
    controls: l.controls.map((c) => {
      const rules: Rule[] = [];
      const initial = makeRule("activate", "activate");
      initial.behavior.light.effect = {
        ...emptyEffect(),
        mode: c.led.base ? "on" : "off",
        colors: [c.led.color],
        brightness: c.led.brightness,
      };
      rules.push(initial);
      for (const [trigger, b] of Object.entries(c.events)) {
        if (!(
          b.action.kind !== "none" ||
          b.status.id ||
          b.when.id ||
          b.light.mode !== "none"
        ))
          continue;
        const r = makeRule(trigger, trigger as Trigger);
        r.behavior.action = b.action;
        r.behavior.when = {
          eventId: b.when.id,
          stateId: b.when.id ? (b.when.value ? "active" : "inactive") : "",
        };
        r.behavior.transition = {
          eventId: b.status.id,
          operation: b.status.operation === "toggle" ? "next" : "set",
          stateId: b.status.id
            ? b.status.operation === "off"
              ? "inactive"
              : "active"
            : "",
        };
        r.behavior.light = {
          target: b.light.target,
          effect: {
            ...emptyEffect(),
            mode: b.light.mode === "color" ? "on" : b.light.mode,
            colors: [b.light.color],
            brightness: c.led.brightness,
          },
        };
        rules.push(r);
      }
      if (c.led.statusId) {
        const event = named.find((e) => e.id === c.led.statusId)!;
        for (const state of event.states)
          state.lights.push({
            id: `${layer}-${c.id}`,
            target: c.id,
            layer,
            effect: {
              ...emptyEffect(),
              mode: state.id === "active" ? "on" : "off",
              colors: [c.led.color],
              brightness: c.led.brightness,
            },
          });
      }
      for (const trigger of (c.kind === "key"
        ? ["press"]
        : ["left", "press", "right"]) as Trigger[])
        if (!rules.some((r) => r.trigger === trigger))
          rules.push(makeRule(trigger, trigger));
      rules.sort(
        (a, b) =>
          Number(a.trigger === "activate") - Number(b.trigger === "activate"),
      );
      return { id: c.id, kind: c.kind, label: c.label, rules };
    }),
  }));
  return { id: old.id, name: old.name, events: named, layers };
}
export function parseDocument(input: unknown): KeymapDocument {
  if (
    typeof input === "object" &&
    input &&
    "version" in input &&
    input.version === 1
  ) {
    const old = legacySchema.parse(input);
    return documentSchema.parse({
      version: 2,
      activeProfile: old.activeProfile,
      profiles: old.profiles.map(migrateProfile),
    });
  }
  return documentSchema.parse(input);
}
export function makeProfile(
  profileId: string,
  name: string,
  demo = false,
): Profile {
  return migrateProfile(legacyProfile(profileId, name, demo));
}
export function defaultDocument(): KeymapDocument {
  return {
    version: 2,
    activeProfile: "principal",
    profiles: [makeProfile("principal", "Meu dia a dia", true)],
  };
}
