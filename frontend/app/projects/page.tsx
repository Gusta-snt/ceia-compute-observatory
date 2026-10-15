"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button, Card, Empty, ErrorBox, Field, Loading, inputCls } from "@/components/ui";

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
    <div className="space-y-5">
      <h1 className="text-xl font-medium text-navy-900">Projetos e alocação</h1>
      <p className="text-sm text-mute">Associações são organização administrativa; não indicam que o projeto usa todos os recursos da máquina.</p>
      {msg && <div role="status" className={`border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{msg.t}</div>}

      <Card title="Situação por máquina">
        {overview.loading ? <Loading /> : overview.error ? <ErrorBox message={overview.error} /> : !overview.data?.length ? <Empty>Sem máquinas.</Empty> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {overview.data.map((m) => (
              <div key={m.machine_id} className="border border-line p-3">
                <div className="flex items-center justify-between"><span className="font-medium">{m.machine}</span>
                  {m.simultaneous && <span className="border border-amber-300 bg-amber-50 px-1.5 text-xs text-amber-800">alocações simultâneas</span>}</div>
                <ul className="mt-2 space-y-1 text-sm">
                  {m.projects.length === 0 && <li className="text-mute">Sem projetos associados</li>}
                  {m.projects.map((p: any) => (
                    <li key={p.allocation_id} className="flex justify-between gap-2"><span>{p.name} <span className="text-xs text-mute">({p.kind}, prioridade {p.priority})</span></span>
                      <button className="text-xs text-red-700 underline" onClick={() => run(() => api(`/allocations/${p.allocation_id}`, { method: "DELETE" }), "Associação removida.")}>remover</button></li>))}
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
              <Field label="Prioridade"><select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option></select></Field>
            </div>
            <Field label="Descrição"><textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Button>Criar projeto</Button>
          </form>
        </Card>
        <Card title="Associar projeto a máquina">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api("/allocations", { method: "POST", json: { project_id: Number(alloc.project_id), machine_id: Number(alloc.machine_id), kind: alloc.kind } }), "Associação criada."); }}>
            <Field label="Projeto"><select required className={inputCls} value={alloc.project_id} onChange={(e) => setAlloc({ ...alloc, project_id: e.target.value })}><option value="">Selecione</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Máquina"><select required className={inputCls} value={alloc.machine_id} onChange={(e) => setAlloc({ ...alloc, machine_id: e.target.value })}><option value="">Selecione</option>{machines.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            <Field label="Tipo"><select className={inputCls} value={alloc.kind} onChange={(e) => setAlloc({ ...alloc, kind: e.target.value })}><option value="principal">Principal</option><option value="compartilhada">Compartilhada</option></select></Field>
            <Button>Associar</Button>
          </form>
        </Card>
      </div>

      <Card title="Todos os projetos">
        {!projects.data?.length ? <Empty>Nenhum projeto cadastrado.</Empty> : (
          <table className="w-full text-sm"><tbody>{projects.data.map((p) => (
            <tr key={p.id} className="border-t border-line first:border-0"><td className="py-1.5 font-medium">{p.name}</td><td className="text-mute">{p.owner}</td>
              <td className="text-xs">{p.machines.map((m: any) => m.machine).join(", ") || "sem máquina"}</td>
              <td className="text-right"><button className="text-xs text-red-700 underline" onClick={() => confirm(`Excluir projeto ${p.name}?`) && run(() => api(`/projects/${p.id}`, { method: "DELETE" }), "Projeto excluído.")}>excluir</button></td></tr>))}</tbody></table>)}
      </Card>
    </div>
  );
}
