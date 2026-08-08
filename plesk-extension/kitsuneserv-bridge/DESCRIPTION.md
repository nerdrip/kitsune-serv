# KitsuneServ Bridge

Connects a Plesk server to Kitsune Hub. The extension provides signed Plesk SSO, maps Plesk administrator/reseller/customer roles to KitsuneServ roles, enrolls Plesk as a revocable Hub node, and synchronizes a redacted domain inventory.

The bridge supports independent KitsuneServ accounts, Plesk-only authentication, or hybrid authentication. Shared secrets and device tokens are stored with Plesk encrypted settings. Plesk passwords never leave Plesk.

Wildcard DNS and certificates remain explicitly configurable because certificate issuance may require an installed Plesk SSL provider and valid DNS authority. The extension reports this integration boundary instead of silently weakening TLS.
