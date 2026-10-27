import { parseDocument } from "../../lib/model.ts";
import type { Envelope, KeymapDocument } from "../../lib/model.ts";
import type { SyncResult } from "../../native/profile-sync.ts";
import type { ApplicationMode } from "../../lib/bindings.ts";

export async function loadProfiles(signal: AbortSignal): Promise<Envelope> {
  const response = await fetch("/api/profiles", { signal });
  if (!response.ok)
    throw new Error(
      "Não foi possível abrir os perfis locais. Verifique o servidor e tente novamente.",
    );
  const data = (await response.json()) as Envelope;
  return {
    revision: data.revision,
    document: parseDocument(data.document),
  };
}
export async function saveProfiles(
  document: KeymapDocument,
  revision: number,
): Promise<Envelope> {
  const response = await fetch("/api/profiles", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision, document }),
  });
  const data = (await response.json()) as Envelope & { error?: string };
  if (!response.ok)
    throw new Error(data.error || "Não foi possível salvar. Tente novamente.");
  return data;
}
export function downloadProfiles(document: KeymapDocument) {
  const blob = new Blob([JSON.stringify(document, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = "meu-keymap.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function syncProfiles(document:KeymapDocument,revision:number,mode:ApplicationMode):Promise<SyncResult>{
  const response=await fetch("/api/profiles/sync",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({document,revision,mode})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??"Não foi possível salvar e aplicar.");
  return {...data,saved:{...data.saved,document:parseDocument(data.saved.document)}} as SyncResult;
}
