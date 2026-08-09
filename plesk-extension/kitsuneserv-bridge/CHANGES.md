# Changelog

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
