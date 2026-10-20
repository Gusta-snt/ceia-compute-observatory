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

**Upgrade do servidor:** rode o instalador de novo (`install-central.sh`) ou `git pull && scripts/compose.sh up -d --build`; as migrações rodam sozinhas. Faça backup antes (`scripts/backup-db.sh`).
**Rotação do SECRET_KEY:** invalida sessões de administrador; tokens de agente não são afetados.
**Rede:** só o Caddy é exposto (`BIND_ADDR:HTTP_PORT`, HTTP). Bloqueie as demais portas no firewall da VPS (ex.: `ufw allow 22,80,443/tcp`). Sem TLS o token do agente e a sessão trafegam em texto claro; use HTTPS: `install-central.sh --mode https --domain <domínio>`, ou `--mode proxy --domain <domínio>` se já houver um proxy (NetBird/Caddy/Nginx) nas portas 80/443 — nesse caso o proxy encaminha o domínio para `ceia-observatory:80` (mesma rede Docker) ou `127.0.0.1:8080`; no Nginx, desligue `proxy_buffering` para `/api/v1/stream`. Sempre use `scripts/compose.sh` em vez de `docker compose` direto: ele inclui a porta 443 (modo https) e a rede do proxy (modo proxy). Certificado não emitido: `scripts/compose.sh logs caddy` (DNS errado ou porta 80/443 fechada).
**Privacidade:** o agente envia apenas métricas agregadas da máquina; coleta de processos de GPU não existe nesta versão.
