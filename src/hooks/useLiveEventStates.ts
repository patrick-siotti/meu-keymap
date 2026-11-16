import { useEffect, useState } from "react";
import { runtimeStatus } from "../services/application";

export function useLiveEventStates(profileId: string, enabled: boolean) {
  const [states, setStates] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    setStates(null);
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const status = await runtimeStatus(controller.signal);
        if (!controller.signal.aborted)
          setStates(status.active && status.profileId === profileId ? status.events : null);
      } catch {
        if (!controller.signal.aborted) setStates(null);
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 100);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, profileId]);

  return enabled ? states : null;
}
