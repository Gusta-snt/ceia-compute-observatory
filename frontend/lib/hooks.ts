"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export type LiveSample = { machine_id: number; ts: string; values: Record<string, number | null>; accepted: number };

// Uma única conexão SSE (/api/v1/stream) compartilhada por todos os componentes da página.
const listeners = new Set<(s: LiveSample) => void>();
let source: EventSource | null = null;

function connect() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/v1/stream", { withCredentials: true });
  source.addEventListener("sample", (e) => {
    const s = JSON.parse((e as MessageEvent).data) as LiveSample;
    listeners.forEach((fn) => fn(s));
  });
}

export function useLive(fn: (s: LiveSample) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const l = (s: LiveSample) => ref.current(s);
    listeners.add(l);
    connect();
    return () => {
      listeners.delete(l);
      if (!listeners.size && source) { source.close(); source = null; }
    };
  }, []);
}

/**
 * refreshMs: polling de segurança. live: recarrega quando chega uma amostra pelo broadcast
 * ("all" = qualquer máquina, número = só aquela máquina), no máximo a cada 5 s.
 */
export function useApi<T = any>(path: string | null, refreshMs = 0, live?: "all" | number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const lastLive = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    try {
      const d = await api<T>(path);
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (id === seq.current) setError(e.message || "Erro ao carregar");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  useLive((s) => {
    if (live === undefined || (live !== "all" && live !== s.machine_id)) return;
    const now = Date.now();
    if (now - lastLive.current < 5000) return;
    lastLive.current = now;
    load();
  });
  return { data, error, loading, reload: load };
}
