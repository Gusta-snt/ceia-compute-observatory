# CEIA Compute Observatory

Monitoramento histórico e análise de capacidade das NVIDIA DGX Sparks do CEIA-UFG.

- **`agent/`** — agente Python (psutil + NVML/`nvidia-smi`), serviço systemd, buffer SQLite, envio em lote com retry.
- **`backend/`** — FastAPI, SQLAlchemy, Alembic; PostgreSQL/TimescaleDB em produção (SQLite em dev/testes).
- **`frontend/`** — Next.js + Tailwind + Recharts (dashboard, análise, projetos, alertas, administração).
- **`deploy/`** — Docker Compose da plataforma central. **`packaging/`** — builds de distribuição (Sparks e central). **`scripts/`** — instalação do agente, backup/restore, demo. **`docs/`** — arquitetura, métricas, operação.

## Estado verificado

| Item | Situação |
|---|---|
| Testes do agente (20) e do backend (15) | passam (`pytest`) |
| Agente real → backend real → banco, queda e recuperação de rede | verificado localmente (macOS) |
| Build do frontend (`next build`, `tsc`) | passa |
| Migração Alembic em SQLite | verificada |
| PostgreSQL/TimescaleDB, Docker Compose, systemd, ARM64 GB10, `nvidia-smi` real | **não testados** (sem Docker nem Sparks neste ambiente) |
| Interface renderizada no navegador | **não inspecionada visualmente**; apenas compilada |
| Agentes nas seis Sparks | **não instalados** — exige acesso às máquinas |

## Executar localmente (desenvolvimento)

```bash
# Backend (porta 8000)
cd backend && uv venv --python 3.13 && uv pip install -e ".[dev]"
DATABASE_URL=sqlite:///./dev.db ADMIN_PASSWORD='uma-senha-longa' SECRET_KEY=$(openssl rand -hex 32) \
  .venv/bin/uvicorn app.main:app --port 8000
# Frontend (porta 3000, proxy /api -> :8000)
cd frontend && npm install && npm run dev
# Testes
cd backend && .venv/bin/pytest ; cd ../agent && uv venv --python 3.13 && uv pip install -e ".[dev]" && .venv/bin/pytest
```

Modo demonstração (dados sintéticos, identificado por selo): `DATABASE_URL=sqlite:///demo.db python ../scripts/seed_demo.py` a partir de `backend/`.

## Builds de distribuição (`packaging/`)

```bash
packaging/build.sh agent                    # dist/ceia-agent-<versão>-linux-aarch64.tar.gz  → Sparks
packaging/build.sh central                  # dist/ceia-central-<versão>.tar.gz              → máquina central
packaging/build.sh central --images --platform linux/amd64   # inclui imagens Docker (instalação offline; exige Docker/buildx)
packaging/build.sh all                      # os dois
```

A versão da central é `backend/pyproject.toml` + commit (`1.0.0-3201a65`, com `-dirty` se houver alterações não commitadas). O pacote contém só arquivos versionados de `backend/`, `frontend/`, `deploy/`, os scripts de backup/restauração e `install.sh`. Na central (Linux com Docker e o plugin compose):

```bash
tar xzf ceia-central-*.tar.gz && cd ceia-central-*
sudo ./install.sh [--port 80] [--bind 0.0.0.0] [--site monitor.exemplo.com]
```

Instala em `/opt/ceia-compute-observatory/central` (`--prefix` muda). Na primeira vez gera o `.env` com segredos aleatórios e mostra a senha do admin **uma única vez**; nas atualizações mantém o `.env` e o banco (o projeto compose continua `deploy`, mesmos volumes), carrega as imagens do pacote se houver ou constrói, e espera `/api/v1/health` responder.

## Implantar a plataforma central a partir do repositório

```bash
cp .env.example .env     # defina POSTGRES_PASSWORD, SECRET_KEY, ADMIN_PASSWORD (BIND_ADDR/HTTP_PORT opcionais)
cd deploy && docker compose --env-file ../.env up -d --build
docker compose ps && curl http://localhost/api/v1/health
```

