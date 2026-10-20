"use client";
import { useEffect, useState } from "react";
import { api, ago } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button, Card, Empty, ErrorBox, Field, Loading, StatusBadge, inputCls } from "@/components/ui";

const LABELS: Record<string, string> = {
  min_coverage: "Cobertura mínima (0–1)", idle_gpu_percent: "Ociosidade: GPU abaixo de (%)", idle_cpu_percent: "Ociosidade: CPU abaixo de (%)",
  active_gpu_percent: "Hora ativa: GPU acima de (%)", under_gpu_mean: "Subutilizada: GPU média < (%)", under_gpu_p95: "Subutilizada: GPU P95 < (%)",
  under_mem_mean: "Subutilizada: memória média < (%)", under_mem_p95: "Subutilizada: memória P95 < (%)", under_cpu_mean: "Subutilizada: CPU média < (%)",
  high_gpu_mean: "Alta: GPU média ≥ (%)", high_gpu_p95: "Alta: GPU P95 ≥ (%)", high_cpu_mean: "Alta: CPU média ≥ (%)",
  pressure_mem_p95: "Pressão: memória P95 ≥ (%)", pressure_psi_p95: "Pressão: PSI P95 ≥ (%)", pressure_disk_percent: "Pressão: disco ≥ (%)",
  min_free_disk_gb: "Disco livre mínimo (GB)",
};

const AGENT_INSTALL_URL = "https://raw.githubusercontent.com/Gusta-snt/ceia-compute-observatory/main/agent/install.sh";

