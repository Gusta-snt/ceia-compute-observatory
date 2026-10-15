#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Execute como root."; exit 1; }
systemctl disable --now ceia-agent 2>/dev/null || true
rm -f /etc/systemd/system/ceia-agent.service; systemctl daemon-reload
rm -rf /opt/ceia-compute-observatory
echo "Agente removido. Configuração (/etc/ceia-compute-observatory) e buffer (/var/lib/ceia-compute-observatory) preservados."
