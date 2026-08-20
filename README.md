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
- True PTY/xterm terminals for local shells and SSH/Telnet/serial sessions, with tabs, split panes, broadcast input, macros, search and reconnect
- SSH jump hosts, agent forwarding, host-key pinning, tmux reattachment and reusable encrypted session profiles
- Local/remote port forwarding plus RDP and VNC over SSH; portable PuTTY, Pageant, PuTTYgen, WinSCP and TigerVNC are checksum-verified before launch
- Session recording with text, standalone HTML and asciinema v2 export

### 🗂️ File Manager and remote DevOps

- Two-pane local/remote browsing for SFTP, FTP/FTPS, WebDAV, S3-compatible storage and Azure Blob
- Recursive and resumable transfers, direct server-to-server streaming, search, preview, UTF-8 editing, permissions, rename/delete and transfer queues
- Synchronization preview, file snapshots with integrity-checked undo, text comparison and 3-way merge
- Remote Git, Docker/Compose, systemd, processes, Kubernetes pods/logs/exec/copy/port-forward and a bounded HTTP/REST client

### 🧭 Operations Center

- Connection Graph and universal command palette covering servers, tunnels, storage, terminals, files and saved Smart Workspaces
- Cross-server filename/content search and replace with exact preview, change detection, automatic snapshots and one-click rollback
- Infrastructure capture, baselines, drift/diff inspection, blast-radius preview and a deterministic Digital Twin before risky changes
- Deployment preflight, secret scanning on uploads, maintenance windows, deployment timeline, Time Machine, replay and shadow deployment with atomic promotion
- Incident Mode/War Room with diagnostic evidence, paused schedules, integrity-protected Session Capsules, shared terminal control and collaborative editor locks
- Log correlation, learned metric anomaly baselines, error explanations, bounded command templates, Health Contracts, DNS propagation and TLS renewal
- SSH CA, Mosh, ProxyCommand/SOCKS/Tor, port and database tunnels, cron/systemd timers, firewall previews, certificate and DNS management
- Content-addressed transfer cache, bandwidth limits, deduplicated backups, encrypted secret-free Offline Vault and MFA-bound single-use Break Glass access
- Zero-Trust Gateway with policy evaluation, MFA-authenticated multi-person approvals and signed, scoped, expiring one-use access grants
- Secrets Broker with encrypted, scoped, one-time runtime leases plus a secret-aware clipboard that clears itself without erasing newer clipboard content
- Live Service Map, GitOps/IaC export and diff, canary-first fleet batches and a Network Flight Recorder that downloads, hashes and seals bounded PCAP evidence
- Scheduled synthetic HTTP/SSH scenarios with automatic incidents, Canary Autopilot traffic progression/rollback and isolated checksum-verifying disaster recovery drills
- Database Studio Pro for live schema capture, ERD/diff/migration planning and deterministic masking of production-shaped datasets
- Conflict-aware offline workspaces covering SFTP, FTP/FTPS, WebDAV, S3 and Azure, with queued synchronization and remote-divergence protection
- Expiring isolated preview environment manifests, governed RDP clipboard/drive policies, portable Rescue Environments and integrity-gated Operational Replay Labs
- Chained HMAC-sealed Evidence Vault objects and a deterministic local Operations Copilot that analyzes evidence without transmitting data or executing remediation
- Live CPU/RAM/disk/network/container metrics, server/disk/TLS alerts and connection diagnostics covering DNS, SSH, host identity, routes, ports, time, firewall and runtimes
- SSH key generation/rotation/installation and imports from 1Password, Bitwarden and KeePassXC; desktop secrets use OS-backed encryption
- Encrypted scheduled remote backups, sync/health schedules and retention; workspace templates launch terminals, tunnels and panels together
- Team roles, production approvals and expiring one-time session handoffs that never include a password

### 🦊 Enterprise Ops and Kitsune Agent

