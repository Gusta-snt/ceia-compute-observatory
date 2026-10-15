#!/usr/bin/env bash
# Restaura um backup (DESTRUTIVO: substitui o banco). Uso: scripts/restore-db.sh arquivo.sql.gz
set -euo pipefail
F="${1:?informe o arquivo .sql.gz}"
read -r -p "Isto substituirá o banco atual. Digite RESTAURAR para continuar: " c
[ "$c" = "RESTAURAR" ] || exit 1
C="docker compose -f $(dirname "$0")/../deploy/docker-compose.yml"
$C stop backend
$C exec -T db psql -U observatory -d postgres -c "DROP DATABASE observatory" -c "CREATE DATABASE observatory OWNER observatory"
gunzip -c "$F" | $C exec -T db psql -U observatory observatory
$C start backend
