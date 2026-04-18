#!/bin/bash
# KitsuneServ — Linux/macOS Dependency Installer
# Installs Node.js (if missing) and npm dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  KitsuneServ — Dependency Installer"
echo "============================================"
echo ""

# Check Node.js
if command -v node &>/dev/null; then
    NODE_VER=$(node -v)
    echo "[OK] Node.js found: $NODE_VER"
else
    echo "[!] Node.js not found."
    echo "    Please install Node.js 18+ from https://nodejs.org"
    echo "    Or use your package manager:"
    echo ""
    if command -v apt-get &>/dev/null; then
        echo "    sudo apt-get update && sudo apt-get install -y nodejs npm"
    elif command -v dnf &>/dev/null; then
        echo "    sudo dnf install -y nodejs npm"
    elif command -v pacman &>/dev/null; then
        echo "    sudo pacman -S nodejs npm"
    elif command -v brew &>/dev/null; then
        echo "    brew install node"
    fi
    echo ""
    exit 1
fi

# Check npm
if command -v npm &>/dev/null; then
    NPM_VER=$(npm -v)
    echo "[OK] npm found: v$NPM_VER"
else
    echo "[!] npm not found. Please install npm."
    exit 1
fi

# Node version check (need 18+)
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "[!] Node.js 18+ required (found v$NODE_MAJOR). Please upgrade."
    exit 1
fi

echo ""
echo "[1/2] Installing npm dependencies..."
npm install
echo "[OK] Dependencies installed."

echo ""
echo "[2/2] Creating directory structure..."
mkdir -p servers/{apache,nginx,php,node,go,bun,deno,python,postgresql,mysql,mariadb,mongodb,redis,memcached,caddy,minio}
mkdir -p data temp www/apps projects/{node,go,bun,deno,python} config utils/adminer

echo ""
echo "============================================"
echo "  Installation Complete!"
echo "============================================"
echo ""
echo "  To start in desktop mode (Electron):"
echo "    ./start.sh"
echo ""
echo "  To start in server mode (web browser):"
echo "    ./start-server.sh"
echo ""