- A standalone Kitsune Agent (`npm run agent`) exposes health, inventory, metrics, bounded file reads and allowlisted service actions through replay-resistant HMAC-signed requests; generate an enrollment token with `npm run agent:keygen`
- SLO/error-budget evaluation can freeze deployments, while linear capacity forecasts estimate resource exhaustion from stored samples
- Canary-first Patch Orchestrator and quorum-aware Reboot Coordinator stop on failures and never reboot two members of the same replica group in one batch
- Compliance baselines inspect SSH, firewall and update posture; Syft/Trivy adapters generate SBOMs, and immutable image digests advance only through development → staging → canary → production
- Air-gap backups use content-addressed deduplication, read-only objects, signed manifests and retention metadata; cloud login delegates to AWS/Azure/GCloud OIDC CLIs without storing long-lived tokens
- Chaos Lab is hard-blocked on production and limits latency, container pause and disk-pressure tests to five minutes with shell-trap rollback
- Autonomous remediation ranks allowlisted rules inside the Digital Twin and never executes them; database migrations run only against explicitly named `_rehearsal`, `_preview` or `_sandbox` databases
- Config Studio delegates validation to Nginx, Caddy, systemd, Docker Compose or Kubernetes; bare-metal provisioning emits hardened, credential-free cloud-init
- Multi-region failover planning verifies target health and produces an approval-gated sequence; signed Marketplace packs are declarative and cannot ship executable plugin code
- Desktop global shortcuts: `Ctrl+Alt+T` opens Terminal, `Ctrl+Alt+F` opens File Manager and `Ctrl+Alt+O` opens Operations Center. The optional voice console accepts navigation/read-only commands only
- Desktop and authenticated Web/Hub modes share the remote, storage, Operations Fabric and Enterprise manager implementations

### 🚀 Next-generation operations

- Relay Mesh calculates the lowest-cost healthy path and provisions strict-host-key-checked reverse SSH, so agents need no inbound management port
- Privileged Action Broker issues signed, expiring, resource-scoped, single-use capabilities that are independently verified by Kitsune Agent
- OSC 133 shell integration turns commands into structured blocks with output and exit state; captured blocks can be inspected and converted into runbooks
- Delta Transfer uses strong block signatures, transfers only changed blocks, reconstructs atomically and verifies the complete destination hash
- Filesystem Time Travel provides content-addressed, deduplicated snapshots and individual-file restoration, with provider metadata for VSS/ZFS/Btrfs integration
- Ransomware Guard detects mass changes and suspicious encrypted extensions, freezes File Manager writes/download queues below the affected root and recommends an evidence snapshot
- Embedded HTTPS Guacamole/noVNC workspaces enforce configured clipboard/file policies inside a sandboxed frame
- SSH certificate policies require fresh MFA before issuing short-lived certificates; no private key is transported through the policy layer
- Bounded eBPF probes inspect connection, block-I/O and OOM events without capturing network payloads
- Network Digital Twin evaluates firewall, DNS and route changes against critical service paths before execution
- Transactional Remote Changes provide an exact preview, bounded allowlisted steps, health gates and reverse-order rollback
- Pair Operations implements four-eyes proposals and distinct approvals for terminal, file and desktop collaboration
- Mobile Approval Companion runs as the installable PWA and requires a fresh password plus TOTP/recovery verification before resolving an approval
- Offline PWA Vault encrypts rescue metadata in IndexedDB using AES-256-GCM and PBKDF2; API responses and credentials are never cached
- WASM Automation Sandbox accepts modules up to 2 MB, forbids every import and provides no filesystem, network or secret capability
- Operations Black Box retains a one-hour, 10,000-event integrity chain with credential-shaped fields excluded
- Server DNA captures packages, services, ports, containers and runtimes into comparable, secret-free rebuild blueprints
- Self-Healing Connectivity tries direct SSH, Kitsune Agent and Relay Mesh without performing system mutations, then recommends Rescue Environment
- Intent Operations converts a requested outcome into an explicit, non-executable plan with gates and rollback constraints
- Operations Flight Simulator injects bounded faults into an isolated topology, scores the response and derives a draft runbook without touching production

