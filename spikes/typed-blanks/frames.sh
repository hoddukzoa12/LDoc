#!/usr/bin/env bash
# Throwaway spike. Pulls one frame from late in each caption of out/blanks.mp4, full width.
set -euo pipefail
cd "$(dirname "$0")/out"
rm -rf frames && mkdir frames
index=0
grep -- '-->' blanks.srt | while read -r start _ end; do
  index=$((index + 1))
  to_s() { IFS=':,' read -r h m s ms <<<"$1"; echo "$((10#$h * 3600 + 10#$m * 60 + 10#$s)).$ms"; }
  at=$(awk -v a="$(to_s "$start")" -v b="$(to_s "$end")" 'BEGIN { print a + (b - a) * 0.8 }')
  ffmpeg -loglevel error -y -ss "$at" -i blanks.mp4 -frames:v 1 "frames/$(printf %02d $index).png"
done
ffprobe -v error -show_entries stream=width,height -show_entries format=duration -of csv=p=0 blanks.mp4
ls frames | wc -l
