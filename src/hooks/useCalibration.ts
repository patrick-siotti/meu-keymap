import { useEffect, useRef, useState } from "react";
import {
  CHANNELS,
  deviceFingerprint,
  normalizedSignal,
} from "../../lib/calibration";
import type { Calibration, CalibrationEnvelope } from "../../lib/calibration";
import type { DeviceInput } from "../../lib/device";
import { loadCalibration, saveCalibration } from "../services/calibration";
import { useDeviceConnection } from "./useDeviceConnection";

export function useCalibration() {
  const device = useDeviceConnection();
  const [envelope, setEnvelope] = useState<CalibrationEnvelope | null>(null),
    [layer, setLayer] = useState(0),
    [selected, setSelected] = useState("key-1:press");
  const [capturing, setCapturing] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [packets, setPackets] = useState(0),
    [needLayer, setNeedLayer] = useState(false);
  const current = useRef<CalibrationEnvelope | null>(null),
    pending = useRef<Calibration | null>(null),
    fingerprint = useRef("");
  const capture = useRef<{
      layer: number;
      channel: string;
      startedAt: number;
      samples: DeviceInput[];
    } | null>(null),
    seen = useRef(new WeakSet<DeviceInput>());
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null),
    deadline = useRef<ReturnType<typeof setTimeout> | null>(null),
    alive = useRef(true);
  function cancel() {
    if (quiet.current) clearTimeout(quiet.current);
    if (deadline.current) clearTimeout(deadline.current);
    capture.current = null;
    setCapturing(false);
  }
  async function persist(document: Calibration) {
    if (!current.current) return;
    pending.current = document;
    setSaving(true);
    setError("");
    try {
      const saved = await saveCalibration(document, current.current.revision);
      current.current = saved;
      pending.current = null;
      if (alive.current) {
        setEnvelope(saved);
        setNotice("Identificação salva neste computador.");
      }
    } catch (problem) {
      if (alive.current) setError((problem as Error).message);
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  function finish() {
    const sample = capture.current;
    cancel();
    if (!sample || !current.current) return;
    if (sample.channel === "layer:press") setNeedLayer(true);
    if (!normalizedSignal(sample.samples).length) {
      setError("Não recebemos um código de ativação. Tente novamente.");
      return;
    }
    const binding = {
      layer: sample.layer,
      channel: sample.channel,
      samples: sample.samples,
      capturedAt: Date.now(),
    };
    const document = {
      ...current.current.document,
      fingerprint: fingerprint.current,
      layerSwitch:
        sample.channel === "layer:press"
          ? ("unknown" as const)
          : current.current.document.layerSwitch,
      bindings: [
        ...current.current.document.bindings.filter(
          (b) => !(b.layer === sample.layer && b.channel === sample.channel),
        ),
        binding,
      ],
    };
    void persist(document);
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    loadCalibration(controller.signal)
      .then((value) => {
        current.current = value;
        setEnvelope(value);
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError((problem as Error).message);
      });
    return () => {
      alive.current = false;
      controller.abort();
      if (quiet.current) clearTimeout(quiet.current);
      if (deadline.current) clearTimeout(deadline.current);
    };
  }, []);
  useEffect(() => {
    if (!device.inventory?.devices.length) return;
    fingerprint.current = deviceFingerprint(device.inventory);
    if (!device.loading && !device.listening && !device.error) device.start();
  }, [
    device.inventory,
    device.loading,
    device.listening,
    device.error,
    device.start,
  ]);
  useEffect(() => {
    const fresh = device.events.filter((e) => !seen.current.has(e)).reverse();
    for (const event of fresh) {
      seen.current.add(event);
      if (
        capture.current &&
        event.at >= capture.current.startedAt &&
        capture.current.samples.length < 64
      )
        capture.current.samples.push(event);
    }
    if (fresh.length && capture.current) {
      setPackets(capture.current.samples.length);
      if (quiet.current) clearTimeout(quiet.current);
      quiet.current = setTimeout(finish, 600);
    }
  }, [device.events]);
  useEffect(() => {
    if (device.error) {
      cancel();
      setError(device.error);
    }
  }, [device.error]);
  const mismatch =
    !!device.inventory?.devices.length &&
    !!envelope?.document.bindings.length &&
    envelope.document.fingerprint !== deviceFingerprint(device.inventory!);
  function arm(channel = selected, bank = layer) {
    if (
      !device.ready ||
      !current.current ||
      saving ||
      pending.current ||
      mismatch ||
      needLayer
    )
      return;
    cancel();
    setSelected(channel);
    setLayer(bank);
    setError("");
    setNotice("");
    setPackets(0);
    for (const event of device.events) seen.current.add(event);
    capture.current = {
      channel,
      layer: bank,
      samples: [],
      startedAt: Date.now(),
    };
    setCapturing(true);
    deadline.current = setTimeout(() => {
      if (capture.current?.samples.length) finish();
      else {
        cancel();
        if (channel === "layer:press") setNeedLayer(true);
        setError(
          channel === "layer:press"
            ? "Este botão não enviou código ao Windows. Ele pode trocar a camada só no aparelho."
            : "Nenhum código recebido. Confira a camada do aparelho e tente novamente.",
        );
      }
    }, 9000);
  }
  function select(channel: string) {
    if (saving || pending.current || needLayer) return;
    cancel();
    setSelected(channel);
    setError("");
    setNotice("");
    if (
      !envelope?.document.bindings.some(
        (b) => b.layer === layer && b.channel === channel,
      )
    )
      arm(channel);
  }
  return {
    device,
    envelope,
    layer,
    selected,
    capturing,
    saving,
    error,
    notice,
    packets,
    mismatch,
    needLayer,
    hasPending: !!pending.current,
    arm,
    cancel,
    select,
    changeLayer: (value: number) => {
      if (saving || pending.current) return;
      cancel();
      setLayer(value);
      if (needLayer) setSelected("key-1:press");
      setNeedLayer(false);
      setError("");
      setNotice("");
    },
    retry: () => {
      if (pending.current) void persist(pending.current);
    },
    discard: () => {
      pending.current = null;
      setError("");
      setNotice("");
    },
    markInternal: () => {
      cancel();
      setNeedLayer(true);
      if (current.current)
        void persist({
          ...current.current.document,
          fingerprint: fingerprint.current,
          layerSwitch: "internal",
        });
    },
    next: () => {
      const index = CHANNELS.findIndex((c) => c.id === selected);
      select(CHANNELS[index >= 25 ? 0 : (index + 1) % 25]!.id);
    },
  };
}
