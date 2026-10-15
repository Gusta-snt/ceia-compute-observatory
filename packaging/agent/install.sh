#!/usr/bin/env bash
# Instala/atualiza o agente CEIA a partir deste pacote (offline: dependências em ./wheels).
# Uso: sudo ./install.sh [--url http://IP-DA-CENTRAL] [--token ceia_agt_...]
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Execute como root (sudo)."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX=/opt/ceia-compute-observatory
CONF=/etc/ceia-compute-observatory/agent.env
PY="${PYTHON:-python3}"
URL=""; TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    *) echo "argumento desconhecido: $1"; exit 2 ;;
  esac
done

[ "$(uname -m)" = "aarch64" ] || echo "aviso: pacote gerado para aarch64; esta máquina é $(uname -m) (o pip buscará dependências online)."
"$PY" -c 'import sys; assert sys.version_info >= (3, 10)' 2>/dev/null || { echo "Requer Python >= 3.10"; exit 1; }
"$PY" -c 'import venv, ensurepip' 2>/dev/null || { echo "Falta o módulo venv: sudo apt install python3-venv"; exit 1; }

id ceia-agent >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin ceia-agent
mkdir -p "$PREFIX" /etc/ceia-compute-observatory
"$PY" -m venv "$PREFIX/venv"
PIP=("$PREFIX/venv/bin/pip" install --quiet --upgrade)
"${PIP[@]}" --no-index --find-links "$HERE/wheels" ceia-observatory-agent \
  || "${PIP[@]}" --find-links "$HERE/wheels" ceia-observatory-agent
"${PIP[@]}" --no-index --find-links "$HERE/wheels" nvidia-ml-py 2>/dev/null \
  || echo "aviso: nvidia-ml-py indisponível; usando nvidia-smi"

if [ ! -f "$CONF" ]; then
  cp "$HERE/agent.env.example" "$CONF"
  echo ">> Configuração criada em $CONF"
fi
# Remove comentários no fim da linha (systemd não os aceita; versões antigas do exemplo tinham).
sed -i -E 's/^([A-Z_]+=[^#"]*[^ #"])[[:space:]]+#.*$/\1/' "$CONF"
setkv() { if grep -qE "^#?\s*$1=" "$CONF"; then sed -i -E "s|^#?\s*$1=.*|$1=$2|" "$CONF"; else echo "$1=$2" >> "$CONF"; fi; }
[ -n "$URL" ] && setkv CENTRAL_API_URL "$URL"
[ -n "$TOKEN" ] && setkv AGENT_TOKEN "$TOKEN"
chown root:ceia-agent "$CONF"; chmod 640 "$CONF"

cp "$HERE/ceia-agent.service" /etc/systemd/system/ceia-agent.service
install -m 755 "$HERE/agent-status.sh" /usr/local/bin/ceia-agent-status
install -m 755 "$HERE/uninstall.sh" /usr/local/bin/ceia-agent-uninstall
systemctl daemon-reload
systemctl enable ceia-agent >/dev/null
if "$PREFIX/venv/bin/ceia-agent" --check --env-file "$CONF"; then
  systemctl restart ceia-agent
  echo "Agente iniciado. Verifique com: ceia-agent-status"
else
  echo "Configuração incompleta: edite $CONF (CENTRAL_API_URL e AGENT_TOKEN) e rode: sudo systemctl restart ceia-agent"
fi
