#!/usr/bin/env bash
# Mantido por compatibilidade: use packaging/build.sh agent
exec "$(dirname "$0")/../packaging/build.sh" agent "$@"
