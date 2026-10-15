# Operação e solução de problemas

| Sintoma | Verificação |
|---|---|
| Máquina "Dados insuficientes" | Menos de 20 amostras recebidas. `curl 127.0.0.1:9477` no agente; veja `last_error`. |
| `send_failures` crescendo | DNS/certificado/firewall da VPS (80/443); `curl $CENTRAL_API_URL/api/v1/health` a partir da Spark. |
| `HTTP 401` nos logs | Token incorreto, rotacionado ou revogado; gere novo em Administração. |
| `HTTP 409` | O token está sendo usado por outra máquina (uid diferente). Gere token próprio. |
| GPU "n/d" | Driver reporta N/A; rode `nvidia-smi -q` e `ceia-agent --once` para ver `quality`. Instale `nvidia-ml-py` no venv do agente. |
| PSI "n/d" | Kernel sem `CONFIG_PSI` ou `psi=0`; o restante segue funcional. |
| Buffer cheio | `BUFFER_MAX_SAMPLES` atingido; ajuste a política (`oldest`/`newest`). |

**Upgrade do servidor:** `git pull && docker compose up -d --build`; as migrações rodam sozinhas. Faça backup antes (`scripts/backup-db.sh`).
**Rotação do SECRET_KEY:** invalida sessões de administrador; tokens de agente não são afetados.
**Rede:** só o Caddy é exposto (`BIND_ADDR:HTTP_PORT`, HTTP). Bloqueie as demais portas no firewall da VPS (ex.: `ufw allow 22,80/tcp`). Sem TLS o token do agente e a sessão trafegam em texto claro; se precisar, use `SITE_ADDRESS=<domínio>` (HTTPS automático, abrir 443) e `COOKIE_SECURE=true`.
**Privacidade:** o agente envia apenas métricas agregadas da máquina; coleta de processos de GPU não existe nesta versão.
