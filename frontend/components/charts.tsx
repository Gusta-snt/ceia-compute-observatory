"use client";
import { useMemo, useState } from "react";
import { LineChart } from "@mui/x-charts/LineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { useDrawingArea, useXScale } from "@mui/x-charts/hooks";
import { ptBR } from "@mui/x-charts/locales";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { useResolvedTheme } from "@/lib/theme";
import { METRICS } from "@/lib/api";

// Cores vêm dos tokens (globals.css), então o tema escuro do quiosque troca junto.
// Até 8 séries com cor própria; da 9ª em diante ficam em cinza (nunca repete cor).
export const PALETTE = Array.from({ length: 8 }, (_, i) => `var(--data-${i + 1})`);
export const seriesColor = (i: number) => (i < PALETTE.length ? PALETTE[i] : "var(--data-rest)");
const TZ = "America/Sao_Paulo";
const tfmt = (d: Date, span: number) =>
  d.toLocaleString("pt-BR", { timeZone: TZ, ...(span > 2 * 86400 ? { day: "2-digit", month: "2-digit" } : { hour: "2-digit", minute: "2-digit" }) });

/** Períodos sem coleta desenhados como faixas cinzas atrás das linhas. */
function Gaps({ gaps }: { gaps: { from: number; to: number }[] }) {
  const x = useXScale<"time">();
  const { top, height } = useDrawingArea();
  return <g>{gaps.map((g, i) => {
    const a = x(new Date(g.from * 1000)) as number, b = x(new Date(g.to * 1000)) as number;
    return <rect key={i} x={Math.min(a, b)} y={top} width={Math.abs(b - a)} height={height} fill="var(--data-rest)" fillOpacity={0.2} />;
  })}</g>;
}

// Eixos, grade e legenda seguem os tokens; o MUI desenha o resto.
const sx = {
  "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { stroke: "var(--chart-grid) !important" },
  "& .MuiChartsAxis-tickLabel": { fill: "var(--chart-axis) !important", fontSize: "12px !important" },
  "& .MuiChartsGrid-line": { stroke: "var(--chart-grid)" },
  "& .MuiChartsLegend-root": { color: "rgb(var(--ink))", fontSize: 13 },
};

type Series = { key: string; name: string; color?: string };
export function TimeChart({ data, series, metric, gaps = [], height = 260, domain, syncId }: {
  data: any[]; series: Series[]; metric: string; gaps?: { from: number; to: number }[]; height?: number; domain?: [number, number]; syncId?: string;
}) {
  const m = METRICS[metric];
  // Série com unidade diferente da primeira (ex.: W junto de °C) ganha eixo próprio à direita.
  const second = series.find((s) => METRICS[s.key] && m && METRICS[s.key].unit !== m.unit);
  const m2 = second ? METRICS[second.key] : undefined;
  const span = data.length ? data[data.length - 1].t - data[0].t : 0;
  // Clicar na legenda destaca uma série; clicar de novo volta a mostrar todas.
  const [focus, setFocus] = useState<string | null>(null);
  const dataset = useMemo(() => data.map((r) => ({ ...r, date: new Date(r.t * 1000) })), [data]);
  const yfmt = (mm: typeof m) => (v: number | null) => (v == null ? "indisponível" : mm?.fmt ? mm.fmt(v) : String(v));
  const pct = (mm: typeof m) => mm?.unit === "%";
  // Rótulos do eixo: taxas em formato curto ("763 MB/s", sem casa decimal acima de 10) para caber.
  const axisFmt = (mm: typeof m) => (v: number) => {
    if (pct(mm)) return `${v}%`;
    if (mm?.unit === "B/s") {
      const u = ["B", "KB", "MB", "GB"]; let i = 0, x = v;
      while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
      return `${x >= 10 || x === 0 ? x.toFixed(0) : x.toFixed(1)}\u00a0${u[i]}/s`;
    }
    return mm?.fmt ? mm.fmt(v) : String(v);
  };
  const axisW = (mm: typeof m) => (mm?.unit === "B/s" ? 72 : 52);
  void syncId; // MUI não sincroniza cursores entre gráficos; mantido na assinatura.
  // O tooltip e a legenda do MUI vêm do tema dele; acompanha o data-theme da página.
  const mode = useResolvedTheme();
  const muiTheme = useMemo(() => createTheme({ palette: { mode, background: { paper: mode === "dark" ? "#091e2f" : "#ffffff" } },
    typography: { fontFamily: "Roboto, system-ui, sans-serif" } }), [mode]);
  return (
    <ThemeProvider theme={muiTheme}>
    <div role="img" aria-label={`Série temporal: ${m?.label ?? metric}`}>
      <LineChart
        dataset={dataset}
        height={height}
        localeText={ptBR.components.MuiChartsLocalizationProvider.defaultProps.localeText}
        margin={{ top: 8, right: m2 ? 0 : 12, bottom: 0, left: 0 }}
        grid={{ horizontal: true }}
        sx={sx}
        hideLegend={series.length < 2}
        highlightedItem={focus ? { seriesId: focus } : null}
        slotProps={{ legend: { onItemClick: (_e: any, item: any) => setFocus((f) => (f === item.seriesId ? null : String(item.seriesId))) } as any }}
        xAxis={[{ dataKey: "date", scaleType: "time", valueFormatter: (d: Date, ctx: any) => ctx?.location === "tooltip"
          ? d.toLocaleString("pt-BR", { timeZone: TZ }) : tfmt(d, span), tickLabelStyle: { fontSize: 12 } }]}
        yAxis={[
          { id: "l", width: axisW(m), min: domain?.[0] ?? (pct(m) ? 0 : undefined), max: domain?.[1] ?? (pct(m) ? 100 : undefined),
            valueFormatter: axisFmt(m) },
          ...(m2 ? [{ id: "r", position: "right" as const, width: axisW(m2), min: pct(m2) ? 0 : undefined, max: pct(m2) ? 100 : undefined,
            valueFormatter: axisFmt(m2) }] : []),
        ]}
        series={series.map((s, i) => {
          const sm = METRICS[s.key] ?? m;
          return {
            id: s.key, dataKey: s.key, label: s.name, color: s.color ?? seriesColor(i), showMark: false, connectNulls: false, curve: "linear" as const,
            yAxisId: m2 && METRICS[s.key]?.unit === m2.unit ? "r" : "l", valueFormatter: yfmt(sm),
            highlightScope: { highlight: "series" as const, fade: "global" as const },
          };
        })}
      >
        {gaps.length > 0 && <Gaps gaps={gaps} />}
        {pct(m) && <ChartsReferenceLine y={90} axisId="l" lineStyle={{ stroke: "rgb(var(--crit-dot))", strokeDasharray: "4 4", strokeOpacity: 0.7 }} />}
      </LineChart>
    </div>
    </ThemeProvider>
  );
}

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DAYS_FULL = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const STEPS = [0, 25, 50, 75, 100];
// Escala sequencial de 5 degraus (não contínua), com legenda visível.
const level = (v: number) => (v < 12.5 ? 0 : v < 37.5 ? 1 : v < 62.5 ? 2 : v < 87.5 ? 3 : 4);
const LEVEL_LABEL = ["ociosa", "baixa", "moderada", "alta", "muito alta"];
const SHADE = [0.12, 0.3, 0.5, 0.72, 1];
const color = (v: number | null) => (v == null ? "rgb(var(--sunken))" : `rgb(var(--action) / ${SHADE[level(v)]})`);
const hh = (h: number) => `${String(h).padStart(2, "0")}h`;

