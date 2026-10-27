import { z } from "zod";
export type Value = boolean | number | string;
export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), eventId: z.string().min(1).max(100) }),
  z.object({
    kind: z.literal("process"),
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[\w .-]+$/),
  }),
  z.object({
    kind: z.literal("key"),
    controlId: z.string().regex(/^(key-(?:[1-9]|1[0-6])|knob-[1-3])$/),
  }),
  z.object({
    kind: z.literal("input"),
    key: z.string().min(1).max(120),
    label: z.string().min(1).max(80),
    type: z.enum(["boolean", "number", "text"]),
    provider: z.enum(["windows", "obs", "custom"]),
  }),
]);
export type Source = z.infer<typeof sourceSchema>;
export type InputSource = Extract<Source, { kind: "input" }>;
export type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
export type Condition =
  | { id: string; kind: "all" | "any"; children: Condition[] }
  | {
      id: string;
      kind: "test";
      source: Source;
      operator: Operator;
      value: Value;
    };
const rawCondition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string().min(1).max(100),
      kind: z.enum(["all", "any"]),
      children: z.array(rawCondition).max(64),
    }),
    z
      .object({
        id: z.string().min(1).max(100),
        kind: z.literal("test"),
        source: sourceSchema,
        operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
        value: z.union([z.boolean(), z.number().finite(), z.string().max(200)]),
      })
      .superRefine((c, ctx) => {
        const type =
          c.source.kind === "event"
            ? "text"
            : c.source.kind === "input"
              ? c.source.type
              : "boolean";
        if (
          typeof c.value !== (type === "text" ? "string" : type) ||
          (!["eq", "neq"].includes(c.operator) && type !== "number")
        )
          ctx.addIssue({
            code: "custom",
            message: "Comparação incompatível com a fonte",
          });
      }),
  ]),
);
export const conditionSchema = z.preprocess((value) => {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 256 || item.depth > 6) return undefined;
    const node = item.value;
    if (
      node &&
      typeof node === "object" &&
      "children" in node &&
      Array.isArray(node.children)
    )
      for (const child of node.children)
        pending.push({ value: child, depth: item.depth + 1 });
  }
  return value;
}, rawCondition);
export const observationsSchema = z.object({
  at: z.number().int().positive(),
  processNames: z.array(z.string().max(300)).max(10000).nullable(),
  values: z.record(
    z.string().max(120),
    z.union([z.boolean(), z.number().finite(), z.string().max(1000), z.null()]),
  ),
  error: z.string().max(1000).optional(),
});
export type Observations = z.infer<typeof observationsSchema>;
export interface ConditionContext {
  events: Record<string, string>;
  held: string[];
  signals: Record<string, Value | null>;
  observed: Observations | null;
  now: number;
}
export const INPUTS: InputSource[] = [
  {
    kind: "input",
    key: "windows.microphone.level",
    label: "Nível de entrada do microfone · Windows",
    type: "number",
    provider: "windows",
  },
  {
    kind: "input",
    key: "windows.microphone.muted",
    label: "Microfone em mudo · Windows",
    type: "boolean",
    provider: "windows",
  },
  {
    kind: "input",
    key: "windows.microphone.volume",
    label: "Volume ajustado do microfone · Windows",
    type: "number",
    provider: "windows",
  },
  {
    kind: "input",
    key: "obs.microphone.level",
    label: "Nível de entrada do microfone · OBS",
    type: "number",
    provider: "obs",
  },
  {
    kind: "input",
    key: "obs.microphone.muted",
    label: "Microfone em mudo · OBS",
    type: "boolean",
    provider: "obs",
  },
  {kind:"input",key:"obs.recording",label:"Gravação ativa · OBS",type:"boolean",provider:"obs"},
  {kind:"input",key:"obs.recording.paused",label:"Gravação pausada · OBS",type:"boolean",provider:"obs"},
  {kind:"input",key:"obs.streaming",label:"Transmissão ativa · OBS",type:"boolean",provider:"obs"},
  {kind:"input",key:"obs.microphone.volume",label:"Volume ajustado do microfone · OBS",type:"number",provider:"obs"},
];
export function always(): Condition {
  return { id: "root", kind: "all", children: [] };
}
export function sourceKey(source: Source): string {
  switch (source.kind) {
    case "event":
      return `event:${source.eventId}`;
    case "key":
      return `key:${source.controlId}`;
    case "process":
      return `process:${source.name.toLowerCase().replace(/\.exe$/, "")}`;
    case "input":
      return source.key;
  }
}
export function sourceLabel(source: Source): string {
  switch (source.kind) {
    case "event":
      return "Estado do evento";
    case "key":
      return `Tecla ${source.controlId.split("-")[1]} pressionada`;
    case "process":
      return `${source.name} aberto`;
    case "input":
      return source.label;
  }
}
export function readSource(
  source: Source,
  context: ConditionContext,
): Value | null {
  if (source.kind === "event") return context.events[source.eventId] ?? null;
  const key = sourceKey(source);
  if (Object.hasOwn(context.signals, key)) return context.signals[key] ?? null;
  if (source.kind === "key")
    return context.held.includes(source.controlId) ? true : null;
  const snapshot = context.observed;
  if (
    !snapshot ||
    context.now - snapshot.at > 2500 ||
    snapshot.at > context.now + 1000
  )
    return null;
  if (source.kind === "process")
    return snapshot.processNames
      ? snapshot.processNames.some(
          (n) => n.toLowerCase().replace(/\.exe$/, "") === key.slice(8),
        )
      : null;
  const value = snapshot.values[key] ?? null;
  if (value === null) return null;
  return typeof value === (source.type === "text" ? "string" : source.type)
    ? value
    : null;
}
export function evaluateCondition(
  condition: Condition,
  context: ConditionContext,
): boolean | null {
  if (condition.kind !== "test") {
    const results = condition.children.map((c) =>
      evaluateCondition(c, context),
    );
    if (condition.kind === "all") {
      if (results.includes(false)) return false;
      return results.includes(null) ? null : true;
    }
    if (results.includes(true)) return true;
    return results.includes(null) ? null : false;
  }
  const actual = readSource(condition.source, context);
  if (actual === null || typeof actual !== typeof condition.value) return null;
  switch (condition.operator) {
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "gt":
      return Number(actual) > Number(condition.value);
    case "gte":
      return Number(actual) >= Number(condition.value);
    case "lt":
      return Number(actual) < Number(condition.value);
    case "lte":
      return Number(actual) <= Number(condition.value);
  }
}
export function conditionSources(condition: Condition): Source[] {
  return condition.kind === "test"
    ? [condition.source]
    : condition.children.flatMap(conditionSources);
}
export function conditionCount(condition: Condition): number {
  return condition.kind === "test"
    ? 1
    : condition.children.reduce((n, c) => n + conditionCount(c), 0);
}
