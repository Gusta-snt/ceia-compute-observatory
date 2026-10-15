#!/usr/bin/env bash
# Coleta, SOMENTE LEITURA, informações do host para validar o agente. Não requer root.
# Uso: bash scripts/collect-spark-diagnostics.sh   ->   gera spark-diag-<host>-<data>.txt
set -u
OUT="spark-diag-$(hostname)-$(date +%Y%m%d-%H%M%S).txt"
sec() { printf '\n===== %s =====\n' "$1"; }
{
  sec "sistema";        uname -a; cat /etc/os-release 2>/dev/null | head -4; uptime
  sec "arquitetura";    uname -m; nproc
  sec "python";         command -v python3; python3 --version; python3 -c "import venv, ensurepip; print('venv/ensurepip: ok')" 2>&1
  sec "systemd";        systemctl --version | head -1; command -v journalctl
  sec "meminfo";        head -8 /proc/meminfo
  sec "psi";            for r in memory cpu io; do echo "-- $r"; cat /proc/pressure/$r 2>&1; done
  sec "nvidia-smi (resumo)";   command -v nvidia-smi && nvidia-smi 2>&1 | head -25
  sec "nvidia-smi query CSV (campos que o agente usa)"
  nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,power.draw,clocks.sm,clocks.mem,memory.total,memory.used,name,driver_version --format=csv 2>&1
  sec "nvidia-smi campos individuais"
  for f in utilization.gpu temperature.gpu power.draw clocks.sm clocks.mem memory.total memory.used; do
    printf '%s: ' "$f"; nvidia-smi --query-gpu=$f --format=csv,noheader,nounits 2>&1
  done
  sec "nvidia-smi -q (trecho de memória/utilização/energia)"
  nvidia-smi -q 2>&1 | grep -iE -A6 "Utilization|FB Memory|Power Readings|Temperature" | head -60
  sec "dispositivos nvidia";   ls -l /dev/nvidia* 2>&1
  sec "nvml em python";  python3 - <<'PY' 2>&1
try:
    import pynvml
    pynvml.nvmlInit()
    h = pynvml.nvmlDeviceGetHandleByIndex(0)
    for n, f in [("util", lambda: pynvml.nvmlDeviceGetUtilizationRates(h).gpu),
                 ("temp", lambda: pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)),
                 ("power_mW", lambda: pynvml.nvmlDeviceGetPowerUsage(h)),
                 ("mem", lambda: pynvml.nvmlDeviceGetMemoryInfo(h).total)]:
        try: print(n, f())
        except Exception as e: print(n, "ERRO:", e)
except ImportError:
    print("pynvml não instalado (ok: o agente usa nvidia-smi como alternativa)")
PY
  sec "filesystems";    df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>&1
  sec "docker";         docker --version 2>&1; docker compose version 2>&1; id
  sec "rede (saída)";   (curl -sS -m 8 -o /dev/null -w 'pypi: HTTP %{http_code}\n' https://pypi.org/simple/psutil/ 2>&1)
} > "$OUT" 2>&1
echo "Diagnóstico salvo em: $OUT"
echo "Revise antes de compartilhar (contém hostname e IPs)."
