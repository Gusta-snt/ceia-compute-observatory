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

## Instalação rápida da central (uma linha)

Em um Linux com internet (VPS ou máquina local):
```bash
curl -fsSL https://raw.githubusercontent.com/Gusta-snt/ceia-compute-observatory/main/install-central.sh | sudo bash
```
Instala o Docker se faltar (script oficial `get.docker.com`, pede confirmação), baixa o código, pergunta como a central será acessada, constrói e sobe a central em `/opt/ceia-compute-observatory/central`, e mostra o endereço do dashboard e a senha do admin (**uma única vez**).

Três modos (`--mode`, perguntado na 1ª instalação e mantido nas atualizações):

| Modo | Quando usar | O que acontece |
|---|---|---|
| `https` | Máquina com 80/443 livres | O Caddy da central emite e renova o certificado Let's Encrypt para `--domain` (DNS A apontando para a máquina, portas 80/443 abertas). Liga `COOKIE_SECURE`, confere o DNS e libera 80/443 no `ufw`, se ativo. |
| `proxy` | Já existe um proxy com HTTPS na máquina (ex.: **Caddy do NetBird**) | A central sobe só em HTTP em `127.0.0.1:8080` e **não toca** nas portas 80/443 nem no seu proxy. Se o proxy roda em container, a central entra na rede Docker dele como `ceia-observatory` (detectado sozinho). Se o proxy é **Traefik** com provider Docker (caso do NetBird), a rota é criada sozinha por labels no container da central (entrypoint e certresolver lidos do Traefik). Nos outros casos, o instalador mostra o bloco para colar no Caddyfile do proxy e o comando de reload. |
| `http` | Sem domínio | HTTP pelo IP (`--port`, padrão 80). |

Se as portas 80/443 já estiverem ocupadas, o instalador sugere o modo `proxy` (e recusa o `https`). Exemplo com o NetBird:
```bash
curl -fsSL https://raw.githubusercontent.com/Gusta-snt/ceia-compute-observatory/main/install-central.sh \
  | sudo bash -s -- --mode proxy --domain monitor.exemplo.com
# NetBird com Traefik: nada a fazer depois. Com Caddy:  monitor.exemplo.com { reverse_proxy ceia-observatory:80 }
```
Trocar de modo: rode de novo com outro `--mode`. Outras opções: `--port`, `--bind`, `--proxy-network <rede>`, `--prefix`, `--ref <branch/tag>`, `-y`. Rodar de novo atualiza e mantém `.env` e banco. Depois, **Administração → Cadastrar máquina** mostra o comando de uma linha para instalar o agente em cada Spark.

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
sudo ./install.sh [--mode https|proxy|http] [--domain monitor.exemplo.com] [--port 80] [--bind 0.0.0.0] [--proxy-network rede]
```

Instala em `/opt/ceia-compute-observatory/central` (`--prefix` muda). Na primeira vez gera o `.env` com segredos aleatórios e mostra a senha do admin **uma única vez**; nas atualizações mantém o `.env` e o banco (o projeto compose continua `deploy`, mesmos volumes), carrega as imagens do pacote se houver ou constrói, e espera `/api/v1/health` responder.

## Implantar a plataforma central a partir do repositório

```bash
cp .env.example .env     # defina POSTGRES_PASSWORD, SECRET_KEY, ADMIN_PASSWORD (BIND_ADDR/HTTP_PORT opcionais)
scripts/compose.sh up -d --build      # = docker compose com deploy/docker-compose.yml (+ docker-compose.https.yml se houver domínio)
scripts/compose.sh ps && curl http://localhost/api/v1/health
```

Funciona igual em localhost ou numa VPS, sem domínio nem certificado: o Caddy (`deploy/Caddyfile`) publica dashboard + API numa única porta HTTP (`BIND_ADDR:HTTP_PORT`, padrão `0.0.0.0:80`); backend, frontend e banco não são expostos (backend/frontend só em `127.0.0.1` para diagnóstico). Dashboard em `http://localhost` ou `http://<IP-da-VPS>`; os agentes enviam para `http://<IP-da-VPS>/api/v1/ingest`. Não é necessária VPN: cada Spark só precisa alcançar essa porta. Sem TLS, o token do agente trafega em texto claro; para HTTPS, `SITE_ADDRESS=<domínio>` e `COOKIE_SECURE=true` no `.env`, portas 80 e 443 abertas, e subir com `scripts/compose.sh` (que acrescenta `deploy/docker-compose.https.yml`, publicando a 443). As migrações rodam na inicialização do backend (`alembic upgrade head`); a hypertable TimescaleDB é criada automaticamente se a extensão existir.

## Cadastrar máquinas e instalar o agente

**Instalação em uma linha (recomendado, precisa de internet na máquina):** no dashboard, **Administração → Cadastrar máquina** já mostra o comando com o token. Na máquina Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/Gusta-snt/ceia-compute-observatory/main/agent/install.sh \
  | sudo bash -s -- --url http://<IP-da-central> --token ceia_agt_...
```
Sem `--url`/`--token` o script pergunta no terminal. Ele instala pré-requisitos (`python3-venv` via apt, se faltar), baixa o agente, cria/atualiza `/etc/ceia-compute-observatory/agent.env`, sobe o serviço e confirma o primeiro envio à central. Outras variáveis: `--interval 30`, `--set PROCESS_CMDLINE=false` (repetível, qualquer chave do `agent.env`), `--ref v1.1.0` (branch/tag), `-y` (sem perguntas). Rodar de novo atualiza o agente e mantém a configuração; `--uninstall` remove.

**Pacote offline:** `packaging/build.sh agent` gera `dist/ceia-agent-<versão>-linux-aarch64.tar.gz` com o agente, as dependências ARM64 (instalação offline) e o instalador. Na Spark:
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
