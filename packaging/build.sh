#!/usr/bin/env bash
# Ponto de entrada dos builds de distribuição (saída em dist/).
#   packaging/build.sh agent               pacote offline das Sparks (Linux ARM64)
#   packaging/build.sh central [opções]    pacote da máquina central (dashboard + API + banco)
#   packaging/build.sh all [opções]        os dois
# Opções da central: --images [--platform linux/amd64|linux/arm64]  (veja packaging/central/build.sh)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-}"; shift || true
case "$TARGET" in
  agent) "$HERE/agent/build.sh" ;;
  central) "$HERE/central/build.sh" "$@" ;;
  all) "$HERE/agent/build.sh" && "$HERE/central/build.sh" "$@" ;;
  *) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
