#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -n "${KITSUNESERV_EXECUTABLE:-}" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$KITSUNESERV_EXECUTABLE" "$SCRIPT_DIR/../app.asar/src/cli.js" "$@"
fi
exec node "$SCRIPT_DIR/../app.asar/src/cli.js" "$@"
