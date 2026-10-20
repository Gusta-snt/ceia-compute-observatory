#!/usr/bin/env bash
# Instalador da plataforma central (dashboard + API + banco) em uma linha. Precisa de internet.
#
#   curl -fsSL https://raw.githubusercontent.com/Gusta-snt/ceia-compute-observatory/main/install-central.sh | sudo bash
#
# Na 1ª instalação pergunta como publicar a central e exibe a senha do admin (anote: não é exibida de novo).
# Rodar de novo atualiza a central e mantém .env, banco e o modo escolhido.
#
# Modos (--mode):
#   https   a central emite o próprio certificado (Let's Encrypt) para --domain; precisa das portas 80/443 livres
#   proxy   já existe um proxy com HTTPS nesta máquina (ex.: Caddy do NetBird): a central sobe só em HTTP numa
#           porta local e o instalador mostra o bloco para colar no Caddyfile do proxy (nada nele é alterado)
#   http    HTTP pelo IP, sem domínio
# Opções:
#   --mode MODO          https | proxy | http (sem --mode: pergunta na 1ª instalação, depois mantém)
#   --domain DOMINIO     domínio público (modos https e proxy)
#   --port PORTA         porta HTTP da central (modo http: 80; modo proxy: 8080 local)
#   --proxy-network REDE modo proxy: rede Docker do proxy existente (detectada sozinha se ele roda em container)
#   --bind ENDERECO      endereço de escuta (http/https: 0.0.0.0; proxy: 127.0.0.1)
#   --prefix DIR         diretório de instalação (padrão /opt/ceia-compute-observatory/central)
#   --ref REF            branch/tag do repositório a instalar (padrão main)
#   -y, --yes            não pergunta nada (instala o Docker sem confirmar, se faltar)
set -euo pipefail

REPO="${CEIA_REPO:-Gusta-snt/ceia-compute-observatory}"
REF="main"; PREFIX=/opt/ceia-compute-observatory/central
PORT=""; BIND=""; MODE=""; DOMAIN=""; PROXY_NET=""; YES=0

say() { printf '\033[1;34m>>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merro:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --proxy-network) PROXY_NET="$2"; shift 2 ;;
    --site) MODE=https; DOMAIN="$2"; shift 2 ;;
    --no-site) MODE=http; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    -y|--yes) YES=1; shift ;;
    -h|--help) sed -n '2,24p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; exit 0 ;;
    *) die "argumento desconhecido: $1 (use --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "execute como root: curl -fsSL ... | sudo bash -s -- [opções]"
[ "$(uname -s)" = "Linux" ] || die "a central roda em Linux com Docker"

# Perguntas vêm do terminal mesmo com o script chegando pelo pipe do curl.
TTY=""
if [ "$YES" -eq 0 ] && { : </dev/tty; } 2>/dev/null; then TTY=/dev/tty; fi
ask() {  # ask VAR "pergunta" "padrão"
  local __v="$1" ans=""
  [ -n "$TTY" ] || { printf -v "$__v" '%s' "${3:-}"; return; }
  read -r -p "$2${3:+ [$3]}: " ans <"$TTY"
  printf -v "$__v" '%s' "${ans:-${3:-}}"
}

# ---------------------------------------------------------------- pré-requisitos
need_pkgs=()
for c in curl tar openssl; do command -v "$c" >/dev/null || need_pkgs+=("$c"); done
if [ ${#need_pkgs[@]} -gt 0 ]; then
  command -v apt-get >/dev/null || die "instale manualmente: ${need_pkgs[*]}"
  say "Instalando pré-requisitos: ${need_pkgs[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need_pkgs[@]}" >/dev/null
fi

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  ok="s"; [ -z "$TTY" ] || ask ok "Docker (com o plugin compose) não encontrado. Instalar agora pelo script oficial get.docker.com? [s/n]" "s"
  [[ "$ok" =~ ^[sS]$ ]] || die "instale o Docker: https://docs.docker.com/engine/install/"
  say "Instalando Docker ..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker info >/dev/null 2>&1 || die "o Docker não está rodando (systemctl start docker)"

# ---------------------------------------------------------------- modo de publicação
# Algo que não é a própria central ocupando 80/443 = já existe um proxy (NetBird, Caddy, Nginx...).
port_busy() {
  ss -ltnH "( sport = :$1 )" 2>/dev/null | grep -q . || return 1
  ! docker ps --filter "publish=$1" --format '{{.Names}}' | grep -q '^deploy-caddy'
}
PROXY_C="$(docker ps --filter publish=443 --format '{{.Names}}' | grep -v '^deploy-caddy' | head -1 || true)"
BUSY=0; { port_busy 443 || port_busy 80; } && BUSY=1

if [ -z "$MODE" ] && [ ! -f "$PREFIX/.env" ]; then
  if [ -n "$TTY" ]; then
    echo
    echo "Como a central será acessada?"
    echo "  1) HTTPS automático: a central emite o próprio certificado (precisa das portas 80 e 443 livres)"
    echo "  2) Atrás de um proxy que já existe nesta máquina (NetBird, Caddy, Nginx...): você mantém o seu proxy"
    echo "  3) HTTP pelo IP, sem domínio"
    if [ "$BUSY" -eq 1 ]; then
      echo "  Detectado: as portas 80/443 já estão em uso${PROXY_C:+ pelo container '$PROXY_C'} -> opção 2."
      DEF=2
    else
      DEF=1
    fi
    ask OPT "Opção" "$DEF"
    case "$OPT" in 1) MODE=https ;; 2) MODE=proxy ;; 3) MODE=http ;; *) die "opção inválida: $OPT" ;; esac
  else
    MODE=http; [ "$BUSY" -eq 0 ] || MODE=proxy
  fi
