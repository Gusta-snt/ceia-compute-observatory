"use client";
import { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/api";

export function Card({ title, actions, children, className = "", bodyClass = "p-4" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
          <h2 className="text-base font-medium text-heading">{title}</h2>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

type Tone = "ok" | "warn" | "crit";
const TONE_TEXT: Record<Tone, string> = { ok: "text-ok-fg", warn: "text-warn-fg", crit: "text-crit-fg" };

/** Indicador. O valor troca com um fade curto quando muda; nada conta a partir de zero. */
export function Stat({ label, value, hint, tone, size = "md" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; size?: "md" | "lg" }) {
  return (
    <div className="min-w-0">
      <div className="text-label font-medium text-mute">{label}</div>
      <div className={`num mt-1 font-medium ${size === "lg" ? "text-[56px] leading-[60px]" : "text-stat"} ${tone ? TONE_TEXT[tone] : "text-heading"}`}>
        <span key={String(value)} className="anim-tick inline-block whitespace-nowrap">{value}</span>
      </div>
      {hint && <div className="mt-1 text-label text-mute">{hint}</div>}
    </div>
  );
}

/** Grupo de indicadores num único card: menos caixas, rótulo do grupo em cima. */
export function StatGroup({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={`rounded-lg border border-line bg-surface px-4 py-3 ${className}`}>
      <h2 className="mb-3 text-label font-medium text-heading">{label}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-6 gap-y-4">{children}</div>
    </section>
  );
}

const STATUS_TONE: Record<string, string> = { online: "ok", sem_comunicacao: "crit", agente_com_problema: "warn", dados_insuficientes: "unknown" };
const BOX: Record<string, string> = {
  ok: "border-ok-line bg-ok-bg text-ok-fg", warn: "border-warn-line bg-warn-bg text-warn-fg", crit: "border-crit-line bg-crit-bg text-crit-fg",
  idle: "border-idle-line bg-idle-bg text-idle-fg", unknown: "border-unknown-line bg-unknown-bg text-unknown-fg",
};
const DOT: Record<string, string> = { ok: "bg-ok", warn: "bg-warn", crit: "bg-crit", idle: "bg-idle", unknown: "bg-unknown" };

/** Estado da máquina. Online é só ponto + texto; os estados anormais ganham caixa. */
export function StatusBadge({ status, title }: { status: string; title?: string }) {
  const t = STATUS_TONE[status] ?? "unknown";
  const label = STATUS_LABEL[status] ?? status;
  if (t === "ok") {
    return <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-ink"><span aria-hidden className={`h-2 w-2 rounded-full ${DOT[t]}`} />{label}</span>;
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-label font-medium ${BOX[t]}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[t]}`} />{label}
    </span>
  );
}

/** Classificação: só as que pedem ação (pressão, subutilizada) ganham selo; o resto é texto. */
const CLASS_TONE: Record<string, string> = { subutilizada: "idle", pressao: "crit", alta: "warn" };
export function ClassBadge({ k, label }: { k: string; label: string }) {
  const t = CLASS_TONE[k];
  if (k === "subutilizada" || k === "pressao") return <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-label font-medium ${BOX[t]}`}>{label}</span>;
  return <span className={`whitespace-nowrap text-sm ${t === "warn" ? "text-warn-fg" : "text-mute"}`}>{label}</span>;
}

/** Selo genérico com tom semântico. */
export function Tag({ tone = "unknown", children }: { tone?: keyof typeof BOX; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-label font-medium ${BOX[tone]}`}>{children}</span>;
}

/** Bloco de mensagem: confirmação, aviso ou erro, sempre com texto (nunca só cor). */
export function Notice({ tone = "ok", children, role }: { tone?: "ok" | "warn" | "crit"; children: ReactNode; role?: string }) {
  return <div role={role ?? (tone === "crit" ? "alert" : "status")} className={`rounded-md border px-3 py-2 text-sm ${BOX[tone]}`}>{children}</div>;
}

export function Loading({ label = "Carregando…", variant = "lines", height = 240 }: { label?: string; variant?: "lines" | "table" | "chart" | "stats"; height?: number }) {
  return (
    <div role="status" className="anim-fade py-2">
      <span className="sr-only">{label}</span>
      {variant === "chart" ? <div aria-hidden className="skeleton rounded-md" style={{ height }} /> :
        variant === "stats" ? <div aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-lg" />)}</div> :
          variant === "table" ? <div aria-hidden className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-8 rounded" />)}</div> :
            <div aria-hidden className="space-y-2.5">{[92, 78, 85, 60].map((w, i) => <div key={i} className="skeleton h-3 rounded" style={{ width: `${w}%` }} />)}</div>}
    </div>
  );
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className={`rounded-md border px-4 py-3 text-sm ${BOX.crit}`}>
      {message}
      {onRetry && <button onClick={onRetry} className="link ml-3 font-medium">Tentar novamente</button>}
    </div>
  );
}
export function Restricted() {
  return (
    <div className="page space-y-6">
      <h1 className="text-2xl font-medium text-heading">Acesso restrito</h1>
      <Empty>Esta área é só para administradores. Se precisar de acesso, fale com um administrador da central.</Empty>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line bg-surface px-4 py-8 text-center text-base text-mute">{children}</div>;
}

/** Medidor 0–100 %. Faixas: < 70 neutro (ação), 70–89 atenção, ≥ 90 crítico. `mark` desenha um traço (ex.: média). */
export function Meter({ value, label, mark, size = "md" }: { value: number | null | undefined; label: string; mark?: number | null; size?: "md" | "lg"; tone?: string }) {
  if (value == null) return <span className="text-label text-mute" title="Indisponível ou não suportado">n/d</span>;
  const v = Math.max(0, Math.min(100, value));
  const fill = v >= 90 ? "bg-crit" : v >= 70 ? "bg-warn" : "bg-brand";
  return (
    <div className={`flex items-center gap-2 ${size === "lg" ? "w-full" : ""}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}
      title={mark != null ? `${label}: ${v.toFixed(0)}% agora · média ${mark.toFixed(1)}%` : undefined}>
      <div className={`relative overflow-hidden rounded-full bg-sunken ${size === "lg" ? "h-2.5 flex-1" : "h-1.5 w-24"}`}>
        <div className={`h-full origin-left rounded-full transition-[transform,background-color] duration-500 ease-out ${fill}`} style={{ transform: `scaleX(${v / 100})` }} />
        {mark != null && <span aria-hidden className="absolute -top-px bottom-[-1px] w-0.5 bg-heading" style={{ left: `calc(${Math.max(0, Math.min(100, mark))}% - 1px)` }} />}
      </div>
      <span className={`num w-9 text-right ${size === "lg" ? "text-base" : "text-sm"}`}>{v.toFixed(0)}%</span>
    </div>
  );
}
/** Compatibilidade: telas antigas ainda chamam Bar. */
export const Bar = ({ value, label = "Uso" }: { value: number | null | undefined; label?: string; tone?: string }) => <Meter value={value} label={label} />;

const ctl = "min-h-9 coarse:min-h-11";
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded border border-line bg-surface p-0.5">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={v === value}
          className={`${ctl} whitespace-nowrap rounded-[3px] px-3 text-sm transition-colors duration-150 ${v === value ? "bg-heading text-surface" : "text-ink hover:bg-sunken"}`}>{l}</button>
      ))}
    </div>
  );
}

/** Dois estilos: primário (preenchido, um por vista) e secundário (contorno). `danger` é o secundário em vermelho. */
export function Button({ children, variant = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const s = variant === "primary" ? "border-heading bg-heading text-surface hover:bg-heading/85"
    : variant === "danger" ? "border-crit-line bg-surface text-crit-fg hover:bg-crit-bg"
      : "border-line-strong bg-surface text-ink hover:bg-sunken";
  return <button {...p} className={`btn inline-flex min-h-11 items-center justify-center gap-2 rounded border px-5 text-sm font-medium disabled:opacity-50 ${s} ${p.className ?? ""}`}>{children}</button>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-label font-medium text-mute">{label}</span>{children}</label>;
}
export const inputCls = "min-h-10 w-full rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-brand focus:shadow-[0_0_0_3px_rgb(var(--action)/.15)] focus:outline-none";
