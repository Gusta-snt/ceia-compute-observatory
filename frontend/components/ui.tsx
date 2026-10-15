"use client";
import { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/api";

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border border-line bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-medium text-navy-900">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="border border-line bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-mute">{label}</div>
      <div className={`num mt-1 text-2xl font-medium ${tone === "warn" ? "text-amber-700" : "text-navy-900"}`}>{value}</div>
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
export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block border px-2 py-0.5 text-xs ${STATUS_STYLE[status] ?? STATUS_STYLE.dados_insuficientes}`}>{STATUS_LABEL[status] ?? status}</span>;
}

const CLASS_STYLE: Record<string, string> = {
  subutilizada: "bg-cyan-50 text-cyan-900 border-cyan-300",
  moderada: "bg-blue-50 text-blue-900 border-blue-200",
  alta: "bg-orange-50 text-orange-900 border-orange-200",
  pressao: "bg-red-50 text-red-900 border-red-300",
  insuficiente: "bg-slate-100 text-slate-700 border-slate-300",
};
export function ClassBadge({ k, label }: { k: string; label: string }) {
  return <span className={`inline-block border px-2 py-0.5 text-xs ${CLASS_STYLE[k] ?? CLASS_STYLE.insuficiente}`}>{label}</span>;
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return <div role="status" className="py-10 text-center text-sm text-mute">{label}</div>;
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
      {onRetry && <button onClick={onRetry} className="ml-3 underline">Tentar novamente</button>}
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
      <div className="h-1.5 w-20 bg-slate-200">
        <div className={`h-full ${v >= 90 ? "bg-red-600" : tone === "warn" ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${v}%` }} />
      </div>
      <span className="num w-10 text-right text-xs">{v.toFixed(0)}%</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-line">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={v === value}
          className={`px-2.5 py-1 text-xs ${v === value ? "bg-navy-900 text-white" : "bg-white text-ink hover:bg-slate-50"}`}>{l}</button>
      ))}
    </div>
  );
}

export function Button({ children, variant = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const s = variant === "primary" ? "bg-navy-900 text-white hover:bg-navy-800" : variant === "danger" ? "bg-red-700 text-white hover:bg-red-800" : "border border-line bg-white hover:bg-slate-50";
  return <button {...p} className={`px-3 py-1.5 text-sm disabled:opacity-50 ${s} ${p.className ?? ""}`}>{children}</button>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-xs text-mute">{label}</span>{children}</label>;
}
export const inputCls = "w-full border border-line bg-white px-2 py-1.5 text-sm";
