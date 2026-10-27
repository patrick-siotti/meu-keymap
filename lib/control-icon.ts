import { z } from "zod";

export const ICON_LIBRARY = [
  ["copy", "Copiar"], ["paste", "Colar"], ["cut", "Recortar"],
  ["undo", "Desfazer"], ["redo", "Refazer"], ["save", "Salvar"],
  ["search", "Pesquisar"], ["capture", "Captura de tela"], ["folder", "Pasta"],
  ["desktop", "Área de trabalho"], ["lock", "Bloquear"], ["keyboard", "Teclado"],
  ["text", "Texto"], ["macro", "Sequência"], ["command", "Terminal"],
  ["layer", "Camadas"], ["event", "Evento"], ["plus", "Adicionar"],
  ["volume", "Volume"], ["mute", "Mudo"], ["play", "Reproduzir"],
  ["next", "Próxima"], ["previous", "Anterior"], ["star", "Estrela"],
  ["heart", "Coração"], ["camera", "Câmera"], ["mail", "E-mail"],
  ["globe", "Navegador"], ["music", "Música"], ["calculator", "Calculadora"],
] as const;
export type ActionIconName = (typeof ICON_LIBRARY)[number][0];
export const MAX_ICON_DATA_URL = 128 * 1024;
export const MAX_ICON_UPLOAD = 2 * 1024 * 1024;
export const MAX_ICON_DIMENSION = 128;
const prefix = "data:image/png;base64,";
const uint32 = (b: Uint8Array, i: number) => ((b[i]! * 0x1000000) + (b[i+1]! << 16) + (b[i+2]! << 8) + b[i+3]!) >>> 0;
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function validIconPng(value: string): boolean {
  if (value.length > MAX_ICON_DATA_URL || !value.startsWith(prefix)) return false;
  const encoded = value.slice(prefix.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  try {
    const binary = atob(encoded);
    if (btoa(binary) !== encoded) return false;
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    if (![137,80,78,71,13,10,26,10].every((byte,i) => bytes[i] === byte)) return false;
    let offset=8, chunks=0, hasData=false;
    while (offset + 12 <= bytes.length) {
      const length=uint32(bytes,offset), end=offset+12+length;
      if (end>bytes.length) return false;
      const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));
      if (crc32(bytes.subarray(offset+4,end-4)) !== uint32(bytes,end-4)) return false;
      if (chunks++ === 0) {
        if (type!=="IHDR" || length!==13) return false;
        const width=uint32(bytes,offset+8),height=uint32(bytes,offset+12);
        if (!width||!height||width>MAX_ICON_DIMENSION||height>MAX_ICON_DIMENSION || bytes[offset+16]!==8 || ![0,2,3,4,6].includes(bytes[offset+17]!) || bytes[offset+18]!==0 || bytes[offset+19]!==0 || bytes[offset+20]!==0) return false;
      } else if (type==="IHDR") return false;
      if (type==="IDAT") {if (!length) return false; hasData=true;}
      if (type==="IEND") return length===0 && hasData && end===bytes.length;
      if (!["IHDR","IDAT","PLTE","tRNS","sRGB","gAMA","cHRM","pHYs"].includes(type)) return false;
      offset=end;
    }
  } catch { return false; }
  return false;
}
const names=ICON_LIBRARY.map(([name])=>name) as [ActionIconName,...ActionIconName[]];
export const controlIconSchema = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("library"),name:z.enum(names)}).strict(),
  z.object({kind:z.literal("image"),dataUrl:z.string().max(MAX_ICON_DATA_URL,"O ícone deve ocupar até 128 KiB.").refine(validIconPng,"Imagem inválida: use PNG canônico de até 128 × 128 e 128 KiB.")}).strict(),
]);
export type ControlIcon = z.infer<typeof controlIconSchema>;