fi
[ -z "$MODE" ] || [[ "$MODE" =~ ^(https|proxy|http)$ ]] || die "--mode deve ser https, proxy ou http"

DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
if [ "$MODE" = https ] || [ "$MODE" = proxy ]; then
  [ -n "$DOMAIN" ] || [ ! -f "$PREFIX/.env" ] || DOMAIN="$(sed -n 's/^PUBLIC_DOMAIN=//p' "$PREFIX/.env" | tail -1)"
  [ -n "$DOMAIN" ] || ask DOMAIN "Domínio público da central (ex.: monitor.exemplo.com)" ""
  [ -n "$DOMAIN" ] || [ "$MODE" = proxy ] || die "o modo https exige um domínio (--domain)"
  [ -z "$DOMAIN" ] || [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "domínio inválido: $DOMAIN"
fi
[ -z "$PORT" ] || [[ "$PORT" =~ ^[0-9]+$ ]] || die "porta inválida: $PORT"
[ "$MODE" != http ] || [ -n "$PORT" ] || [ -f "$PREFIX/.env" ] || ask PORT "Porta HTTP do dashboard" "80"

if [ "$MODE" = https ]; then
  [ "$BUSY" -eq 0 ] || die "as portas 80/443 já estão em uso${PROXY_C:+ ('$PROXY_C')}. Use --mode proxy para manter o proxy existente."
  # O Let's Encrypt só emite o certificado se o domínio apontar para esta máquina.
  DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
  PUB_IP="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$DNS_IP" ]; then
    echo "aviso: $DOMAIN ainda não resolve no DNS; crie um registro A apontando para ${PUB_IP:-o IP público desta máquina}." >&2
  elif [ -n "$PUB_IP" ] && [ "$DNS_IP" != "$PUB_IP" ]; then
    echo "aviso: $DOMAIN aponta para $DNS_IP, mas o IP público desta máquina parece ser $PUB_IP." >&2
  else
    say "DNS ok: $DOMAIN -> $DNS_IP"
  fi
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    say "Liberando 80 e 443 no ufw"; ufw allow 80/tcp >/dev/null; ufw allow 443 >/dev/null
  fi
fi

if [ "$MODE" = proxy ] && [ -z "$PROXY_NET" ] && [ -n "$PROXY_C" ]; then
  # Proxy em container: a central entra na rede dele (sem expor porta nova e sem mexer no firewall).
  NETS="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$PROXY_C" 2>/dev/null || true)"
  NET="$(printf '%s\n' $NETS | grep -vx -e host -e none | head -1 || true)"
  if [ -n "$NET" ]; then
    ok="s"; [ -z "$TTY" ] || ask ok "Conectar a central à rede Docker '$NET' do proxy '$PROXY_C'? [s/n]" "s"
    [[ ! "$ok" =~ ^[sS]$ ]] || PROXY_NET="$NET"
  fi
fi

# ---------------------------------------------------------------- download
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
SHA="$(curl -fsSL -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$REF" 2>/dev/null || true)"
say "Baixando a central ($REPO@$REF${SHA:+ ${SHA:0:7}}) ..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/${SHA:-$REF}" | tar -xz -C "$TMP" --strip-components=1 \
  || die "falha ao baixar https://github.com/$REPO (ref $REF)"
[ -f "$TMP/packaging/central/install.sh" ] || die "o ref $REF não contém packaging/central/install.sh"

# Mesmo formato de versão do pacote (packaging/central/build.sh): <versão>-<commit>.
BASE_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$TMP/backend/pyproject.toml")"
echo "$BASE_VERSION-${SHA:0:7}" | sed 's/-$//' > "$TMP/VERSION"

ARGS=(--prefix "$PREFIX")
[ -z "$PORT" ] || ARGS+=(--port "$PORT")
[ -z "$BIND" ] || ARGS+=(--bind "$BIND")
[ -z "$MODE" ] || ARGS+=(--mode "$MODE")
[ -z "$DOMAIN" ] || ARGS+=(--domain "$DOMAIN")
[ -z "$PROXY_NET" ] || ARGS+=(--proxy-network "$PROXY_NET")
# O instalador do pacote usa a própria pasta como raiz do pacote (backend/, frontend/, deploy/...).
cp "$TMP/packaging/central/install.sh" "$TMP/install.sh"
bash "$TMP/install.sh" "${ARGS[@]}"

# ---------------------------------------------------------------- próximos passos
P="$(sed -n 's/^HTTP_PORT=\([0-9]*\).*/\1/p' "$PREFIX/.env")"; P="${P:-80}"
M="$(sed -n 's/^CENTRAL_MODE=//p' "$PREFIX/.env" | tail -1)"
D="$(sed -n 's/^PUBLIC_DOMAIN=//p' "$PREFIX/.env" | tail -1)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ "$M" != http ] && [ -n "$D" ]; then ADDR="https://$D"; else ADDR="http://${IP:-<IP-desta-máquina>}$([ "$P" = 80 ] || echo ":$P")"; fi
echo
say "Dashboard: $ADDR   (usuário admin)"
echo "   Próximo passo: Administração -> Cadastrar máquina mostra o comando de instalação do agente."
echo "   Atualizar: rode este mesmo comando de novo.   Backup: sudo $PREFIX/scripts/backup-db.sh /var/backups/ceia"
