import { useEffect, useState } from "react";
import type { Observations } from "../../lib/conditions";
import { observationsSchema } from "../../lib/conditions";
interface MonitorState {
  sample: Observations | null;
  status: "off" | "connecting" | "live" | "error";
}
export function useSignalMonitor(enabled: boolean): MonitorState {
  const [state, setState] = useState<MonitorState>({
    sample: null,
    status: "off",
  });
  useEffect(() => {
    if (!enabled) {
      setState({ sample: null, status: "off" });
      return;
    }
    setState({ sample: null, status: "connecting" });
    const source = new EventSource("/api/signals");
    let active = true;
    source.onmessage = (event) => {
      if (!active) return;
      try {
        const parsed = observationsSchema.safeParse(JSON.parse(event.data));
        if (parsed.success) {
          const value = parsed.data;
          setState({
            sample: value,
            status:
              value.processNames === null && !Object.keys(value.values).length
                ? "error"
                : "live",
          });
        } else setState({ sample: null, status: "error" });
      } catch {
        setState({ sample: null, status: "error" });
      }
    };
    source.onerror = () => {
      if (active) setState({ sample: null, status: "error" });
    };
    return () => {
      active = false;
      source.close();
    };
  }, [enabled]);
  return state;
}
