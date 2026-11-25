"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Warning as AlertTriangle, CheckCircle as CheckCircle2, Monitor } from "@phosphor-icons/react";
import { useApi } from "@/lib/hooks";
import { METRICS, RANGES, ago, fmtBytes, fmtPct } from "@/lib/api";
import { attention, recommend } from "@/lib/fleet";
import { Card, ClassBadge, Empty, ErrorBox, Loading, Meter, Segmented, Stat, StatGroup, StatusBadge } from "@/components/ui";
import { Select } from "@/components/Select";
import { Heatmap, TimeChart, seriesColor } from "@/components/charts";

const CHART_METRICS = ["gpu_util_percent", "unified_percent", "cpu_percent", "psi_memory_some_avg10", "disk_percent", "disk_read_bps", "disk_write_bps"] as const;
type SortKey = "gpu" | "mem" | "avail" | "cpu" | "disk" | "name";
const STALE_S = 300;

export default function Overview() {
  const [range, setRange] = useState<string>("24h");
  const [metric, setMetric] = useState<string>("gpu_util_percent");
  const [sort, setSort] = useState<SortKey>("gpu");
  const ov = useApi<any>(`/overview?window=${range === "1h" || range === "6h" ? "24h" : range}`, 120000, "all");
  const al = useApi<any>(`/alerts?status=open`, 60000);
  const ts = useApi<any>(`/infrastructure/timeseries?metric=${metric}&range=${range}`, 300000, "all");
  const hm = useApi<any>(`/infrastructure/heatmap?metric=gpu_util_percent&days=14`);

  const machines: any[] = ov.data?.machines ?? [];
  const rows = useMemo(() => {
    const L = (c: any, k: string) => c.latest?.[k] ?? 999;
    return [...machines].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "mem") return (a.analysis.memory_mean ?? 999) - (b.analysis.memory_mean ?? 999);
      if (sort === "avail") return (b.latest?.unified_available_bytes ?? -1) - (a.latest?.unified_available_bytes ?? -1);
      if (sort === "cpu") return L(a, "cpu_percent") - L(b, "cpu_percent");
      if (sort === "disk") return L(a, "disk_percent") - L(b, "disk_percent");
      return (a.analysis.gpu_mean ?? 999) - (b.analysis.gpu_mean ?? 999) || L(a, "gpu_util_percent") - L(b, "gpu_util_percent");
    });
  }, [machines, sort]);
  const issues = useMemo(() => attention(machines, al.data?.items ?? []), [machines, al.data]);
  const best = useMemo(() => recommend(machines), [machines]);

  const chartData = useMemo(() => {
    if (!ts.data) return { data: [] as any[], series: [] as any[] };
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
      series: ids.map((id, i) => ({ key: `m${id}`, name: ts.data.machines[id].name, color: seriesColor(i) })),
    };
  }, [ts.data, metric]);

  const t = ov.data?.totals;
  const th = (k: SortKey, label: React.ReactNode, cls = "") => (
    <th aria-sort={sort === k ? (k === "avail" ? "descending" : "ascending") : undefined} className={cls}>
      <button onClick={() => setSort(k)} className={`inline-flex items-center gap-1 text-left hover:text-ink ${sort === k ? "text-ink" : ""}`}>
        {label}{sort === k && <span aria-hidden>{k === "avail" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
  return (
    <div className="page space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-heading">Visão geral da infraestrutura</h1>
          <p className="mt-1 text-base text-mute">Como os recursos computacionais das DGX Sparks estão sendo utilizados.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/kiosk" className="link inline-flex items-center gap-1.5 text-sm text-ink"><Monitor size={16} aria-hidden />Modo quiosque</Link>
          <Segmented label="Intervalo" value={range} onChange={setRange} options={RANGES as any} />
        </div>
      </header>

      {ov.loading && !ov.data ? <Loading variant="stats" /> : ov.error ? <ErrorBox message={ov.error} onRetry={ov.reload} /> : t && (
        <>
          {/* Atenção primeiro: só aparece com destaque quando há algo errado. */}
          {issues.length ? (
            <section aria-label="Precisa de atenção" className="rounded-lg border border-crit-line bg-crit-bg px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-medium text-crit-fg"><AlertTriangle size={18} aria-hidden />Precisa de atenção ({issues.length})</h2>
              <ul className="mt-2 grid gap-x-6 gap-y-1 md:grid-cols-2">
                {issues.slice(0, 8).map((x) => (
                  <li key={x.key} className="flex items-start gap-2 text-sm">
                    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${x.tone === "crit" ? "bg-crit" : "bg-warn"}`} />
                    <Link href={x.href} className="link text-ink">{x.text}</Link>
                  </li>
                ))}
              </ul>
              {issues.length > 8 && <Link href="/alerts" className="link mt-2 inline-block text-sm text-crit-fg">Ver todos os {issues.length}</Link>}
            </section>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ok-fg"><CheckCircle2 size={16} aria-hidden />Todas as {t.machines} Sparks online, sem pressão de memória e sem alertas abertos.</p>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Card title="Melhor opção para rodar agora" bodyClass="p-2">
              {!best.length ? <div className="p-2"><Empty>Nenhuma Spark online com memória disponível no momento.</Empty></div> : (
                <ol className="divide-y divide-line">
                  {best.map((m, i) => (
                    <li key={m.id}>
                      <Link href={`/machines/${m.id}`} className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-sunken">
                        <span className={`num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${i === 0 ? "bg-heading text-surface" : "bg-sunken text-ink"}`}>{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-heading">{m.name}</span>
                          <span className="block truncate text-label text-mute">{(m.projects as any[]).map((p) => p.name).join(", ") || "sem projeto"}</span>
                        </span>
                        <span className="num whitespace-nowrap text-right text-sm text-ink">{m.why}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <StatGroup label="Uso agora">
                <Stat label="GPU média" value={fmtPct(t.gpu_avg_now)} />
                <Stat label="Mem. unificada" value={fmtPct(t.unified_avg_now)} />
                <Stat label="Mem. disponível" value={fmtBytes(t.unified_available_bytes)} hint="soma das máquinas" />
              </StatGroup>
              <StatGroup label={`Frota e período (${ov.data.window})`}>
                <Stat label="Online" value={`${t.online}/${t.machines}`} tone={t.sem_comunicacao ? "crit" : undefined}
                  hint={t.sem_comunicacao ? `${t.sem_comunicacao} sem comunicação` : "todas respondendo"} />
                <Stat label="Subutilizadas" value={t.underutilized} />
                <Stat label="Sob pressão" value={t.pressure} tone={t.pressure ? "crit" : undefined} />
              </StatGroup>
            </div>
          </div>

          <Card title="Comparativo das máquinas" bodyClass="p-0 xl:px-4 xl:pb-2 xl:pt-3">
            {rows.length === 0 ? (
              <div className="p-4"><Empty>Nenhuma máquina cadastrada. Cadastre as Sparks em <Link className="link" href="/admin">Administração</Link> e instale o agente em cada uma.</Empty></div>
            ) : (
              <>
                {/* Telas largas: tabela ordenável pelo cabeçalho (precisa de ~1000 px ao lado do menu). */}
                <div className="hidden xl:block">
                  <table className="w-full text-sm [&_thead_th]:align-bottom">
                    <thead className={`text-left text-label text-mute ${rows.length > 12 ? "sticky top-0 z-10 bg-surface" : ""}`}>
                      <tr>{th("name", "Máquina")}<th>Estado</th>{th("gpu", "GPU")}
                        {th("avail", "Mem. unificada")}{th("cpu", "CPU")}{th("disk", "Disco")}<th>Classificação</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((m) => {
                        const stale = m.last_seen && (Date.now() - new Date(m.last_seen).getTime()) / 1000 > STALE_S;
                        return (
                          <tr key={m.id} className="row-link border-t border-line align-middle">
                            <td><Link href={`/machines/${m.id}`} className="row-target whitespace-nowrap font-medium text-heading">{m.name}</Link>
                              <div className="text-label text-mute">{(m.projects as any[]).map((p) => p.name).join(", ") || "sem projeto"}</div></td>
                            <td><StatusBadge status={m.status} title={`Última comunicação ${ago(m.last_seen)}`} />
                              {stale && <div className="mt-0.5 text-label text-warn-fg">{ago(m.last_seen)}</div>}</td>
                            <td><Meter value={m.latest?.gpu_util_percent} mark={m.analysis.gpu_mean} label={`GPU de ${m.name}`} /></td>
                            <td><Meter value={m.latest?.unified_percent} label={`Memória unificada de ${m.name}`} />
                              <div className="text-label text-mute">{fmtBytes(m.latest?.unified_available_bytes)} livres</div></td>
                            <td><Meter value={m.latest?.cpu_percent} label={`CPU de ${m.name}`} /></td>
                            <td><Meter value={m.latest?.disk_percent} label={`Disco de ${m.name}`} /></td>
                            <td><ClassBadge k={m.analysis.classification.key} label={m.analysis.classification.label} />
                              <div className="text-label text-mute">cobertura {fmtPct(m.analysis.coverage * 100)}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Até telas médias: cartões (2 colunas a partir de sm), sem rolagem lateral. */}
                <div className="xl:hidden">
                  <div className="border-b border-line px-4 py-3">
                    <div className="flex items-center justify-between gap-3 text-label text-mute">Ordenar por
                      <Select label="Ordenar por" value={sort} onChange={setSort} options={[
                        { value: "gpu", label: "Menos GPU" }, { value: "mem", label: "Menos memória" }, { value: "avail", label: "Mais disponível" }, { value: "name", label: "Nome" },
                      ]} />
                    </div>
                  </div>
                  <ul className="grid sm:grid-cols-2">
                    {rows.map((m) => (
                      <li key={m.id} className="border-b border-line last:border-b-0 sm:odd:border-r sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
                        <Link href={`/machines/${m.id}`} className="block space-y-2 px-4 py-3 active:bg-sunken">
                          <div className="flex items-start justify-between gap-3">
                            <div><div className="font-medium text-heading">{m.name}</div>
                              <div className="text-label text-mute">{(m.projects as any[]).map((p) => p.name).join(", ") || "sem projeto"}</div></div>
                            <StatusBadge status={m.status} />
                          </div>
                          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-label text-mute">
                            GPU<Meter value={m.latest?.gpu_util_percent} mark={m.analysis.gpu_mean} label={`GPU de ${m.name}`} />
                            Memória<Meter value={m.latest?.unified_percent} label={`Memória unificada de ${m.name}`} />
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <ClassBadge k={m.analysis.classification.key} label={m.analysis.classification.label} />
                            <span className="text-label text-mute">{fmtBytes(m.latest?.unified_available_bytes)} livres</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      <Card title="Comparação temporal"
        actions={<Select label="Métrica" value={metric} onChange={setMetric}
          options={CHART_METRICS.map((m) => ({ value: m, label: METRICS[m].label }))} />}>
        {ts.loading && !ts.data ? <Loading variant="chart" height={300} /> : ts.error ? <ErrorBox message={ts.error} onRetry={ts.reload} /> :
          chartData.data.length === 0 ? <Empty>Ainda não há amostras suficientes neste intervalo.</Empty> :
            <TimeChart data={chartData.data} series={chartData.series} metric={metric} height={300} />}
        <p className="mt-2 max-w-[62ch] text-label text-mute">Linhas interrompidas indicam períodos sem coleta, não utilização zero. Clique numa máquina da legenda para destacá-la.</p>
      </Card>

      <Card title="Utilização da GPU por dia da semana e hora (14 dias)">
        {hm.loading && !hm.data ? <Loading variant="chart" height={260} /> : hm.error ? <ErrorBox message={hm.error} /> :
          !hm.data?.sufficient ? <Empty>Dados insuficientes para o mapa de calor (são necessários alguns dias de coleta). Amostras até agora: {hm.data?.samples ?? 0}.</Empty> :
            <Heatmap grid={hm.data.grid} details={hm.data.details} />}
      </Card>
    </div>
  );
}
