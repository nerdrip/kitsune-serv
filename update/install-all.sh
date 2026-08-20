#!/usr/bin/env bash
set -euo pipefail

update_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$update_root"
# A bundle may be copied or unpacked by Windows tooling which converts this
# text manifest to CRLF. Strip only carriage returns from the checksum stream;
# package bytes remain untouched and are still verified before installation.
tr -d '\r' < SHA256SUMS | sha256sum -c -

found=0
for package in "$update_root"/packages/*.zip; do
  [ -f "$package" ] || continue
  found=1
  printf 'Installing %s\n' "$(basename "$package")"
  plesk bin extension -g "$package"
done

if [ "$found" -ne 1 ]; then
  printf 'No Plesk packages found in %s/packages\n' "$update_root" >&2
  exit 1
fi

plesk bin extension -l
