export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  let body = init?.body;
  if (init?.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  const r = await fetch(`/api/v1${path}`, { ...init, body, headers: { ...headers, ...(init?.headers as any) }, credentials: "same-origin" });
  if (r.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = "/login";
  }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new ApiError(r.status, msg);
  }
  return r.json();
}

export const fmtPct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${v.toFixed(d)}%`);
export function fmtBytes(v: number | null | undefined): string {
  if (v == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let x = v;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x >= 100 ? 0 : 1)} ${u[i]}`;
}
export const fmtRate = (v: number | null | undefined) => (v == null ? "—" : `${fmtBytes(v)}/s`);
export function fmtDur(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 5) return "agora";
  return `há ${fmtDur(Math.max(0, s))}`;
}

export const STATUS_LABEL: Record<string, string> = {
  online: "Online", sem_comunicacao: "Sem comunicação", agente_com_problema: "Agente com problema", dados_insuficientes: "Dados insuficientes",
};
export const METRICS: Record<string, { label: string; unit: string; fmt: (v: number) => string }> = {
  gpu_util_percent: { label: "Utilização da GPU", unit: "%", fmt: (v) => `${v.toFixed(1)}%` },
  unified_percent: { label: "Memória unificada", unit: "%", fmt: (v) => `${v.toFixed(1)}%` },
  cpu_percent: { label: "CPU", unit: "%", fmt: (v) => `${v.toFixed(1)}%` },
  psi_memory_some_avg10: { label: "Pressão de memória (PSI)", unit: "%", fmt: (v) => `${v.toFixed(1)}%` },
  disk_percent: { label: "Armazenamento", unit: "%", fmt: (v) => `${v.toFixed(1)}%` },
  gpu_temp_c: { label: "Temperatura da GPU", unit: "°C", fmt: (v) => `${v.toFixed(0)} °C` },
  gpu_power_w: { label: "Consumo da GPU", unit: "W", fmt: (v) => `${v.toFixed(0)} W` },
  net_rx_bps: { label: "Rede (recebido)", unit: "B/s", fmt: (v) => fmtRate(v) },
  net_tx_bps: { label: "Rede (enviado)", unit: "B/s", fmt: (v) => fmtRate(v) },
  disk_read_bps: { label: "Disco (leitura)", unit: "B/s", fmt: (v) => fmtRate(v) },
  disk_write_bps: { label: "Disco (escrita)", unit: "B/s", fmt: (v) => fmtRate(v) },
};
export const RANGES = [["1h", "1 h"], ["6h", "6 h"], ["24h", "24 h"], ["7d", "7 dias"], ["30d", "30 dias"]] as const;
