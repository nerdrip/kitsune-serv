# KitsuneServ Bridge

KitsuneServ Bridge turns Plesk into a managed Kitsune Hub deployment node or connects it to an existing external Hub.

The administrator selects an active Plesk domain or subdomain directly from the panel inventory. The public Hub URL can be derived automatically from that domain or entered manually. For a locally managed deployment, Bridge can maintain an isolated Git checkout, build an atomic release with production dependencies, configure a hardened systemd service, and install a marked nginx reverse-proxy block with rollback if Plesk rejects the vhost configuration. Manual mode provides the exact nginx directives without modifying the domain.

Repository access supports public HTTPS, HTTPS credentials through a temporary `GIT_ASKPASS` helper, and SSH with strict host-key verification, pinned `known_hosts`, and an optional read-only deploy key. After a successful synchronization or managed deployment, Bridge detects a newer extension release in the same verified checkout, packages it locally and schedules installation through the Plesk CLI after the active operation finishes. Repository, branch, source/deployment/data paths, Node.js/npm binaries, service user, bind address, port, bootstrap account, IP rules, safe mode, API/update keys, connector and authentication settings are configurable from the extension.

Passwords, tokens, private keys, SSO secrets and device credentials use Plesk encrypted settings. Temporary operation files are mode `0600`, secrets are redacted from state/log output, the managed server binds only to loopback, and updates preserve persistent data plus the previous deployment for rollback.

Signed one-use Plesk SSO maps administrator, reseller and customer roles to KitsuneServ. Hybrid password login verifies credentials through a signed, replay-protected HTTPS request to this Plesk server; neither the Hub nor Bridge stores or logs the submitted password. Matching local usernames are linked to the same Hub profile without replacing local roles, MFA or password. The extension can also enroll Plesk as a revocable Hub node and synchronize a redacted domain/capability inventory.

DNS records and trusted certificates remain administrator-controlled because issuing them can require an installed SSL/DNS provider and external account authority.
