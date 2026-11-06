"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { refreshMe } from "@/lib/me";
import { Button, Field, inputCls } from "@/components/ui";

export default function Login() {
  const r = useRouter();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api("/auth/login", { method: "POST", json: { username: u, password: p } }); await refreshMe(); r.push("/"); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="bg-drift flex min-h-screen items-center justify-center bg-gradient-to-br from-ceia-dark via-ceia to-[#24479f] p-4">
      <form onSubmit={submit} className="anim-rise w-full max-w-sm space-y-4 bg-white p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.55)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/ceia-cor.png" alt="CEIA — Centro de Excelência em Inteligência Artificial" className="h-14 w-auto" />
        <h1 className="text-lg font-medium text-navy-900">CEIA Compute Observatory</h1>
        <Field label="Usuário"><input className={inputCls} value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></Field>
        <Field label="Senha"><input className={inputCls} type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
        {err && <div key={err} role="alert" className="anim-rise text-sm text-red-700">{err}</div>}
        <Button disabled={busy} className="w-full">{busy ? "Entrando…" : "Entrar"}</Button>
      </form>
    </div>
  );
}
