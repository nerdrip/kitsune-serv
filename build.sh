#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  KitsuneServ Linux Release Builder"
echo "============================================"

command -v node >/dev/null || { echo "[ERROR] Node.js is not installed."; exit 1; }
command -v npm >/dev/null || { echo "[ERROR] npm is not installed."; exit 1; }

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22 || (a===22 && b>=19) ? 0 : 1)" \
  || { echo "[ERROR] Node.js 22.19+ is required."; exit 1; }

echo "[1/4] Installing exact dependencies..."
npm ci

echo "[2/4] Running project checks and tests..."
npm run check
npm test

echo "[3/4] Auditing production dependencies..."
npm audit --omit=dev

echo "[4/4] Building configured Linux packages..."
npm run build:linux
npm run build:sbom
npm run build:manifest
npm run build:checksums

echo "[OK] Linux release artifacts are available in artifacts/linux/"
