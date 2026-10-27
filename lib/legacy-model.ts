import { z } from "zod";

export const EVENTS = [
  "press",
  "double",
  "hold",
  "release",
  "left",
  "right",
] as const;
export type Trigger = (typeof EVENTS)[number];
export const EVENT_LABELS: Record<Trigger, string> = {
  press: "Clique",
  double: "Duplo clique",
  hold: "Segurar",
  release: "Soltar",
  left: "Girar à esquerda",
  right: "Girar à direita",
};
export const MEDIA = {
  volumeUp: "Aumentar volume",
  volumeDown: "Diminuir volume",
  mute: "Alternar som",
  playPause: "Reproduzir / pausar",
  next: "Próxima faixa",
  previous: "Faixa anterior",
} as const;
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("shortcut"),
    keys: z.string().trim().min(1).max(100),
  }),
  z.object({
    kind: z.literal("media"),
    command: z.enum(
      Object.keys(MEDIA) as [keyof typeof MEDIA, ...Array<keyof typeof MEDIA>],
    ),
  }),
  z.object({ kind: z.literal("text"), value: z.string().min(1).max(2000) }),
  z.object({
    kind: z.literal("macro"),
    steps: z
      .array(
        z.object({
          keys: z.string().min(1).max(100),
          delay: z.number().int().min(0).max(10000),
        }),
      )
      .min(1)
      .max(30),
  }),
  z.object({ kind: z.literal("layer"), value: z.number().int().min(0).max(2) }),
]);
export type Action = z.infer<typeof actionSchema>;
export const CONTROL_IDS = [
  ...Array.from({ length: 16 }, (_, i) => `key-${i + 1}`),
  "knob-1",
  "knob-2",
  "knob-3",
];
const idSchema = z.enum(CONTROL_IDS as [string, ...string[]]);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const behaviorSchema = z.object({
  action: actionSchema,
  when: z.object({ id: z.string().max(40), value: z.boolean() }),
  light: z.object({
    mode: z.enum(["none", "on", "off", "toggle", "color", "pulse"]),
    target: z.enum(["self", "all", ...CONTROL_IDS]),
    color: colorSchema,
  }),
  status: z.object({
    id: z.string().max(40),
    operation: z.enum(["toggle", "on", "off"]),
  }),
});
export type Behavior = z.infer<typeof behaviorSchema>;
export const controlSchema = z.object({
  id: idSchema,
  kind: z.enum(["key", "knob"]),
  label: z.string().max(30),
  led: z.object({
    color: colorSchema,
    base: z.boolean(),
    brightness: z.number().int().min(0).max(100),
    statusId: z.string().max(40),
  }),
  events: z.object({
    press: behaviorSchema,
    double: behaviorSchema,
    hold: behaviorSchema,
    release: behaviorSchema,
    left: behaviorSchema,
    right: behaviorSchema,
  }),
});
export type Control = z.infer<typeof controlSchema>;
const layerSchema = z.object({
  name: z.string().trim().min(1).max(30),
  controls: z
    .array(controlSchema)
    .length(19)
    .superRefine((controls, ctx) => {
      if (new Set(controls.map((c) => c.id)).size !== 19)
        ctx.addIssue({ code: "custom", message: "Controles duplicados" });
      if (
        controls.some(
          (c) => (c.id.startsWith("key-") ? "key" : "knob") !== c.kind,
        )
      )
        ctx.addIssue({ code: "custom", message: "Tipo de controle inválido" });
    }),
});
export const profileSchema = z
  .object({
    id: z.string().min(1).max(60),
    name: z.string().trim().min(1).max(40),
    flags: z.array(z.string().trim().min(1).max(40)).max(16),
    layers: z.array(layerSchema).length(3),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.flags).size !== p.flags.length)
      ctx.addIssue({ code: "custom", message: "Estados duplicados" });
    const known = (id: string) => id === "" || p.flags.includes(id);
    for (const l of p.layers)
      for (const c of l.controls) {
        if (
          !known(c.led.statusId) ||
          Object.values(c.events).some(
            (b) => !known(b.status.id) || !known(b.when.id),
          )
        )
          ctx.addIssue({ code: "custom", message: "Estado inexistente" });
      }
  });
