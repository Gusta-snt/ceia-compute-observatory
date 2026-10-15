"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { METRICS, RANGES, ago, fmtBytes, fmtDateTime, fmtDur, fmtPct } from "@/lib/api";
import { Bar, Card, ClassBadge, Empty, ErrorBox, Loading, Segmented, Stat, StatusBadge } from "@/components/ui";
import { TimeChart } from "@/components/charts";

const PANELS: { title: string; metrics: string[] }[] = [
  { title: "GPU", metrics: ["gpu_util_percent"] },
  { title: "Memória unificada e pressão (PSI)", metrics: ["unified_percent", "psi_memory_some_avg10"] },
  { title: "CPU", metrics: ["cpu_percent"] },
  { title: "Temperatura e consumo da GPU", metrics: ["gpu_temp_c", "gpu_power_w"] },
  { title: "Armazenamento (uso)", metrics: ["disk_percent"] },
  { title: "Rede", metrics: ["net_rx_bps", "net_tx_bps"] },
];

function MetricPanel({ id, title, metrics, range }: { id: string; title: string; metrics: string[]; range: string }) {
  const { data, loading, error, reload } = useApi<any>(`/machines/${id}/metrics?metrics=${metrics.join(",")}&range=${range}`, 300000, Number(id));
  const hasData = data?.points?.some((p: any) => metrics.some((m) => p[m] != null));
  return (
    <Card title={title}>
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> :
        !hasData ? <Empty>Sem dados disponíveis neste intervalo (métrica não suportada ou sem coleta).</Empty> :
          <>
            <TimeChart data={data.points} gaps={data.gaps} metric={metrics[0]} height={200}
              series={metrics.map((m) => ({ key: m, name: METRICS[m].label }))} />
            {data.gaps.length > 0 && <p className="mt-1 text-xs text-mute">{data.gaps.length} período(s) sem coleta (áreas cinzas).</p>}
          </>}
    </Card>
  );
}

const PROC_SORTS = [["cpu", "CPU"], ["gpu", "GPU"], ["mem", "Memória"], ["gpu_mem", "Memória GPU"]] as const;

