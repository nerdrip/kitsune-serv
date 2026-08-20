# Changelog

## 3.1.2 — 2026-08-20

- Added Kitsune Plesk Suite management in Hub: installed Kitsune extensions are detected automatically, linked from one screen and can be updated from validated Plesk ZIP packages.
- Unified the Plesk managers with one shared visual shell and Hub-aware navigation; product entries remain standalone only when Kitsune Hub is unavailable.
- Added a reproducible thirteen-package Plesk update bundle, including WPKit, Nerd Apps and Ultimate Tool, with a CRLF-safe checksum manifest, one-command installer and reusable extension template; KitsuneColab and Artifactory now use collision-free extension IDs.
- Released KitsuneServ Bridge r21 with central Plesk Management while preserving the guarded Hub self-update workflow.
- Updated KitsunePNC Manager to r3 so Suite operations install Colab from `plesk-extension/kitsunecolab-manager` and address the current `kitsunecolab-manager` extension and runner.
- Made Plesk API domains reusable namespaces: starting `Nowe API` in web mode now publishes `nowe-api.api.example.com` automatically while keeping the process port internal.
- Prevented unmatched API namespace requests from falling through to the Kitsune Hub login page and added explicit API-not-found responses.
- Added automatic wildcard DNS provisioning attempts and wildcard nginx host routing in Plesk Bridge r18, with actionable DNS/TLS warnings when the provider is external.
- Clarified the desktop `localhost:port` model versus server-side public HTTPS addresses in API Flow.
- Added exact `{steps.block-id}` result names, documented result fields and contextual placeholder examples to every API Flow block.

## 3.1.1 — 2026-08-20

- Fixed web terminal startup output and added real SSH terminal sessions in server mode.
- Removed native Windows launch actions from the web interface and clarified server-host file semantics.
- Hardened drag-and-drop transfers between file panes.
- Restored the missing web incident/resilience API surface so live Operations Center status no longer remains in a loading state.
- Grouped File Manager actions by transfer, review and management outcomes instead of one overflowing toolbar.
- Simplified Operations Center with progressive disclosure and readable typography.
- Added guided Hub-domain publication for Test Lab and API Flow resources.
- Reworked Plesk Bridge status, API-domain configuration, web-server integration and self-updates.
- Added the Plesk Bridge r14 migration that removes the legacy managed nginx block before domain rebuilds, fixes API-domain selection and links directly to the server panel.
- Fixed the Plesk Bridge update-result race so checks and upgrade scheduling are displayed immediately and survive automatic status refreshes.
- Replaced managed Plesk pairing codes with automatic signed enrollment, one-click SSO setup and a persistent connector heartbeat in Bridge r16.
- Fixed unreadable privileged Bridge state and made r17 update checks show the installed and fetched repository releases separately.

## 3.1.0 — 2026-08-20

- Reorganized the desktop and web interface into clearer workspace, operations and management sections with contextual descriptions and improved responsive presentation.
- Enabled authenticated browser terminals and restored file drag-and-drop between workspace columns.
- Made dashboard health refreshes resilient so one unavailable endpoint no longer hides healthy services or stale-but-useful operational data.
- Improved Test Lab value discovery and added domain-based public API Flow publication with managed proxy metadata.
- Added automatic Plesk Bridge self-updates from the configured verified repository checkout, including release status and failure reporting in the Plesk overview.

## 3.0.0 — 2026-08-09

