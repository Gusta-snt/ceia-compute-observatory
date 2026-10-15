# Arquitetura

```
DGX Spark (x6)                          VPS ou localhost (Caddy, porta HTTP)
┌──────────────────────────┐  HTTP       ┌───────────────────────────────────────┐
│ ceia-agent (systemd)     │ ──────────► │ FastAPI  /api/v1/ingest  (token/máquina)│
│ coleta → buffer SQLite   │  lotes JSON │   ├─ PostgreSQL + TimescaleDB          │
│ envio c/ backoff+jitter  │             │   ├─ alertas/retenção (tarefa periódica)│
└──────────────────────────┘             │ Next.js dashboard (sessão por cookie)  │
                                         └───────────────────────────────────────┘
```

## Tempo real (broadcast)
Broadcast de rede (UDP broadcast/multicast) não atravessa a internet: só funciona dentro de uma mesma LAN, então não serve entre Sparks e VPS. O "broadcast" é feito na camada HTTP:
- **Agente → central:** push HTTP (o agente sempre inicia a conexão; funciona atrás de NAT/firewall sem abrir portas nas Sparks).
- **Central → dashboards:** `GET /api/v1/stream` (Server-Sent Events, sessão de administrador). Cada `/ingest` publica `{machine_id, ts, values}` para todos os navegadores abertos, que recarregam os gráficos afetados (no máximo a cada 5 s). O polling continua como fallback, com intervalo maior.
- O broadcaster é em memória, como a tarefa periódica: **uma** réplica do backend. Para várias réplicas, trocar por Redis pub/sub ou `LISTEN/NOTIFY` do PostgreSQL.

## Formato de dados (schema_version 1)
`POST /api/v1/ingest` com `Authorization: Bearer <token da máquina>`:
`{schema_version, agent_version, machine_uid, system{…}, samples:[{ts(UTC), interval_s, values{métrica: número|null}, quality{métrica: ok|unsupported|unavailable|error}, sources, extra}]}`.
Idempotência: chave primária `(machine_id, ts)`; reenvios retornam `duplicates`. O servidor devolve 202; 4xx permanentes (400/413/422) descartam o lote no agente, 401/403/5xx/rede mantêm no buffer.

## Segurança
- Token por máquina (SHA-256 no banco), rotacionável e revogável; só alcança `/ingest`.
- Dashboard: senha com Argon2, JWT em cookie HttpOnly/SameSite=Lax; tokens de agente nunca são aceitos nas rotas administrativas.
- Limite de corpo (2 MB), de lote (500 amostras), rate limit por máquina e no login, CORS desabilitado por padrão (proxy de mesma origem).
- O `machine_uid` fica preso ao token no primeiro envio; uid diferente → 409.
- Agente sem root, unit systemd endurecida; sem execução remota. Coleta o top N de processos por CPU/GPU (PID, nome, usuário, linha de comando truncada em 240 caracteres; desligável com `COLLECT_PROCESSES=false` ou `PROCESS_CMDLINE=false`).

## Dados e retenção
Amostras brutas ficam `RAW_RETENTION_DAYS` (90). Depois são agregadas em `rollups_hourly` (média ponderada por tempo e máximo por métrica) e só então removidas; cada execução registra um evento `retencao` visível em Alertas. Agregados horários são mantidos indefinidamente. Consultas longas usam buckets calculados no banco; o gráfico limita-se a ~600 pontos.
Volume: 6 máquinas × 5.760 amostras/dia ≈ 34,5 mil linhas/dia (~12,6 M/ano antes da retenção).

## Limitações conhecidas
- Percentis sobre médias de 5 min, não sobre amostras de 15 s.
- Rollups horários não guardam percentis nem mínimos.
- Tarefa periódica em processo único: execute **uma** réplica do backend.
- Sem gestão de múltiplos administradores na UI (apenas troca de senha via API).
- shadcn/ui não foi adotado; componentes próprios com Tailwind.
