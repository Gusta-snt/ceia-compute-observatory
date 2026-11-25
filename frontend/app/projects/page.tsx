"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button, Card, Empty, ErrorBox, Field, Loading, inputCls, Notice } from "@/components/ui";
import { Select } from "@/components/Select";

export default function Projects() {
  const projects = useApi<any[]>("/projects");
  const machines = useApi<any[]>("/machines");
  const overview = useApi<any[]>("/allocations/overview");
  const [form, setForm] = useState({ name: "", owner: "", researchers: "", priority: "media", description: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [alloc, setAlloc] = useState({ project_id: "", machine_id: "", kind: "principal" });
  const refresh = () => { projects.reload(); overview.reload(); };
  async function run(fn: () => Promise<any>, ok: string) {
    try { await fn(); setMsg({ ok: true, t: ok }); refresh(); } catch (e: any) { setMsg({ ok: false, t: e.message }); }
  }
  return (
    <div className="page space-y-5">
      <header>
        <h1 className="text-2xl font-medium text-heading">Projetos e alocação</h1>
        <p className="text-sm text-mute">Associações são organização administrativa; não indicam que o projeto usa todos os recursos da máquina.</p>
      </header>
      {msg && <Notice tone={msg.ok ? "ok" : "crit"}>{msg.t}</Notice>}

      <Card title="Situação por máquina">
        {overview.loading ? <Loading /> : overview.error ? <ErrorBox message={overview.error} /> : !overview.data?.length ? <Empty>Sem máquinas.</Empty> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {overview.data.map((m) => (
              <div key={m.machine_id} className="border border-line p-3">
                <div className="flex items-center justify-between"><span className="font-medium">{m.machine}</span>
                  {m.simultaneous && <span className="border border-warn-line bg-warn-bg px-1.5 text-label text-warn-fg">alocações simultâneas</span>}</div>
                <ul className="mt-2 space-y-1 text-sm">
                  {m.projects.length === 0 && <li className="text-mute">Sem projetos associados</li>}
                  {m.projects.map((p: any) => (
                    <li key={p.allocation_id} className="flex justify-between gap-2"><span>{p.name} <span className="text-label text-mute">({p.kind}, prioridade {p.priority})</span></span>
                      <button className="text-label text-crit-fg underline" onClick={() => run(() => api(`/allocations/${p.allocation_id}`, { method: "DELETE" }), "Associação removida.")}>remover</button></li>))}
                </ul>
              </div>))}
          </div>)}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Novo projeto">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api("/projects", { method: "POST", json: { ...form, researchers: form.researchers ? Number(form.researchers) : null } }), "Projeto criado."); }}>
            <Field label="Nome"><input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Responsável"><input className={inputCls} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field>
              <Field label="Pesquisadores"><input type="number" min={0} className={inputCls} value={form.researchers} onChange={(e) => setForm({ ...form, researchers: e.target.value })} /></Field>
              <Field label="Prioridade"><Select size="md" label="Prioridade" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })}
                options={[{ value: "baixa", label: "Baixa" }, { value: "media", label: "Média" }, { value: "alta", label: "Alta" }]} /></Field>
            </div>
            <Field label="Descrição"><textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Button>Criar projeto</Button>
          </form>
        </Card>
        <Card title="Associar projeto a máquina">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api("/allocations", { method: "POST", json: { project_id: Number(alloc.project_id), machine_id: Number(alloc.machine_id), kind: alloc.kind } }), "Associação criada."); }}>
            <Field label="Projeto"><Select size="md" required label="Projeto" value={String(alloc.project_id)} onChange={(v) => setAlloc({ ...alloc, project_id: v })}
              options={(projects.data ?? []).map((p: any) => ({ value: String(p.id), label: p.name }))} /></Field>
            <Field label="Máquina"><Select size="md" required label="Máquina" value={String(alloc.machine_id)} onChange={(v) => setAlloc({ ...alloc, machine_id: v })}
              options={(machines.data ?? []).map((m: any) => ({ value: String(m.id), label: m.name }))} /></Field>
            <Field label="Tipo"><Select size="md" label="Tipo" value={alloc.kind} onChange={(v) => setAlloc({ ...alloc, kind: v })}
              options={[{ value: "principal", label: "Principal" }, { value: "compartilhada", label: "Compartilhada" }]} /></Field>
            <Button>Associar</Button>
          </form>
        </Card>
      </div>

      <Card title="Todos os projetos">
        {!projects.data?.length ? <Empty>Nenhum projeto cadastrado.</Empty> : (
          <table className="w-full text-sm"><tbody>{projects.data.map((p) => (
            <tr key={p.id} className="border-t border-line first:border-0"><td className="py-1.5 font-medium">{p.name}</td><td className="text-mute">{p.owner}</td>
              <td className="text-label">{p.machines.map((m: any) => m.machine).join(", ") || "sem máquina"}</td>
              <td className="text-right"><button className="text-label text-crit-fg underline" onClick={() => confirm(`Excluir projeto ${p.name}?`) && run(() => api(`/projects/${p.id}`, { method: "DELETE" }), "Projeto excluído.")}>excluir</button></td></tr>))}</tbody></table>)}
      </Card>
    </div>
  );
}
