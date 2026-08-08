#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export KITSUNE_HOST="${KITSUNE_HOST:-127.0.0.1}"
exec node src/server.js "$@"
