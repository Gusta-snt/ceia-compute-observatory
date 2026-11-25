"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Warning as AlertTriangle, CheckCircle as CheckCircle2, ArrowsOut as Maximize, X } from "@phosphor-icons/react";
import { useApi } from "@/lib/hooks";
import { fmtBytes, fmtPct } from "@/lib/api";
import { attention, recommend } from "@/lib/fleet";
import { ClassBadge, ErrorBox, Loading, Meter, Stat, StatusBadge } from "@/components/ui";

/**
 * Modo quiosque: uma tela só, tema escuro, letras grandes, para TV ou painel de parede.
 * Sem navegação, sem rotação automática de telas; os dados chegam pelo SSE e por polling de segurança.
 */
export default function Kiosk() {
  const ov = useApi<any>(`/overview?window=24h`, 60000, "all");
  const al = useApi<any>(`/alerts?status=open`, 60000);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    const prev = el.dataset.theme;
    el.dataset.theme = "dark";
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => { clearInterval(t); if (prev) el.dataset.theme = prev; else delete el.dataset.theme; };
  }, []);

  const machines: any[] = ov.data?.machines ?? [];
  const sorted = useMemo(() => [...machines].sort((a, b) => a.name.localeCompare(b.name)), [machines]);
  const issues = useMemo(() => attention(machines, al.data?.items ?? []), [machines, al.data]);
  const best = useMemo(() => recommend(machines, 1)[0], [machines]);
  const t = ov.data?.totals;

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-paper p-6 text-ink xl:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/ceia.png" alt="CEIA" className="h-10 w-auto" />
          <h1 className="text-2xl font-medium text-heading xl:text-3xl">DGX Sparks · infraestrutura</h1>
        </div>
        <div className="flex items-center gap-5">
          <span className="num text-2xl text-heading xl:text-3xl" suppressHydrationWarning>
            {now?.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}
          </span>
          <button onClick={fullscreen} className="btn inline-flex min-h-11 items-center gap-2 rounded border border-line-strong px-4 text-sm text-ink hover:bg-sunken">
            <Maximize size={16} aria-hidden />Tela cheia
          </button>
          <Link href="/" aria-label="Sair do modo quiosque" className="btn inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-line-strong text-ink hover:bg-sunken">
            <X size={18} aria-hidden />
          </Link>
        </div>
      </header>

      {ov.loading && !ov.data ? <Loading variant="stats" /> : ov.error ? <ErrorBox message={ov.error} onRetry={ov.reload} /> : t && (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section aria-label="Indicadores" className="grid grid-cols-2 content-center gap-x-8 gap-y-6 rounded-lg border border-line bg-surface p-6 md:grid-cols-4">
              <Stat size="lg" label="Online" value={`${t.online}/${t.machines}`} tone={t.sem_comunicacao ? "crit" : "ok"} />
              <Stat size="lg" label="GPU média agora" value={fmtPct(t.gpu_avg_now)} />
              <Stat size="lg" label="Memória disponível" value={fmtBytes(t.unified_available_bytes)} />
              <Stat size="lg" label="Sob pressão" value={t.pressure} tone={t.pressure ? "crit" : undefined} />
            </section>

            {issues.length ? (
              <section aria-label="Precisa de atenção" className="rounded-lg border border-crit-line bg-crit-bg p-6">
                <h2 className="flex items-center gap-2 text-xl font-medium text-crit-fg"><AlertTriangle size={22} aria-hidden />Precisa de atenção ({issues.length})</h2>
                <ul className="mt-3 space-y-2">
                  {issues.slice(0, 5).map((x) => (
                    <li key={x.key} className="flex items-start gap-3 text-lg text-ink">
                      <span aria-hidden className={`mt-2.5 h-2.5 w-2.5 shrink-0 rounded-full ${x.tone === "crit" ? "bg-crit" : "bg-warn"}`} />{x.text}
                    </li>
                  ))}
                  {issues.length > 5 && <li className="pl-5 text-base text-mute">e mais {issues.length - 5}</li>}
                </ul>
              </section>
            ) : (
              <section aria-label="Situação" className="flex flex-col justify-center gap-3 rounded-lg border border-ok-line bg-ok-bg p-6">
                <h2 className="flex items-center gap-2 text-xl font-medium text-ok-fg"><CheckCircle2 size={22} aria-hidden />Tudo normal</h2>
                {best && <p className="text-lg text-ink">Melhor opção agora: <strong className="font-medium text-heading">{best.name}</strong> <span className="text-mute">({best.why})</span></p>}
              </section>
            )}
          </div>

          <section aria-label="Máquinas" className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {sorted.map((m) => (
              <article key={m.id} className={`rounded-lg border bg-surface p-5 ${m.status === "sem_comunicacao" || m.analysis.classification.key === "pressao" ? "border-crit-line" : "border-line"}`}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-medium text-heading">{m.name}</h2>
                  <StatusBadge status={m.status} />
                </div>
                <div className="mt-1 truncate text-sm text-mute">{(m.projects as any[]).map((p) => p.name).join(", ") || "sem projeto"}</div>
                <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-base">
                  <dt className="text-mute">GPU</dt><dd><Meter size="lg" value={m.latest?.gpu_util_percent} label={`GPU de ${m.name}`} /></dd>
                  <dt className="text-mute">Memória</dt><dd><Meter size="lg" value={m.latest?.unified_percent} label={`Memória unificada de ${m.name}`} /></dd>
                </dl>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="num text-base text-ink">{fmtBytes(m.latest?.unified_available_bytes)} livres</span>
                  <ClassBadge k={m.analysis.classification.key} label={m.analysis.classification.label} />
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
