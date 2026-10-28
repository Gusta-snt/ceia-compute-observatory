#!/usr/bin/env bash
# Filtro de origem da porta da central: só os IPs/redes de ALLOW_FROM (no .env) abrem conexão com BIND_ADDR:HTTP_PORT.
# As regras ficam na cadeia CEIA-OBS, chamada pela DOCKER-USER: o Docker publica portas por iptables próprio e
# ignora o ufw, então o filtro precisa estar ali. O install.sh liga este script ao docker.service (drop-in), que
# o reaplica a cada boot ou reinício do Docker.
# Uso: scripts/firewall.sh [arquivo .env]   |   scripts/firewall.sh --clear   (remove o filtro)
set -euo pipefail
CHAIN=CEIA-OBS
command -v iptables >/dev/null || { echo "iptables não encontrado"; exit 1; }

clear_rules() {
  # Remove todos os saltos para a cadeia (mesmo de uma porta antiga) e a própria cadeia.
  iptables -S DOCKER-USER 2>/dev/null | grep -- "-j $CHAIN\$" | sed 's/^-A /-D /' \
    | while read -r rule; do eval "iptables $rule"; done
  iptables -F "$CHAIN" 2>/dev/null || true
  iptables -X "$CHAIN" 2>/dev/null || true
}

if [ "${1:-}" = --clear ]; then clear_rules; echo "filtro de origem removido"; exit 0; fi

ENV="${1:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
[ -f "$ENV" ] || { echo "não encontrei $ENV"; exit 1; }
getkv() { sed -n "s/^$1=//p" "$ENV" | tail -1; }
ALLOW="$(getkv ALLOW_FROM)"; BIND="$(getkv BIND_ADDR)"; PORT="$(getkv HTTP_PORT)"; PORT="${PORT:-80}"

clear_rules
[ -n "$ALLOW" ] || { echo "ALLOW_FROM vazio: sem filtro de origem"; exit 0; }

iptables -N "$CHAIN"
for src in ${ALLOW//,/ }; do iptables -A "$CHAIN" -s "$src" -j RETURN; done
iptables -A "$CHAIN" -j DROP
iptables -N DOCKER-USER 2>/dev/null || true   # no boot, antes do Docker; ele reaproveita a cadeia
# Só conexões novas destinadas à porta publicada (depois do DNAT, por isso o conntrack com o destino original).
DST=(); case "$BIND" in ""|0.0.0.0) ;; *) DST=(--ctorigdst "$BIND") ;; esac
iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctstate NEW --ctorigdstport "$PORT" "${DST[@]}" -j "$CHAIN"
echo "filtro de origem ativo: ${BIND:-*}:$PORT aceita só $ALLOW"
