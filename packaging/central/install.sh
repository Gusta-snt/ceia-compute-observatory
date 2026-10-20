#!/usr/bin/env bash
# Instala/atualiza a plataforma central a partir deste pacote.
# Uso: sudo ./install.sh [--prefix DIR] [--port 80] [--bind 0.0.0.0] [--site dominio | --no-site]
#   --site monitor.exemplo.com  HTTPS automático (Let's Encrypt): o domínio deve apontar para esta máquina
#                               e as portas 80 e 443 precisam estar abertas.  --no-site volta para HTTP pelo IP.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Execute como root (sudo)."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX=/opt/ceia-compute-observatory/central
PORT=""; BIND=""; SITE=""; NO_SITE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --site) SITE="$2"; shift 2 ;;
    --no-site) NO_SITE=1; shift ;;
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
if [ -n "$SITE" ]; then
  SITE="${SITE#http://}"; SITE="${SITE#https://}"; SITE="${SITE%%/*}"
  setkv SITE_ADDRESS "$SITE"; setkv COOKIE_SECURE true
elif [ "$NO_SITE" -eq 1 ]; then
  setkv SITE_ADDRESS ""; setkv COOKIE_SECURE false
fi
SITE="$(sed -n 's/^SITE_ADDRESS=//p' "$ENV" | tail -1)"
case "$SITE" in :*) SITE="" ;; esac
HTTP_PORT="$(sed -n 's/^HTTP_PORT=\([0-9]*\).*/\1/p' "$ENV")"
if [ -n "$SITE" ] && [ "${HTTP_PORT:-80}" != 80 ]; then
  echo "aviso: com HTTPS a porta HTTP deve ser 80 (emissão do certificado); HTTP_PORT=$HTTP_PORT"
fi
setkv APP_VERSION "$VERSION"
chmod 600 "$ENV"

COMPOSE=("$PREFIX/scripts/compose.sh")
if [ -f "$HERE/images/images.tar.gz" ]; then
  echo ">> Carregando imagens Docker do pacote..."
  docker load -i "$HERE/images/images.tar.gz"
  "${COMPOSE[@]}" up -d --pull never
else
  echo ">> Construindo imagens (precisa de internet)..."
  "${COMPOSE[@]}" up -d --build
fi

BACKEND_PORT="$(sed -n 's/^BACKEND_PORT=\([0-9]*\).*/\1/p' "$ENV")"
URL="http://127.0.0.1:${BACKEND_PORT:-8000}/api/v1/health"
ok=0
for _ in $(seq 60); do
  if curl -fsS "$URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" -eq 1 ] || { echo "A API não respondeu em $URL. Veja: ${COMPOSE[*]} logs backend"; exit 1; }
if [ -z "$SITE" ]; then
  echo "Central $VERSION no ar: http://<IP-desta-máquina>:${HTTP_PORT:-80}"
  exit 0
fi
echo ">> Aguardando o certificado HTTPS de $SITE ..."
for _ in $(seq 45); do
  if curl -fsS --max-time 5 "https://$SITE/api/v1/health" >/dev/null 2>&1; then
    echo "Central $VERSION no ar: https://$SITE"
    exit 0
  fi
  sleep 2
done
echo "aviso: a central está rodando, mas https://$SITE ainda não respondeu com certificado válido."
echo "  Confira se o DNS de $SITE aponta para esta máquina e se as portas 80 e 443 estão abertas no firewall."
echo "  O Caddy tenta de novo sozinho; acompanhe com: ${COMPOSE[*]} logs -f caddy"
exit 0
