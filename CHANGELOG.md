# Changelog

## 3.0.0 — 2026-08-09

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
