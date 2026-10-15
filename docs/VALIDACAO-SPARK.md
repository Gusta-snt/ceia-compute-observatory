# Tutorial — validar o agente numa DGX Spark

Objetivo: confirmar, **sem instalar serviço, sem mexer em nada do pesquisador e sem servidor central**, que o agente coleta corretamente no GB10. Tudo roda como usuário comum, dentro de uma pasta temporária, e é removido no fim. Faça numa Spark primeiro; só repita nas outras depois que passar.

Tempo estimado: 20–30 min. Nada aqui requer `sudo`, exceto (opcionalmente) o `apt install` do passo 1.

> Convenção: `[ ]` = ponto de verificação. Anote o resultado de cada um — a seção "O que me enviar" no fim lista o que é útil.

---

## 0. Preparar (na sua máquina → na Spark)

Copie o projeto para a Spark (escolha um):

```bash
# a) rsync a partir do Mac (SSH)
rsync -av --exclude node_modules --exclude .venv --exclude .next --exclude '*.db' \
  ./SPARKS-EMC/ usuario@<ip-ou-host-da-spark>:~/ceia-validacao/

# b) ou git clone, se o repositório estiver num remoto
```

Na Spark:

```bash
cd ~/ceia-validacao
```

## 1. Diagnóstico do host (somente leitura)

```bash
bash scripts/collect-spark-diagnostics.sh
```

Gera `spark-diag-<host>-<data>.txt`. **Abra o arquivo e confira:**

- [ ] `arquitetura` mostra `aarch64`.
- [ ] `python` mostra Python ≥ 3.10 e `venv/ensurepip: ok`.
  Se falhar: `sudo apt install -y python3-venv python3-pip`.
- [ ] `psi` mostra linhas `some avg10=…` para memory/cpu/io.
  Se der "No such file": o kernel não expõe PSI — não é bloqueante (essas métricas ficam `n/d`), mas anote.
- [ ] `nvidia-smi query CSV` mostra uma linha com valores. **Anote quais campos aparecem como `[N/A]` ou `[Not Supported]`** — é o dado mais importante: no GB10, `memory.total/used` costumam ser N/A (memória unificada) e, às vezes, `utilization.gpu` também.
- [ ] `systemd` presente (`systemd 2xx`) e `journalctl` encontrado.
- [ ] `rede (saída)` mostra `pypi: HTTP 200`. Se não, o `pip install` do passo 2 precisará de um mirror/proxy.

## 2. Instalar o agente em um venv descartável

```bash
cd agent
python3 -m venv /tmp/ceia-venv
/tmp/ceia-venv/bin/pip install --quiet --upgrade pip
/tmp/ceia-venv/bin/pip install --quiet -e ".[nvml]"
/tmp/ceia-venv/bin/ceia-agent --help
```

- [ ] A instalação terminou sem erro de compilação (`psutil`, `httpx`, `nvidia-ml-py` instalam como wheels).
- [ ] `--help` imprime as opções.

## 3. Coletar uma amostra e inspecionar a qualidade das métricas

```bash
/tmp/ceia-venv/bin/ceia-agent --once > /tmp/ceia-once.json
python3 - <<'PY'
import json
d = json.load(open("/tmp/ceia-once.json"))
w = max(len(k) for k in d["values"])
for k, v in d["values"].items():
    print(f"{k:<{w}}  {str(v):<22} {d['quality'][k]:<12} {d['sources'][k]}")
PY
```

Interprete a tabela (colunas: métrica, valor, qualidade, fonte):

