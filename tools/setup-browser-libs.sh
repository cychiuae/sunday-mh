#!/usr/bin/env bash
# Headless Chromium needs a few system libraries that this machine lacks, and
# installing them system-wide needs sudo. This fetches the .deb files and
# unpacks them into .cache/browser-libs (no root). tools/playtest-browser.mjs
# adds that directory to LD_LIBRARY_PATH automatically.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/.cache/browser-libs"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$dest"
cd "$work"
for pkg in libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxcomposite1 libxdamage1 libxrandr2; do
  apt-get download "$pkg" 2>/dev/null || apt-get download "${pkg%t64}"
done
for deb in *.deb; do dpkg-deb -x "$deb" "$work/x"; done
find "$work/x" -name '*.so*' -exec cp -a {} "$dest/" \;
echo "browser libs ready in $dest"
