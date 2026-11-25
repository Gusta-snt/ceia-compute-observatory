"use client";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { fmtDateTime } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Segmented } from "@/components/ui";
import { Select } from "@/components/Select";

const SEV: Record<string, string> = { critical: "text-crit-fg", warning: "text-warn-fg", info: "text-mute" };
const SEV_LABEL: Record<string, string> = { critical: "Crítico", warning: "Aviso", info: "Info" };

export default function Alerts() {
  const [status, setStatus] = useState("all");
  const [sev, setSev] = useState("");
  const [mid, setMid] = useState("");
  const machines = useApi<any[]>("/machines?include_inactive=true");
  const q = `/alerts?status=${status}${sev ? `&severity=${sev}` : ""}${mid ? `&machine_id=${mid}` : ""}`;
  const a = useApi<any>(q, 30000);
  return (
    <div className="page space-y-5">
      <h1 className="text-2xl font-medium text-heading">Alertas e eventos</h1>
      <Card actions={<>
        <Segmented label="Estado" value={status} onChange={setStatus} options={[["all", "Todos"], ["open", "Abertos"], ["resolved", "Resolvidos"]]} />
        <Select label="Severidade" value={sev} onChange={setSev} options={[
          { value: "", label: "Toda severidade" }, { value: "critical", label: "Crítico" }, { value: "warning", label: "Aviso" }, { value: "info", label: "Info" },
        ]} />
        <Select label="Máquina" value={mid} onChange={setMid}
          options={[{ value: "", label: "Todas as máquinas" }, ...(machines.data ?? []).map((m) => ({ value: String(m.id), label: m.name }))]} /></>}>
        {a.loading && !a.data ? <Loading /> : a.error ? <ErrorBox message={a.error} onRetry={a.reload} /> :
          !a.data.items.length ? <Empty>Nenhum alerta para os filtros selecionados.</Empty> : (
            <div className="relative overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-label text-mute"><tr><th className="py-1">Severidade</th><th>Máquina</th><th>Regra</th><th>Mensagem</th><th>Aberto</th><th>Resolvido</th></tr></thead>
              <tbody>{a.data.items.map((x: any) => (
                <tr key={x.id} className="border-t border-line align-top">
                  <td className={`font-medium ${SEV[x.severity]}`}>{SEV_LABEL[x.severity] ?? x.severity}</td><td>{x.machine ?? "—"}</td>
                  <td className="font-mono text-label">{x.rule}</td><td>{x.message}</td><td className="text-label">{fmtDateTime(x.opened_at)}</td>
                  <td className="text-label">{x.resolved_at ? fmtDateTime(x.resolved_at) : <span className="text-crit-fg">aberto</span>}</td>
                </tr>))}</tbody>
            </table></div>)}
      </Card>
    </div>
  );
}