export type Profile = z.infer<typeof profileSchema>;
export const documentSchema = z
  .object({
    version: z.literal(1),
    activeProfile: z.string().min(1).max(60),
    profiles: z.array(profileSchema).min(1).max(20),
  })
  .superRefine((doc, ctx) => {
    if (
      new Set(doc.profiles.map((p) => p.id)).size !== doc.profiles.length ||
      !doc.profiles.some((p) => p.id === doc.activeProfile)
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
export const PALETTE = [
  "#d2bee9",
  "#65c8ce",
  "#6dcca0",
  "#e8bd78",
  "#e29b9c",
  "#eeeeee",
];
export function emptyBehavior(): Behavior {
  return {
    action: { kind: "none" },
    when: { id: "", value: true },
    light: { mode: "none", target: "self", color: "#d2bee9" },
    status: { id: "", operation: "toggle" },
  };
}
export function makeProfile(id: string, name: string, demo = false): Profile {
  const labels = [
    "Copiar",
    "Colar",
    "Recortar",
    "Desfazer",
    "Salvar",
    "Captura",
    "Pesquisar",
    "Explorador",
    "Anterior",
    "Play / pause",
    "Próxima",
    "Sem som",
    "Gravando",
    "Área de trabalho",
    "Camada 2",
    "Bloquear",
  ];
  const actions: Action[] = [
    ...[
      "Ctrl+C",
      "Ctrl+V",
      "Ctrl+X",
      "Ctrl+Z",
      "Ctrl+S",
      "Win+Shift+S",
      "Ctrl+F",
      "Win+E",
    ].map((keys) => ({ kind: "shortcut" as const, keys })),
    ...(["previous", "playPause", "next", "mute"] as const).map((command) => ({
      kind: "media" as const,
      command,
    })),
    { kind: "none" },
    { kind: "shortcut", keys: "Win+D" },
    { kind: "layer", value: 1 },
    { kind: "shortcut", keys: "Win+L" },
  ];
  return {
    id,
    name,
    flags: ["Gravando", "Microfone mudo"],
    layers: Array.from({ length: 3 }, (_, layer) => ({
      name: ["Principal", "Criação", "Livre"][layer]!,
      controls: CONTROL_IDS.map((controlId, i) => {
        const events = Object.fromEntries(
          EVENTS.map((e) => [e, emptyBehavior()]),
        ) as Control["events"];
        if (demo && layer === 0 && i < 16) events.press.action = actions[i]!;
        if (demo && layer === 0 && i >= 16) {
          const commands =
            i === 16
              ? (["volumeDown", "mute", "volumeUp"] as const)
              : i === 17
                ? (["previous", "playPause", "next"] as const)
                : null;
          if (commands)
            ["left", "press", "right"].forEach((e, j) => {
              events[e as Trigger].action = {
                kind: "media",
                command: commands[j]!,
              };
            });
          else {
            events.left.action = { kind: "shortcut", keys: "Ctrl+-" };
            events.press.action = { kind: "shortcut", keys: "Ctrl+0" };
            events.right.action = { kind: "shortcut", keys: "Ctrl++" };
          }
        }
        if (demo && layer === 0 && i === 12) {
          events.press.status.id = "Gravando";
          events.press.light.mode = "toggle";
        }
        return {
          id: controlId,
          kind: i < 16 ? "key" : "knob",
          label:
            demo && layer === 0
              ? i < 16
                ? labels[i]!
                : ["Volume", "Mídia", "Zoom"][i - 16]!
              : "",
          led: {
            color: PALETTE[Math.floor(i / 4) % PALETTE.length]!,
            base: true,
            brightness: 75,
            statusId: demo && layer === 0 && i === 12 ? "Gravando" : "",
          },
          events,
        };
      }),
    })),
  };
}
export function defaultDocument(): KeymapDocument {
  return {
    version: 1,
    activeProfile: "principal",
    profiles: [makeProfile("principal", "Meu dia a dia", true)],
  };
}
export function actionLabel(action: Action): string {
  switch (action.kind) {
    case "none":
      return "Sem ação";
    case "shortcut":
      return action.keys.replaceAll("+", " + ");
    case "media":
      return MEDIA[action.command];
    case "text":
      return `Texto: ${action.value.slice(0, 28)}`;
    case "macro":
      return `Sequência · ${action.steps.length} passos`;
    case "layer":
      return `Ir para camada ${action.value + 1}`;
  }
}
