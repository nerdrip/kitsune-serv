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
- Browse schemas, databases, tables, views, routines, indexes and paged data
- Execute SQL/NoSQL in a multi-purpose workbench with read-only protection enabled by default
- Optional transactions, EXPLAIN mode, timeouts, result limits and active-query cancellation
- Persistent query history with duration/result status plus reusable named queries
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
- Select any combination of services, Composer and Java; add all, remove selected entries, or remove all KitsuneServ entries from the Windows user PATH or Linux shell profile
- Active entries are replaced automatically after a profile/version switch and pending selections are activated after installation
- Existing unrelated PATH entries are preserved and Windows receives an environment-change notification immediately
- KitsuneServ integrates managed Python releases with the official Python Install Manager through PEP 514; `py`, `py --list`, selectors such as `py -3.14`, and the default runtime follow the active profile automatically
- Installing the first Python runtime from Version Manager automatically installs the official manager and provisions a complete private runtime with pip; installing no Python leaves the system untouched. Legacy embeddable runtimes expose a one-click pip repair. Removing the last KitsuneServ Python also removes a manager installed by KitsuneServ
- KitsuneServ detects Windows Store App Execution Aliases that override `python`, opens the supported Apps settings page, copies the Polish settings search phrase and shows the exact path to the alias switches

### 🎼 Composer Integration
- Install, version and switch verified Composer releases directly from Version Manager or the PHP panel
- Run Composer commands with whitelisted safety
- Composer automatically uses active managed PHP; Eclipse Temurin JDK is managed the same way and synchronizes both PATH and JAVA_HOME
- Developer Toolchains re-reads current Windows user/machine PATH, handles `.cmd`/`.bat` shims and reports the detected executable and its System/KitsuneServ source

### 🚀 Project Workspaces
- Create complete stacks from PHP/Apache/MySQL, PHP/Nginx/PostgreSQL, Laravel, Symfony, WordPress, Node, Next.js, Vite, Django, FastAPI, MongoDB and static templates
- Pin runtime versions, domains, local HTTPS, public roots, environment values and named commands per project
- Start dependencies in order, share compatible processes, roll back failed version changes and restore the previous web-server profile after stop
- Run named tasks on the Windows host or a selected WSL distribution, and open the project in VS Code, JetBrains IDEs or Zed
- Export/import a project or the complete redacted environment; create integrity-checked restore snapshots
- Run a blocking project preflight for runtime availability, directories, permissions, ports, domains, HTTPS and free disk space before orchestration
- Persist runtime state and recover interrupted project sessions, orphaned managed services and temporary web-server configuration after an unclean exit
- Detect existing Node/Next/Vite/PHP/Laravel/Symfony/WordPress/Python/Go/Rust projects, Compose stacks and devcontainers without creating files in their source directories
- Keep environment profiles, encrypted per-project secrets, tags, colors, resource policies and lifecycle hooks in a portable schema-2 project manifest
- Synchronize managed `.test` domains after create, edit, import and removal; existing user entries in the system hosts file remain untouched

### 🧪 Test Lab and API Sidecars

- Run a second Node.js, PHP, Python, Go, Bun, Deno or custom API beside the main project, with independent setup/start commands, port, environment, logs and health checks
- Provision an isolated WordPress instance and database for plugin development, create the administrator automatically and activate plugins from selected local directories
- Live-mount WordPress plugin directories with symlinks/junctions, so edits in the original source are immediately visible and removing the lab never removes source code
- Use Compose as an optional external adapter; Docker is required only for that recipe, not for the built-in Node implementation
- Persist lab definitions and control provision/start/stop/remove from the same desktop and web interface

### ⤳ Visual REST API Flow Builder

- Build a real REST API as connected blocks: `Input → validation → database → HTTP request → transform/condition → Output`
- Keep many named GET, POST, PUT, PATCH, DELETE and OPTIONS endpoints in one API project and run them together on an independently managed local port
- Use 31 executable blocks for authentication, rate limiting, SQL/MongoDB, HTTP/webhooks, variables, JSON transforms, branches, switch, filter/map/sort/pagination, cache, hash/HMAC, Base64, UUID, timestamps, delays, logs and response headers
- Connect normal, true/false, cache hit/miss and error ports visually; drag blocks freely or apply automatic graph layout
- Reference request and previous-step data with `{body.email}`, `{query.page}`, `{params.id}`, `{var.name}`, `{last}` and `{steps.block-id}` placeholders
- Use the integrated REST client to save and auto-start the listener, send a real HTTP request and inspect its response plus the actual output/error of every executed block; optional preview mode remains available without a listener
- See listener state immediately through a live runtime bar with URL actions, uptime, request/error counters, last HTTP result and every currently active API project
- Keep the graph usable in compact windows with route/block rails, canvas fitting and responsive overlay inspectors in both API Flow and the environment builder
- Review persisted request logs from both the built-in tester and live REST traffic
- Keep database access read-only by default, escape request-derived query values, bound HTTP/body sizes and store authentication/HMAC/custom secrets only in the encrypted secret vault
- Use the same builder and runtime through Electron or authenticated server mode; stopping KitsuneServ also stops every API Flow listener

### 📊 Monitoring, Automation and Integrations

- Collect local uptime, process memory and CPU samples, render service history, record crashes and expose authenticated Prometheus metrics at `/api/metrics`
- Configure threshold alerts and acknowledge incidents from the Monitoring panel
- Schedule safe named actions for services, projects, Test Labs, backups and Kitsune Doctor; arbitrary unattended shell commands are deliberately not accepted
- Configure and verify optional adapters for Authenticode, GitHub/GitLab releases, winget, Chocolatey, Scoop, OAuth/OIDC, Sentry, OpenTelemetry, Grafana, 1Password, Bitwarden and a pinned remote agent
- Invoke an opt-in OpenAI-compatible operations assistant. Diagnostic context is redacted locally and nothing is sent before an explicit request
- Review an integrity-protected audit trail for operational changes, server logins and failures; secret values and request bodies are excluded

