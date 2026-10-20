#!/usr/bin/env bash
# Instalador da plataforma central (dashboard + API + banco) em uma linha. Precisa de internet.
#
#   curl -fsSL https://raw.githubusercontent.com/Gusta-snt/ceia-compute-observatory/main/install-central.sh | sudo bash
#
# Na 1ª instalação pergunta o domínio (HTTPS automático) ou a porta, e exibe a senha do admin (anote: não é exibida de novo).
# Rodar de novo atualiza a central e mantém .env e banco.
#
# Opções:
#   --site DOMINIO       HTTPS automático (Let's Encrypt) em https://DOMINIO; o DNS deve apontar para esta
#                        máquina e as portas 80 e 443 precisam estar abertas
#   --no-site            volta para HTTP pelo IP (sem domínio)
#   --port PORTA         porta HTTP do dashboard/API sem domínio (padrão 80)
#   --bind ENDERECO      0.0.0.0 aceita agentes pela rede (padrão); 127.0.0.1 = só esta máquina
#   --prefix DIR         diretório de instalação (padrão /opt/ceia-compute-observatory/central)
#   --ref REF            branch/tag do repositório a instalar (padrão main)
#   -y, --yes            não pergunta nada (instala o Docker sem confirmar, se faltar)
set -euo pipefail

REPO="${CEIA_REPO:-Gusta-snt/ceia-compute-observatory}"
REF="main"; PREFIX=/opt/ceia-compute-observatory/central
PORT=""; BIND=""; SITE=""; NO_SITE=0; YES=0

say() { printf '\033[1;34m>>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merro:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --site) SITE="$2"; shift 2 ;;
    --no-site) NO_SITE=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    -y|--yes) YES=1; shift ;;
    -h|--help) sed -n '2,18p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; exit 0 ;;
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

# ---------------------------------------------------------------- configuração (só na 1ª instalação)
if [ ! -f "$PREFIX/.env" ] && [ "$NO_SITE" -eq 0 ] && [ -z "$SITE" ]; then
  ask SITE "Domínio para HTTPS, ex.: monitor.exemplo.com (Enter = sem domínio, HTTP pelo IP)" ""
  [ -n "$SITE" ] || [ -n "$PORT" ] || ask PORT "Porta HTTP do dashboard" "80"
fi
SITE="${SITE#http://}"; SITE="${SITE#https://}"; SITE="${SITE%%/*}"
[ -z "$PORT" ] || [[ "$PORT" =~ ^[0-9]+$ ]] || die "porta inválida: $PORT"
if [ -n "$SITE" ]; then
  [[ "$SITE" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "domínio inválido: $SITE"
  [ -z "$PORT" ] || [ "$PORT" = 80 ] || die "com HTTPS a porta HTTP precisa ser 80 (emissão do certificado)"
  PORT=80
  # O Let's Encrypt só emite o certificado se o domínio apontar para esta máquina.
  DNS_IP="$(getent ahostsv4 "$SITE" 2>/dev/null | awk 'NR==1{print $1}')"
  PUB_IP="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$DNS_IP" ]; then
    echo "aviso: $SITE ainda não resolve no DNS; crie um registro A apontando para ${PUB_IP:-o IP público desta máquina}." >&2
  elif [ -n "$PUB_IP" ] && [ "$DNS_IP" != "$PUB_IP" ]; then
    echo "aviso: $SITE aponta para $DNS_IP, mas o IP público desta máquina parece ser $PUB_IP." >&2
  else
    say "DNS ok: $SITE -> $DNS_IP"
  fi
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    say "Liberando 80 e 443 no ufw"; ufw allow 80/tcp >/dev/null; ufw allow 443 >/dev/null
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
[ -z "$SITE" ] || ARGS+=(--site "$SITE")
[ "$NO_SITE" -eq 0 ] || ARGS+=(--no-site)
# O instalador do pacote usa a própria pasta como raiz do pacote (backend/, frontend/, deploy/...).
cp "$TMP/packaging/central/install.sh" "$TMP/install.sh"
bash "$TMP/install.sh" "${ARGS[@]}"

# ---------------------------------------------------------------- próximos passos
P="$(sed -n 's/^HTTP_PORT=\([0-9]*\).*/\1/p' "$PREFIX/.env")"; P="${P:-80}"
S="$(sed -n 's/^SITE_ADDRESS=//p' "$PREFIX/.env" | tail -1)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
case "$S" in ""|:*) ADDR="http://${IP:-<IP-desta-máquina>}$([ "$P" = 80 ] || echo ":$P")" ;; *) ADDR="https://$S" ;; esac
echo
say "Dashboard: $ADDR   (usuário admin)"
echo "   Próximo passo: Administração -> Cadastrar máquina mostra o comando de instalação do agente."
echo "   Atualizar: rode este mesmo comando de novo.   Backup: sudo $PREFIX/scripts/backup-db.sh /var/backups/ceia"
