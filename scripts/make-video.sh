#!/usr/bin/env bash
# Builds the demo videos from a raw dashboard recording.
#   recordings/demo.mp4       title card + session at 2x + 10 s hold on the final reveal (for sharing)
#   recordings/demo-full.mp4  title card + session at real-time speed
# Usage: scripts/make-video.sh recordings/raw/final.webm
set -euo pipefail
RAW="${1:?raw webm path}"
cd "$(dirname "$0")/.."
TITLE=recordings/assets/title.png
ENC=(-c:v libx264 -preset slow -pix_fmt yuv420p -movflags +faststart -an)

ffmpeg -v error -y -loop 1 -t 5 -i "$TITLE" -vf "scale=1280:720,fps=30" "${ENC[@]}" -crf 26 recordings/raw/_title.mp4
ffmpeg -v error -y -i "$RAW" -vf "setpts=PTS/2,scale=1280:720,fps=30" "${ENC[@]}" -crf 30 recordings/raw/_fast.mp4
ffmpeg -v error -y -sseof -1 -i "$RAW" -frames:v 1 -update 1 recordings/raw/_last.png
ffmpeg -v error -y -loop 1 -t 10 -i recordings/raw/_last.png -vf "scale=1280:720,fps=30" "${ENC[@]}" -crf 26 recordings/raw/_hold.mp4
printf "file '%s'\n" _title.mp4 _fast.mp4 _hold.mp4 > recordings/raw/_list.txt
ffmpeg -v error -y -f concat -safe 0 -i recordings/raw/_list.txt -c copy recordings/demo.mp4

ffmpeg -v error -y -i "$RAW" -vf "scale=1280:720,fps=30" "${ENC[@]}" -crf 30 recordings/raw/_full.mp4
printf "file '%s'\n" _title.mp4 _full.mp4 > recordings/raw/_list_full.txt
ffmpeg -v error -y -f concat -safe 0 -i recordings/raw/_list_full.txt -c copy recordings/demo-full.mp4
ls -lh recordings/demo.mp4 recordings/demo-full.mp4
