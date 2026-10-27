import { useEffect, useState } from "react";
import type { Runtime } from "../../lib/engine";
import { animated } from "../../lib/engine";
export function usePreviewClock(runtime: Runtime): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!animated(runtime, Date.now())) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (!animated(runtime, time)) clearInterval(timer);
    }, 80);
    return () => clearInterval(timer);
  }, [runtime]);
  return now;
}
