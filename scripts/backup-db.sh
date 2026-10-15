#!/usr/bin/env bash
# Backup do PostgreSQL do compose. Uso: scripts/backup-db.sh [pasta]
set -euo pipefail
DIR="${1:-./backups}"; mkdir -p "$DIR"
OUT="$DIR/observatory-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose -f "$(dirname "$0")/../deploy/docker-compose.yml" exec -T db pg_dump -U observatory observatory | gzip > "$OUT"
echo "Backup: $OUT"
