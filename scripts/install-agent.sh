#!/usr/bin/env bash
# Instala/atualiza o agente nesta máquina (requer root). Não sobrescreve agent.env existente sem confirmação.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Execute como root (sudo)."; exit 1; }
SRC="$(cd "$(dirname "$0")/../agent" && pwd)"
PREFIX=/opt/ceia-compute-observatory
CONF=/etc/ceia-compute-observatory/agent.env
PY="${PYTHON:-python3}"

id ceia-agent >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin ceia-agent
mkdir -p "$PREFIX" /etc/ceia-compute-observatory
"$PY" -m venv "$PREFIX/venv"
"$PREFIX/venv/bin/pip" install --quiet --upgrade pip
"$PREFIX/venv/bin/pip" install --quiet --upgrade "$SRC"
"$PREFIX/venv/bin/pip" install --quiet nvidia-ml-py || echo "aviso: nvidia-ml-py indisponível; usando nvidia-smi"

if [ -f "$CONF" ]; then
  read -r -p "$CONF já existe. Sobrescrever? [s/N] " a
  [[ "$a" =~ ^[sS]$ ]] && cp "$SRC/deploy/agent.env.example" "$CONF" || echo "Mantendo configuração existente."
else
  cp "$SRC/deploy/agent.env.example" "$CONF"
  echo ">> Edite $CONF (CENTRAL_API_URL e AGENT_TOKEN) antes de iniciar."
fi
chown root:ceia-agent "$CONF"; chmod 640 "$CONF"
cp "$SRC/deploy/ceia-agent.service" /etc/systemd/system/ceia-agent.service
systemctl daemon-reload
systemctl enable ceia-agent >/dev/null
if "$PREFIX/venv/bin/ceia-agent" --check --env-file "$CONF"; then
  systemctl restart ceia-agent && echo "Agente iniciado. Use scripts/agent-status.sh"
else
  echo "Configuração incompleta: serviço habilitado mas não iniciado."
fi