### 🌐 Kitsune Hub and Plesk

- Configure one panel domain and one wildcard DNS/TLS record; projects, labs, API projects and previews receive flat addresses such as `project-shop.panel.example.com`
- Route HTTP and WebSocket traffic to local or HTTPS origins with public, Hub-session or bearer-token policies
- Manage persistent accounts with global and resource-scoped RBAC, encrypted TOTP, one-use recovery codes, invitations, sessions and revocable device/API tokens
- Pair desktops, servers, CI agents and Plesk nodes with a short-lived code and monitor live presence, capabilities, version and redacted inventory
- Synchronize projects, Test Labs and API Flow definitions in both directions with revisions, hashes, history, explicit conflicts and rollback; secret values never enter synchronized manifests
- Connect the desktop to a remote Hub over HTTPS, optionally pin its SHA-256 certificate fingerprint, and retry synchronization idempotently
- Install `artifacts/plesk/kitsuneserv-bridge-3.0.0-r3.zip` in Plesk and select an active hosted domain directly from the Plesk inventory
- Choose managed deployment from a configurable Git repository or connect an existing external Hub; public URL and nginx reverse proxy can be automatic or manual
- Configure branch and isolated source/release/data paths, HTTPS token or strict SSH deploy key, Node.js/npm, systemd service user, port, bootstrap account, API/update keys and Plesk connector secrets
- Run atomic staged deployments with previous-release rollback, service health/control, operation logs, signed one-use SSO, role mapping, service-plan access and domain/capability synchronization

### 🩺 Operations and Platform Integration
- Activity Center with persisted progress, cancellation and failure history
- Kitsune Doctor and Port Manager for compatibility, directories, PATH and port collisions
- Managed `.test` domains, mkcert certificates and one-click browser opening
- Verified offline installer cache, declarative integrity-checked plugins and temporary cloudflared/ngrok sharing
- Linux systemd user-service installer and package-manager/WSL detection
- Signed update channel (Ed25519 + SHA-256), redacted support reports, CycloneDX SBOM and release checksums
- Versioned configuration migrations, safe automatic Doctor repairs and a `--safe-mode` launch that pauses automatic starts, scheduled backups and system integration

---

## 🚀 Quick Start

### Install on Windows (recommended)

Run `artifacts\windows\KitsuneServ-3.0.0-x64-setup.exe`, choose the destination and launch KitsuneServ from the Start menu. The installer preserves application data during uninstall. The portable EXE is useful for testing or carrying the UI without a traditional installation.

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

# Diagnostic launch without automatic services, backups or system integration
npm start -- --safe-mode
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

## 🧪 Test Lab workflow

Open **Visual Test Lab** and choose a ready-made tile. KitsuneServ creates a connected block diagram inspired by a visual endpoint builder. Clicking a block opens only the settings relevant to that component; blocks can be moved, optional databases/cache can be added or removed, and the resulting layout is saved with the blueprint.

Choosing a KitsuneServ project or source folder runs automatic detection for WordPress plugins, Node/npm/pnpm/yarn/Bun, PHP/Composer, Python, Go, Deno and Compose. Setup/start commands are generated automatically and remain hidden under the advanced section. Before any system change, **Plan and control** shows installed/missing runtimes and the exact ordered actions. **Create, run and open** then provisions and launches the complete graph with one action.

For WordPress plugin work:

1. Install and configure PHP plus MySQL or MariaDB and one web server.
2. Click the **WordPress plugin lab** tile, choose the KitsuneServ project or plugin directory and let the builder detect its `Plugin Name` header.
3. Verify the visual PHP → web server → WordPress graph, the database branch and plugin blocks, then choose **Create, run and open**. KitsuneServ installs a clean isolated WordPress instance, creates its database, initializes the site and activates every detected plugin entry file.
4. Open the returned URL and continue editing the original plugin source. The WordPress `wp-content/plugins` entries are live directory links, not copies.

The generated administrator password is stored in the encrypted local vault and returned only when it is first generated. Removing a lab can remove its managed WordPress instance and database, but never follows a live mount into the original plugin source.

## 🔌 External integration boundary

The **General → External Integrations** panel stores public settings in `config/integrations.json` and credentials only in the secret vault. Each adapter must be enabled and pass its own connection/tool test before Monitoring marks it ready. HTTP is accepted only for loopback development endpoints; remote endpoints require HTTPS.

Version 3.0.0 includes configuration, secret handling, readiness tests and environment projection for these providers. Operations that require an external account, legal approval, paid certificate or repository ownership remain inactive until those credentials are supplied. OAuth/OIDC entries remain configurable adapters; Kitsune Hub device enrollment and Plesk SSO are built-in. Package-manager submissions also remain explicit user-controlled publishing actions.

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
- `artifacts/plesk/` — installable KitsuneServ Bridge extension ZIP

### Individual Windows build scripts

```batch
tools\build\build-windows.bat
tools\build\build-linux.bat
tools\build\build-server.bat
tools\build\build-plesk.bat
tools\build\build-all.bat
```

The scripts automatically prefer a compatible Node 24 installation (including Laragon), run the complete test suite and check production dependencies. `build-linux.bat` requires Docker Desktop. The all-platform build also writes `SBOM.cdx.json`, `release-manifest.json` and `SHA256SUMS.txt`.

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
