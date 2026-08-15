# Bundled portable tools

These unmodified upstream binaries are shipped as optional fallbacks. KitsuneServ's built-in terminal and file manager remain the defaults.

- PuTTY suite 0.84 — MIT license (`windows/putty/putty-license.html`).
- WinSCP Portable 6.5.6 — GPL-3.0-or-later (`windows/winscp/license.txt`). The corresponding source archive is included.
- TigerVNC Viewer 1.16.2 — GPL-2.0-or-later (`windows/tigervnc/tigervnc-license.txt`). The corresponding source archive is included.

Runtime files are pinned by SHA-256 in `windows/manifest.json` and verified before launch. Passwords are never placed in command-line arguments.