| Métrica | Esperado | Se não for assim |
|---|---|---|
| `cpu_percent`, `cpu_cores` | número; cores = `nproc` (20 no GB10) | bug — reporte |
| `mem_total_bytes` | ≈ 128 GiB (≈ 1,37e11) | reporte |
| `mem_percent`, `mem_available_bytes` | números coerentes com `free -b` | compare com `free -h` |
| `swap_used_bytes` | número (pode ser 0 real) | — |
| `psi_memory_some_avg10` | número, qualidade `ok`, fonte `proc_pressure` | `unsupported` = kernel sem PSI |
| `gpu_util_percent` | número 0–100 **ou** `null` + `unsupported` | `null` é aceitável, mas **muda o comportamento** (ver abaixo) |
| `gpu_temp_c`, `gpu_power_w`, `gpu_clock_sm_mhz` | números plausíveis (temp 30–90, W > 0) | `null` indica campo N/A no driver |
| `gpu_mem_total_bytes`, `gpu_mem_used_bytes` | **`null` / `unsupported` é o esperado no GB10** | se vierem números, anote (o sistema não os usa como VRAM) |
| `unified_total_bytes`, `unified_percent` | iguais a `mem_total_bytes` / `mem_percent`, fonte `proc_meminfo` | ausente = bug |
| `disk_percent`, `disk_free_bytes` | números do `/` | — |
| `disk_read_bps`, `net_rx_bps` | `null` nesta chamada (1ª amostra não tem taxa) | normal |

Verificações cruzadas (cada uma deve bater com o comando de referência, com folga de ±2–3 p.p.):

```bash
free -b | head -2                                   # total/available
nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,power.draw --format=csv,noheader
df -h /
```

- [ ] `mem_percent` ≈ `(total-available)/total` do `free`.
- [ ] `gpu_temp_c` e `gpu_power_w` batem com o `nvidia-smi`.
- [ ] Nenhum valor `ok` é `0` quando o comando de referência mostra valor ≠ 0.
- [ ] **Teste de carga (GPU):** rode algo leve na GPU por ~30 s (ex.: `python3 -c "import torch;x=torch.randn(8192,8192,device='cuda');[x@x for _ in range(200)];torch.cuda.synchronize()"`, se houver torch; **somente se a Spark estiver livre**) e repita o `--once`. `gpu_util_percent` deve subir. Se continuar `null`/0 com GPU ocupada, anote — é decisivo para a classificação.

> **Consequência importante:** se `gpu_util_percent` for sempre `null`/`unsupported`, o sistema classificará a máquina como "Dados insuficientes" e **nunca** como "Potencialmente subutilizada". Isso é intencional; a decisão de usar outra fonte de utilização (por exemplo, processos de GPU) seria um ajuste a fazer com base no seu relatório.

## 4. Enviar de verdade (receptor falso, sem servidor central)

Terminal A (receptor):

```bash
python3 scripts/fake-central.py 8000
```

Terminal B (agente com intervalo curto):

```bash
mkdir -p /tmp/ceia-state
cat > /tmp/ceia-agent.env <<'ENV'
CENTRAL_API_URL=http://127.0.0.1:8000
AGENT_TOKEN=ceia_agt_teste_local
COLLECTION_INTERVAL_SECONDS=5
BUFFER_PATH=/tmp/ceia-state/buffer.db
STATE_DIR=/tmp/ceia-state
HEALTH_PORT=9477
LOG_LEVEL=INFO
ENV
/tmp/ceia-venv/bin/ceia-agent --env-file /tmp/ceia-agent.env
```

- [ ] O terminal A passa a imprimir `N amostras …` a cada poucos segundos, com `gpu_util=` e `unified%=` coerentes.
- [ ] Terminal C: `curl -s 127.0.0.1:9477 | python3 -m json.tool` mostra `status: ok`, `pending_samples: 0`, `collect_errors: 0`.
- [ ] O uso de CPU do próprio agente é baixo: `top -b -n1 -p $(pgrep -f ceia-agent | head -1) | tail -2` (esperado < 2 %).

### 4.1 Queda de rede (buffer e reenvio)

1. Pare o receptor (Ctrl+C no terminal A) e espere ~30 s.
2. `curl -s 127.0.0.1:9477` → `status: degraded`, `pending_samples` crescendo, `send_failures` > 0.
3. Reinicie o receptor (`python3 scripts/fake-central.py 8000`).
4. Em até ~1–2 min: `pending_samples` volta a 0 e o receptor mostra um lote grande.