### 🦊 Terminal & File Operations Workspace

- Universal Connection Workspace binds terminals, file paths, logs, metrics, containers, database tools and tunnels to one switchable server context and restores the redacted layout after restart
- Command Timeline consumes OSC 133 blocks, records exit state and inferred service/filesystem effects in an integrity chain, and offers approval-gated restore only when a Time Machine snapshot exists
- Live File Collaboration reuses expiring participant sessions and editor locks; proposed revisions remain metadata until the existing guarded File Manager write path applies them
- Connection Doctor 2.0 walks DNS, profile, transport/SSH and jump-host stages, pinpoints the first failed layer and can hand off to direct/Agent/Relay path selection
- Smart Transfer Engine chooses resumable SFTP, delta blocks, parallel chunks, compression or server-to-server streaming from file size and path characteristics
- Workspace Resume restores tabs, paths and layout, then reconnects tmux terminals, resumable queues and health-checked tunnels through their existing managers
- Secretless Readiness reports SSH agent, public-key, OS keychain, WebAuthn and short-lived-certificate options without returning credential material
- Fleet Terminal accepts bounded command templates only, runs a reviewed canary first, limits batch concurrency and stops the fleet on error
- Environment Diff compares secret-free package, service, port, container and runtime captures; Disposable Rescue writes a deny-by-default, read-only-source manifest
- Local Operational Memory indexes verified symptoms and resolutions without an external AI service; Policy Autocomplete returns non-executable, allowlisted command templates
- Visual SSH Multiplexer persists up to 16 tmux-backed panes, read-only roles and confirmation-protected synchronized input
- Infrastructure Movie merges command effects and deployment events into an immutable playback timeline; Live Blast Map adds affected workspaces and tunnels before a change
- Remote Pair Debugger uses four-eyes proposals, while One-click Incident Room creates a terminal/files workspace and expiring war-room session together
- Network Path Replay models latency, loss, DNS, route and certificate faults without touching production
- Portable Rescue Kit emits an install-free, secret-free recovery manifest for bundled WinSCP, PuTTY/Plink/PSFTP and TigerVNC tools
- Intent Command Palette translates terminal/file outcomes into a constrained preview; it never generates or runs arbitrary shell commands

### 🧰 Terminal & File Manager Pro

- Terminal Notebook stores structured commands, exit states, notes, attachments and optionally redacted output; Recording Studio removes credential patterns and supports chapters, cuts and annotations
- Secure Paste Firewall is active on real xterm paste/input bursts and detects destructive commands, privilege changes, encoded commands, invisible Unicode controls, redirects and download-to-shell chains before input is sent
- Shell Dialect Translator converts only deterministic Bash/Zsh/Fish, PowerShell and CMD patterns and refuses to invent a translation; Command Shadow Mode runs allowlisted templates in Bubblewrap, a protected systemd user unit or an isolated container
- Terminal Sidecar collects a bounded CWD, Git branch, process, port, container and recently changed-file view; checkpoints preserve public context, tmux, tunnels and open paths without credentials
- Multi-host Result Matrix highlights output divergence; Interactive Output Actions recognize files, URLs, PIDs, ports and container identifiers; Protocol Console persists SSH, serial, Telnet, Docker/Kubernetes exec, WSL and PowerShell targets
- Transactional Multi-file Editor captures a Time Machine snapshot, checks every pre-edit hash, writes and verifies the approved set, and rolls applied files back when any member fails
- Container/Kubernetes Files, Git-aware Remote Files and Archive-as-a-Folder expose bounded fixed-command adapters with strict identifier/path validation and preview-first extraction
- Huge File Studio streams tail, byte ranges or bounded search results up to 4 MB instead of loading an entire remote log, CSV or dump
- Remote Content Index keeps file metadata in a locally AES-256-GCM-encrypted index; Duplicate Finder hashes remotely and Filesystem Heatmap uses bounded depth and entry counts
- File Provenance and Terminal↔File Causality connect checksummed transfers, terminal effects and paths; OSC-7 CWD updates drive the Context-aware Split View
- Transfer Pipeline Builder validates filter/compress/encrypt/transfer/checksum/extract/validate stages; cross-protocol routing covers local, SFTP, FTP/FTPS, WebDAV, S3, Azure, Docker and Kubernetes endpoints
- Safe Remote Drop Zone inventories staged local files with SHA-256 before transfer; Connection Capsules use AES-256-GCM/PBKDF2 and exclude passwords, tokens, private keys and host trust secrets
- Server AirDrop creates an encrypted, expiring, one-use file package with a short out-of-band code and mandatory SHA-256 verification
- Remote Clipboard Vault keeps text in the encrypted secret store, binds it to an optional server, expires it and consumes it once
- Filesystem Watch & Explain compares bounded remote metadata snapshots and correlates changes with recent filesystem-affecting terminal events; process attribution is reported only when Agent/auditd evidence exists

