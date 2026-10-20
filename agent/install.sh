#!/usr/bin/env bash
# Instalador do agente CEIA Compute Observatory em uma linha (baixa o agente do GitHub; precisa de internet).
#
#   curl -fsSL https://raw.githubusercontent.com/Gusta-snt/ceia-compute-observatory/main/agent/install.sh \
#     | sudo bash -s -- --url http://IP-DA-CENTRAL --token ceia_agt_...
#
# Sem --url/--token o script pergunta no terminal. Também serve para atualizar (mantém agent.env)
# e para mudar a configuração de uma máquina já instalada (rode de novo com as opções novas).
#
# Opções:
#   --url URL            CENTRAL_API_URL (ex.: http://203.0.113.10)
#   --token TOKEN        AGENT_TOKEN gerado no dashboard (Administração -> Cadastrar máquina)
#   --interval SEG       COLLECTION_INTERVAL_SECONDS (padrão 15)
#   --set CHAVE=VALOR    qualquer variável do agent.env (repetível), ex.: --set PROCESS_CMDLINE=false
#   --ref REF            branch/tag do repositório a instalar (padrão main)
#   -y, --yes            não pergunta nada (falha se faltar URL ou token)
#   --uninstall          remove o agente (mantém configuração e buffer)
# As variáveis CENTRAL_API_URL e AGENT_TOKEN no ambiente também são aceitas no lugar de --url/--token.
set -euo pipefail

REPO="${CEIA_AGENT_REPO:-Gusta-snt/ceia-compute-observatory}"
REF="main"
PREFIX=/opt/ceia-compute-observatory
CONF_DIR=/etc/ceia-compute-observatory
CONF="$CONF_DIR/agent.env"
PY="${PYTHON:-python3}"
URL="${CENTRAL_API_URL:-}"; TOKEN="${AGENT_TOKEN:-}"; INTERVAL=""; YES=0; UNINSTALL=0
SETS=()

say() { printf '\033[1;34m>>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33maviso:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merro:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --set) [[ "$2" =~ ^[A-Z_][A-Z0-9_]*=.*$ ]] || die "--set espera CHAVE=VALOR, recebeu: $2"; SETS+=("$2"); shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    -y|--yes) YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; exit 0 ;;
    *) die "argumento desconhecido: $1 (use --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "execute como root: curl -fsSL ... | sudo bash -s -- [opções]"
[ "$(uname -s)" = "Linux" ] || die "o agente roda apenas em Linux com systemd"
command -v systemctl >/dev/null || die "systemd não encontrado"

if [ "$UNINSTALL" -eq 1 ]; then
  systemctl disable --now ceia-agent 2>/dev/null || true
  rm -f /etc/systemd/system/ceia-agent.service /usr/local/bin/ceia-agent-status /usr/local/bin/ceia-agent-uninstall
  systemctl daemon-reload
  rm -rf "$PREFIX/venv"
  say "Agente removido. Configuração ($CONF_DIR) e buffer (/var/lib/ceia-compute-observatory) preservados."
  exit 0
fi

# Perguntas vêm do terminal mesmo com o script chegando pelo pipe do curl.
TTY=""
if [ "$YES" -eq 0 ] && { : </dev/tty; } 2>/dev/null; then TTY=/dev/tty; fi
ask() {  # ask VAR "pergunta" "padrão" [secreto]
  local __v="$1" q="$2" def="${3:-}" ans=""
  [ -n "$TTY" ] || { printf -v "$__v" '%s' "$def"; return; }
  if [ -n "${4:-}" ]; then
    read -r -s -p "$q${def:+ [Enter mantém o atual]}: " ans <"$TTY"; echo >"$TTY"
  else
    read -r -p "$q${def:+ [$def]}: " ans <"$TTY"
  fi
  printf -v "$__v" '%s' "${ans:-$def}"
}
current() { [ -f "$CONF" ] && sed -n "s/^$1=//p" "$CONF" | tail -1 || true; }

# ---------------------------------------------------------------- configuração
CUR_URL="$(current CENTRAL_API_URL)"; CUR_TOKEN="$(current AGENT_TOKEN)"
case "$CUR_URL" in *203.0.113.10*) CUR_URL="" ;; esac           # valor do exemplo
case "$CUR_TOKEN" in *COLE_AQUI*) CUR_TOKEN="" ;; esac
[ -n "$URL" ] || ask URL "Endereço da central (ex.: http://203.0.113.10)" "$CUR_URL"
[ -n "$TOKEN" ] || ask TOKEN "Token do agente (ceia_agt_...)" "$CUR_TOKEN" secret
if [ -z "$INTERVAL" ] && [ -n "$TTY" ] && [ -z "$CUR_URL" ]; then
  ask INTERVAL "Intervalo de coleta em segundos" "15"
