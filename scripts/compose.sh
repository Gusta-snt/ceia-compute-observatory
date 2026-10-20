#!/usr/bin/env bash
# docker compose da central com os arquivos certos: inclui o HTTPS (porta 443) se SITE_ADDRESS for um domínio.
# Uso: scripts/compose.sh ps | logs -f backend | up -d --build | ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="${ENV_FILE:-$ROOT/.env}"
[ -f "$ENV" ] || { echo "não encontrei $ENV (defina ENV_FILE)"; exit 1; }
FILES=(-f "$ROOT/deploy/docker-compose.yml")
SITE="$(sed -n 's/^SITE_ADDRESS=//p' "$ENV" | tail -1)"
case "$SITE" in ""|:*) ;; *) FILES+=(-f "$ROOT/deploy/docker-compose.https.yml") ;; esac
exec docker compose "${FILES[@]}" --env-file "$ENV" "$@"
