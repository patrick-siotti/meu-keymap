import type { KeymapDocument } from "./model.ts";

export function removeProfile(
  document: KeymapDocument,
  id: string,
): KeymapDocument {
  const index = document.profiles.findIndex((profile) => profile.id === id);
  if (index < 0 || document.profiles.length === 1) return document;
  const profiles = document.profiles.filter((profile) => profile.id !== id);
  return {
    ...document,
    profiles,
    activeProfile:
      document.activeProfile === id
        ? profiles[Math.max(0, index - 1)]!.id
        : document.activeProfile,
  };
}