- [ ] A coleta não parou durante a queda.
- [ ] Todo o backlog foi entregue após a volta.

### 4.2 Rejeição temporária

Reinicie o receptor com `python3 scripts/fake-central.py 8000 --fail-first 5`.

- [ ] O agente registra falhas (503) e depois entrega tudo sem perda.

Encerre o agente com Ctrl+C.

## 5. Testar a unit systemd endurecida (sem tocar no serviço real)

Esta etapa valida as restrições de segurança (`ProtectSystem=strict`, `CapabilityBoundingSet=` vazio…) que o `nvidia-smi` pode não aceitar. Usa uma unit **transitória** com `systemd-run`, que some ao terminar. Requer `sudo` (e é a única etapa que precisa).

```bash
sudo systemd-run --unit=ceia-teste --wait --collect --pipe \
  -p User=$USER -p NoNewPrivileges=true -p ProtectSystem=strict -p ProtectHome=read-only \
  -p PrivateTmp=true -p CapabilityBoundingSet= -p RestrictAddressFamilies="AF_INET AF_INET6 AF_UNIX" \
  /tmp/ceia-venv/bin/ceia-agent --once
```

> Como `ProtectHome=read-only` permite ler `/tmp/ceia-venv`? O venv está em `/tmp`, e `PrivateTmp=true` o esconde. Se der `No such file`, copie o venv para `/opt` (`sudo cp -r /tmp/ceia-venv /opt/ceia-venv`) e use esse caminho — é o que o instalador faz de qualquer forma.

- [ ] Saída com o JSON de métricas e **`gpu_*` com valores** (não `unavailable`).
  - Se `gpu_*` virou `unavailable` só aqui, as restrições bloquearam o acesso a `/dev/nvidia*`: afrouxe `CapabilityBoundingSet=` / `ProtectSystem=` na unit antes de instalar.

## 6. Plataforma central (opcional, só quando houver um servidor)

Pule se ainda não tem host para o servidor. Na VPS (ou localhost) com Docker, porta 80 aberta:

```bash
cp .env.example .env     # preencha POSTGRES_PASSWORD, SECRET_KEY, ADMIN_PASSWORD
cd deploy && docker compose --env-file ../.env up -d --build
docker compose ps
docker compose logs backend | grep -iE "alembic|timescale|error"
curl http://localhost/api/v1/health
```

- [ ] Os quatro serviços (db, backend, frontend, caddy) ficam `running`/`healthy`.
- [ ] `docker compose exec db psql -U observatory -c "select hypertable_name from timescaledb_information.hypertables;"` lista `samples` (confirma o TimescaleDB; se vazio, o sistema funciona em PostgreSQL puro).
- [ ] Login em `http://<IP-da-VPS>` (ou `http://localhost`) funciona.

Depois, cadastre **uma** máquina em Administração, copie o token e repita o passo 4 apontando `CENTRAL_API_URL=http://<IP-da-VPS>`. Aguarde ~5 min.

- [ ] Máquina aparece *Online* e os gráficos mostram dados.
- [ ] `docker compose exec db psql -U observatory -c "select count(*), max(ts) from samples;"` cresce.

## 7. Limpeza

```bash
rm -rf /tmp/ceia-venv /tmp/ceia-state /tmp/ceia-agent.env /tmp/ceia-once.json ~/ceia-validacao
# se criou a cópia em /opt:  sudo rm -rf /opt/ceia-venv
```

Nada permanente foi instalado nos passos 1–5.

---

## O que me enviar

1. O arquivo `spark-diag-….txt` (passo 1) — revise antes: contém hostname e IPs.
2. A tabela impressa no passo 3, **com a GPU ociosa e com a GPU sob carga**.
3. O resultado do passo 5 (`systemd-run`): sucesso ou a mensagem de erro.
4. Qualquer `[ ]` que não passou, com a saída do comando.

Com isso eu ajusto os coletores ao que o GB10 realmente expõe, e só então vale instalar nas seis.
