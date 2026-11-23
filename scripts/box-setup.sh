#!/usr/bin/env bash
# Runs inside the instabox sandbox. Installs what a Tauri 2 Linux build and
# its WebDriver end-to-end test need. Safe to rerun.
set -euo pipefail

packages=(
  build-essential curl wget file pkg-config unzip
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev
  webkit2gtk-driver xvfb xauth imagemagick fonts-noto-cjk ffmpeg
)

missing=()
for package in "${packages[@]}"; do
  dpkg -s "$package" >/dev/null 2>&1 || missing+=("$package")
done

if ((${#missing[@]})); then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
fi

command -v tauri-driver >/dev/null 2>&1 || cargo install tauri-driver --locked

echo "box ready: $(rustc --version), node $(node --version), pnpm $(pnpm --version)"
