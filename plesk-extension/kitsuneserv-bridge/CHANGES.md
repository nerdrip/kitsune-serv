# Changelog

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
