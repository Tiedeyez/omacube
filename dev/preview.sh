#!/usr/bin/env bash
# Render Omacube frames to PNG for development, without the plugin installed.
# Opens a click-through surface on the "bottom" layer of the current Wayland
# session for a few seconds, saves frames, then exits.
#   dev/preview.sh [outdir] [frames] [fps] [t0] [width] [height]
set -euo pipefail
cd "$(dirname "$0")/.."
tools/build-shader.sh >/dev/null
out=${1:-$PWD/frames}; mkdir -p "$out"
OMACUBE_OUT=$out OMACUBE_FRAMES=${2:-1} OMACUBE_FPS=${3:-24} OMACUBE_T0=${4:-3} \
OMACUBE_W=${5:-1920} OMACUBE_H=${6:-1080} OMACUBE_QSB=$PWD/shaders/omacube.frag.qsb \
  /usr/bin/timeout 300 /usr/bin/qs -p "$PWD/dev/preview.qml" >/dev/null 2>&1 || true
ls "$out"
