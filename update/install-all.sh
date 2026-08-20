#!/usr/bin/env bash
set -euo pipefail

update_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$update_root"
sha256sum -c SHA256SUMS

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
