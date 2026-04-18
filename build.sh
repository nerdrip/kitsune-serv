#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  KitsuneServ Release Builder (Linux)"
echo "============================================"
echo ""

# Get version from package.json
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
echo "[INFO] Version: $VERSION"

# Generate timestamp
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
echo "[INFO] Timestamp: $TIMESTAMP"
echo ""

# --- Step 1: Build Electron executable ---
echo "[1/4] Building Electron executable for Linux..."
npx electron-builder --linux --config.compression=maximum
echo "[OK] Electron build complete."
echo ""

# --- Step 2: Prepare release directory ---
RELEASE_DIR="release/KitsuneServ-${VERSION}"
echo "[2/4] Preparing release directory: $RELEASE_DIR"

rm -rf release
mkdir -p "$RELEASE_DIR"

# Copy unpacked Electron app
echo "  Copying Electron runtime..."
cp -r dist/linux-unpacked/* "$RELEASE_DIR/"

# Copy configs (not packaged in asar)
echo "  Copying configurations..."
cp -r config "$RELEASE_DIR/config"

# --- Step 3: Create directory structure ---
echo "[3/4] Creating directory structure..."
mkdir -p "$RELEASE_DIR/servers"/{apache,nginx,php,node,go,bun,deno,python,postgresql,mysql,mariadb,mongodb,redis,memcached,caddy,minio}
mkdir -p "$RELEASE_DIR/data"
mkdir -p "$RELEASE_DIR/temp"
mkdir -p "$RELEASE_DIR/www/apps"
mkdir -p "$RELEASE_DIR/projects"/{node,go,bun,deno,python}

# Create default www/index.html
cat > "$RELEASE_DIR/www/index.html" << 'HTMLEOF'
<html><body><h1>KitsuneServ - It works!</h1><p>Your local development server is ready.</p></body></html>
HTMLEOF

# Create start script
cat > "$RELEASE_DIR/start.sh" << 'SHEOF'
#!/bin/bash
cd "$(dirname "${BASH_SOURCE[0]}")"
./kitsuneserv "$@"
SHEOF
chmod +x "$RELEASE_DIR/start.sh"

# --- Step 4: Create tar.gz archive ---
echo "[4/4] Creating tar.gz archive..."
ARCHIVE_NAME="KitsuneServ-${VERSION}-${TIMESTAMP}-linux-x64.tar.gz"
cd release
tar -czf "$ARCHIVE_NAME" "KitsuneServ-${VERSION}"
cd ..

echo ""
echo "============================================"
echo "  Build Complete!"
echo "============================================"
echo ""
echo "  Release Dir  : $RELEASE_DIR/"
echo "  Archive      : release/$ARCHIVE_NAME"
echo ""
echo "  Directory structure in release:"
echo "    KitsuneServ-${VERSION}/"
echo "      ├── kitsuneserv      (Electron runtime)"
echo "      ├── *.so             (Chromium libs)"
echo "      ├── resources/       (app.asar with source)"
echo "      ├── start.sh"
echo "      ├── config/          (default configs)"
echo "      ├── servers/         (16 service dirs)"
echo "      ├── data/            (database data)"
echo "      ├── projects/        (user projects)"
echo "      ├── www/             (document root)"
echo "      └── temp/            (downloads temp)"
echo ""
