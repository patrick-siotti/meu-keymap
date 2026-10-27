import { z } from "zod";
import {
  actionSchema as previousActionSchema,
  actionLabel as previousLabel,
} from "./legacy-model.ts";
export const commandSchema = z.object({
  kind: z.literal("command"),
  runner: z.enum(["program", "powershell", "python", "batch"]),
  path: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .regex(/^[^\r\n\0]+$/),
  arguments: z
    .array(
      z
        .string()
        .max(4000)
        .refine((s) => !s.includes("\0"), "Argumento inválido"),
    )
    .max(64),
  cwd: z
    .string()
    .max(1024)
    .regex(/^[^\r\n\0]*$/),
  timeoutMs: z.number().int().min(1000).max(3600000),
});
export const actionSchema = z.union([previousActionSchema, commandSchema]);
export type Action = z.infer<typeof actionSchema>;
export type CommandAction = z.infer<typeof commandSchema>;
export function actionLabel(action: Action): string {
  return action.kind === "command"
    ? `Script / comando: ${action.path.split(/[\\/]/).pop()}`
    : previousLabel(action);
}
export function commandPreview(action: CommandAction): string {
  const quote = (value: string) => JSON.stringify(value);
  const prefix =
    action.runner === "powershell"
      ? ["powershell.exe", "-NoProfile", "-File"]
      : action.runner === "python"
        ? ["python.exe"]
        : action.runner === "batch"
          ? ["cmd.exe", "/d", "/c"]
          : [];
  return [...prefix, action.path, ...action.arguments].map(quote).join(" ");
}