- Added the context-driven Deep Tools Dock with nine advanced Terminal/File workflows grouped into Inspect, Connect and Move & Prove, plus a compact visual result inspector instead of new data tables.
- Added bounded binary/hex range inspection, cross-platform metadata fidelity maps, provider-native S3/Azure multipart checkpoints and version/Object Lock inspection.
- Added approval-gated Remote Git staging, public-only OpenSSH Agent/Pageant/FIDO readiness and preview-first migration from MobaXterm, PuTTY, WinSCP, OpenSSH, Royal TS and Termius.
- Added guarded OSC 8/52 handling, bounded Sixel/iTerm rendering through `@xterm/addon-image`, a bounded direct/chunked Kitty graphics canvas renderer, real SSHFS/rclone mounts and an 81-cell protocol certification matrix.
- Added a reference-counted shared SSH transport for terminals, SFTP, commands, diagnostics, tunnels and server-to-server transfers with safe idle expiry.
- Added a Worker Thread scale engine with cancellation, backpressure and a durable SQLite/WAL index behind the existing Huge File Workbench.
- Added an approval-gated WinFsp bootstrap that pins the current security build hash, validates Authenticode and requests elevation only for driver install/repair.
- Bundled official rclone 1.75.0 for Windows as a checksum-pinned MIT-licensed portable tool and wired it as the fallback cloud-mount engine.
- Expanded Terminal & Files to 89 capabilities while preserving 55 workflow cards: 12 adaptive tools remain contextual, 12 production layers live in a collapsed three-lane Platform Foundation and 10 deep tools are organized as five focused Expert Workspaces.
- Added Semantic Shell blocks, signed Command Reproducibility, configuration-aware Config Studio, disposable Shadow Host rehearsals, public-only Identity & Trust Center and encrypted Workspace Recovery Capsules.
- Added policy-aware multi-monitor Remote Desktop Pro, a virtualized Process & Network graph, directed Cross-Host Data Pipelines and responsive deployment/debug/migration/recovery/incident layouts.
- Added a ten-engine Production Runtime beneath the existing 89 workflows: identity-pinned connection leases, integrity-chained crash recovery, opt-in OSC shell packages, checkpointed real transfers and signed optimistic remote editing with verification/rollback.
- Added Ed25519/SHA-256 staged portable-tool updates, disposable protocol/failure matrices, bounded 10k-server/1m-file profiling and an attack corpus that also fixed generic PKCS#8 private-key redaction.
- Added a five-group, non-table Runtime Cockpit with a one-click bounded production audit and responsive health visualization.
- Added a real signed Approved Execution lifecycle for whitelisted command templates and atomic file writes with distinct approval, idempotency, verification and rollback.
- Added Unified Remote Session Canvas, adaptive RDP/VNC quality, guarded desktop file bridge, capability negotiation, optional signed Agent acceleration and declarative Adapter SDK v2.
- Added bounded visual result renderers, contextual Action Orb, disposable failure Test Lab, keyboard/screen-reader/forced-color support and large-fleet virtualization/streaming strategies.
- Added Execution Context Beacon, Connection Waterfall & Tuner, Data Boundary Guard, Live Output Privacy Shield, Executable Trust Inspector and resource-budgeted command plans.
- Added detached jobs, a three-way Conflict Resolution Cockpit, isolated Remote Quarantine Lab, Branchable Terminal, verified SSH channel pooling and a distinct-approver Terminal & Files Review Inbox.
- Added Cross-Server Command Matrix, resumable Transfer Control Center, encrypted direct server transfer plans, guarded Smart Sync Profiles and traversal-safe Archive Explorer workflows.
- Added Atomic Remote Editor, redacted Session Time Machine, Filesystem Snapshot Diff, Remote Storage Fabric, Live Virtual Folders and a zoomable Disk Space Visualizer.
- Added Process/Port/Container Navigator, expiring secret-aware Clipboard Bridge, Shell Resurrection and synchronized Terminal–File Manager Fusion.
- Added Structured Output Canvas, File Relationship Graph, signed transfer receipts, local predictive cache, native filesystem event streams and semantic configuration history.
- Added visual batch rename/transform previews, bounded Remote Data Inspector, transport continuity, server identity trust timeline and a reviewable command composer.
- Added Terminal Focus Mode, Universal Staging Area, multi-monitor layouts, command/file bookmarks, contextual screen explanations, compact workspace health and Disposable Data Lens isolation plans.
- Added cache-backed Remote Workspace Drive plans, delta block transfers, offline three-way reconciliation, local Remote Code Intelligence and private universal search.
- Added topology graphs, reviewed ProxyJump/tunnel plans, one-use JIT secret leases, ephemeral SSH certificate requests and encrypted secret-free Context Teleport capsules.
- Added policy-as-code guardrails, signed read-only forensics, canary fleet plans, Production Safety Lens and minimal-scope Remote Disaster Undo points.
- Added local Digital Twin effect prediction, deterministic Intent Terminal, telemetry HUD, governed collaborative terminals, Visual Permission Studio, Living Runbooks and adaptive scheduling.
- Added Terminal & File Manager Pro: structured notebooks, automatic Secure Paste Firewall, deterministic shell translation, isolated Shadow Mode, sidecar inspection, checkpoints, result matrices and sanitized recording workflows.
- Added transactional multi-file editing with snapshot rollback, container/Kubernetes filesystem adapters, Git-aware files, archive browsing and bounded Huge File Studio streaming.
- Added encrypted remote content indexes, provenance/causality records, remote duplicate hashing, filesystem heatmaps, OSC-7 context synchronization and cross-protocol transfer/pipeline plans.
- Added safe drop-zone inventories, encrypted secret-free Connection Capsules, expiring one-use Server AirDrop, server-bound one-use Clipboard Vault and filesystem change explanation.
- Added Terminal & File Operations Workspace with resumable multi-server contexts, OSC 133 command-effect timelines, snapshot-backed approved undo and governed collaborative file revisions.
- Added Connection Doctor 2.0, secretless readiness, adaptive transfer planning, canary-first bounded Fleet Terminal and a confirmation-protected Visual SSH Multiplexer.
- Added full secret-free Environment Diff, disposable and portable rescue manifests, local Operational Memory, policy-aware command completion and constrained intent planning.
- Added Infrastructure Movie, live blast-radius overlays, four-eyes pair debugging, one-click terminal incident rooms and isolated degraded-network path replay.
- Added Next-generation Operations: outbound-only Relay Mesh, signed single-use Privilege Broker capabilities and direct/Agent/Relay self-healing connectivity selection.
- Added structured OSC 133 terminal blocks, atomic block-level delta transfer, content-addressed Filesystem Time Travel and File Manager-enforced Ransomware Guard freezes.
- Added sandboxed Guacamole/noVNC workspaces, fresh-MFA SSH certificate policies, four-eyes Pair Operations and PWA-based mobile approvals.
- Added bounded content-free eBPF diagnostics, Network Digital Twin, transactional remote changes with reverse rollback, Server DNA and an integrity-chained Operations Black Box.
- Added encrypted Offline PWA Vault, import-free WASM Automation Sandbox, non-executable Intent Operations and an isolated scored Operations Flight Simulator.
- Added Kitsune Agent with signed replay-resistant requests, bounded telemetry/files and allowlisted service controls, plus desktop and Web/Hub enrollment/probing.
- Added SLO error budgets with deployment freezes, capacity forecasting, canary patch orchestration and quorum-aware reboot coordination.
- Added host compliance scans, Syft/Trivy SBOM adapters, sequential digest-only image promotion, signed content-addressed air-gap backups and credentialless cloud CLI login.
- Added non-production Chaos Lab with automatic rollback, simulation-only autonomous remediation, disposable-clone migration rehearsal and native configuration validators.
- Added hardened cloud-init generation, multi-region failover plans, signed declarative Marketplace packs, global Operations shortcuts and a read-only/navigation voice console.
- Added Web/Hub parity for saved remote sessions, two-pane files, cloud storage, Advanced Ops, Operations Fabric and Enterprise Ops.
- Added Operations Fabric: Zero-Trust policies, authenticated multi-person approvals, signed short-lived one-use access grants, scoped one-time secret leases and an audited self-clearing clipboard.
- Added a live Service Map, credential-free Ansible/OpenTofu/Compose exports, GitOps diff plans, canary-first bounded fleet execution and Network Flight Recorder PCAP evidence.
- Added scheduled synthetic HTTP/SSH journeys with automatic incident creation, Canary Autopilot with real traffic commands and required rollback, and isolated checksum-verifying disaster recovery simulations.
- Added Database Studio Pro schema capture, ERD/diff/migration planning and deterministic masked dataset export directly from the existing native database connections.
- Added conflict-aware offline workspaces for SSH/SFTP, FTP/FTPS, WebDAV, S3 and Azure profiles, plus expiring isolated preview manifests and governed RDP workspaces.
- Added HMAC-sealed chained Evidence Vault objects, deterministic local-only operations analysis, integrity-gated Operational Replay Labs and portable Rescue Environment exports without embedded credentials.
- Added Operations Center with a live connection graph, universal command palette, global cross-server search/replace with preview and rollback, Smart Workspaces, infrastructure baselines/diffs/drift detection, blast-radius preview and a deterministic Digital Twin.
- Added deployment preflight, secret scanning, maintenance gates, a deployment timeline, Time Machine snapshots, replayable safe workflows and shadow releases with health checks and atomic promotion.
- Added Incident Mode/War Room with automatic diagnostic evidence, automation freeze, integrity-protected Session Capsules, collaborative terminal control, collaborative editor locks and runbook suggestions.
- Added learned metric anomaly baselines, multi-log correlation, error explanations, safe command generation, Health Contracts, DNS propagation checks and certificate inspection/renewal.
- Added SSH CA operations, ProxyCommand/Tor/SOCKS support, Mosh, database tunnels, port/process/container inspection, cron/systemd timers and preview-first firewall management.
- Added content-addressed transfer cache, bandwidth limiting and remote hash skips, deduplicated backups, encrypted secret-free Offline Vault exports and MFA-bound single-use Break Glass grants.
- Added a unified two-pane File Manager for SFTP, FTP/FTPS, WebDAV, S3-compatible storage and Azure Blob, including recursive transfers, server-to-server streaming, rename/delete, previews, editing, snapshots, undo and 3-way merge.
- Added an xterm/PTY remote workspace with SSH jump hosts, agent forwarding, tunnels, tmux, RDP/VNC, session recording and text/HTML/asciinema export.
- Added remote Git, Docker Compose, Kubernetes, HTTP/REST, live metrics, disk/RAM/load/TLS alerts and expanded DNS/SSH/network/firewall/runtime diagnostics.
- Added managed SSH key generation, installation and rotation plus 1Password, Bitwarden, KeePassXC and Windows safeStorage credential integrations.
- Added encrypted scheduled remote backups, scheduled synchronization/health checks, retention, workspace templates, team roles, one-use production approvals and expiring passwordless session handoffs.
- Added a permission-gated declarative plugin SDK for protocol, preview and action extensions, signed update history/rollback and verified portable PuTTY, WinSCP and TigerVNC resources.
- Added dedicated installer shortcuts for Terminal and File Manager alongside the tray launch actions.
- Reorganized Hub settings into two explicit contexts: “this computer as the Hub server” and a separate “Hub connections” client view, with live status, field-level explanations, a three-step remote workflow and responsive visual QA coverage.
- Plesk package release 11 no longer depends on reading or changing nginx Proxy Mode: a tested server-rewrite/internal-location strategy coexists with Plesk routes, preserves REST/WebSocket traffic and ACME, and the Hub menu now shares the server-management group with the other Kitsune plugins.
- Plesk package release 10 reads nginx Proxy Mode from Plesk web-server settings and updates it through the documented subscription CLI, eliminating the false rollback caused by treating every generated `location /` as active Apache proxying.
- Plesk package release 9 coordinates managed Hub publication with the domain's Plesk nginx Proxy Mode, preventing duplicate root locations and rolling back both domain settings and custom directives on failure.
- Plesk package release 8 verifies its protected executor through an official privileged `callSbin` self-check instead of reading the root-owned file from the unprivileged post-install process.
- Plesk package release 7 uses a versioned privileged executor and verifies it during installation, preventing Plesk from reusing a stale release-5 `sbin` copy after an extension upgrade.
- Plesk package release 6 automatically discovers Plesk-managed Node.js 22.19+ and its matching npm, propagates the runtime through task/systemd `PATH`, and repairs stale service units during start or restart.
- Plesk package release 5 forces Unix LF for its privileged PHP entry point and prevents Windows-built packages from invoking the invalid interpreter name `php\r`.
- Plesk package release 4 removes the hybrid-auth bootstrap deadlock, auto-generates the connector settings, adds signed Plesk password verification and applies Plesk-first password checks while merging matching usernames into the existing local Hub profile.
- Plesk package release 3 adds Plesk-domain selection, automatic/manual publication, managed/external Hub modes, configurable Git credentials and deploy keys, atomic systemd deployments, nginx rollback, live health/log state and a complete responsive management UI.
- Plesk package release 2 fixes the panel entry point and exposes Kitsune Hub in Service Provider, Reseller and Power User navigation plus Tools & Settings.
- Added Kitsune Hub: persistent multi-user accounts, owner/admin/operator/developer/auditor/viewer RBAC, scoped memberships, encrypted TOTP MFA, recovery codes, invitations, persistent sessions and revocable, permission-bounded device/API tokens.
- Added flat wildcard routing below one configured panel domain, including authenticated/public policies, HTTP and WebSocket reverse proxying, node presence, short-lived device pairing and automatic token revocation.
- Added versioned, secret-redacted synchronization for projects, Test Labs, API Flow projects, environments, snapshots, deployment profiles and policies, with SHA-256 identity, diffs, conflicts, history, rollback and tombstones.
- Added two-way desktop/server synchronization with remote revision tracking, idempotent retries, real divergent-edit detection and optional SHA-256 TLS certificate pinning.
- Added deployment records with approval, replace/blue-green/canary/preview strategies, health results and rollback states.
- Added a complete Hub & Servers control panel for status, nodes, routes, sync inventory, users/MFA, deployments, Plesk connectors, policies and remote Hubs.
- Replaced server mode's single in-memory login with durable multi-account authentication while retaining first-run `KITSUNE_USER`/`KITSUNE_PASS` bootstrap compatibility and legacy bearer-token support.
- Added signed, one-use Plesk SSO with role mapping and automatic account provisioning. Hybrid password checks are sent only to the configured Plesk endpoint over verified HTTPS and are never persisted or logged.
- Added the separately installable KitsuneServ Bridge for Plesk extension with encrypted connector/device secrets, service-plan permission, custom panel buttons, pairing and redacted domain inventory synchronization.
- Added integration and security tests for live gateway proxying, enrollment, Plesk SSO, RBAC denial, remote conflict preservation and Plesk package structure/PHP syntax.