function ProcessRanking({ id, range }: { id: string; range: string }) {
  const [sort, setSort] = useState<string>("cpu");
  const r = useApi<any>(`/machines/${id}/processes?range=${range}&sort=${sort}&limit=20`, 300000, Number(id));
  const rows: any[] = r.data?.processes ?? [];
  const n1 = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
  return (
    <Card title="Ranking de processos" actions={<Segmented label="Ordenar por" value={sort} onChange={setSort} options={PROC_SORTS as any} />}>
      {r.loading && !r.data ? <Loading /> : r.error ? <ErrorBox message={r.error} onRetry={r.reload} /> : !rows.length ? (
        <Empty>Nenhum processo registrado no período (agente sem coleta de processos ou máquina ociosa).</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-xs text-mute"><tr>
              <th className="py-1">#</th><th>Processo</th><th>Usuário</th>
              <th title="Σ CPU% × tempo; 1 = um núcleo cheio por 1 h">CPU núcleo·h</th><th>CPU média / máx</th>
              <th title="Σ GPU% × tempo; 1 = GPU inteira por 1 h">GPU·h</th><th>GPU média / máx</th>
              <th>Memória máx</th><th>Mem. GPU máx</th><th>Visto</th><th>Último</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.name}|${p.user}`} className="num border-t border-line align-top">
                  <td className="py-1.5">{p.rank}</td>
                  <td className="font-sans"><div className="font-medium">{p.name}</div>
                    {p.cmd_example && <div className="max-w-[360px] truncate font-mono text-xs text-mute" title={p.cmd_example}>{p.cmd_example}</div>}</td>
                  <td className="font-sans">{p.user ?? "—"}</td>
                  <td>{n1(p.cpu_core_hours, 2)}</td><td>{n1(p.cpu_avg)}% / {n1(p.cpu_max)}%</td>
                  <td>{n1(p.gpu_pct_hours, 2)}</td><td>{p.gpu_avg == null ? "—" : `${n1(p.gpu_avg)}% / ${n1(p.gpu_max)}%`}</td>
                  <td>{fmtBytes(p.mem_max_bytes)}</td><td>{fmtBytes(p.gpu_mem_max_bytes)}</td>
                  <td>{fmtDur(p.seen_seconds)}</td><td className="font-sans text-xs text-mute">{ago(p.last_seen)}</td>
                </tr>))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-mute">Agrupado por nome + usuário. CPU% é relativo a um núcleo (pode passar de 100%). Só entram processos que estavam no top do agente a cada coleta. No GB10 a memória de GPU por processo costuma não ser informada pelo driver.</p>
        </div>)}
    </Card>
  );
}

export default function MachinePage() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState("24h");
  const m = useApi<any>(`/machines/${id}`, 60000, Number(id));
  const s = useApi<any>(`/machines/${id}/summary?range=${range}`, 300000, Number(id));
  const av = useApi<any[]>(`/machines/${id}/availability?range=30d`);
  if (m.loading && !m.data) return <Loading />;
  if (m.error) return <ErrorBox message={m.error} onRetry={m.reload} />;
  const d = m.data, L = d.latest, st = s.data;
  const mt = (k: string) => st?.metrics?.[k];
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-navy-900">{d.name}</h1>
          <p className="text-sm text-mute">{[d.hostname, d.address, d.system?.gpu_name ?? d.hardware].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-3"><StatusBadge status={d.status} /><span className="text-xs text-mute">última comunicação {ago(d.last_seen)}</span>
          <Segmented label="Intervalo" value={range} onChange={setRange} options={RANGES as any} /></div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="GPU agora" value={fmtPct(L?.gpu_util_percent)} hint={L?.quality?.gpu_util_percent ? `fonte: ${L.quality.gpu_util_percent}` : undefined} />
        <Stat label="Memória unificada" value={fmtPct(L?.unified_percent)} hint={L ? `${fmtBytes(L.unified_used_bytes)} de ${fmtBytes(L.unified_total_bytes)}` : undefined} />
        <Stat label="Disponível" value={fmtBytes(L?.unified_available_bytes)} hint="memória unificada (CPU+GPU, mesmo pool)" />
        <Stat label="Pressão de memória" value={fmtPct(L?.psi_memory_some_avg10, 1)} hint="PSI some avg10" />
      </div>

      <Card title="Classificação e estatísticas do período">
        {s.loading && !st ? <Loading /> : s.error ? <ErrorBox message={s.error} onRetry={s.reload} /> : st && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ClassBadge k={st.classification.key} label={st.classification.label} />
              <span className="text-xs text-mute">confiança {st.classification.confidence} · cobertura {fmtPct(st.coverage * 100)} · {st.total_samples} amostras (5 min agregadas)</span>
            </div>
            <ul className="list-disc pl-5 text-sm">{st.classification.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
            {st.classification.caveats.map((c: string, i: number) => <p key={i} className="text-xs text-amber-800">⚠ {c}</p>)}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-left text-xs text-mute"><tr><th className="py-1">Métrica</th><th>Média</th><th>Média pond.</th><th>Mediana</th><th>P90</th><th>P95</th><th>Mín</th><th>Máx</th><th>Amostras válidas</th></tr></thead>
                <tbody>
                  {["gpu_util_percent", "unified_percent", "cpu_percent", "psi_memory_some_avg10", "disk_percent", "gpu_temp_c", "gpu_power_w"].map((k) => {
                    const x = mt(k);
                    return (
                      <tr key={k} className="num border-t border-line">
                        <td className="py-1.5 font-sans">{METRICS[k].label}</td>
                        {x?.available ? ["mean", "wmean", "median", "p90", "p95", "min", "max"].map((f) => <td key={f}>{x[f] == null ? "—" : x[f].toFixed(1)}</td>)
                          : <td colSpan={7} className="font-sans text-mute">indisponível / não suportado</td>}
                        <td>{x?.valid_samples ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><div className="text-xs text-mute">Ociosidade</div>{st.idle_fraction == null ? "—" : fmtPct(st.idle_fraction * 100)}</div>
              <div><div className="text-xs text-mute">Horas com atividade</div>{st.active_hours} h</div>
              <div><div className="text-xs text-mute">Indisponibilidades</div>{st.outages.count} ({fmtDur(st.outages.total_seconds)})</div>
              <div><div className="text-xs text-mute">Tendência da GPU</div>{st.trend_gpu_pp_per_week == null ? "dados insuficientes" : `${st.trend_gpu_pp_per_week > 0 ? "+" : ""}${st.trend_gpu_pp_per_week} p.p./semana`}</div>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {PANELS.map((p) => <MetricPanel key={p.title} id={id} title={p.title} metrics={p.metrics} range={range} />)}
      </div>

      <ProcessRanking id={id} range={range} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Armazenamento por sistema de arquivos">
          {!L?.filesystems?.length ? <Empty>Sem dados de armazenamento.</Empty> : (
            <table className="w-full text-sm"><tbody>
              {L.filesystems.map((f: any) => (
                <tr key={f.mount} className="border-t border-line first:border-0">
                  <td className="py-1.5 font-mono text-xs">{f.mount}</td><td className="text-xs text-mute">{f.fstype}</td>
                  <td><Bar value={f.percent} /></td><td className="num text-right text-xs">{fmtBytes(f.free_bytes)} livres / {fmtBytes(f.total_bytes)}</td>
                </tr>))}
            </tbody></table>)}
        </Card>
        <Card title="Eventos e períodos sem coleta (30 dias)">
          {av.loading ? <Loading /> : !av.data?.length ? <Empty>Nenhum evento registrado.</Empty> : (
            <ul className="space-y-1 text-sm">
              {av.data.slice(0, 12).map((e, i) => (
                <li key={i} className="flex items-center gap-2"><StatusBadge status={e.status} />
                  <span className="text-xs text-mute">{fmtDateTime(e.started_at)} → {e.ended_at ? fmtDateTime(e.ended_at) : "em andamento"}</span></li>))}
            </ul>)}
          <h3 className="mt-4 text-xs font-medium text-mute">Projetos associados</h3>
          <p className="text-sm">{d.projects.length ? d.projects.map((p: any) => `${p.name} (${p.kind})`).join(", ") : "Nenhum projeto associado."}</p>
          <h3 className="mt-4 text-xs font-medium text-mute">Exportar dados</h3>
          <p className="text-sm">
            <a className="text-brand underline" href={`/api/v1/export/samples?machine_id=${id}&range=${range}&format=csv`}>CSV</a>{" · "}
            <a className="text-brand underline" href={`/api/v1/export/samples?machine_id=${id}&range=${range}&format=json`}>NDJSON</a>
          </p>
        </Card>
      </div>
    </div>
  );
}
