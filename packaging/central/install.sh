#!/usr/bin/env bash
# Instala/atualiza a plataforma central a partir deste pacote.
# Uso: sudo ./install.sh [--mode https|proxy|http] [--domain D] [--port P] [--bind IP] [--proxy-network REDE] [--prefix DIR]
#   --mode https   o Caddy da central emite o certificado (Let's Encrypt) para --domain; precisa das portas 80 e 443
#                  livres e do DNS do domínio apontando para esta máquina.
#   --mode proxy   já existe um proxy com HTTPS nesta máquina (NetBird, Caddy, Nginx...): a central sobe só em HTTP
#                  em BIND:PORT (padrão 127.0.0.1:8080) e o proxy encaminha --domain para ela. Com --proxy-network,
#                  o Caddy da central entra nessa rede Docker como "ceia-observatory" (proxy rodando em container).
#   --mode http    HTTP pelo IP, sem domínio (porta 80 ou --port).
#   Sem --mode mantém o modo atual. Atalhos antigos: --site D = --mode https --domain D; --no-site = --mode http.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Execute como root (sudo)."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX=/opt/ceia-compute-observatory/central
PORT=""; BIND=""; MODE=""; DOMAIN=""; PROXY_NET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --proxy-network) PROXY_NET="$2"; shift 2 ;;
    --site) MODE=https; DOMAIN="$2"; shift 2 ;;
    --no-site) MODE=http; shift ;;
    *) echo "argumento desconhecido: $1"; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "Docker não encontrado: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta o plugin docker compose (pacote docker-compose-plugin)."; exit 1; }
VERSION="$(cat "$HERE/VERSION")"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"

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
getkv() { sed -n "s/^$1=//p" "$ENV" | tail -1; }
# Modo de publicação (só muda quando --mode/--site/--no-site é passado; senão mantém o da instalação anterior).
case "$MODE" in
  https)
    [ -n "$DOMAIN" ] || DOMAIN="$(getkv PUBLIC_DOMAIN)"
    [ -n "$DOMAIN" ] || { echo "--mode https exige --domain"; exit 2; }
    setkv SITE_ADDRESS "$DOMAIN"; setkv PUBLIC_DOMAIN "$DOMAIN"; setkv COOKIE_SECURE true; setkv PROXY_NETWORK ""
    setkv HTTP_PORT 80; setkv BIND_ADDR "${BIND:-0.0.0.0}" ;;
  proxy)
    setkv SITE_ADDRESS ""; setkv COOKIE_SECURE true; setkv PROXY_NETWORK "$PROXY_NET"
    [ -z "$DOMAIN" ] || setkv PUBLIC_DOMAIN "$DOMAIN"
    setkv HTTP_PORT "${PORT:-8080}"; setkv BIND_ADDR "${BIND:-127.0.0.1}" ;;
  http)
    setkv SITE_ADDRESS ""; setkv PUBLIC_DOMAIN ""; setkv COOKIE_SECURE false; setkv PROXY_NETWORK ""
    setkv HTTP_PORT "${PORT:-80}"; setkv BIND_ADDR "${BIND:-0.0.0.0}" ;;
  "")
    [ -z "$PORT" ] || setkv HTTP_PORT "$PORT"
    [ -z "$BIND" ] || setkv BIND_ADDR "$BIND" ;;
  *) echo "--mode deve ser https, proxy ou http"; exit 2 ;;
esac
if [ -z "$MODE" ] && ! grep -q '^CENTRAL_MODE=' "$ENV"; then   # instalações anteriores a esta opção
  case "$(getkv SITE_ADDRESS)" in ""|:*) MODE=http ;; *) MODE=https; setkv PUBLIC_DOMAIN "$(getkv SITE_ADDRESS)" ;; esac
  setkv CENTRAL_MODE "$MODE"; MODE=""
fi
[ -z "$MODE" ] || setkv CENTRAL_MODE "$MODE"
MODE="$(getkv CENTRAL_MODE)"; SITE="$(getkv SITE_ADDRESS)"; DOMAIN="$(getkv PUBLIC_DOMAIN)"; PROXY_NET="$(getkv PROXY_NETWORK)"
HTTP_PORT="$(getkv HTTP_PORT)"; HTTP_PORT="${HTTP_PORT:-80}"
[ -z "$PROXY_NET" ] || docker network inspect "$PROXY_NET" >/dev/null 2>&1 \
  || { echo "rede Docker '$PROXY_NET' não existe (docker network ls)"; exit 1; }

# Porta ocupada por outro serviço (ex.: o Caddy do NetBird) faria o compose falhar no meio da instalação.
port_busy() {
  ss -ltnH "( sport = :$1 )" 2>/dev/null | grep -q . || return 1
  ! docker ps --filter "publish=$1" --format '{{.Names}}' | grep -q '^deploy-caddy'
}
PORTS="$HTTP_PORT"; [ "$MODE" != https ] || PORTS="80 443"
for p in $PORTS; do
  if port_busy "$p"; then
    echo "A porta $p já está em uso por outro serviço nesta máquina."
    [ "$MODE" = https ] && echo "Se já existe um proxy (NetBird, Caddy, Nginx) nas portas 80/443, use: --mode proxy --domain <domínio>" \
                        || echo "Escolha outra porta com --port."
    exit 1
  fi
done
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
if [ "$MODE" = proxy ]; then
  UP="127.0.0.1:$HTTP_PORT"; [ -z "$PROXY_NET" ] || UP="ceia-observatory:80"
  PROXY_C="$(docker ps --filter "publish=443" ${PROXY_NET:+--filter "network=$PROXY_NET"} --format '{{.Names}}' | grep -v '^deploy-caddy' | head -1 || true)"
  CFILE=""; [ -z "$PROXY_C" ] || CFILE="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$PROXY_C" 2>/dev/null || true)"
  echo "Central $VERSION no ar em http://$UP (atrás do seu proxy)."
  echo
  echo "Adicione ao Caddyfile do seu proxy${CFILE:+ ($CFILE)}:"
  echo
  echo "${DOMAIN:-monitor.seudominio.com} {"
  echo "	reverse_proxy $UP"
  echo "}"
  echo
  [ -z "$PROXY_C" ] || echo "e recarregue: docker exec $PROXY_C caddy reload --config /etc/caddy/Caddyfile"
  echo "(Nginx: proxy_pass http://$UP; com proxy_buffering off para o stream /api/v1/stream.)"
  [ -n "$DOMAIN" ] && curl -fsS --max-time 5 "https://$DOMAIN/api/v1/health" >/dev/null 2>&1 \
    && echo "https://$DOMAIN já está respondendo."
  exit 0
fi
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