## 2.1.1 — 2026-08-08

- Rebuilt both Test Lab editors for 1360 px and smaller windows: the graph keeps the available width, palettes use compact rails and block settings open in a responsive overlay instead of clipping the canvas.
- Added a live API runtime bar with immediate starting/stopping/running/error states, active URL actions, uptime, request/error counters, last HTTP status and a summary of every running API project.
- Replaced the simulated-by-default tester with an integrated REST client that can save the graph, auto-start or restart its listener, send a real HTTP request and show the response together with the actual per-block execution trace.
- Fixed the API start action restoring its stale “Uruchom API” label after the listener was already running; every action now follows one explicit runtime state machine.
- Added canvas fit, collapsible inspectors, route/block rail navigation and clearer live/preview indicators throughout Test Lab.
- Added detailed runtime status to desktop IPC and authenticated web mode, bounded shutdown of lingering connections and correct live request/error accounting, including 404 responses.
- Preserved custom OPTIONS endpoints while handling actual CORS preflight requests separately.

## 2.1.0 — 2026-08-08

- Added a visual REST API Flow Builder inside Test Lab. A project can expose multiple GET/POST/PUT/PATCH/DELETE/OPTIONS routes from one managed Node.js server.
- Added a connected, draggable graph editor with endpoint navigation, searchable block palette, generated inspectors, click-to-connect ports, true/false/error branches and automatic layout.
- Added 31 executable blocks covering input/output, validation, authentication, rate limiting, SQL/MongoDB, HTTP/webhooks, JSON transforms, variables, conditions, switch, collections, cache, hashing/HMAC, secrets, logging and response headers.
- Added plugin-compatible placeholders such as `{body.email}`, `{query.page}`, `{params.id}`, `{var.name}`, `{last}` and `{steps.block-id}` while preserving nested JSON values.
- Added an in-app request tester with body/query/header/path inputs, HTTP result, duration and a per-block execution trace, plus persisted traffic logs for tester and live-server requests.
- Added graph validation for duplicate routes, missing blocks, broken connections, cycles, incomplete branches, unsafe write-mode queries and missing secrets; all normal and connected error paths must terminate in Output.
- Added parameter escaping for request-derived database placeholders, read-only database execution by default, bounded HTTP calls, 1 MB request/response limits and encrypted per-block secrets.
- Added full desktop IPC and authenticated web-mode parity, lifecycle audit entries, graceful API server shutdown and automated tests against a real local REST endpoint.

