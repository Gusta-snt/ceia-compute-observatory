"use client";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { fmtDateTime } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Segmented } from "@/components/ui";

const SEV: Record<string, string> = { critical: "text-red-700", warning: "text-amber-700", info: "text-slate-600" };

export default function Alerts() {
  const [status, setStatus] = useState("all");
  const [sev, setSev] = useState("");
  const [mid, setMid] = useState("");
  const machines = useApi<any[]>("/machines?include_inactive=true");
  const q = `/alerts?status=${status}${sev ? `&severity=${sev}` : ""}${mid ? `&machine_id=${mid}` : ""}`;
  const a = useApi<any>(q, 30000);
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-medium text-navy-900">Alertas e eventos</h1>
      <Card actions={<>
        <Segmented label="Estado" value={status} onChange={setStatus} options={[["all", "Todos"], ["open", "Abertos"], ["resolved", "Resolvidos"]]} />
        <select aria-label="Severidade" className="border border-line bg-white px-2 py-1 text-xs" value={sev} onChange={(e) => setSev(e.target.value)}>
          <option value="">Toda severidade</option><option value="critical">Crítico</option><option value="warning">Aviso</option><option value="info">Info</option>
        </select>
        <select aria-label="Máquina" className="border border-line bg-white px-2 py-1 text-xs" value={mid} onChange={(e) => setMid(e.target.value)}>
          <option value="">Todas as máquinas</option>{machines.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></>}>
        {a.loading && !a.data ? <Loading /> : a.error ? <ErrorBox message={a.error} onRetry={a.reload} /> :
          !a.data.items.length ? <Empty>Nenhum alerta para os filtros selecionados.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-mute"><tr><th className="py-1">Severidade</th><th>Máquina</th><th>Regra</th><th>Mensagem</th><th>Aberto</th><th>Resolvido</th></tr></thead>
              <tbody>{a.data.items.map((x: any) => (
                <tr key={x.id} className="border-t border-line align-top">
                  <td className={`py-1.5 font-medium ${SEV[x.severity]}`}>{x.severity}</td><td>{x.machine ?? "—"}</td>
                  <td className="font-mono text-xs">{x.rule}</td><td>{x.message}</td><td className="text-xs">{fmtDateTime(x.opened_at)}</td>
                  <td className="text-xs">{x.resolved_at ? fmtDateTime(x.resolved_at) : <span className="text-red-700">aberto</span>}</td>
                </tr>))}</tbody>
            </table></div>)}
      </Card>
    </div>
  );
}