export type HeatDetail = { min: number; max: number; days: number; samples: number; machines: { id: number; name: string; mean: number }[] } | null;
type Cell = { d: number; h: number };

/**
 * Mapa de calor dia da semana × hora com painel de detalhes à direita.
 * Passar o mouse mostra o quadrado; clicar fixa (clicar de novo solta). Setas movem a seleção.
 */
export function Heatmap({ grid, details, unit = "%" }: { grid: (number | null)[][]; details?: HeatDetail[][]; unit?: string }) {
  const [hover, setHover] = useState<Cell | null>(null);
  const [pinned, setPinned] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Cell>({ d: 0, h: 0 });
  const shown = hover ?? pinned;
  const fmt = (v: number) => `${v.toFixed(1)}${unit}`;

  // Extremos para o resumo quando nada está selecionado.
  const ext = useMemo(() => {
    let hi: (Cell & { v: number }) | null = null, lo: (Cell & { v: number }) | null = null;
    grid.forEach((row, d) => row.forEach((v, h) => {
      if (v == null) return;
      if (!hi || v > hi.v) hi = { d, h, v };
      if (!lo || v < lo.v) lo = { d, h, v };
    }));
    return { hi: hi as (Cell & { v: number }) | null, lo: lo as (Cell & { v: number }) | null };
  }, [grid]);

  function onKey(e: React.KeyboardEvent) {
    const mv: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (mv[e.key]) {
      e.preventDefault();
      const n = { d: Math.max(0, Math.min(6, focus.d + mv[e.key][0])), h: Math.max(0, Math.min(23, focus.h + mv[e.key][1])) };
      setFocus(n); setPinned(n);
      (e.currentTarget.querySelector(`[data-c="${n.d}-${n.h}"]`) as HTMLElement | null)?.focus();
    } else if (e.key === "Escape") setPinned(null);
  }
  const toggle = (c: Cell) => { setFocus(c); setPinned((p) => (p && p.d === c.d && p.h === c.h ? null : c)); };
  const isPinned = (d: number, h: number) => pinned?.d === d && pinned?.h === h;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="relative overflow-x-auto">
          <table className="heat w-full min-w-[640px] table-fixed border-separate border-spacing-[3px] text-label" onKeyDown={onKey} onMouseLeave={() => setHover(null)}>
            <caption className="sr-only">Utilização média por dia da semana (linhas) e hora do dia (colunas), horário de Brasília. Use as setas para navegar.</caption>
            <colgroup><col className="w-10" />{Array.from({ length: 24 }, (_, h) => <col key={h} />)}</colgroup>
            <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col" className="pb-1 text-center font-normal text-mute">{h % 3 === 0 ? h : <span className="sr-only">{h}</span>}</th>)}</tr></thead>
            <tbody>
              {grid.map((row, d) => (
                <tr key={d}>
                  <th scope="row" className="pr-2 text-right font-normal text-mute">{DAYS[d]}</th>
                  {row.map((v, h) => {
                    const txt = `${DAYS_FULL[d]}, ${hh(h)}: ${v == null ? "sem dados" : fmt(v)}`;
                    const on = isPinned(d, h);
                    return (
                      <td key={h} className="p-0">
                        <button type="button" data-c={`${d}-${h}`} aria-label={txt} aria-pressed={on}
                          tabIndex={focus.d === d && focus.h === h ? 0 : -1}
                          onMouseEnter={() => setHover({ d, h })} onFocus={() => setFocus({ d, h })} onClick={() => toggle({ d, h })}
                          className={`block h-8 w-full rounded-[3px] outline-none transition-shadow duration-100 hover:ring-2 hover:ring-heading focus-visible:ring-2 focus-visible:ring-brand ${on ? "ring-2 ring-heading ring-offset-1 ring-offset-surface" : ""}`}
                          style={{ background: color(v) }} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-label text-mute">
          <span className="flex items-center gap-1" aria-hidden>
            {STEPS.map((s, i) => <span key={s} className="flex flex-col items-center gap-0.5"><span className="h-3 w-7 rounded-[2px]" style={{ background: `rgb(var(--action) / ${SHADE[i]})` }} />{s}%</span>)}
          </span>
          <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-[2px] bg-sunken" />sem dados (não é zero)</span>
          <span>Horário de Brasília. Clique num quadrado para fixar os detalhes.</span>
        </div>
      </div>

      <aside aria-live="polite" className="rounded-md border border-line bg-paper/60 p-4 lg:min-h-[290px]">
        {shown ? (() => {
          const v = grid[shown.d][shown.h];
          const det = details?.[shown.d]?.[shown.h] ?? null;
          return (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-label font-medium text-mute">{DAYS_FULL[shown.d]}, {hh(shown.h)}–{hh((shown.h + 1) % 24)}</div>
                  <div className="num mt-1 text-stat font-medium text-heading">{v == null ? "—" : fmt(v)}</div>
                  <div className="text-label text-mute">{v == null ? "sem coleta neste horário" : `média da infraestrutura · ${LEVEL_LABEL[level(v)]}`}</div>
                </div>
                {pinned && !hover && <button onClick={() => setPinned(null)} className="link text-label text-mute">Soltar</button>}
              </div>
              {det && (
                <>
                  <dl className="grid grid-cols-3 gap-2 border-y border-line py-3 text-label">
                    <div><dt className="text-mute">Mínima</dt><dd className="num text-sm text-ink">{fmt(det.min)}</dd></div>
                    <div><dt className="text-mute">Máxima</dt><dd className="num text-sm text-ink">{fmt(det.max)}</dd></div>
                    <div><dt className="text-mute">Dias</dt><dd className="num text-sm text-ink">{det.days}</dd></div>
                  </dl>
                  <div>
                    <div className="mb-2 text-label font-medium text-mute">Por máquina</div>
                    <ul className="space-y-1.5">
                      {det.machines.map((m) => (
                        <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_96px_44px] items-center gap-2 text-sm">
                          <span className="truncate text-ink">{m.name}</span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-sunken"><span className="block h-full origin-left rounded-full bg-brand" style={{ transform: `scaleX(${Math.min(100, m.mean) / 100})` }} /></span>
                          <span className="num text-right text-ink">{m.mean.toFixed(0)}{unit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="text-label text-mute">{det.samples.toLocaleString("pt-BR")} amostras em {det.days} {det.days === 1 ? "dia" : "dias"}.</p>
                </>
              )}
            </div>
          );
        })() : (
          <div className="space-y-4">
            <div className="text-label font-medium text-mute">Resumo dos 14 dias</div>
            {ext.hi && <div><div className="text-label text-mute">Horário mais ocupado</div>
              <div className="text-base text-heading"><span className="font-medium">{DAYS_FULL[ext.hi.d]}, {hh(ext.hi.h)}</span> · <span className="num">{fmt(ext.hi.v)}</span></div></div>}
            {ext.lo && <div><div className="text-label text-mute">Horário mais livre</div>
              <div className="text-base text-heading"><span className="font-medium">{DAYS_FULL[ext.lo.d]}, {hh(ext.lo.h)}</span> · <span className="num">{fmt(ext.lo.v)}</span></div></div>}
            <p className="text-label text-mute">Passe o mouse sobre um quadrado para ver a média de cada máquina, a faixa de valores e quantos dias entraram na conta.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
