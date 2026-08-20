# Changelog

## 3.1.2-21

- Added Ultimate Tool to Kitsune Plesk Management and the deterministic aggregate update bundle.
- Made the one-command suite installer tolerate checksum manifests copied with Windows CRLF line endings.

## 3.1.2-20

- Added WPKit Parse Manager and Nerd Apps Runtime Manager to central discovery, navigation and the aggregate update bundle.
- Extended the shared Suite contract and deterministic builder to the Android/Nerd project workspace.

## 3.1.2-19

- Added the central Plesk Management screen with dynamic discovery, product configuration links and validated manual ZIP updates.
- Unified Suite navigation so Kitsune Hub remains the single menu entry while active product managers stay independently functional.
- Added the shared visual shell, aggregate update bundle and reusable extension template contract.

## 3.1.2-18

- Treats every selected API domain as a reusable namespace and proxies one child hostname per API Flow project.
- Attempts to provision the namespace wildcard CNAME in the Plesk DNS zone and reports an actionable warning for external DNS providers.
- Explains the required wildcard TLS certificate and the difference between a base API domain and a concrete API address.
- Ships the application-side automatic publication and API namespace fallback introduced in KitsuneServ 3.1.2.

## 3.1.1-17

- Fixed the root-owned `state.json` permissions so the Plesk web UI can read operation, service-health and extension-update results written by the privileged executor.
- Made the update check explicitly fetch and reset the managed checkout to the configured remote branch before comparing extension metadata.
- Added separate installed/repository version cards, a visible check timestamp/error and an update button enabled only when the repository contains a newer release.
- Normalized the installed version from the running extension so stale state can no longer report an older active release.

## 3.1.1-16

- Replaced mandatory pairing codes with automatic, HMAC-signed enrollment backed by the connector secret already deployed to Kitsune Hub.
- Made the managed start action perform the first deployment when needed and added one guided action for deployment, SSO trust and node synchronization.
- Reduced the connection screen to a clear three-step status; manual connector fields and legacy pairing remain available only as an emergency fallback.
- Added a managed connector heartbeat so the Plesk node stays accurately online without requiring the extension page to remain open.

## 3.1.1-15

- Serialized status refreshes and state-changing operations through one lock, preventing a stale page refresh from overwriting update results.
- Made Bridge update checks and update scheduling return their final result before the page redirects.
- Kept status refreshes from clearing the last operation result and normalized a completed scheduled upgrade to the installed release.

## 3.1.1-14

- Automatically migrates the legacy managed nginx block before Plesk rebuilds a domain, preventing duplicate internal locations while preserving unrelated vhost directives and a one-time backup.
- Fixed API/Test Lab subdomain selection with an accessible, Plesk-independent checkbox control.
- Added a header shortcut that opens the configured KitsuneServ server panel in a new tab.

## 3.1.1-13

- Added explicit Hub/API domain selection with one Plesk-managed reverse-proxy hook for Hub, Test Lab and API Flow hostnames.
- Replaced direct `vhost_nginx.conf` writes with `pm_Hook_WebServer` and Plesk domain reconfiguration.
- Reworked the overview into accurate configuration, deployment, service-health and update states with a guided setup checklist.
- Added manual Bridge update checks and upgrades; automatic upgrades now use the Plesk CLI upgrade operation.
- Published selected API domains in paired-node inventory for the KitsuneServ publication dialog.

## 3.1.0-12

- Added automatic Plesk Bridge self-updates after repository synchronization and managed deployment. A newer extension from the verified checkout is packaged locally and installed through the Plesk CLI after the active long task completes.
- The overview reports the installed and discovered Bridge releases, scheduled updates and actionable update failures.
- Updated the Bridge alongside KitsuneServ 3.1.0 interface, web terminal, file workspace, operational dashboard and Test Lab publication improvements.

## 3.0.0-11

- Replaced Proxy Mode detection and mutation with a server-rewrite plus an internal named path that safely coexists with Plesk's generated `location /` and static-file locations.
- The managed and manual proxy variants preserve the original method, body, URI, query string and WebSocket headers while leaving `/.well-known` to Plesk for ACME/certificate handling.
- Unified the hosting-panel navigation entry with the other Kitsune managers under `SECTION_NAV_SERVER_MANAGEMENT`, removing the isolated bottom-of-menu item.

