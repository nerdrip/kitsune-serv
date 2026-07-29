# 🦊 KitsuneServ

**Visual Server Management Console** — an all-in-one local development environment manager for Windows and Linux. It combines a desktop GUI and an authenticated browser interface with the same version manager, terminal, database viewer and app store.

![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/License-ISC-green)

> Ready packages are grouped under `artifacts/`: Windows installer/portable, Linux AppImage/DEB/RPM and universal web-server ZIP/TAR.GZ. Node.js is not required by desktop packages.

---

## ✨ Features

### 🖥️ Desktop Mode (Electron)
- Beautiful dark-themed GUI with frameless window
- System tray integration with quick controls
- One-click start/stop for all services

### 🌐 Server Mode (Web)
- The same renderer and management features as desktop, accessible on port 10000
- Session-based authentication
- SSE (Server-Sent Events) for real-time updates
- Browser file import/export and a server-side directory picker
- Native Windows/Linux data directories, optional TLS and an included Docker Compose deployment

### 🔧 16 Managed Services

| Category | Services |
|----------|----------|
| **Web Servers** | Apache, Nginx, Caddy |
| **Databases** | PostgreSQL, MySQL, MariaDB, MongoDB |
| **Languages** | PHP, Node.js, Go, Bun, Python, Deno |
| **Cache** | Redis, Memcached |
| **Storage** | MinIO |

### 📦 Per-Service Features
- **Multi-version management** — Install and switch between multiple versions
- **Live release catalogs** — Synchronize Node.js, Python, PHP, Nginx, Go and MariaDB feeds plus Bun, Deno, Caddy, Redis and Memcached releases
- **Integrity verification** — Use upstream SHA-256 manifests whenever a provider publishes one
- **Profile system** — Create, rename, and switch between configuration profiles
- **Auto-start** — Configure services to start automatically on launch
- **Auto-restart** — Automatic restart on crash
- **Health checks** — HTTP/TCP health monitoring with response time
- **Resource monitoring** — Real-time memory usage per service
- **Log viewer** — Live log tailing with ANSI color support
- **Web-server shortcut** — Open the active Apache, Nginx or Caddy site directly in the default browser
- **Port conflict detection** — Warns about port conflicts before starting
- **Coordinated web stack switching** — PHP, Apache, Nginx and Caddy restart in dependency order with automatic rollback

### 🗄️ Database Manager and Built-in Viewer
- Detect managed/local database endpoints and keep reusable custom connections to local or remote servers
- Connect to PostgreSQL, MySQL, MariaDB and MongoDB through bundled native Node.js drivers; no external database CLI is required
- Saved passwords are kept outside normal configuration in an OS-backed encrypted secret vault (Electron safeStorage on desktop, AES-256-GCM fallback in server mode)
- Browse databases, tables, and data
- Execute custom SQL/NoSQL queries
- Create and drop databases
- Query history
- CSV export
- One-click access to phpMyAdmin/Adminer
- Native, checksummed PostgreSQL/MySQL/MariaDB/MongoDB backups, destructive restore confirmation, rotation and automatic schedules

### 🛒 App Store
Install web applications with a single click:

| Category | Apps |
|----------|------|
| **Database Tools** | phpMyAdmin, Adminer |
| **CMS** | WordPress, Drupal, Joomla, PrestaShop |
| **Frameworks** | Laravel, Symfony |
| **DevOps** | Gitea, File Browser, Mailpit |
| **Analytics** | Matomo |
| **Email** | Roundcube |

Supports custom Git repositories as well.

### 🖥️ Built-in Terminal
- Integrated terminal with PATH pre-configured for all installed services
- Multiple terminal tabs
- Command history (up/down arrows)
- ANSI color support
- Fixed-height workspace with independent scrolling, follow-output control and clear action

