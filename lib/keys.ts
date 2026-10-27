export interface KeyChord { modifiers: number[]; key: number; virtualKey: number; }
interface ModifierOption {
  name: string;
  label: string;
  code: number;
  virtualKey: number;
  aliases: readonly string[];
}
export interface KeyOption {
  name: string;
  label: string;
  group: string;
  code: number;
  virtualKey: number;
  aliases?: readonly string[];
  shift?: boolean;
}

// The same existing codes and aliases serve the parser and the editor.
export const MODIFIER_OPTIONS: readonly ModifierOption[] = [
  { name: "Ctrl", label: "Ctrl", code: 241, virtualKey: 162, aliases: ["Control"] },
  { name: "Shift", label: "Shift", code: 242, virtualKey: 160, aliases: [] },
  { name: "Alt", label: "Alt", code: 243, virtualKey: 164, aliases: [] },
  { name: "Win", label: "Win", code: 244, virtualKey: 91, aliases: ["Meta"] },
  { name: "RightCtrl", label: "Ctrl direito", code: 245, virtualKey: 163, aliases: [] },
  { name: "RightShift", label: "Shift direito", code: 246, virtualKey: 161, aliases: [] },
  { name: "RightAlt", label: "Alt direito", code: 247, virtualKey: 165, aliases: [] },
  { name: "RightWin", label: "Win direito", code: 248, virtualKey: 92, aliases: [] },
];
const specialKeys: readonly KeyOption[] = [
  { name: "Enter", label: "Enter", group: "Edição e navegação", code: 40, virtualKey: 13 },
  { name: "Esc", label: "Esc / Escape", group: "Edição e navegação", code: 41, virtualKey: 27, aliases: ["Escape"] },
  { name: "Backspace", label: "Backspace", group: "Edição e navegação", code: 42, virtualKey: 8 },
  { name: "Tab", label: "Tab", group: "Edição e navegação", code: 43, virtualKey: 9 },
  { name: "Space", label: "Espaço / Space", group: "Edição e navegação", code: 44, virtualKey: 32, aliases: [" "] },
  ...([
    ["-", 45, 189], ["=", 46, 187], ["[", 47, 219], ["]", 48, 221],
    ["\\", 49, 220], [";", 51, 186], ["'", 52, 222], ["`", 53, 192],
    [",", 54, 188], [".", 55, 190], ["/", 56, 191],
  ] as const).map(([name, code, virtualKey]) => ({ name, label: name, group: "Pontuação", code, virtualKey })),
  { name: "+", label: "+ (Shift+=)", group: "Pontuação", code: 46, virtualKey: 187, shift: true },
  { name: "CapsLock", label: "Caps Lock", group: "Sistema", code: 57, virtualKey: 20 },
  { name: "PrintScreen", label: "Print Screen", group: "Sistema", code: 70, virtualKey: 44 },
  { name: "ScrollLock", label: "Scroll Lock", group: "Sistema", code: 71, virtualKey: 145 },
  { name: "Pause", label: "Pause", group: "Sistema", code: 72, virtualKey: 19 },
  { name: "Insert", label: "Insert", group: "Edição e navegação", code: 73, virtualKey: 45 },
  { name: "Home", label: "Home", group: "Edição e navegação", code: 74, virtualKey: 36 },
  { name: "PageUp", label: "Page Up", group: "Edição e navegação", code: 75, virtualKey: 33 },
  { name: "Delete", label: "Delete", group: "Edição e navegação", code: 76, virtualKey: 46 },
  { name: "End", label: "End", group: "Edição e navegação", code: 77, virtualKey: 35 },
  { name: "PageDown", label: "Page Down", group: "Edição e navegação", code: 78, virtualKey: 34 },
  { name: "ArrowRight", label: "Seta para a direita", group: "Edição e navegação", code: 79, virtualKey: 39 },
  { name: "ArrowLeft", label: "Seta para a esquerda", group: "Edição e navegação", code: 80, virtualKey: 37 },
  { name: "ArrowDown", label: "Seta para baixo", group: "Edição e navegação", code: 81, virtualKey: 40 },
  { name: "ArrowUp", label: "Seta para cima", group: "Edição e navegação", code: 82, virtualKey: 38 },
];
export const KEY_OPTIONS: readonly KeyOption[] = [
  ...Array.from({ length: 26 }, (_, i) => ({ name: String.fromCharCode(65 + i), label: String.fromCharCode(65 + i), group: "Letras", code: 4 + i, virtualKey: 65 + i })),
  ...Array.from({ length: 10 }, (_, i) => ({ name: String(i), label: String(i), group: "Números", code: i === 0 ? 39 : 29 + i, virtualKey: 48 + i })),
  ...Array.from({ length: 24 }, (_, i) => ({ name: `F${i + 1}`, label: `F${i + 1}`, group: "Funções", code: i < 12 ? 58 + i : 92 + i, virtualKey: 112 + i })),
  ...specialKeys,
];
const modifiersByName = new Map(MODIFIER_OPTIONS.flatMap(option => [option.name, ...option.aliases].map(name => [name.toUpperCase(), option] as const)));
const keysByName = new Map(KEY_OPTIONS.flatMap(option => [option.name, ...(option.aliases ?? [])].map(name => [name.toUpperCase(), option] as const)));
export const modifierVirtualKeys: Record<number, number> = Object.fromEntries(MODIFIER_OPTIONS.map(option => [option.code, option.virtualKey]));

function parseParts(value: string) {
  const normalized = value.replace(/\s*\+\s*/g, "+").trim();
  const plus = normalized.endsWith("++") || normalized === "+";
  const parts = (plus ? normalized.slice(0, -1) : normalized).split("+").filter(Boolean);
  const name = plus ? "+" : parts.pop()?.toUpperCase();
  const mods = parts.map(part => modifiersByName.get(part.toUpperCase()));
  if (!name || mods.some(mod => !mod) || new Set(mods).size !== mods.length) throw new Error(`Atalho inválido: ${value}`);
  const key = keysByName.get(name);
  if (!key) throw new Error(`Tecla não reconhecida: ${name}`);
  const selected = mods as ModifierOption[];
  if (key.shift && !selected.some(mod => mod.name === "Shift")) selected.push(MODIFIER_OPTIONS[1]!);
  return { key, modifiers: selected };
}
export function parseChord(value: string): KeyChord {
  const chord = parseParts(value);
  return { modifiers: chord.modifiers.map(mod => mod.code), key: chord.key.code, virtualKey: chord.key.virtualKey };
}
export function chordSelection(value: string): { modifiers: string[]; key: string } {
  const chord = parseParts(value);
  return { modifiers: chord.modifiers.map(mod => mod.name), key: chord.key.name };
}
export function buildChord(modifiers: readonly string[], key: string): string {
  const value = [...modifiers, key].join("+");
  parseChord(value);
  return value;
}
// Identity for presentation only. Never changes the order sent to the hardware.
export function chordIdentity(value: string): string {
  const chord = parseChord(value);
  return `${[...chord.modifiers].sort((a, b) => a - b).join(",")}:${chord.key}`;
}
