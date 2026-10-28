#!/usr/bin/env bash
# Composites a gameplay recording with rendered overlay frames (scripts/render-overlay.js) into one video:
# 5 s title card, gameplay sped up, then the end card held over the frozen last frame.
# Usage: scripts/compose-video.sh <recording> <overlayDir> <titlePng> <out.mp4> [speed=2] [overlayFps=5] [tailSec=14]
set -euo pipefail
REC="${1:?recording}"; OVERLAY="${2:?overlay dir}"; TITLE="${3:?title png}"; OUT="${4:?output mp4}"
SPEED="${5:-2}"; OVFPS="${6:-5}"; TAIL="${7:-14}"
cd "$(dirname "$0")/.."

# Keep the bottom 16:9 band of the recording (the in-game chat lives at the bottom-left).
IFS=x read -r W H < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$REC")
CROP_H=$(( W * 9 / 16 )); CROP_H=$(( CROP_H > H ? H : CROP_H ))

ffmpeg -v error -stats -y -hwaccel videotoolbox -i "$REC" \
  -framerate "$OVFPS" -i "$OVERLAY/f%05d.png" \
  -loop 1 -t 5 -i "$TITLE" \
  -filter_complex "
    [0:v]setpts=PTS/${SPEED},fps=30,crop=${W}:${CROP_H}:0:$(( H - CROP_H )),scale=1440:810:flags=lanczos,tpad=stop_mode=clone:stop_duration=${TAIL}[game];
    [1:v]fps=30[panels];
    color=c=0x0f1115:s=1920x1080:r=30[bg];
    [bg][game]overlay=0:54:shortest=1[base];
    [base][panels]overlay=0:0:eof_action=repeat,format=yuv420p,setsar=1[main];
    [2:v]scale=1920:1080,fps=30,format=yuv420p,setsar=1[title];
    [title][main]concat=n=2:v=1:a=0[out]" \
  -map "[out]" -c:v libx264 -preset medium -crf 21 -movflags +faststart "$OUT"
ls -lh "$OUT"