fi
URL="${URL%/}"
[[ "$URL" =~ ^https?:// ]] || die "endereço da central inválido: '${URL}' (use --url http://IP-DA-CENTRAL)"
[ -n "$TOKEN" ] || die "token ausente (use --token ceia_agt_...; gere em Administração -> Cadastrar máquina)"
[[ "$TOKEN" == ceia_agt_* ]] || warn "o token não começa com ceia_agt_; confira se copiou o valor completo"
[ -z "$INTERVAL" ] || [[ "$INTERVAL" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "intervalo inválido: $INTERVAL"

# ---------------------------------------------------------------- pré-requisitos
need_pkgs=()
command -v curl >/dev/null || need_pkgs+=(curl)
command -v tar >/dev/null || need_pkgs+=(tar)
command -v "$PY" >/dev/null || need_pkgs+=(python3)
if command -v "$PY" >/dev/null && ! "$PY" -c 'import venv, ensurepip' 2>/dev/null; then need_pkgs+=(python3-venv); fi
if [ ${#need_pkgs[@]} -gt 0 ]; then
  if command -v apt-get >/dev/null; then
    say "Instalando pré-requisitos: ${need_pkgs[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need_pkgs[@]}" >/dev/null
  else
    die "instale manualmente: ${need_pkgs[*]}"
  fi
fi
"$PY" -c 'import sys; assert sys.version_info >= (3, 10)' 2>/dev/null || die "requer Python >= 3.10 ($("$PY" --version 2>&1))"

say "Testando a central em $URL ..."
# Central em HTTPS redireciona http:// -> https://; o agente não segue redirecionamentos, então já grava a URL final.
FINAL="$(curl -sS -L -o /dev/null --max-time 10 -w '%{url_effective}' "$URL/api/v1/health" 2>/dev/null || true)"
if [[ "$URL" == http://* && "$FINAL" == https://*/api/v1/health ]]; then
  URL="${FINAL%/api/v1/health}"
  say "A central usa HTTPS; usando $URL"
fi
if curl -fsS --max-time 10 "$URL/api/v1/health" >/dev/null 2>&1; then
  say "Central respondeu."
else
  warn "não consegui acessar $URL/api/v1/health; o agente guardará as amostras no buffer até a central responder."
fi

# ---------------------------------------------------------------- download e instalação
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
say "Baixando o agente ($REPO@$REF) ..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP" --strip-components=1 \
  || die "falha ao baixar https://github.com/$REPO (ref $REF)"
SRC="$TMP/agent"
[ -f "$SRC/pyproject.toml" ] || die "pacote baixado não contém agent/ (ref $REF)"

id ceia-agent >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin ceia-agent
mkdir -p "$PREFIX" "$CONF_DIR"
say "Instalando em $PREFIX/venv ..."
"$PY" -m venv "$PREFIX/venv"
PIP=("$PREFIX/venv/bin/pip" install --quiet --disable-pip-version-check --upgrade)
"${PIP[@]}" pip
"${PIP[@]}" "$SRC"
"${PIP[@]}" nvidia-ml-py 2>/dev/null || warn "nvidia-ml-py indisponível; usando nvidia-smi"

# agent.env: cria a partir do exemplo e grava os valores informados (mantém o resto).
[ -f "$CONF" ] || { cp "$SRC/deploy/agent.env.example" "$CONF"; say "Configuração criada em $CONF"; }
sed -i -E 's/^([A-Z_]+=[^#"]*[^ #"])[[:space:]]+#.*$/\1/' "$CONF"   # systemd não aceita comentário no fim da linha
setkv() {
  local k="$1" v="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$k" -v v="$v" 'BEGIN{done=0} $0 ~ "^#? *"k"=" {if(!done){print k"="v; done=1}; next} {print} END{if(!done) print k"="v}' "$CONF" >"$tmp"
  cat "$tmp" >"$CONF"; rm -f "$tmp"
}
setkv CENTRAL_API_URL "$URL"
setkv AGENT_TOKEN "$TOKEN"
[ -z "$INTERVAL" ] || setkv COLLECTION_INTERVAL_SECONDS "$INTERVAL"
for kv in ${SETS[@]+"${SETS[@]}"}; do setkv "${kv%%=*}" "${kv#*=}"; done
chown root:ceia-agent "$CONF"; chmod 640 "$CONF"

cp "$SRC/deploy/ceia-agent.service" /etc/systemd/system/ceia-agent.service
install -m 755 "$TMP/scripts/agent-status.sh" /usr/local/bin/ceia-agent-status
install -m 755 "$TMP/scripts/uninstall-agent.sh" /usr/local/bin/ceia-agent-uninstall
systemctl daemon-reload
systemctl enable ceia-agent >/dev/null
"$PREFIX/venv/bin/ceia-agent" --check --env-file "$CONF" >/dev/null || die "configuração inválida em $CONF"
systemctl restart ceia-agent

# ---------------------------------------------------------------- verificação
PORT="$(current HEALTH_PORT)"; PORT="${PORT:-9477}"
VERSION="$("$PREFIX/venv/bin/python" -c 'import ceia_agent; print(ceia_agent.AGENT_VERSION)')"
say "Agente $VERSION iniciado; aguardando o primeiro envio (até 60 s) ..."
health=""
for _ in $(seq 30); do
  sleep 2
  health="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT" 2>/dev/null || true)"
  [ -n "$health" ] || continue
  rc=0; printf '%s' "$health" | "$PY" -c 'import json,sys; h=json.load(sys.stdin)
sys.exit(0 if h.get("last_sent_sample") else 3 if "401" in (h.get("last_error") or "") else 1)' || rc=$?
  if [ "$rc" -eq 0 ]; then
    say "Pronto: amostras chegando na central. A máquina deve aparecer como online no dashboard."
    echo "   Status: ceia-agent-status    Config: $CONF    Remover: sudo ceia-agent-uninstall"
    exit 0
  fi
  [ "$rc" -ne 3 ] || die "a central recusou o token (401). Gere um novo no dashboard e rode de novo com --token"
done
ERR="$(printf '%s' "$health" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("last_error") or "")' 2>/dev/null || true)"
systemctl is-active --quiet ceia-agent || die "o serviço não ficou ativo; veja: journalctl -u ceia-agent -n 50"
warn "o agente está rodando, mas ainda não confirmou envio à central${ERR:+: $ERR}"
echo "   Verifique o token e o acesso à central; diagnóstico: ceia-agent-status" >&2
exit 1
