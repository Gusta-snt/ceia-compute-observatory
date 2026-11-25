// Leituras derivadas do /overview usadas pela visão geral e pelo modo quiosque.
import { fmtBytes, fmtPct } from "./api";

export type Attention = { key: string; tone: "crit" | "warn"; text: string; href: string };

/** O que precisa de atenção agora: sem comunicação, agente com problema, pressão de memória e alertas abertos. */
export function attention(machines: any[], alerts: any[] = []): Attention[] {
  const out: Attention[] = [];
  const alerted = new Set(alerts.map((a) => a.machine_id));
  for (const m of machines) {
    if (alerted.has(m.id)) { /* o alerta aberto já descreve o problema */ }
    else if (m.status === "sem_comunicacao") out.push({ key: `s${m.id}`, tone: "crit", text: `${m.name} está sem comunicação`, href: `/machines/${m.id}` });
    else if (m.status === "agente_com_problema") out.push({ key: `s${m.id}`, tone: "warn", text: `${m.name}: agente com problema`, href: `/machines/${m.id}` });
    if (m.analysis?.classification?.key === "pressao" && !alerted.has(m.id)) out.push({ key: `p${m.id}`, tone: "crit", text: `${m.name} está sob pressão de memória`, href: `/machines/${m.id}` });
  }
  for (const a of alerts) {
    out.push({ key: `a${a.id}`, tone: a.severity === "critical" ? "crit" : "warn", text: a.machine && !String(a.message).startsWith(a.machine) ? `${a.machine}: ${a.message}` : a.message, href: a.machine_id ? `/machines/${a.machine_id}` : "/alerts" });
  }
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "crit" ? -1 : 1));
}

/**
 * Melhor opção para rodar um job agora: máquinas online e fora de pressão, ordenadas pela memória
 * unificada disponível e, no empate, pela GPU em uso.
 */
export function recommend(machines: any[], n = 3) {
  return machines
    .filter((m) => m.status === "online" && m.analysis?.classification?.key !== "pressao" && m.latest?.unified_available_bytes != null)
    .sort((a, b) => (b.latest.unified_available_bytes - a.latest.unified_available_bytes) || ((a.latest.gpu_util_percent ?? 100) - (b.latest.gpu_util_percent ?? 100)))
    .slice(0, n)
    .map((m) => ({ ...m, why: `${fmtBytes(m.latest.unified_available_bytes)} livres · GPU ${fmtPct(m.latest.gpu_util_percent)} agora` }));
}