export default function Admin() {
  const machines = useApi<any[]>("/machines?include_inactive=true", 60000, "all");
  const settings = useApi<any>("/settings");
  const [form, setForm] = useState({ name: "", hostname: "", address: "", hardware: "NVIDIA DGX Spark (GB10)", notes: "" });
  const [token, setToken] = useState<{ name: string; value: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [cls, setCls] = useState<Record<string, any> | null>(null);
  const [brand, setBrand] = useState<Record<string, any> | null>(null);
  useEffect(() => { if (settings.data) { setCls(settings.data.classification); setBrand(settings.data.branding); } }, [settings.data]);
  async function run(fn: () => Promise<any>, ok: string) {
    try { const r = await fn(); setMsg({ ok: true, t: ok }); machines.reload(); return r; } catch (e: any) { setMsg({ ok: false, t: e.message }); }
  }
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-medium text-navy-900">Administração</h1>
      {msg && <div role="status" className={`border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{msg.t}</div>}
      {token && (
        <div role="alert" className="border border-amber-300 bg-amber-50 p-3 text-sm">
          Token de <b>{token.name}</b> (exibido uma única vez; copie agora e grave em <code>AGENT_TOKEN</code> no agente):
          <pre className="mt-2 overflow-x-auto bg-white p-2 font-mono text-xs">{token.value}</pre>
          <p className="mt-3">Para instalar o agente, rode na máquina (Linux com internet). Se ela acessa a central por outro endereço, troque o <code>--url</code>:</p>
          <pre className="mt-2 overflow-x-auto bg-white p-2 font-mono text-xs">{`curl -fsSL ${AGENT_INSTALL_URL} | sudo bash -s -- --url ${window.location.origin} --token ${token.value}`}</pre>
          <button className="mt-2 text-xs underline" onClick={() => setToken(null)}>Já copiei</button>
        </div>)}

      <Card title="Máquinas">
        {machines.loading && !machines.data ? <Loading /> : machines.error ? <ErrorBox message={machines.error} /> : !machines.data?.length ? <Empty>Nenhuma máquina cadastrada ainda.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-mute"><tr><th className="py-1">Nome</th><th>Host</th><th>Estado</th><th>Agente</th><th>Última comunicação</th><th /></tr></thead>
            <tbody>{machines.data.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="py-1.5 font-medium">{m.name}{!m.active && <span className="ml-2 text-xs text-mute">(desativada)</span>}</td>
                <td className="text-xs">{m.hostname}<br /><span className="text-mute">{m.address}</span></td>
                <td><StatusBadge status={m.status} /></td><td className="text-xs">{m.agent_version ?? "—"}{!m.has_token && <span className="ml-1 text-red-700">sem token</span>}</td>
                <td className="text-xs">{ago(m.last_seen)}</td>
                <td className="space-x-3 text-right text-xs">
                  <button className="underline" onClick={() => { const n = prompt("Novo nome da máquina:", m.name)?.trim(); if (!n || n === m.name) return; run(() => api(`/machines/${m.id}`, { method: "PATCH", json: { name: n } }), "Nome alterado."); }}>renomear</button>
                  <button className="underline" onClick={async () => { if (!confirm("Gerar novo token invalida o anterior. Continuar?")) return; const r = await run(() => api(`/machines/${m.id}/token`, { method: "POST" }), "Token rotacionado."); if (r) setToken({ name: m.name, value: r.token }); }}>rotacionar token</button>
                  <button className="underline" onClick={() => run(() => api(`/machines/${m.id}/token`, { method: "DELETE" }), "Token revogado.")}>revogar</button>
                  <button className="underline" onClick={() => run(() => api(`/machines/${m.id}`, { method: "PATCH", json: { active: !m.active } }), m.active ? "Máquina desativada." : "Máquina reativada.")}>{m.active ? "desativar" : "reativar"}</button>
                  <button className="underline text-red-600" onClick={() => { if (!confirm(`Apagar "${m.name}" e TODO o histórico dela? Isso não pode ser desfeito.`)) return; run(() => api(`/machines/${m.id}`, { method: "DELETE" }), "Máquina apagada."); }}>apagar</button>
                </td></tr>))}</tbody>
          </table></div>)}
      </Card>

      <Card title="Cadastrar máquina">
        <form className="grid gap-3 md:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api("/machines", { method: "POST", json: form }), "Máquina cadastrada."); if (r) { setToken({ name: r.name, value: r.token }); setForm({ ...form, name: "", hostname: "", address: "", notes: "" }); } }}>
          <Field label="Nome"><input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Hostname"><input className={inputCls} value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} /></Field>
          <Field label="Endereço (hostname / IP)"><input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="Hardware"><input className={inputCls} value={form.hardware} onChange={(e) => setForm({ ...form, hardware: e.target.value })} /></Field>
          <div className="md:col-span-2"><Field label="Observações"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
          <div><Button>Cadastrar e gerar token</Button></div>
        </form>
      </Card>

      <Card title="Limites de classificação">
        {!cls ? <Loading /> : (
          <form onSubmit={(e) => { e.preventDefault(); run(() => api("/settings/classification", { method: "PUT", json: cls }), "Limites salvos."); }}>
            <div className="grid gap-3 md:grid-cols-3">
              {Object.keys(LABELS).map((k) => (
                <Field key={k} label={LABELS[k]}><input type="number" step="any" className={inputCls} value={cls[k] ?? ""} onChange={(e) => setCls({ ...cls, [k]: Number(e.target.value) })} /></Field>))}
            </div>
            <p className="mt-3 text-xs text-mute">Valores iniciais são pontos de partida, não verdades universais. Veja docs/METRICS.md.</p>
            <Button className="mt-3">Salvar limites</Button>
          </form>)}
      </Card>

      <Card title="Identidade visual">
        {!brand ? <Loading /> : (
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => api("/settings/branding", { method: "PUT", json: brand }), "Identidade salva. Recarregue a página."); }}>
            <Field label="Nome do sistema"><input className={inputCls} value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} /></Field>
            <Field label="Subtítulo"><input className={inputCls} value={brand.subtitle} onChange={(e) => setBrand({ ...brand, subtitle: e.target.value })} /></Field>
            <Field label="Logo do CEIA (URL ou /brand/arquivo.png)"><input className={inputCls} value={brand.ceia_logo} onChange={(e) => setBrand({ ...brand, ceia_logo: e.target.value })} /></Field>
            <Field label="Logo da UFG (URL ou /brand/arquivo.png)"><input className={inputCls} value={brand.ufg_logo} onChange={(e) => setBrand({ ...brand, ufg_logo: e.target.value })} /></Field>
            <div><Button>Salvar identidade</Button></div>
          </form>)}
      </Card>
    </div>
  );
}
