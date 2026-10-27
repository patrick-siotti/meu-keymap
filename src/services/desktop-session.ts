// Started outside React: StrictMode, screen changes and hidden tabs do not detach it.
let stream: EventSource | null = null;
export async function connectDesktopSession(): Promise<void> {
  const marker = document.querySelector<HTMLMetaElement>('meta[name="keymap-browser-session"]');
  if (!marker) return; // Technical -SemAbrir has no window lifecycle.
  const ticket = marker.content; marker.remove();
  const response = await fetch("/api/desktop/bootstrap", { method: "POST", headers: { "x-keymap-tab-ticket": ticket }, credentials: "same-origin" });
  if (!response.ok) throw new Error("A sessão local não foi conectada. Reabra pelo atalho Meu Keymap.");
  stream = new EventSource("/api/desktop/tabs");
  // Keep the object alive; no pagehide/unload beacon that could kill a reload.
  stream.addEventListener("message", () => {});
}