### 🌐 Shared WWW root
- Choose profile-specific directories with a native folder picker and save/restart immediately
- Optionally force one global directory for Apache, Nginx and Caddy; individual selectors are locked while enforcement is enabled
- Running web servers are restarted transactionally and the previous configuration is restored on failure

### ⌨️ Command Palette
- `Ctrl+K` — Fuzzy search to quickly start/stop services, switch panels, and more

### 🔗 PATH Management
- Select any combination of services, add all, remove selected entries, or remove all KitsuneServ entries from the Windows user PATH or Linux shell profile
- Active entries are replaced automatically after a profile/version switch and pending selections are activated after installation
- Existing unrelated PATH entries are preserved and Windows receives an environment-change notification immediately
- KitsuneServ integrates managed Python releases with the official Python Install Manager through PEP 514; `py`, `py --list`, selectors such as `py -3.14`, and the default runtime follow the active profile automatically
- Installing the first Python runtime from Version Manager automatically installs the official manager; installing no Python leaves the system untouched. Removing the last KitsuneServ Python also removes a manager installed by KitsuneServ. The General/PATH panel provides a retry action, while a compatibility launcher covers temporary network failures
- KitsuneServ detects Windows Store App Execution Aliases that override `python`, opens the supported Apps settings page, copies the Polish settings search phrase and shows the exact path to the alias switches

### 🎼 Composer Integration
- Install and manage PHP Composer directly from the UI
- Run Composer commands with whitelisted safety

### 🚀 Project Workspaces
- Create complete stacks from PHP/Apache/MySQL, PHP/Nginx/PostgreSQL, Laravel, Symfony, WordPress, Node, Next.js, Vite, Django, FastAPI, MongoDB and static templates
- Pin runtime versions, domains, local HTTPS, public roots, environment values and named commands per project
- Start dependencies in order, share compatible processes, roll back failed version changes and restore the previous web-server profile after stop
- Run named tasks on the Windows host or a selected WSL distribution, and open the project in VS Code, JetBrains IDEs or Zed
- Export/import a project or the complete redacted environment; create integrity-checked restore snapshots

### 🩺 Operations and Platform Integration
- Activity Center with persisted progress, cancellation and failure history
- Kitsune Doctor and Port Manager for compatibility, directories, PATH and port collisions
- Managed `.test` domains, mkcert certificates and one-click browser opening
- Verified offline installer cache, declarative integrity-checked plugins and temporary cloudflared/ngrok sharing
- Linux systemd user-service installer and package-manager/WSL detection
- Signed update channel (Ed25519 + SHA-256), redacted support reports, CycloneDX SBOM and release checksums

---

## 🚀 Quick Start

### Install on Windows (recommended)

Run `artifacts\windows\KitsuneServ-1.0.0-beta13-x64-setup.exe`, choose the destination and launch KitsuneServ from the Start menu. The installer preserves application data during uninstall. The portable EXE is useful for testing or carrying the UI without a traditional installation.

Mutable data is stored in `%APPDATA%\KitsuneServ` instead of `Program Files`. Set `KITSUNE_DATA_DIR` before launching to place downloaded runtimes, projects and databases on another drive.

### Build or run from source

Prerequisites:

