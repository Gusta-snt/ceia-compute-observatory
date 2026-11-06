"use client";
import { useState } from "react";
import { api, ago, fmtDateTime } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ROLE_LABEL, useMe } from "@/lib/me";
import { Button, Card, Empty, ErrorBox, Field, Loading, Restricted, inputCls } from "@/components/ui";

type U = { id: number; username: string; name: string | null; role: string; active: boolean; last_login: string | null; created_at: string };
const EMPTY = { username: "", name: "", password: "", role: "usuario" };

export default function UsersPage() {
  const { me, loading } = useMe();
  if (loading) return <Loading />;
  if (me?.role !== "admin") return <Restricted />;
  return <Users meId={me.id} />;
}

function Users({ meId }: { meId: number }) {
  const users = useApi<U[]>("/users");
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function run(fn: () => Promise<any>, ok: string) {
    try { const r = await fn(); setMsg({ ok: true, t: ok }); users.reload(); return r ?? true; } catch (e: any) { setMsg({ ok: false, t: e.message }); }
  }
  function resetPassword(u: U) {
    const p = prompt(`Nova senha para ${u.username} (mínimo 10 caracteres). As sessões abertas dessa pessoa serão encerradas.`);
    if (!p) return;
    if (p.length < 10) { setMsg({ ok: false, t: "A senha precisa ter pelo menos 10 caracteres." }); return; }
    run(() => api(`/users/${u.id}/password`, { method: "POST", json: { password: p } }), `Senha de ${u.username} redefinida. Envie a nova senha a essa pessoa.`);
  }
  return (
    <div className="page space-y-5">
      <h1 className="text-xl font-medium text-navy-900">Usuários</h1>
      <p className="text-sm text-mute">
        <b>Usuários</b> acessam painéis, análises, alertas e projetos. <b>Administradores</b> também cadastram máquinas, gerenciam tokens, configurações e usuários.
      </p>
      {msg && <div role="status" className={`border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{msg.t}</div>}

      <Card title="Contas">
        {users.loading && !users.data ? <Loading /> : users.error ? <ErrorBox message={users.error} onRetry={users.reload} /> : !users.data?.length ? <Empty>Nenhum usuário.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-mute"><tr><th className="py-1">Usuário</th><th>Nome</th><th>Papel</th><th>Situação</th><th>Último acesso</th><th /></tr></thead>
            <tbody>{users.data.map((u) => {
              const self = u.id === meId;
              return (
                <tr key={u.id} className="border-t border-line">
                  <td className="py-1.5 font-medium">{u.username}{self && <span className="ml-2 text-xs text-mute">(você)</span>}</td>
                  <td>{u.name ?? <span className="text-mute">—</span>}</td>
                  <td><span className={`inline-block border px-2 py-0.5 text-xs ${u.role === "admin" ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-slate-50"}`}>{ROLE_LABEL[u.role] ?? u.role}</span></td>
                  <td className="text-xs">{u.active ? "Ativo" : <span className="text-red-700">Desativado</span>}</td>
                  <td className="text-xs" title={fmtDateTime(u.last_login)}>{u.last_login ? ago(u.last_login) : "nunca"}</td>
                  <td className="space-x-3 text-right text-xs">
                    <button className="underline" onClick={() => { const n = prompt("Nome de exibição:", u.name ?? ""); if (n === null) return; run(() => api(`/users/${u.id}`, { method: "PATCH", json: { name: n } }), "Nome alterado."); }}>renomear</button>
                    {!self && <button className="underline" onClick={() => run(() => api(`/users/${u.id}`, { method: "PATCH", json: { role: u.role === "admin" ? "usuario" : "admin" } }), u.role === "admin" ? `${u.username} agora é usuário.` : `${u.username} agora é administrador.`)}>{u.role === "admin" ? "tornar usuário" : "tornar admin"}</button>}
                    <button className="underline" onClick={() => resetPassword(u)}>redefinir senha</button>
                    {!self && <button className="underline" onClick={() => run(() => api(`/users/${u.id}`, { method: "PATCH", json: { active: !u.active } }), u.active ? `${u.username} desativado.` : `${u.username} reativado.`)}>{u.active ? "desativar" : "reativar"}</button>}
                    {!self && <button className="text-red-600 underline" onClick={() => { if (!confirm(`Apagar o usuário "${u.username}"? Isso não pode ser desfeito.`)) return; run(() => api(`/users/${u.id}`, { method: "DELETE" }), "Usuário apagado."); }}>apagar</button>}
                  </td>
                </tr>);
            })}</tbody>
          </table></div>)}
      </Card>

      <Card title="Novo usuário">
        <form className="grid gap-3 md:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => api("/users", { method: "POST", json: form }), `Usuário ${form.username.trim().toLowerCase()} criado. Envie o usuário e a senha a essa pessoa; ela pode trocar a senha em "Minha conta".`);
          if (r) setForm(EMPTY);
        }}>
          <Field label="Usuário (login)"><input required className={inputCls} value={form.username} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,63}" title="Letras, números, ponto, hífen ou sublinhado" autoComplete="off" onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="Nome de exibição (opcional)"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Senha inicial (mínimo 10 caracteres)"><input required minLength={10} type="password" autoComplete="new-password" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Papel">
            <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="usuario">Usuário — usa a central, sem administrar</option>
              <option value="admin">Administrador — acesso total</option>
            </select>
          </Field>
          <div><Button>Criar usuário</Button></div>
        </form>
      </Card>
    </div>
  );
}
