#!/usr/bin/env bash
set -euo pipefail

REPO="stevenwang288/waveterm"
STABLE_ONLY="0"
PREFER="deb"

print_usage() {
  cat <<'USAGE'
WAVE Ubuntu/Debian installer (from GitHub Releases).

Usage:
  install-ubuntu.sh [--repo owner/repo] [--stable] [--prefer deb|appimage]

Examples:
  ./scripts/install-ubuntu.sh
  ./scripts/install-ubuntu.sh --repo stevenwang288/waveterm --stable
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --stable)
      STABLE_ONLY="1"
      shift 1
      ;;
    --prefer)
      PREFER="${2:-}"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      print_usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$REPO" ]]; then
  echo "Missing --repo value" >&2
  exit 2
fi

if [[ "$PREFER" != "deb" && "$PREFER" != "appimage" ]]; then
  echo "Invalid --prefer: $PREFER (expected deb|appimage)" >&2
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Missing dependency: curl" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Missing dependency: python3" >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  x86_64)
    EB_ARCH="x64"
    ;;
  aarch64|arm64)
    EB_ARCH="arm64"
    ;;
  *)
    echo "Unsupported CPU architecture: $arch" >&2
    exit 1
    ;;
esac

api_url="https://api.github.com/repos/${REPO}/releases"
releases_json="$(curl -fsSL -H "Accept: application/vnd.github+json" "$api_url")"

selected="$(
  STABLE_ONLY="$STABLE_ONLY" PREFER="$PREFER" EB_ARCH="$EB_ARCH" python3 - <<'PY'
import json
import os
import re
import sys

stable_only = os.environ.get("STABLE_ONLY") == "1"
prefer = os.environ.get("PREFER", "deb")
arch = os.environ["EB_ARCH"]
product = "WAVE"

try:
    releases = json.loads(sys.stdin.read() or "[]")
except Exception as e:
    print(f"error: failed to parse GitHub API response: {e}", file=sys.stderr)
    sys.exit(1)

if not isinstance(releases, list):
    print("error: unexpected GitHub API response (expected list)", file=sys.stderr)
    sys.exit(1)

pattern_deb = re.compile(rf"^{re.escape(product)}-linux-{re.escape(arch)}-.*\.deb$")
pattern_app = re.compile(rf"^{re.escape(product)}-linux-{re.escape(arch)}-.*\.AppImage$")

preferred_patterns = [pattern_deb, pattern_app] if prefer == "deb" else [pattern_app, pattern_deb]

for rel in releases:
    if not isinstance(rel, dict):
        continue
    if rel.get("draft"):
        continue
    if stable_only and rel.get("prerelease"):
        continue
    assets = rel.get("assets") or []
    if not isinstance(assets, list):
        continue
    for pat in preferred_patterns:
        for asset in assets:
            if not isinstance(asset, dict):
                continue
            name = asset.get("name") or ""
            if not isinstance(name, str):
                continue
            if not pat.match(name):
                continue
            url = asset.get("browser_download_url") or ""
            if not isinstance(url, str) or not url:
                continue
            print(f"{name}\t{url}")
            sys.exit(0)

print("error: no matching release asset found", file=sys.stderr)
sys.exit(1)
PY
)" <<<"$releases_json"

asset_name="${selected%%$'\t'*}"
asset_url="${selected#*$'\t'}"

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

asset_path="${tmpdir}/${asset_name}"
echo "Downloading: $asset_name"
curl -fL --retry 3 --retry-delay 2 -o "$asset_path" "$asset_url"

if [[ "$asset_name" == *.deb ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Missing dependency: sudo (required to install .deb)" >&2
    exit 1
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Missing dependency: apt-get (expected Ubuntu/Debian). Try --prefer appimage." >&2
    exit 1
  fi
  echo "Installing .deb..."
  sudo apt-get update
  sudo apt-get install -y "$asset_path"
  echo "Installed WAVE. Launch it from your app menu (or run: WAVE)."
  exit 0
fi

if [[ "$asset_name" == *.AppImage ]]; then
  install_dir="${HOME}/.local/bin"
  mkdir -p "$install_dir"
  target="${install_dir}/WAVE.AppImage"
  mv "$asset_path" "$target"
  chmod +x "$target"
  echo "Installed AppImage to: $target"
  echo "Run: $target"
  exit 0
fi

echo "Downloaded unknown artifact type: $asset_name" >&2
exit 1
