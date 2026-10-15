# Métricas, qualidade e classificação

## Qualidade de cada valor
`ok` (medido, inclusive zero real) · `unsupported` (N/A / Not Supported) · `unavailable` (fonte ausente ou 1ª amostra de uma taxa) · `error` (falha de coleta). Valores não-`ok` são gravados como `NULL` e **nunca** como zero; no CSV aparecem vazios; nos gráficos, como lacunas.

## Fontes
| Métrica | Fonte |
|---|---|
| CPU, carga, rede, I/O | psutil, `os.getloadavg` (taxas via relógio monotônico) |
| Memória, cache, buffers, swap | `/proc/meminfo` |
| Pressão (PSI) | `/proc/pressure/{memory,cpu,io}` (some/full, avg10/avg60) |
| GPU: utilização, temperatura, potência, clock | NVML (se instalado); alternativa `nvidia-smi --query-gpu` |
| Memória unificada | derivada de `/proc/meminfo` (o mesmo pool físico da RAM) |
| Armazenamento | `psutil.disk_partitions` + `shutil.disk_usage`, excluindo tmpfs, squashfs, overlay etc. |

**GB10:** a memória é unificada; `memory.used/total` do NVML não é tratada como VRAM. A memória unificada **não é somada** à RAM — são o mesmo recurso. Utilização de GPU e pressão de memória são indicadores distintos e exibidos separadamente. Se o driver reportar N/A para a utilização da GPU, o sistema registra `unsupported` e a máquina nunca é classificada como subutilizada.

## Ranking de processos
A cada amostra o agente envia os `PROCESS_TOP_N` (10) processos que mais usam CPU e os 10 que mais usam GPU: PID, nome, usuário, linha de comando (até 240 caracteres, opcional), CPU % (relativo a **um** núcleo), memória residente, GPU % (SM) e memória de GPU por processo. GPU por processo vem do NVML (`nvmlDeviceGetProcessUtilization`) ou de `nvidia-smi pmon`; N/A fica vazio, nunca zero. Tabela `process_samples`, mesma retenção das amostras brutas (sem rollup).
`GET /api/v1/machines/{id}/processes?range=24h&sort=cpu|gpu|mem|gpu_mem` agrupa por nome + usuário: **CPU núcleo·h** = Σ CPU%/100 × duração; **GPU·h** = Σ GPU%/100 × duração; mais média/máximo, memória máxima, tempo visto e PIDs distintos. Processos fora do top N em uma coleta não são contados nela (ranking subestima cauda longa, não o topo).

## Estatísticas
Média simples (por amostra) e média ponderada por tempo (cada amostra pesa `interval_s`, limitado a 120 s) são exibidas lado a lado. Cobertura = tempo representado por amostras ÷ duração da janela. Ociosidade = fração do tempo observado com GPU < 5 % e CPU < 15 %.

## Classificação (limites editáveis em Administração)
Ordem de avaliação: dados insuficientes → pressão → alta → subutilizada → moderada.

| Regra | Padrão inicial |
|---|---|
| Cobertura mínima | 60 % |
| Pressão | memória unificada P95 ≥ 90 %, PSI some P95 ≥ 10 %, ou disco ≥ 90 % |
| Alta | GPU média ≥ 60 %, GPU P95 ≥ 90 %, ou CPU média ≥ 70 % |
| Subutilizada | GPU média < 15 % e P95 < 50 %; memória média < 50 % e P95 < 75 %; CPU média < 30 %; disco livre ≥ 100 GB |

Confiança *alta*: cobertura ≥ 90 % com GPU e memória disponíveis; *média*: ≥ 75 %; senão *baixa* (nunca candidata automática). Janelas: 24 h, 7 d, 30 d; a principal é 7 d, caindo para 24 h/30 d se insuficiente.
Esses valores são pontos de partida, não verdades universais. O resultado é evidência administrativa: não garante que um treinamento ou inferência específico caiba na máquina.

## Estados da máquina
`online` · `sem_comunicacao` (sem heartbeat por > 120 s — configurável) · `agente_com_problema` (última amostra com falha de CPU/memória) · `dados_insuficientes` (< 20 amostras).

## Alertas
`sem_comunicacao`, `agente_com_problema`, `memoria_disponivel_baixa` (< 10 %), `pressao_memoria` (PSI ≥ 20), `armazenamento_cheio` (≥ 90/95 %), `temperatura_alta` (≥ 85 °C), `consumo_alto` (≥ 200 W), `gpu_utilizacao_continua` (≥ 90 % por 60 min). Um alerta aberto por (máquina, regra); resolvido automaticamente. Métrica indisponível não resolve nem abre alertas. Sem notificações externas.
