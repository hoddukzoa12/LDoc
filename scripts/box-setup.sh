#!/usr/bin/env bash
# Runs inside the instabox sandbox. Installs what driving the page in
# WebKitGTK and filming it need. Safe to rerun.
set -euo pipefail

packages=(
  curl libwebkit2gtk-4.1-0 webkit2gtk-driver
  xvfb xauth xdotool fonts-noto-cjk ffmpeg
)

missing=()
for package in "${packages[@]}"; do
  dpkg -s "$package" >/dev/null 2>&1 || missing+=("$package")
done

if ((${#missing[@]})); then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
fi

echo "box ready: node $(node --version), pnpm $(pnpm --version)"
