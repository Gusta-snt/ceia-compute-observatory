#!/usr/bin/env bash
# Instala/atualiza a plataforma central a partir deste pacote.
# Uso: sudo ./install.sh [--prefix DIR] [--port 80] [--bind 0.0.0.0] [--site dominio]
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Execute como root (sudo)."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX=/opt/ceia-compute-observatory/central
PORT=""; BIND=""; SITE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --site) SITE="$2"; shift 2 ;;
    *) echo "argumento desconhecido: $1"; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "Docker não encontrado: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta o plugin docker compose (pacote docker-compose-plugin)."; exit 1; }
VERSION="$(cat "$HERE/VERSION")"

# Código novo substitui o anterior; .env e backups/ ficam. O diretório deploy/ mantém o nome
# do projeto compose ("deploy"), então volumes do banco de instalações anteriores são reaproveitados.
mkdir -p "$PREFIX"
rm -rf "$PREFIX/backend" "$PREFIX/frontend" "$PREFIX/deploy" "$PREFIX/scripts" "$PREFIX/docs"
cp -R "$HERE/backend" "$HERE/frontend" "$HERE/deploy" "$HERE/scripts" "$HERE/docs" \
      "$HERE/.env.example" "$HERE/VERSION" "$PREFIX/"

ENV="$PREFIX/.env"
setkv() { if grep -qE "^#?\s*$1=" "$ENV"; then sed -i -E "s|^#?\s*$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
if [ ! -f "$ENV" ]; then
  ADMIN_PW="$(openssl rand -base64 18 | tr -d '/+=')"
  cp "$PREFIX/.env.example" "$ENV"
  # Remove comentários no fim da linha para os valores ficarem limpos.
  sed -i -E -e 's/^([A-Z_]+=[^#]*[^ #])[[:space:]]+#.*$/\1/' -e 's/^([A-Z_]+=)[[:space:]]+#.*$/\1/' "$ENV"
  setkv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  setkv SECRET_KEY "$(openssl rand -hex 32)"
  setkv ADMIN_PASSWORD "$ADMIN_PW"
  echo ">> .env criado em $ENV"
  echo ">> Usuário: admin   Senha: $ADMIN_PW   (anote agora; não será exibida de novo)"
fi
[ -n "$PORT" ] && setkv HTTP_PORT "$PORT"
[ -n "$BIND" ] && setkv BIND_ADDR "$BIND"
[ -n "$SITE" ] && setkv SITE_ADDRESS "$SITE"
setkv APP_VERSION "$VERSION"
chmod 600 "$ENV"

COMPOSE=(docker compose -f "$PREFIX/deploy/docker-compose.yml" --env-file "$ENV")
if [ -f "$HERE/images/images.tar.gz" ]; then
  echo ">> Carregando imagens Docker do pacote..."
  docker load -i "$HERE/images/images.tar.gz"
  "${COMPOSE[@]}" up -d --pull never
else
  echo ">> Construindo imagens (precisa de internet)..."
  "${COMPOSE[@]}" up -d --build
fi

HTTP_PORT="$(sed -n 's/^HTTP_PORT=\([0-9]*\).*/\1/p' "$ENV")"
URL="http://127.0.0.1:${HTTP_PORT:-80}/api/v1/health"
for _ in $(seq 60); do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "Central $VERSION no ar: http://<IP-desta-máquina>:${HTTP_PORT:-80}"
    exit 0
  fi
  sleep 2
done
echo "A API não respondeu em $URL. Veja: ${COMPOSE[*]} logs backend"; exit 1
