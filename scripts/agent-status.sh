#!/usr/bin/env bash
# Estado do serviço, health check local e últimas linhas de log.
systemctl --no-pager status ceia-agent | head -15
echo "--- health"; curl -s "http://127.0.0.1:${HEALTH_PORT:-9477}" | python3 -m json.tool
echo "--- logs"; journalctl -u ceia-agent -n "${1:-30}" --no-pager
