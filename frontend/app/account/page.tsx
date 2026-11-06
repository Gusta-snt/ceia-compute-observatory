"use client";
import { useState } from "react";
import { api, fmtDateTime } from "@/lib/api";
import { ROLE_LABEL, useMe } from "@/lib/me";
import { Button, Card, Field, Loading, inputCls } from "@/components/ui";

export default function Account() {
  const { me, loading } = useMe();
  const [f, setF] = useState({ current: "", new: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading || !me) return <Loading />;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.new !== f.confirm) { setMsg({ ok: false, t: "A confirmação não confere com a nova senha." }); return; }
    setBusy(true);
    try {
      await api("/auth/password", { method: "POST", json: { current: f.current, new: f.new } });
      setMsg({ ok: true, t: "Senha alterada. Outras sessões abertas com sua conta foram encerradas." });
      setF({ current: "", new: "", confirm: "" });
    } catch (x: any) { setMsg({ ok: false, t: x.message }); } finally { setBusy(false); }
  }
  return (
    <div className="page space-y-5">
      <h1 className="text-xl font-medium text-navy-900">Minha conta</h1>
      <Card title="Perfil">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-mute">Usuário</dt><dd className="font-medium">{me.username}</dd>
          <dt className="text-mute">Nome</dt><dd>{me.name ?? "—"}</dd>
          <dt className="text-mute">Papel</dt><dd>{ROLE_LABEL[me.role] ?? me.role}</dd>
          <dt className="text-mute">Último acesso</dt><dd>{fmtDateTime(me.last_login)}</dd>
        </dl>
      </Card>
      <Card title="Trocar senha">
        <form onSubmit={submit} className="grid max-w-md gap-3">
          <Field label="Senha atual"><input required type="password" autoComplete="current-password" className={inputCls} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
          <Field label="Nova senha (mínimo 10 caracteres)"><input required minLength={10} type="password" autoComplete="new-password" className={inputCls} value={f.new} onChange={(e) => setF({ ...f, new: e.target.value })} /></Field>
          <Field label="Confirmar nova senha"><input required minLength={10} type="password" autoComplete="new-password" className={inputCls} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
          {msg && <div role="status" className={`border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{msg.t}</div>}
          <div><Button disabled={busy}>{busy ? "Salvando…" : "Trocar senha"}</Button></div>
        </form>
      </Card>
    </div>
  );
}
