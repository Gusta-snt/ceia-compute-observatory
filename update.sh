#!/usr/bin/env bash
# Atualiza a central e/ou o agente desta máquina para a versão mais recente do GitHub. Precisa de internet.
#
#   curl -fsSL https://raw.githubusercontent.com/Gusta-snt/ceia-compute-observatory/main/update.sh | sudo bash
#   sudo ceia-update            # depois que a máquina já foi instalada/atualizada uma vez
#
# Detecta sozinho o que está instalado aqui (central, agente ou os dois) e atualiza só isso. Mantém toda a
# configuração: .env, banco, modo de publicação e filtro da central; agent.env (URL, token) e buffer do agente.
#
# Opções:
#   --check              só mostra versão instalada x disponível, sem alterar nada
#   --central-only       atualiza apenas a central
#   --agent-only         atualiza apenas o agente
#   --force              reinstala a central mesmo que já esteja na versão mais recente
#   --ref REF            branch/tag a instalar (padrão main)
#   --prefix DIR         diretório da central (padrão /opt/ceia-compute-observatory/central)
set -euo pipefail

REPO="${CEIA_REPO:-Gusta-snt/ceia-compute-observatory}"
REF="main"
CENTRAL_PREFIX=/opt/ceia-compute-observatory/central
AGENT_PREFIX=/opt/ceia-compute-observatory
CHECK=0; DO_CENTRAL=1; DO_AGENT=1; FORCE=0

say() { printf '\033[1;34m>>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33maviso:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merro:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --central-only) DO_AGENT=0; shift ;;
    --agent-only) DO_CENTRAL=0; shift ;;
    --force) FORCE=1; shift ;;
    --ref) REF="$2"; shift 2 ;;
    --prefix) CENTRAL_PREFIX="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; exit 0 ;;
    *) die "argumento desconhecido: $1 (use --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "execute como root: curl -fsSL ... | sudo bash -s -- [opções]"
[ "$(uname -s)" = "Linux" ] || die "a central e o agente rodam em Linux"
command -v curl >/dev/null || die "curl não encontrado"
command -v tar >/dev/null || die "tar não encontrado"

# ---------------------------------------------------------------- o que está instalado aqui
HAS_CENTRAL=0; HAS_AGENT=0
[ ! -f "$CENTRAL_PREFIX/.env" ] || HAS_CENTRAL=1
{ [ -x "$AGENT_PREFIX/venv/bin/ceia-agent" ] || [ -f /etc/systemd/system/ceia-agent.service ]; } && HAS_AGENT=1
[ "$DO_CENTRAL" -eq 1 ] || HAS_CENTRAL=0
[ "$DO_AGENT" -eq 1 ] || HAS_AGENT=0
if [ "$HAS_CENTRAL" -eq 0 ] && [ "$HAS_AGENT" -eq 0 ]; then
  die "nada para atualizar: não encontrei a central ($CENTRAL_PREFIX/.env) nem o agente nesta máquina.
   Instalar a central: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install-central.sh | sudo bash
   Instalar o agente:  veja Administração -> Cadastrar máquina no dashboard"
fi

SHA="$(curl -fsSL -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$REF" 2>/dev/null || true)"
[ -n "$SHA" ] || warn "não consegui consultar a versão mais recente de $REPO@$REF no GitHub; seguindo sem comparar."

CUR_CENTRAL=""; CUR_AGENT=""
[ "$HAS_CENTRAL" -eq 0 ] || CUR_CENTRAL="$(cat "$CENTRAL_PREFIX/VERSION" 2>/dev/null || echo desconhecida)"
[ "$HAS_AGENT" -eq 0 ] || CUR_AGENT="$("$AGENT_PREFIX/venv/bin/python" -c 'import ceia_agent; print(ceia_agent.AGENT_VERSION)' 2>/dev/null || echo desconhecida)"

echo "Repositório: $REPO@$REF${SHA:+ (${SHA:0:7})}"
[ "$HAS_CENTRAL" -eq 0 ] || echo "  central instalada: $CUR_CENTRAL"
[ "$HAS_AGENT" -eq 0 ] || echo "  agente instalado:  $CUR_AGENT"

CENTRAL_UPTODATE=0
if [ "$HAS_CENTRAL" -eq 1 ] && [ -n "$SHA" ] && [[ "$CUR_CENTRAL" == *-"${SHA:0:7}" ]]; then CENTRAL_UPTODATE=1; fi
if [ "$CHECK" -eq 1 ]; then
  [ "$HAS_CENTRAL" -eq 0 ] || { [ "$CENTRAL_UPTODATE" -eq 1 ] && echo "  central: já na versão mais recente" || echo "  central: há atualização disponível"; }
  [ "$HAS_AGENT" -eq 0 ] || echo "  agente: a versão publicada só é conhecida ao baixar; rode sem --check para atualizar"
  exit 0
fi

# ---------------------------------------------------------------- download
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
say "Baixando $REPO@$REF${SHA:+ ${SHA:0:7}} ..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/${SHA:-$REF}" | tar -xz -C "$TMP" --strip-components=1 \
  || die "falha ao baixar https://github.com/$REPO (ref $REF)"
[ -f "$TMP/install-central.sh" ] && [ -f "$TMP/agent/install.sh" ] || die "o ref $REF não contém os instaladores"

FAILED=0
# ---------------------------------------------------------------- central
# O instalador mantém .env, banco, modo, domínio e filtro de origem quando rodado sem essas opções.
if [ "$HAS_CENTRAL" -eq 1 ]; then
  if [ "$CENTRAL_UPTODATE" -eq 1 ] && [ "$FORCE" -eq 0 ]; then
    say "Central já está na versão mais recente ($CUR_CENTRAL); use --force para reinstalar."
  else
    say "Atualizando a central ..."
    # Backup do banco antes de migrar o esquema (falha no backup não impede a atualização).
    if [ -x "$CENTRAL_PREFIX/scripts/backup-db.sh" ]; then
      "$CENTRAL_PREFIX/scripts/backup-db.sh" "$CENTRAL_PREFIX/backups" >/dev/null 2>&1 \
        && say "Backup do banco salvo em $CENTRAL_PREFIX/backups" || warn "backup do banco falhou; seguindo."
    fi
    bash "$TMP/install-central.sh" -y --ref "${SHA:-$REF}" --prefix "$CENTRAL_PREFIX" || { warn "a atualização da central falhou"; FAILED=1; }
  fi
fi

# ---------------------------------------------------------------- agente
# Sem --url/--token usa os de agent.env; -y não pergunta nada.
if [ "$HAS_AGENT" -eq 1 ]; then
  say "Atualizando o agente ..."
  bash "$TMP/agent/install.sh" -y --ref "${SHA:-$REF}" || { warn "a atualização do agente falhou"; FAILED=1; }
fi

# Comando local para as próximas atualizações.
install -m 755 "$TMP/update.sh" /usr/local/bin/ceia-update 2>/dev/null || true

[ "$FAILED" -eq 0 ] || die "alguma atualização falhou (veja as mensagens acima)"
say "Atualização concluída. Próximas vezes: sudo ceia-update"
