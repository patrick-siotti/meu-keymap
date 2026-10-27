import { useCallback, useEffect, useState } from "react";
import { deviceEventSchema } from "../../lib/device";
import type { DeviceInventory, DeviceInput } from "../../lib/device";
import { loadDevice } from "../services/device";
export function useDeviceConnection() {
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [listening, setListening] = useState(false),
    [ready, setReady] = useState(false);
  const [events, setEvents] = useState<DeviceInput[]>([]),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadDevice(controller.signal)
      .then((value) => {
        setInventory(value);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            "Não foi possível ler os dispositivos. Tente atualizar a conexão.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!listening) {
      setReady(false);
      return;
    }
    let active = true;
    setError("");
    setReady(false);
    const source = new EventSource("/api/device/events");
    const fail = (message: string) => {
      if (active) {
        setError(message);
        setListening(false);
      }
      source.close();
    };
    source.onmessage = (message) => {
      if (!active) return;
      try {
        const parsed = deviceEventSchema.safeParse(JSON.parse(message.data));
        if (!parsed.success) {
          fail("O leitor retornou uma resposta inválida.");
          return;
        }
        const event = parsed.data;
        if (event.type === "error") {
          fail(event.message);
          return;
        }
        setReady(true);
        if (event.type === "inventory") {
          setInventory(event);
          if (!event.devices.length) {
            fail(
              "O macropad foi desconectado. Reconecte o cabo e atualize a conexão.",
            );
            return;
          }
        }
        if (event.type === "input")
          setEvents((all) => [event, ...all].slice(0, 100));
      } catch {
        fail("Não foi possível interpretar a entrada do macropad.");
      }
    };
    source.onerror = () =>
      fail(
        "A conexão com o leitor foi interrompida. Inicie o teste novamente.",
      );
    return () => {
      active = false;
      source.close();
    };
  }, [listening]);
  const start = useCallback(() => {
    setEvents([]);
    setListening(true);
  }, []);
  const stop = useCallback(() => setListening(false), []);
  const reload = useCallback(() => {
    setListening(false);
    setRefresh((v) => v + 1);
  }, []);
  return {
    inventory,
    loading,
    error,
    listening,
    ready,
    events,
    start,
    stop,
    reload,
  };
}