## 2.0.1 — 2026-08-08

- Replaced the technical Test Lab form with a visual node/flow builder based on the interaction model of Visual Endpoint Builder.
- Added draggable connected blocks, contextual inspectors, automatic layout, plan/test view and one-click create/provision/start/open.
- Added project and source auto-detection for WordPress plugins, npm/pnpm/yarn/Bun, PHP, Python, Go, Deno and Compose.
- Added optional PostgreSQL/MySQL/MariaDB/MongoDB/Redis/Memcached/MinIO dependency blocks that start before API sidecars.
- Added backend blueprint previews that mirror the graph, validate sources/plugins/runtimes and list every planned operation before execution.

## 2.0.0 — 2026-08-08

- Added a first-class Test Lab implemented in Node.js, including independently managed API sidecars and isolated WordPress plugin environments with live-mounted source directories.
- Added non-destructive project detection for Node.js, Next.js, Vite, PHP, Laravel, Symfony, WordPress, Django, FastAPI, Go, Rust, Compose and devcontainers.
- Upgraded project manifests to schema 2 with environment profiles, encrypted secrets, lifecycle hooks, tags, source evidence, resource policies and recovery metadata.
- Rebuilt Database Manager as a native PostgreSQL/MySQL/MariaDB/MongoDB workbench with object navigation, read-only enforcement, transactions, EXPLAIN, timeout/cancellation, history and saved queries.
- Added a Monitoring center with resource history, sparklines, crash events, alert rules, Prometheus output and safe interval automations.
- Added 16 configurable external integration adapters for publishing, authentication readiness, observability, secrets, AI operations and remote-agent enrollment.
- Added an opt-in OpenAI-compatible operations assistant with local context redaction.
- Added an integrity-protected audit log for desktop and server operations, including login events and credential-safe audit metadata.
- Expanded the Dashboard with project status and quick actions and brought every new module to both Electron IPC and authenticated web mode.
- Fixed automatic hosts-file synchronization, unwanted document-root `index.html` scaffolding and VS Code launcher discovery/error handling.

## 1.0.0-beta16 — 2026-08-08

- Added versioned configuration schema 2 with an atomic migration history.
- Added persistent project runtime state and recovery after an unclean application exit.
- Recovery stops orphaned managed services and restores temporary web-server configuration.
- Added project preflight checks for runtimes, directories, permissions, ports, domains, HTTPS certificates and disk space.
- Project start is blocked with a structured `PROJECT_PREFLIGHT_FAILED` result when a blocking check fails.
- Added per-project **Check** actions and a safe bulk-repair workflow to Kitsune Doctor.
- Added desktop and server safe mode, which pauses automatic service start, scheduled backups and host system integration.
- Added a release consistency gate and a smoke test for the packaged Windows application.
- Added project cards and quick actions to the main Dashboard.

## 1.0.0-beta15 — 2026-08-08

- Synchronized project domains with the Windows hosts file during project create, update, import and removal.
- Stopped HTTP service startup from creating an unwanted `index.html` in a selected document root.
- Rebuilt Database Manager into a richer native database workbench.
- Fixed VS Code discovery and controlled IDE launch failures.
- Added project status and quick actions to Dashboard.
