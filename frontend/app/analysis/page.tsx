"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { fmtBytes, fmtDur, fmtPct } from "@/lib/api";
import { Bar, Card, ClassBadge, Empty, ErrorBox, Loading, Segmented } from "@/components/ui";

const R = [["24h", "24 h"], ["7d", "7 dias"], ["30d", "30 dias"], ["90d", "90 dias"]] as const;

export default function Analysis() {
  const [range, setRange] = useState("7d");
  const cap = useApi<any>("/analysis/capacity");
  const cmp = useApi<any>(`/analysis/compare?range=${range}`);
  const f = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-medium text-navy-900">Análise histórica e capacidade</h1>
        <p className="text-sm text-mute">Evidências para decidir a alocação de projetos. Os limites de classificação são configuráveis em Administração.</p>
      </header>

      <Card title="Recomendação de alocação">
        {cap.loading && !cap.data ? <Loading /> : cap.error ? <ErrorBox message={cap.error} onRetry={cap.reload} /> :
          !cap.data.machines.length ? <Empty>Sem máquinas cadastradas.</Empty> : (
            <div className="space-y-3">
              {cap.data.machines.map((m: any) => {
                const w = m.windows[m.primary_window];
                return (
                  <article key={m.id} className="border border-line p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link href={`/machines/${m.id}`} className="font-medium text-brand hover:underline">{m.name}</Link>
                      <ClassBadge k={m.result.key} label={m.result.label} />
                      <span className="text-xs text-mute">janela {m.primary_window} · confiança {m.result.confidence} · cobertura {fmtPct(w.coverage * 100)}</span>
                      {m.result.eligible && <span className="text-xs font-medium text-cyan-900">candidata a receber outro projeto</span>}
                      {m.result.key === "subutilizada" && !m.result.eligible && <span className="text-xs text-amber-800">confiança baixa: não recomendar automaticamente</span>}
                    </div>
                    <ul className="mt-2 list-disc pl-5 text-sm">{m.result.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                    {m.result.caveats.map((c: string, i: number) => <p key={i} className="mt-1 text-xs text-amber-800">⚠ {c}</p>)}
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-mute">
                      <span>Memória livre (estimada em P95): {m.result.headroom_gb == null ? "—" : `${m.result.headroom_gb} GB`}</span>
                      <span>Disco livre: {fmtBytes(w.capacity?.disk_free_bytes)}</span>
                      <span>Projetos: {m.projects.length ? m.projects.map((p: any) => p.name).join(", ") : "nenhum"}</span>
                    </div>
                    <div className="mt-2 flex gap-4 text-xs">
                      {["24h", "7d", "30d"].map((k) => (
                        <span key={k}>{k}: <ClassBadge k={m.windows[k].classification.key} label={m.windows[k].classification.label} /></span>
                      ))}
                    </div>
                  </article>
                );
              })}
              <p className="text-xs text-mute">{cap.data.disclaimer}</p>
            </div>
          )}
      </Card>

      <Card title="Comparação entre máquinas"
        actions={<>
          <Segmented label="Período" value={range} onChange={setRange} options={R as any} />
          <a className="text-xs text-brand underline" href={`/api/v1/analysis/report?range=${range}&format=csv`}>CSV</a>
          <a className="text-xs text-brand underline" href={`/api/v1/analysis/report?range=${range}&format=md`}>Relatório (MD)</a>
          <a className="text-xs text-brand underline" href={`/api/v1/analysis/report?range=${range}&format=json`}>JSON</a>
        </>}>
        {cmp.loading && !cmp.data ? <Loading /> : cmp.error ? <ErrorBox message={cmp.error} onRetry={cmp.reload} /> :
          !cmp.data.machines.length ? <Empty>Sem dados.</Empty> : (
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[1000px] text-sm">
                <thead className="text-left text-xs text-mute font-sans">
                  <tr><th className="py-1">Máquina</th><th>Classe</th><th>Cobertura</th><th>GPU média</th><th>GPU mediana</th><th>GPU P90</th><th>GPU P95</th><th>GPU máx</th><th>Mem. média</th><th>Mem. P95</th><th>CPU média</th><th>Ocioso</th><th>Horas ativas</th><th>Indisp.</th></tr>
                </thead>
                <tbody>
                  {cmp.data.machines.map((m: any) => {
                    const g = m.metrics.gpu_util_percent, u = m.metrics.unified_percent, c = m.metrics.cpu_percent;
                    return (
                      <tr key={m.id} className="border-t border-line">
                        <td className="py-1.5 font-sans font-medium">{m.name}</td>
                        <td className="font-sans"><ClassBadge k={m.classification.key} label={m.classification.label} /></td>
                        <td>{fmtPct(m.coverage * 100)}</td>
                        <td>{g.available ? <Bar value={g.mean} /> : "n/d"}</td>
                        <td>{f(g.median)}</td><td>{f(g.p90)}</td><td>{f(g.p95)}</td><td>{f(g.max)}</td>
                        <td>{f(u.mean)}</td><td>{f(u.p95)}</td><td>{f(c.mean)}</td>
                        <td>{m.idle_fraction == null ? "—" : fmtPct(m.idle_fraction * 100)}</td>
                        <td>{m.active_hours}</td>
                        <td>{m.outages.count} ({fmtDur(m.outages.total_seconds)})</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-mute">Percentis sobre médias de 5 min. “n/d” = métrica não suportada ou sem coleta; períodos sem dados não entram como zero.</p>
            </div>
          )}
      </Card>
    </div>
  );
}
