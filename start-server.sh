#!/bin/bash
# KitsuneServ — Start Server Mode (Web)
# Access via browser at http://localhost:10000
#
# Environment variables:
#   KITSUNE_PORT  — Port to listen on (default: 10000)
#   KITSUNE_HOST  — Host to bind to (default: 0.0.0.0)
#   KITSUNE_USER  — Login username (default: admin)
#   KITSUNE_PASS  — Login password (auto-generated if not set)

cd "$(dirname "${BASH_SOURCE[0]}")"
node src/server.js "$@"
