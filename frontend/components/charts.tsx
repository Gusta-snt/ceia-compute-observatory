"use client";
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { METRICS } from "@/lib/api";

export const PALETTE = ["#2375e4", "#1bc7fa", "#023048", "#e07b00", "#7a4fd1", "#0a8f5a"];
const tfmt = (t: number, span: number) =>
  new Date(t * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", ...(span > 2 * 86400 ? { day: "2-digit", month: "2-digit" } : { hour: "2-digit", minute: "2-digit" }) });

type Series = { key: string; name: string; color?: string };
export function TimeChart({ data, series, metric, gaps = [], height = 260, domain }: {
  data: any[]; series: Series[]; metric: string; gaps?: { from: number; to: number }[]; height?: number; domain?: [number, number];
}) {
  const m = METRICS[metric];
  const span = data.length ? data[data.length - 1].t - data[0].t : 0;
  return (
    <div style={{ height }} role="img" aria-label={`Série temporal: ${m?.label ?? metric}`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e8edf1" vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => tfmt(t, span)} fontSize={11} tickLine={false} />
          <YAxis fontSize={11} width={52} tickLine={false} domain={domain ?? (m?.unit === "%" ? [0, 100] : ["auto", "auto"])}
            tickFormatter={(v) => (m?.unit === "%" ? `${v}%` : m?.fmt ? m.fmt(v) : v)} />
          <Tooltip labelFormatter={(t) => new Date((t as number) * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
            formatter={(v: any, n: any) => [v == null ? "indisponível" : m?.fmt(v) ?? v, n]} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {gaps.map((g, i) => (
            <ReferenceArea key={i} x1={g.from} x2={g.to} fill="#94a3b8" fillOpacity={0.15} stroke="none" ifOverflow="hidden" />
          ))}
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color ?? PALETTE[i % PALETTE.length]} dot={false}
              strokeWidth={1.6} connectNulls={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export function Heatmap({ grid, unit = "%" }: { grid: (number | null)[][]; unit?: string }) {
  const color = (v: number | null) => (v == null ? "#eef1f4" : `rgba(35,117,228,${0.12 + Math.min(1, v / 100) * 0.88})`);
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[10px]" aria-label="Mapa de calor por dia da semana e hora">
        <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} className="w-6 font-normal text-mute">{h}</th>)}</tr></thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <th className="pr-2 text-right font-normal text-mute">{DAYS[d]}</th>
              {row.map((v, h) => (
                <td key={h} title={`${DAYS[d]} ${h}h: ${v == null ? "sem dados" : v.toFixed(1) + unit}`} className="h-6 w-6" style={{ background: color(v) }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-mute">Horário de Brasília. Células cinza = sem dados (não representam utilização zero).</p>
    </div>
  );
}