- **Node.js 22.19+**; Node.js 24 LTS is recommended
- **npm** (bundled with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/nerdrip/kitsune-serv.git
cd kitsune-serv

# Install dependencies
# Linux/macOS:
chmod +x install.sh && ./install.sh

# Windows:
install.bat
```

### Running

#### Desktop Mode (Electron GUI)

```bash
# Linux/macOS
./start.sh

# Windows
start.bat

# Or with npm
npm start
```

#### Server Mode (Web Browser)

Access the full management UI via browser — perfect for headless servers or remote access.

```bash
# Linux/macOS
./start-server.sh

# Windows
start-server.bat

# Or with npm
npm run server

# With custom settings
KITSUNE_PORT=8080 KITSUNE_USER=admin KITSUNE_PASS=mysecret ./start-server.sh
```

The server starts on **http://localhost:10000** by default. Credentials are printed in the terminal on startup (auto-generated if `KITSUNE_PASS` is not set).

#### CLI

The server archive contains `bin/kitsune.bat` and `bin/kitsune.sh`. Desktop packages include a CLI wrapper in their resources directory, while source installations expose the `kitsune` package binary. Examples:

```bash
kitsune doctor
kitsune project create my-api node-postgresql
kitsune up my-api
kitsune install php 8.5.9
kitsune use php 8.5.9
kitsune path add php node python
kitsune cache export D:\offline-kitsune-cache
```

For a containerized Linux deployment:

```bash
export KITSUNE_PASS='replace-with-a-strong-password'
docker compose -f deploy/docker/compose.yml up -d --build
```

Server state survives updates in a named `/data` volume. The bare archive uses `%APPDATA%\kitsuneserv` on Windows and `${XDG_CONFIG_HOME:-~/.config}/kitsuneserv` on Linux.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `KITSUNE_PORT` | `10000` | Port to listen on |
| `KITSUNE_HOST` | `127.0.0.1` | Host/interface to bind to |
| `KITSUNE_USER` | `admin` | Login username |
| `KITSUNE_PASS` | *(auto-generated)* | Login password |
| `KITSUNE_DATA_DIR` | native user-data directory | Mutable config, services, projects and databases |
| `KITSUNE_TLS_CERT` / `KITSUNE_TLS_KEY` | unset | Enable native HTTPS with a PEM certificate and key |
| `KITSUNE_TOTP_SECRET` | unset | Base32 secret enabling authenticator-code login |
| `KITSUNE_API_TOKEN` | unset | Bearer token for authenticated API automation |
| `KITSUNE_ALLOWED_IPS` | unset | Comma-separated exact IP/CIDR allowlist |
| `KITSUNE_SECRET_KEY` | local protected key | Optional stable encryption key for headless secret storage |
| `KITSUNE_UPDATE_MANIFEST_URL` | unset | HTTPS URL of a signed single-package or release manifest |
| `KITSUNE_UPDATE_PUBLIC_KEY` | unset | Ed25519 public PEM, SPKI base64 or key-file path |
| `KITSUNE_DISABLE_SYSTEM_INTEGRATION` | `0` | Set to `1` in containers to prevent host PATH/profile changes |
| `KITSUNE_SHELL_RC` | `.bashrc` or `.zshrc` | Explicit Linux shell profile used for managed PATH entries |
| `KITSUNE_PORTABLE` | `0` | Set to `1` to keep server data beside an extracted archive |

---

## 🏗️ Building Release Packages

### One command on Windows

```batch
build.bat
```

This verifies the project once and builds every supported package into:

- `artifacts/windows/` — NSIS installer, portable EXE and unpacked smoke-test build
- `artifacts/linux/` — AppImage, DEB, RPM and unpacked build (built and smoke-tested in Docker)
- `artifacts/server/` — universal web-server ZIP/TAR.GZ and an extracted folder

### Individual Windows build scripts

```batch
tools\build\build-windows.bat
tools\build\build-linux.bat
tools\build\build-server.bat
tools\build\build-all.bat
```

The scripts automatically prefer a compatible Node 24 installation (including Laragon), run 70 tests and check production dependencies. `build-linux.bat` requires Docker Desktop. The all-platform build also writes `SBOM.cdx.json`, `release-manifest.json` and `SHA256SUMS.txt`.

For a signed update channel, create an offline Ed25519 pair once with `npm run release:keygen`, keep the private PEM outside the repository, and build the manifest with `KITSUNE_RELEASE_BASE_URL` plus `KITSUNE_UPDATE_PRIVATE_KEY`. Clients receive only the public key through `KITSUNE_UPDATE_PUBLIC_KEY`. Windows Authenticode signing uses electron-builder's standard `CSC_LINK` and `CSC_KEY_PASSWORD` variables; no certificate is embedded in the repository.

### Native Linux desktop build

```bash
chmod +x build.sh && ./build.sh
```

Creates AppImage, DEB and RPM under `artifacts/linux/`.

### Using electron-builder directly

```bash
# Windows
npm run build:win

# Linux (AppImage, deb, rpm)
npm run build:linux

# macOS
npm run build:mac

# All platforms
npm run build:all
```

---

## 📂 Project Structure

```
KitsuneServ/
├── src/
│   ├── main.js              # Electron main process
│   ├── server.js             # Server mode (web UI)
│   ├── preload.js            # Electron preload (context bridge)
│   ├── config-manager.js     # Configuration management
│   ├── download-manager.js   # Version download & extraction
│   ├── service-manager.js    # Service lifecycle management
│   ├── db-viewer.js          # Database viewer (SQL/NoSQL)
│   ├── app-store-manager.js  # App store (WordPress, etc.)
│   ├── path-manager.js       # Selective PATH and Python Manager integration
│   └── renderer/
│       ├── index.html        # Main UI layout
│       ├── app.js            # Frontend application logic
│       └── styles.css         # UI styles
├── config/
│   ├── kitsuneserv.json      # Main configuration
│   ├── downloads.json        # Available versions & URLs
│   └── instances.json        # App Store instances
├── servers/                   # Installed server binaries
├── data/                      # Database data directories
├── projects/                  # User project directories
├── www/                       # Web document root
│   └── apps/                  # Installed web apps
├── utils/
│   └── adminer/               # Adminer database tool
├── temp/                      # Download temp files
├── deploy/docker/             # Production Dockerfile and Compose deployment
├── tools/build/               # All/Windows/Linux/server build entry points
├── tools/server/              # Standalone web-server install/start scripts
├── artifacts/                 # Generated packages, grouped by platform
├── build.bat                  # Convenience wrapper: build everything
├── build.sh                   # Linux build script
├── install.bat                # Windows dependency installer
├── install.sh                 # Linux dependency installer
├── start.bat                  # Windows desktop start
├── start.sh                   # Linux desktop start
├── start-server.bat           # Windows server mode start
├── start-server.sh            # Linux server mode start
└── package.json
```

---

## ⚙️ Architecture

### Desktop Mode
```
Renderer (HTML/CSS/JS)  ←→  preload.js (IPC bridge)  ←→  main.js (Electron)
                                                            ├── ConfigManager
                                                            ├── DownloadManager
                                                            ├── ServiceManager
                                                            ├── DbViewer
                                                            └── AppStoreManager
```

### Server Mode
```
Browser  ←→  HTTP/SSE  ←→  server.js (Node.js)
                              ├── ConfigManager
                              ├── DownloadManager
                              ├── ServiceManager
                              ├── DbViewer
                              └── AppStoreManager
```

The server mode serves the same `renderer/` UI files and provides a REST API adapter (`/api/*`) that maps to the same manager classes. Real-time updates (terminal output, service exits, download progress) are delivered via Server-Sent Events (SSE).

---

## 🔒 Security

### Server Mode Authentication
- Session-based authentication with HttpOnly, SameSite=Strict cookies
- Timing-safe credential comparison (prevents timing attacks)
- Auto-generated passwords when `KITSUNE_PASS` is not set
- 24-hour session lifetime
- Request body size limits (10MB)

### General
- Path traversal protection on managed runtime, project and App Store paths
- Shell command injection prevention (whitelisted Composer commands, no shell interpolation)
- URL validation for external links (HTTP/HTTPS only)
- Project name sanitization
- HTTPS-only runtime downloads, archive path validation and a 5 GB safety limit
- Electron context isolation, renderer sandbox, restricted navigation and one application instance
- Loopback-only defaults for the management server and local web servers

See [SERVICES.md](SERVICES.md) for the complete service/version matrix and [AUDIT.md](AUDIT.md) for the audit findings, fixes and remaining release considerations.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the ISC License.
