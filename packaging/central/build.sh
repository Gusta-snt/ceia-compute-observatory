#!/usr/bin/env bash
# Pacote da central: gera dist/ceia-central-<versão>.tar.gz com backend, frontend, compose, Caddy,
# scripts de backup/restauração e o instalador (install.sh).
#
# Uso: packaging/central/build.sh [--images] [--platform linux/amd64]
#   (padrão)   pacote só com código-fonte; a central constrói as imagens (precisa de internet).
#   --images   inclui as imagens Docker prontas (backend, frontend, TimescaleDB, Caddy) para
#              instalação offline. Exige Docker com buildx na máquina que gera o pacote.
#   --platform arquitetura da máquina central (padrão linux/amd64; linux/arm64 para ARM).
set -euo pipefail
export COPYFILE_DISABLE=1      # tar do macOS: sem arquivos ._ no pacote
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGES=0; PLATFORM="linux/amd64"
while [ $# -gt 0 ]; do
  case "$1" in
    --images) IMAGES=1; shift ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    *) echo "argumento desconhecido: $1"; exit 2 ;;
  esac
done

BASE_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$ROOT/backend/pyproject.toml")"
REV="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
git -C "$ROOT" diff --quiet HEAD 2>/dev/null || { REV="$REV-dirty"; echo "aviso: há alterações não commitadas; elas entram no pacote."; }
VERSION="${VERSION:-$BASE_VERSION+$REV}"
TAG="${VERSION//+/-}"                     # tags Docker não aceitam '+'
NAME="ceia-central-$TAG"
[ "$IMAGES" -eq 1 ] && NAME="$NAME-${PLATFORM//\//-}"
OUT="$ROOT/dist"; STAGE="$(mktemp -d)/$NAME"
mkdir -p "$STAGE" "$OUT"

# Mesmo layout do repositório: o compose usa ../backend e ../frontend, e os scripts de
# backup procuram ../deploy/docker-compose.yml. Só arquivos versionados (nada de .venv, node_modules, .env).
( cd "$ROOT" && git ls-files -z backend frontend deploy .env.example docs/OPERATIONS.md \
    scripts/backup-db.sh scripts/restore-db.sh scripts/compose.sh \
  | grep -zv '^backend/tests/' | xargs -0 tar -cf - ) | tar -C "$STAGE" -xf -
cp "$ROOT/packaging/central/install.sh" "$STAGE/"
chmod +x "$STAGE"/install.sh "$STAGE"/scripts/*.sh
echo "$TAG" > "$STAGE/VERSION"

if [ "$IMAGES" -eq 1 ]; then
  command -v docker >/dev/null || { echo "--images exige Docker"; exit 1; }
  mkdir -p "$STAGE/images"
  docker buildx build --platform "$PLATFORM" --load -t "ceia-observatory-backend:$TAG" "$ROOT/backend"
  docker buildx build --platform "$PLATFORM" --load -t "ceia-observatory-frontend:$TAG" \
    --build-arg BACKEND_URL=http://backend:8000 "$ROOT/frontend"
  BASE_IMAGES=$(sed -n 's/^ *image: *\([^ $]*\)$/\1/p' "$ROOT/deploy/docker-compose.yml")
  for img in $BASE_IMAGES; do docker pull --platform "$PLATFORM" "$img"; done
  # shellcheck disable=SC2086
  docker save "ceia-observatory-backend:$TAG" "ceia-observatory-frontend:$TAG" $BASE_IMAGES \
    | gzip > "$STAGE/images/images.tar.gz"
fi

cat > "$STAGE/LEIA-ME.txt" <<TXT
CEIA Compute Observatory - plataforma central $TAG
$( [ "$IMAGES" -eq 1 ] && echo "Imagens Docker incluídas ($PLATFORM): instalação não precisa de internet." || echo "Sem imagens: a instalação constrói backend/frontend e baixa TimescaleDB/Caddy (precisa de internet)." )

Requisitos: Linux com Docker Engine e o plugin docker compose.

1. tar xzf $NAME.tar.gz && cd $NAME
2. sudo ./install.sh                       # instala em /opt/ceia-compute-observatory/central
     opções: --prefix DIR  --port 80  --bind 0.0.0.0  --site monitor.exemplo.com
3. Na 1ª instalação o .env é gerado com segredos aleatórios e a senha do admin é exibida uma vez.
4. Dashboard: http://IP-DA-CENTRAL  ->  Administração -> Cadastrar máquina (token para cada Spark).

Atualizar: extraia a versão nova e rode sudo ./install.sh (mantém .env e o banco).
Backup:    sudo /opt/ceia-compute-observatory/central/scripts/backup-db.sh /var/backups/ceia
TXT

tar -C "$(dirname "$STAGE")" -czf "$OUT/$NAME.tar.gz" "$NAME"
( cd "$OUT" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
echo "Pacote: $OUT/$NAME.tar.gz ($(du -h "$OUT/$NAME.tar.gz" | cut -f1))"
