"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { METRICS, RANGES, STATUS_LABEL, ago, fmtBytes, fmtPct } from "@/lib/api";
import { Bar, Card, ClassBadge, Empty, ErrorBox, Loading, Segmented, Stat, StatusBadge } from "@/components/ui";
import { Heatmap, TimeChart, PALETTE } from "@/components/charts";

const CHART_METRICS = ["gpu_util_percent", "unified_percent", "cpu_percent", "psi_memory_some_avg10", "disk_percent"] as const;
type SortKey = "gpu" | "mem" | "name" | "avail";

export default function Overview() {
  const [range, setRange] = useState<string>("24h");
  const [metric, setMetric] = useState<string>("gpu_util_percent");
  const [sort, setSort] = useState<SortKey>("gpu");
  const ov = useApi<any>(`/overview?window=${range === "1h" || range === "6h" ? "24h" : range}`, 120000, "all");
  const ts = useApi<any>(`/infrastructure/timeseries?metric=${metric}&range=${range}`, 300000, "all");
  const hm = useApi<any>(`/infrastructure/heatmap?metric=gpu_util_percent&days=14`);

  const rows = useMemo(() => {
    const r: any[] = ov.data?.machines ?? [];
    const g = (c: any) => c.latest?.gpu_util_percent;
    return [...r].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "mem") return (a.analysis.memory_mean ?? 999) - (b.analysis.memory_mean ?? 999);
      if (sort === "avail") return (b.latest?.unified_available_bytes ?? -1) - (a.latest?.unified_available_bytes ?? -1);
      return (a.analysis.gpu_mean ?? 999) - (b.analysis.gpu_mean ?? 999) || (g(a) ?? 999) - (g(b) ?? 999);
    });
  }, [ov.data, sort]);

  const chartData = useMemo(() => {
    if (!ts.data) return { data: [] as any[], series: [] as any[], gaps: [] as any[] };
    const ids = Object.keys(ts.data.machines);
    const map = new Map<number, any>();
    ids.forEach((id) => {
      for (const p of ts.data.machines[id].points) {
        const row = map.get(p.t) ?? { t: p.t };
        row[`m${id}`] = p[metric];
        map.set(p.t, row);
      }
    });
    return {
      data: [...map.values()].sort((a, b) => a.t - b.t),
      series: ids.map((id, i) => ({ key: `m${id}`, name: ts.data.machines[id].name, color: PALETTE[i % PALETTE.length] })),
      gaps: [] as any[],
    };
  }, [ts.data, metric]);

  const t = ov.data?.totals;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-medium text-navy-900">Visão geral da infraestrutura</h1>
        <p className="text-sm text-mute">Como os recursos computacionais das DGX Sparks estão sendo utilizados.</p>
      </header>

      {ov.loading && !ov.data ? <Loading /> : ov.error ? <ErrorBox message={ov.error} onRetry={ov.reload} /> : t && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Sparks" value={t.machines} />
            <Stat label="Online" value={t.online} hint={t.sem_comunicacao ? `${t.sem_comunicacao} sem comunicação` : undefined} tone={t.sem_comunicacao ? "warn" : undefined} />
            <Stat label="GPU média" value={fmtPct(t.gpu_avg_now)} hint="agora, máquinas online" />
            <Stat label="Mem. unificada" value={fmtPct(t.unified_avg_now)} hint="média agora" />
            <Stat label="Mem. disponível" value={fmtBytes(t.unified_available_bytes)} hint="soma das máquinas" />
            <Stat label="Subutilizadas" value={t.underutilized} hint={`janela ${ov.data.window}`} />
            <Stat label="Sob pressão" value={t.pressure} tone={t.pressure ? "warn" : undefined} />
            <Stat label="Alertas abertos" value={t.open_alerts} tone={t.open_alerts ? "warn" : undefined} />
          </div>

          <Card title="Comparativo das máquinas"
            actions={<Segmented label="Ordenar por" value={sort} onChange={setSort}
              options={[["gpu", "Menos GPU"], ["mem", "Menos memória"], ["avail", "Mais disponível"], ["name", "Nome"]]} />}>
            {rows.length === 0 ? (
              <Empty>Nenhuma máquina cadastrada. Cadastre as Sparks em <Link className="underline" href="/admin">Administração</Link> e instale o agente em cada uma.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="text-left text-xs text-mute">
                    <tr><th className="py-1">Máquina</th><th>Estado</th><th>GPU agora</th><th>GPU média ({ov.data.window})</th><th>Mem. unificada</th><th>CPU</th><th>Disco</th><th>Classificação</th><th>Atualização</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((m, i) => (
                      <tr key={m.id} className="border-t border-line align-middle">
                        <td className="py-2"><Link href={`/machines/${m.id}`} className="font-medium text-brand hover:underline">{m.name}</Link>
                          {i === 0 && sort === "gpu" && m.analysis.gpu_mean != null && <span className="ml-2 text-xs text-cyan-900">menos utilizada</span>}
                          <div className="text-xs text-mute">{(m.projects as any[]).map((p) => p.name).join(", ") || "sem projeto"}</div></td>
                        <td><StatusBadge status={m.status} /></td>
                        <td><Bar value={m.latest?.gpu_util_percent} /></td>
                        <td className="num">{fmtPct(m.analysis.gpu_mean, 1)}</td>
                        <td><Bar value={m.latest?.unified_percent} tone="warn" />
                          <div className="text-xs text-mute">{fmtBytes(m.latest?.unified_available_bytes)} livres</div></td>
                        <td><Bar value={m.latest?.cpu_percent} /></td>
                        <td><Bar value={m.latest?.disk_percent} /></td>
                        <td><ClassBadge k={m.analysis.classification.key} label={m.analysis.classification.label} />
                          <div className="text-xs text-mute">cobertura {fmtPct(m.analysis.coverage * 100)}</div></td>
                        <td className="text-xs text-mute">{ago(m.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Card title="Comparação temporal"
        actions={<>
          <select aria-label="Métrica" className="border border-line bg-white px-2 py-1 text-xs" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {CHART_METRICS.map((m) => <option key={m} value={m}>{METRICS[m].label}</option>)}
          </select>
          <Segmented label="Intervalo" value={range} onChange={setRange} options={RANGES as any} />
        </>}>
        {ts.loading && !ts.data ? <Loading /> : ts.error ? <ErrorBox message={ts.error} onRetry={ts.reload} /> :
          chartData.data.length === 0 ? <Empty>Ainda não há amostras suficientes neste intervalo.</Empty> :
            <TimeChart data={chartData.data} series={chartData.series} metric={metric} height={300} />}
        <p className="mt-2 text-xs text-mute">Linhas interrompidas indicam períodos sem coleta — não são utilização zero.</p>
      </Card>

      <Card title="Utilização da GPU por dia da semana e hora (últimos 14 dias, média da infraestrutura)">
        {hm.loading && !hm.data ? <Loading /> : hm.error ? <ErrorBox message={hm.error} /> :
          !hm.data?.sufficient ? <Empty>Dados insuficientes para o mapa de calor (são necessários alguns dias de coleta). Amostras até agora: {hm.data?.samples ?? 0}.</Empty> :
            <Heatmap grid={hm.data.grid} />}
      </Card>
    </div>
  );
}
