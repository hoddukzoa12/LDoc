#!/usr/bin/env bash
# Throwaway spike. Runs on the sandbox: install, build, serve the build, drive it.
#   bash spikes/ghost-text/run.sh smoke|film|ime|measure ...
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
pnpm install --prefer-offline --reporter=silent
pnpm exec vite build --logLevel error
pnpm exec vite preview --port 5179 --strictPort --host 127.0.0.1 > out/preview.log 2>&1 &
preview=$!
trap 'kill $preview 2>/dev/null || true' EXIT
uptime
for mode in "${@:-smoke}"; do
  xvfb-run -a -s '-screen 0 1360x1000x24' node drive.mjs "$mode"
done
