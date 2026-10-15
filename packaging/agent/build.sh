#!/usr/bin/env bash
# Pacote das Sparks: gera dist/ceia-agent-<versão>-linux-aarch64.tar.gz: agente + dependências (wheels ARM64) + instalador.
# Roda em qualquer máquina com Python 3 (macOS/Linux); a instalação na Spark não precisa de internet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(sed -n 's/^AGENT_VERSION = "\(.*\)"/\1/p' "$ROOT/agent/src/ceia_agent/__init__.py")"
NAME="ceia-agent-$VERSION-linux-aarch64"
OUT="$ROOT/dist"; STAGE="$(mktemp -d)/$NAME"
PY="${PYTHON:-python3}"
mkdir -p "$STAGE/wheels" "$OUT"

# Wheel do próprio agente (puro Python).
"$PY" -m pip wheel --quiet --no-deps --wheel-dir "$STAGE/wheels" "$ROOT/agent"
# Dependências para Linux ARM64. psutil usa wheel abi3 (vale para Python 3.10+);
# baixamos para cada versão provável do Python da Spark para cobrir eventuais diferenças.
for pyv in 3.10 3.12; do
  "$PY" -m pip download --quiet --only-binary=:all: --dest "$STAGE/wheels" \
    --platform manylinux2014_aarch64 --platform manylinux_2_17_aarch64 --platform manylinux_2_28_aarch64 \
    --python-version "$pyv" --implementation cp \
    "psutil>=5.9" "httpx>=0.27" "nvidia-ml-py>=12"
done

cp "$ROOT/packaging/agent/install.sh" "$STAGE/"
cp "$ROOT/scripts/uninstall-agent.sh" "$STAGE/uninstall.sh"
cp "$ROOT/scripts/agent-status.sh" "$ROOT/agent/deploy/ceia-agent.service" "$ROOT/agent/deploy/agent.env.example" "$STAGE/"
chmod +x "$STAGE"/*.sh
cat > "$STAGE/LEIA-ME.txt" <<TXT
CEIA Compute Observatory - agente $VERSION (Linux ARM64 / DGX Spark)

1. No dashboard: Administração -> Cadastrar máquina, copie o token (ceia_agt_...).
2. Na Spark:
     tar xzf $NAME.tar.gz && cd $NAME
     sudo ./install.sh --url http://IP-DA-CENTRAL --token ceia_agt_...
3. Conferir: ceia-agent-status   (pending_samples deve ir a 0)

Atualizar: extraia a versão nova e rode sudo ./install.sh (mantém agent.env).
Remover:   sudo ceia-agent-uninstall
Config:    /etc/ceia-compute-observatory/agent.env
TXT
tar -C "$(dirname "$STAGE")" -czf "$OUT/$NAME.tar.gz" "$NAME"
( cd "$OUT" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
echo "Pacote: $OUT/$NAME.tar.gz"
ls "$STAGE/wheels"
