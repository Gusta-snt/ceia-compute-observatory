"use client";
import { useState } from "react";
import { api, ago, fmtDateTime } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ROLE_LABEL, useMe } from "@/lib/me";
import { Button, Card, Empty, ErrorBox, Field, Loading, Restricted, inputCls, Notice } from "@/components/ui";
import { Select } from "@/components/Select";

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
      <header>
        <h1 className="text-2xl font-medium text-heading">Usuários</h1>
        <p className="text-sm text-mute">
          <b className="font-medium text-ink">Usuários</b> acessam painéis, análises, alertas e projetos. <b className="font-medium text-ink">Administradores</b> também cadastram máquinas, gerenciam tokens, configurações e usuários.
        </p>
      </header>
      {msg && <Notice tone={msg.ok ? "ok" : "crit"}>{msg.t}</Notice>}

      <Card title="Contas">
        {users.loading && !users.data ? <Loading /> : users.error ? <ErrorBox message={users.error} onRetry={users.reload} /> : !users.data?.length ? <Empty>Nenhum usuário.</Empty> : (
          <div className="relative overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-label text-mute"><tr><th className="py-1">Usuário</th><th>Nome</th><th>Papel</th><th>Situação</th><th>Último acesso</th><th /></tr></thead>
            <tbody>{users.data.map((u) => {
              const self = u.id === meId;
              return (
                <tr key={u.id} className="border-t border-line">
                  <td className="whitespace-nowrap py-1.5 font-medium">{u.username}{self && <span className="ml-2 text-label text-mute">(você)</span>}</td>
                  <td>{u.name ?? <span className="text-mute">—</span>}</td>
                  <td><span className={`inline-block border px-2 py-0.5 text-label ${u.role === "admin" ? "border-heading bg-heading text-surface" : "border-line bg-sunken"}`}>{ROLE_LABEL[u.role] ?? u.role}</span></td>
                  <td className="text-label">{u.active ? "Ativo" : <span className="text-crit-fg">Desativado</span>}</td>
                  <td className="text-label" title={fmtDateTime(u.last_login)}>{u.last_login ? ago(u.last_login) : "nunca"}</td>
                  <td className="space-x-3 text-right text-label">
                    <button className="underline" onClick={() => { const n = prompt("Nome de exibição:", u.name ?? ""); if (n === null) return; run(() => api(`/users/${u.id}`, { method: "PATCH", json: { name: n } }), "Nome alterado."); }}>renomear</button>
                    {!self && <button className="underline" onClick={() => run(() => api(`/users/${u.id}`, { method: "PATCH", json: { role: u.role === "admin" ? "usuario" : "admin" } }), u.role === "admin" ? `${u.username} agora é usuário.` : `${u.username} agora é administrador.`)}>{u.role === "admin" ? "tornar usuário" : "tornar admin"}</button>}
                    <button className="underline" onClick={() => resetPassword(u)}>redefinir senha</button>
                    {!self && <button className="underline" onClick={() => run(() => api(`/users/${u.id}`, { method: "PATCH", json: { active: !u.active } }), u.active ? `${u.username} desativado.` : `${u.username} reativado.`)}>{u.active ? "desativar" : "reativar"}</button>}
                    {!self && <button className="text-crit-fg underline" onClick={() => { if (!confirm(`Apagar o usuário "${u.username}"? Isso não pode ser desfeito.`)) return; run(() => api(`/users/${u.id}`, { method: "DELETE" }), "Usuário apagado."); }}>apagar</button>}
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
            <Select size="md" label="Papel" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={[
              { value: "usuario", label: "Usuário", hint: "usa a central, sem administrar" },
              { value: "admin", label: "Administrador", hint: "acesso total" },
            ]} />
          </Field>
          <div><Button>Criar usuário</Button></div>
        </form>
      </Card>
    </div>
  );
}
