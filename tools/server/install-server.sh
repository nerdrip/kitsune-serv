#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v node >/dev/null || { echo '[ERROR] Install Node.js 22.19 or newer first.'; exit 1; }
command -v npm >/dev/null || { echo '[ERROR] npm is not available.'; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)" \
  || { echo '[ERROR] Node.js 22.19 or newer is required.'; exit 1; }
npm ci --omit=dev
echo '[OK] Installation complete. Run bin/start-server.sh'