Funciona igual em localhost ou numa VPS, sem domínio nem certificado: o Caddy (`deploy/Caddyfile`) publica dashboard + API numa única porta HTTP (`BIND_ADDR:HTTP_PORT`, padrão `0.0.0.0:80`); backend, frontend e banco não são expostos (backend/frontend só em `127.0.0.1` para diagnóstico). Dashboard em `http://localhost` ou `http://<IP-da-VPS>`; os agentes enviam para `http://<IP-da-VPS>/api/v1/ingest`. Não é necessária VPN: cada Spark só precisa alcançar essa porta. Sem TLS, o token do agente trafega em texto claro; para HTTPS no futuro basta `SITE_ADDRESS=<domínio>` e abrir a 443. As migrações rodam na inicialização do backend (`alembic upgrade head`); a hypertable TimescaleDB é criada automaticamente se a extensão existir.

## Cadastrar máquinas e instalar o agente

**Pacote pronto (recomendado):** `packaging/build.sh agent` gera `dist/ceia-agent-<versão>-linux-aarch64.tar.gz` com o agente, as dependências ARM64 (instalação offline) e o instalador. Na Spark:
```bash
tar xzf ceia-agent-*-linux-aarch64.tar.gz && cd ceia-agent-*-linux-aarch64
sudo ./install.sh --url http://<IP-da-central> --token ceia_agt_...
ceia-agent-status
```
Alternativa a partir do repositório:

1. No dashboard: **Administração → Cadastrar máquina**. O token (`ceia_agt_…`) é exibido **uma única vez**; cada Spark tem o seu.
2. Em cada Spark (ARM64, Linux, Python ≥ 3.10):
   ```bash
   git clone <repo> && cd <repo>
   sudo scripts/install-agent.sh
   sudo nano /etc/ceia-compute-observatory/agent.env   # CENTRAL_API_URL e AGENT_TOKEN
   sudo systemctl restart ceia-agent
   scripts/agent-status.sh
   ```
3. Confirmação: `curl 127.0.0.1:9477` mostra `pending_samples: 0`; no dashboard a máquina fica *Online* após ~20 amostras (≈5 min) e o gráfico passa a mostrar dados.

Configuração do agente: `CENTRAL_API_URL` (`http://<IP-da-VPS>` ou `http://127.0.0.1`), `AGENT_TOKEN`, `MACHINE_ID` (opcional), `COLLECTION_INTERVAL_SECONDS` (15), `BATCH_SIZE`, `BUFFER_MAX_SAMPLES`, `BUFFER_DROP_POLICY`, `LOG_FILE`, `VERIFY_TLS`. Veja `agent/deploy/agent.env.example`.

**Atualizar o agente:** `git pull && sudo scripts/install-agent.sh` (mantém `agent.env`, reinicia o serviço; amostras pendentes ficam no buffer). **Remover:** `sudo scripts/uninstall-agent.sh`.

## Backup, restauração e diagnóstico

```bash
scripts/backup-db.sh ./backups            # pg_dump comprimido
scripts/restore-db.sh backups/arquivo.sql.gz   # destrutivo, pede confirmação
docker compose -f deploy/docker-compose.yml ps | logs -f backend
# no agente:
systemctl status ceia-agent; journalctl -u ceia-agent -f; ceia-agent --once   # imprime uma coleta
```

## Identidade visual

Logos oficiais baixados de ceia.ufg.br em `frontend/public/brand/` (`ceia.png`, `ufg.png`). Para substituir, troque os arquivos ou aponte outras URLs em **Administração → Identidade visual**. Cores/tipografia: `frontend/tailwind.config.ts` (azul-marinho `#023048`, azul `#2375E4`, ciano `#1BC7FA`, Roboto, valores extraídos do site público).

Validação numa Spark antes de instalar: [`docs/VALIDACAO-SPARK.md`](docs/VALIDACAO-SPARK.md).

Mais: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/METRICS.md`](docs/METRICS.md), [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