### ✦ Terminal & Files Command Deck

- A dedicated outcome-first Command Deck exposes 89 capabilities: 55 browsable workflows stay grouped into Workspace, Transfer & Sync, Connect, Safety, Intelligence and Team & Access tabs; 12 adaptive capabilities live in Context Rail/Workbench/Advanced Labs; 12 production layers stay collapsed inside a three-lane Platform Foundation; and the final 10 deep capabilities form five task-oriented Expert Workspaces instead of inflating the card grid
- Remote Workspace Drive prepares cache-backed virtual mounts, while Offline Workspace produces conflict-aware three-way reconciliation and Delta Transfer plans missing content blocks with adaptive compression, resumability and SHA-256 verification
- Remote Code Intelligence extracts bounded symbols and diagnostics locally without executing repository code; Universal Content Search operates on local/private index records
- Connection Graph maps servers, bastions and tunnels; Smart Jump & Tunnel Manager validates chains, identities and port collisions without binding until approval
- Just-in-Time Secrets creates server-bound, expiring, one-use process-environment leases that never enter terminal history; Ephemeral SSH Certificates generate public-key-only short-lived CA requests
- Policy-as-Code Guardrails enforce read-only environments, forbidden commands, protected paths and four-eyes requirements; Production Safety Lens adds persistent environment identity and typed confirmation requirements
- Forensic Mode emits signed, chained, read-only evidence manifests; Canary Operations separates the first hosts from the gated remainder of a fleet rollout
- Digital Twin Sandbox predicts bounded command effects locally, Intent Terminal emits commands only for deterministic templates, and Terminal HUD correlates hashed commands with before/after telemetry
- Collaborative Terminal models observer/operator/approver roles, keyboard ownership, recording and proposals; Visual Permission Studio explains mode bits and effective access before producing a non-executable chmod plan
- Remote Disaster Undo stores a minimal affected-file/service restore scope; Living Runbooks turn redacted verified sessions into parameterized steps with preconditions, verification, rollback and approval gates
- Adaptive Operations Scheduler ranks work by urgency, load, network quality and cloud cost; Context Teleport encrypts a recursively sanitized workspace capsule and explicitly excludes credentials
- Structured Output Canvas recognizes bounded JSON, CSV, tabular and log output and exposes cards/tree/table views without removing raw access; File Relationship Graph parses imports and configuration references without executing source code
- Signed Transfer Receipts use an integrity signature over sanitized source, destination, checksum, byte count, operator and validation metadata; Predictive Workspace Cache ranks metadata and small-file prefetch candidates from local-only decaying access history
- Live Remote Event Stream normalizes inotify, USN Journal and FSEvents into incremental file-view updates; Connection Continuity chooses between Mosh, tmux/SSH, Agent/Relay and verified reconnect plans
- Semantic File History explains key-level JSON/YAML/INI-style changes; Visual Batch Transform previews renames, line-ending normalization, collisions and a whole-set rollback strategy
- Remote Data Inspector provides bounded read-only pages for CSV, JSON/JSONL, SQLite and Parquet metadata; Disposable Data Lens produces a no-network, no-credentials, target-read-only isolation plan for untrusted files
- Server Identity Trust Timeline records host fingerprints, DNS and addresses and blocks changed identities; Reviewable Command Composer exposes pipeline stages, data flow, redirects and risk without executing the generated command
- Universal Staging Area collects selected changes as an all-or-rollback transaction; Multi-monitor Layout restores validated terminal/files/HUD/graph placement without secrets
- Terminal Focus Mode retains only environment identity, terminal, risk state and exit control; Command/File Bookmarks, Explain This Screen and Remote Workspace Health provide contextual navigation without adding permanent toolbars
- Cross-Server Command Matrix groups identical fleet output and highlights exceptions; Transfer Control Center models pause/resume checkpoints, priorities, retry policy, concurrency, bandwidth and verification as one visual queue
- Direct Server Transfer plans encrypted server-to-server or relay streaming without local payload storage; Smart Sync Profiles add dry runs, filters, three-way conflicts and disabled delete propagation, while Archive Explorer blocks traversal and exposes safe folder navigation
- Atomic Remote Editor performs optimistic hash locking and prepares temporary-file, fsync and atomic-rename writes; Session Time Machine records a redacted searchable context timeline without silently re-executing commands; Filesystem Snapshot Diff compares content, ownership and permissions
- Remote Storage Fabric unifies SFTP/SCP/FTP/FTPS/SMB/WebDAV/S3/Azure Blob/container/Kubernetes/WSL/local endpoints behind capability-aware actions; Live Virtual Folders provide incremental metadata collections and Disk Space Visualizer uses a zoomable treemap with non-executable cleanup suggestions
- Process & Port Navigator links sockets, processes, containers and configuration; Secure Clipboard Bridge blocks secret-shaped content and expires without history; Shell Resurrection safely reattaches multiplexers; Terminal–Files Fusion synchronizes paths, selections and output using dialect-correct quoting
- Execution Context Beacon exposes host/user/elevation/runtime/namespace/cwd identity and blocks mismatches; Connection Waterfall traces DNS through SFTP and proposes deterministic tuning without applying settings
- Data Boundary Guard blocks outward transfers containing critical material; Live Output Privacy Shield protects copy/share/record/export; Executable Trust Inspector resolves aliases, ownership, modes, package origin, hashes and signatures without execution
- Detached Job Orchestrator and Resource-Budgeted Commands prepare bounded process-group plans; Conflict Resolution Cockpit provides a three-way-plus-result flow while retaining hashes rather than file contents
- Adaptive SSH Channel Pool models verified transport reuse without persisting keys; Terminal & Files Review Inbox stores sanitized risk cards and requires a distinct approver; Remote Quarantine Lab and Branchable Terminal remain isolated, review-gated Advanced Labs
- Approved Execution Engine signs sanitized plans, requires a distinct approver and explicit idempotency key, executes only bounded command templates or verified ≤2 MB atomic file writes, verifies results and rolls back completed writes on failure
- Unified Remote Session Canvas composes SSH/SFTP/PowerShell/WSL/container/Kubernetes/RDP/VNC/serial panes with shared context but no shared credentials; Desktop Quality Engine and Desktop File Bridge add adaptive quality plus boundary-guarded drag/drop plans
- Capability Negotiator exposes honest adapter/fallback chains; optional Kitsune Agent uses signed nonce capabilities with SSH fallback; the declarative Terminal & Files Adapter SDK v2 forbids renderer code and arbitrary processes
- Visual Result Renderers add virtualized waterfalls, treemaps, matrices, graphs, conflict panes, timelines and transfer lanes while retaining raw access; every workflow receives a bounded visual summary in its inspector instead of relying on JSON output alone
- Contextual Action Orb shows at most six safe actions beside a selection; Operations Test Lab simulates eight failure classes without touching production; accessibility includes keyboard traversal, `Alt+Enter`, live regions, reduced motion and forced-colors support
- Large Fleet Performance selects windowed lists, worker streaming, incremental pages, end-to-end cancellation and backpressure; Command Deck cards use layout containment/content visibility and result DOM remains bounded
- Semantic Shell Layer creates redacted, virtualized command blocks with cwd, host, duration and exit state; Command Reproducibility signs a sanitized environment, tool/config hashes and result proof without automatic reruns
- Config Studio validates Nginx, Apache, systemd, Compose, Kubernetes, SSH, JSON and YAML-shaped configuration, maps operational impact and prepares snapshot/test/reload/health/rollback stages; Disposable Shadow Host compares files, services, ports and logs inside a credentialless disposable clone before approval-based promotion
- Identity & Trust Center unifies public SSH fingerprints, short-lived CA policy, FIDO2/Windows Hello and rotation warnings without private-key export; Workspace Recovery Capsule encrypts tabs, panes, buffers, transfers and layout while restoring no commands or credentials
- Remote Desktop Pro adds multi-monitor resolution, audio, guarded clipboard/drive/printer/USB policies and consent-based private recording; Live Process & Network Explorer presents a virtualized process tree and socket graph with safe contextual pivots
- Cross-Host Data Pipeline models resumable scan/filter/transform/compress/encrypt/verify flows as a directed canvas with bounded buffers, backpressure, checksums and rollback; Focus & Incident Layouts create responsive task surfaces for deployment, debugging, file migration, database recovery and incidents while keeping safety identity visible
- Production Runtime keeps the visible feature count at 89 while hardening ten underlying engines: Session Canvas integration, native shell signals, real resumable transfers, optimistic remote editing, crash journal, protocol matrix, signed portable updates, pooled connections, scale profiling and attack-corpus checks
- Connection Broker issues bounded identity-pinned channel leases for terminal/files/tunnels/telemetry/desktop; the hash-chain Workspace Journal stores context hashes rather than buffer contents and recovery never replays commands
- Production Transfer Core delegates to the existing real resumable SFTP and server-to-server streams, persists progress checkpoints and requires explicit approval; Remote Editor Core signs a 4 MB-bounded optimistic plan, verifies current and written hashes and rolls back a failed write
- Native Shell Integration generates opt-in OSC 7/633 packages for Bash, Zsh, Fish and PowerShell without silently editing user profiles; the signed portable updater verifies Ed25519, SHA-256 and stages updates while retaining the current bundle for rollback
- Deep Tools Dock adds nine context-aware workflows without increasing the 89-card surface: Binary Workbench, Metadata Fidelity, Object Storage Pro, Remote Git Workspace, hardware-backed SSH, multi-client migration, modern terminal media, real remote mounts and a disposable Protocol CI Lab
- Binary Workbench reads bounded local or SFTP byte ranges, detects encoding and entropy and renders a virtualized hex view/diff; Metadata Fidelity inspects ACL/xattr/link/sparse metadata and creates an explicit cross-platform sidecar map instead of silently losing attributes
- Object Storage Pro performs approval-gated provider-native S3/Azure multipart uploads with persistent part checkpoints, version browsing and S3 Object Lock inspection; Remote Git adds verified status/diff/history/blame plus approval-gated stage and unstage
- Hardware-backed SSH exposes public fingerprints from OpenSSH Agent/Pageant/FIDO providers without private-key export; Migration Assistant previews and deduplicates MobaXterm, PuTTY, WinSCP, OpenSSH, Royal TS and Termius profiles before importing secret-free sessions
- xterm now renders bounded Sixel/iTerm images through `@xterm/addon-image` and direct/chunked Kitty PNG/RGB/RGBA graphics through a dedicated canvas renderer; OSC 8 links require confirmation and OSC 52 passes through the expiring secret scanner
- Terminal, SFTP, command, diagnostic, tunnel and server-transfer channels reuse a pinned, reference-counted SSH transport with idle expiry instead of creating a new connection per action
- Huge File Workbench can build a durable SQLite/WAL directory index in Worker Threads with cancellation, bounded concurrency and queue backpressure, keeping large scans off the renderer thread
- Real Remote Mounts delegates SFTP to SSHFS-Win and WebDAV/S3/Azure to rclone using environment-only credentials and guarded write cache; on Windows it can download the current security-fixed WinFsp build on demand, pin SHA-256, validate Authenticode and ask for elevation before install/repair
- Protocol CI Lab emits a disposable Docker topology and an 81-cell real-adapter/VM matrix across Windows and Linux runners that never references production profiles
- The Windows bundle includes the official rclone 1.75.0 portable binary, its MIT license and a pinned executable SHA-256; the Deep Tools runtime prefers this verified copy when no trusted system rclone is available
- Runtime Audit executes a bounded 10k-server/1m-file profile plus traversal, Unicode-control, command-injection, secret, PKCS#8 private-key, archive, NUL and oversize checks; the compact five-group Runtime Cockpit reports health without adding workflow cards or tables
- `npm run qa:terminal-files` launches the real web renderer in headless Edge, exercises category selection, adaptive context, Platform Foundation, Expert Workspaces, Production Runtime, Deep Tools Dock, rendered results and search, rejects visible error toasts, checks desktop/compact overflow, and writes normal, context-layer, platform, expert, runtime, deep-tools, search and compact screenshots to `artifacts/qa`

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
- Keep local-server settings and outgoing remote-Hub connections in separate UI views with explicit role descriptions and independent status
- Install `artifacts/plesk/kitsuneserv-bridge-3.1.1-r14.zip` in Plesk, select the Hub domain and any direct API/Test Lab subdomains from the Plesk inventory. Bridge publishes them through the standard Plesk web-server hook. Managed synchronizations detect and schedule newer Bridge releases from the same verified checkout automatically; the Deployment tab also provides explicit check and upgrade actions. Release 14 safely migrates the legacy managed nginx block before rebuilding existing domains.
- Choose managed deployment from a configurable Git repository or connect an existing external Hub; public URL and nginx reverse proxy can be automatic or manual
- Configure branch and isolated source/release/data paths, HTTPS token or strict SSH deploy key, automatic Plesk Node.js/npm discovery (or manual paths), systemd service user, port, bootstrap account, API/update keys and Plesk connector secrets
- Let Bridge generate the connector ID, encrypted shared secret and Plesk URL on save/deploy; start and restart refresh authentication settings without a full redeployment
- Run hybrid authentication with Plesk password priority and local fallback for users absent from Plesk; matching names retain the existing Hub profile, roles and MFA
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

Run `artifacts\windows\KitsuneServ-3.1.1-x64-setup.exe`, choose the destination and launch KitsuneServ from the Start menu. The installer preserves application data during uninstall. The portable EXE is useful for testing or carrying the UI without a traditional installation.

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

Version 3.1.1 includes configuration, secret handling, readiness tests and environment projection for these providers. Operations that require an external account, legal approval, paid certificate or repository ownership remain inactive until those credentials are supplied. OAuth/OIDC entries remain configurable adapters; Kitsune Hub device enrollment and Plesk SSO are built-in. Package-manager submissions also remain explicit user-controlled publishing actions.

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
