# 🦊 KitsuneServ

**Visual Server Management Console** — A portable, all-in-one development environment manager for Windows and Linux. Think of it as a modern, feature-rich alternative to XAMPP/WAMP/MAMP with a beautiful GUI, built-in terminal, database viewer, app store, and more.

![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/License-ISC-green)

---

## ✨ Features

### 🖥️ Desktop Mode (Electron)
- Beautiful dark-themed GUI with frameless window
- System tray integration with quick controls
- One-click start/stop for all services

### 🌐 Server Mode (Web)
- Full management UI accessible via web browser on port 10000
- Session-based authentication
- SSE (Server-Sent Events) for real-time updates
- Perfect for headless servers or remote management

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
- **Profile system** — Create, rename, and switch between configuration profiles
- **Auto-start** — Configure services to start automatically on launch
- **Auto-restart** — Automatic restart on crash
- **Health checks** — HTTP/TCP health monitoring with response time
- **Resource monitoring** — Real-time memory usage per service
- **Log viewer** — Live log tailing with ANSI color support
- **Port conflict detection** — Warns about port conflicts before starting

### 🗄️ Built-in Database Viewer
- Browse databases, tables, and data
- Execute custom SQL/NoSQL queries
- Create and drop databases
- Query history
- CSV export
- One-click access to phpMyAdmin/Adminer

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

### ⌨️ Command Palette
- `Ctrl+K` — Fuzzy search to quickly start/stop services, switch panels, and more

### 🔗 PATH Management
- Add/remove all installed service binaries to your system PATH with one click

### 🎼 Composer Integration
- Install and manage PHP Composer directly from the UI
- Run Composer commands with whitelisted safety

### 📁 Project Management
- Create and manage projects per language runtime (Node.js, Go, Bun, Python, Deno)
- Open project folders directly from the UI

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** — [Download](https://nodejs.org)
- **npm** (comes with Node.js)

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

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `KITSUNE_PORT` | `10000` | Port to listen on |
| `KITSUNE_HOST` | `0.0.0.0` | Host/interface to bind to |
| `KITSUNE_USER` | `admin` | Login username |
| `KITSUNE_PASS` | *(auto-generated)* | Login password |

---

## 🏗️ Building Release Packages

### Windows

```batch
build.bat
```

Creates a portable release in `release/KitsuneServ-{version}/` with a ZIP archive.

### Linux

```bash
chmod +x build.sh && ./build.sh
```

Creates a portable release in `release/KitsuneServ-{version}/` with a tar.gz archive.

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
├── build.bat                  # Windows build script
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
- Path traversal protection on all file operations
- Shell command injection prevention (whitelisted Composer commands, no shell interpolation)
- URL validation for external links (HTTP/HTTPS only)
- Project name sanitization
- File operations restricted to app root directory

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
