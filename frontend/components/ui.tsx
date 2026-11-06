"use client";
import { ReactNode, useEffect, useRef, useState } from "react";
import { STATUS_LABEL } from "@/lib/api";

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border border-line bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-medium text-navy-900">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Número que conta do valor anterior até o novo (600 ms); inteiros continuam inteiros. */
export function CountUp({ value, ms = 600 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(0);   // começa em 0 também no servidor (sem divergência na hidratação)
  const from = useRef(0);
  useEffect(() => {
    if (reducedMotion()) { from.current = value; setShown(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const v = a + (value - a) * (1 - Math.pow(1 - k, 3));
      from.current = v; setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{Number.isInteger(value) ? Math.round(shown) : shown.toFixed(1)}</>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="border border-line bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-mute">{label}</div>
      <div className={`num mt-1 text-2xl font-medium transition-colors duration-300 ${tone === "warn" ? "text-amber-700" : "text-navy-900"}`}>
        {typeof value === "number" ? <CountUp value={value} /> : <span key={String(value)} className="anim-tick inline-block">{value}</span>}
      </div>
      {hint && <div className="mt-0.5 text-xs text-mute">{hint}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  online: "bg-emerald-50 text-emerald-800 border-emerald-200",
  sem_comunicacao: "bg-red-50 text-red-800 border-red-200",
  agente_com_problema: "bg-amber-50 text-amber-800 border-amber-200",
  dados_insuficientes: "bg-slate-100 text-slate-700 border-slate-300",
};
const STATUS_DOT: Record<string, string> = { online: "bg-emerald-500", sem_comunicacao: "bg-red-500", agente_com_problema: "bg-amber-500" };
export function StatusBadge({ status }: { status: string }) {
  const dot = STATUS_DOT[status] ?? "bg-slate-400";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 text-xs transition-colors duration-300 ${STATUS_STYLE[status] ?? STATUS_STYLE.dados_insuficientes}`}>
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        {status === "online" && <span className={`ping-soft absolute inset-0 rounded-full ${dot}`} />}
        <span className={`relative h-1.5 w-1.5 rounded-full ${dot}`} />
      </span>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const CLASS_STYLE: Record<string, string> = {
  subutilizada: "bg-cyan-50 text-cyan-900 border-cyan-300",
  moderada: "bg-blue-50 text-blue-900 border-blue-200",
  alta: "bg-orange-50 text-orange-900 border-orange-200",
  pressao: "bg-red-50 text-red-900 border-red-300",
  insuficiente: "bg-slate-100 text-slate-700 border-slate-300",
};
export function ClassBadge({ k, label }: { k: string; label: string }) {
  return <span className={`inline-block whitespace-nowrap border px-2 py-0.5 text-xs transition-colors duration-300 ${CLASS_STYLE[k] ?? CLASS_STYLE.insuficiente}`}>{label}</span>;
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div role="status" className="anim-fade space-y-2.5 py-4">
      <span className="sr-only">{label}</span>
      {[92, 78, 85, 60].map((w, i) => <div key={i} aria-hidden className="skeleton h-3" style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />)}
    </div>
  );
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
      {onRetry && <button onClick={onRetry} className="ml-3 underline transition-colors hover:text-red-950">Tentar novamente</button>}
    </div>
  );
}
export function Restricted() {
  return (
    <div className="page space-y-5">
      <h1 className="text-xl font-medium text-navy-900">Acesso restrito</h1>
      <Empty>Esta área é só para administradores. Se precisar de acesso, fale com um administrador da central.</Empty>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-line bg-white px-4 py-8 text-center text-sm text-mute">{children}</div>;
}

export function Bar({ value, tone = "brand" }: { value: number | null | undefined; tone?: "brand" | "warn" }) {
  if (value == null) return <span className="text-xs text-mute" title="Indisponível ou não suportado">n/d</span>;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2" aria-label={`${v.toFixed(0)}%`}>
      <div className="h-1.5 w-16 overflow-hidden bg-slate-200">
        <div className={`anim-grow h-full transition-[width,background-color] duration-700 ease-out ${v >= 90 ? "bg-red-600" : tone === "warn" ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${v}%` }} />
      </div>
      <span className="num w-8 text-right text-xs">{v.toFixed(0)}%</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-line">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={v === value}
          className={`whitespace-nowrap px-2.5 py-1 text-xs transition-colors duration-200 ${v === value ? "bg-navy-900 text-white" : "bg-white text-ink hover:bg-slate-100"}`}>{l}</button>
      ))}
    </div>
  );
}

export function Button({ children, variant = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const s = variant === "primary" ? "bg-navy-900 text-white hover:bg-navy-800" : variant === "danger" ? "bg-red-700 text-white hover:bg-red-800" : "border border-line bg-white hover:bg-slate-50";
  return <button {...p} className={`px-3 py-1.5 text-sm transition-[background-color,border-color,transform,opacity] duration-150 active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0 ${s} ${p.className ?? ""}`}>{children}</button>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-xs text-mute">{label}</span>{children}</label>;
}
export const inputCls = "w-full border border-line bg-white px-2 py-1.5 text-sm transition-[border-color,box-shadow] duration-150 hover:border-slate-300 focus:border-brand focus:shadow-[0_0_0_3px_rgba(35,117,228,.15)] focus:outline-none";