## 3.0.0-10

- Replaced the unreliable generated-`location /` heuristic with the Plesk `--show-web-server-settings` value when detecting per-domain nginx Proxy Mode.
- Proxy Mode updates now use the documented Plesk subscription utility; generated nginx inspection remains only a conservative compatibility fallback.
- Fixed false rollback after Plesk successfully disabled Proxy Mode but retained a root location in the generated configuration.

## 3.0.0-9

- Fixed managed publication on domains where Plesk nginx Proxy Mode already generates `location /`.
- Bridge now records the previous per-domain setting, disables Plesk Proxy Mode through the official domain CLI, installs a `location ^~ /` Hub proxy and restores both the file and prior mode on failure.
- Added a transition checkpoint so interrupted or failed proxy configuration is visible in extension state and logs.

## 3.0.0-8

- Replaced the invalid direct read/executable check of the protected Plesk utility with an official privileged `pm_ApiCli::callSbin()` self-check.
- Added a side-effect-free `--self-check` operation to `kitsuneserv-bridge-r8`, avoiding permission warnings from the unprivileged post-install process.

## 3.0.0-7

- Versioned the privileged executor as `kitsuneserv-bridge-r7` so an older Plesk-managed `sbin` copy cannot be reused after an extension upgrade.
- Added a post-install integrity/executability check and an executor release marker in every operation log.
- Generalized package-time Unix LF normalization to every privileged utility in the extension.

## 3.0.0-6

- Added automatic discovery of compatible Node.js 22.19+ installations managed by Plesk under `/opt/plesk/node/*/bin/node`, with system paths as fallbacks.
- Paired npm with the selected Node.js installation and propagated its directory through task and systemd `PATH` values.
- Start and restart now repair an older systemd unit that still points to `/usr/bin/node`; manual absolute runtime paths remain supported.
- Extension upgrades migrate the former `/usr/bin/node` and `/usr/bin/npm` defaults to automatic discovery, and the overview reports the selected runtime.
- Replaced the opaque non-executable-binary failure with actionable Plesk Node.js component guidance.

## 3.0.0-5

- Fixed the privileged `sbin/kitsuneserv-bridge` entry point in packages built on Windows by enforcing Unix LF line endings, preventing `/usr/bin/env: 'php\r': No such file or directory`.
- Added package-time normalization and repository EOL rules so executable Unix scripts cannot regress to CRLF.

## 3.0.0-4

- Removed the hybrid-authentication bootstrap deadlock by generating the connector ID, encrypted shared secret and Plesk origin automatically on save or first deployment.
- Added a signed, replay-protected password verification endpoint backed by the official Plesk credential API.
- Added Plesk-first hybrid password login while preserving local Hub profiles, roles, MFA and local passwords when usernames overlap.
- Added explicit Plesk SSO and local-login choices plus authentication status guidance on the Hub login screen.

## 3.0.0-3

- Added direct selection of active hosted Plesk domains and automatic or manual Hub URL generation.
- Added managed and external deployment modes plus managed or manual reverse-proxy publication.
- Added configurable Git repository, branch, paths, Node.js/npm runtime, systemd service, ports, bootstrap account, access rules and signed update channel.
- Added HTTPS token authentication through `GIT_ASKPASS` and strict SSH deploy-key/`known_hosts` support with encrypted secret storage.
- Added atomic staged deployment, previous-release rollback, persistent-data separation, service control, health state and long-task operation logs.
- Rebuilt the extension UI with overview, deployment, configuration, SSO, manual instructions and logs tabs.
- Added automatic Hub domain/authentication provisioning through the managed service environment.
- Added pre-uninstall task cleanup while deliberately preserving deployed code and user data.

## 3.0.0-2

- Removed the invalid manual `pm/bootstrap.php` include from the Plesk-managed entry point.
- Added navigation entries for Service Provider, Reseller and Power User interface modes.
- Added administrator and reseller Tools & Settings fallbacks.

## 3.0.0-1

- Initial Kitsune Hub connection and encrypted device enrollment.
- HMAC-signed, one-use Plesk SSO assertions.
- Administrator, reseller, customer, and service-plan access mapping.
- Redacted Plesk server/domain inventory heartbeat.
- Independent, Plesk-only, and hybrid authentication modes.
