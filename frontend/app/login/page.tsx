"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
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
    try { await api("/auth/login", { method: "POST", json: { username: u, password: p } }); r.push("/"); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 bg-white p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/ceia.png" alt="CEIA" className="h-12" />
        <h1 className="text-lg font-medium text-navy-900">CEIA Compute Observatory</h1>
        <Field label="Usuário"><input className={inputCls} value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></Field>
        <Field label="Senha"><input className={inputCls} type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
        {err && <div role="alert" className="text-sm text-red-700">{err}</div>}
        <Button disabled={busy} className="w-full">{busy ? "Entrando…" : "Entrar"}</Button>
      </form>
    </div>
  );
}
