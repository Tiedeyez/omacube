#!/usr/bin/env bash
# Render Omacube frames to PNG for development, without the plugin installed.
# Opens a click-through surface on the "bottom" layer of the current Wayland
# session for a few seconds, saves frames, then exits.
#   dev/preview.sh [outdir] [frames] [fps] [t0] [width] [height] [qsb]
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p frames
qsb=${7:-}
if [ -z "$qsb" ]; then tools/build-shader.sh >/dev/null; qsb=$PWD/shaders/omacube.frag.qsb; fi
out=${1:-$PWD/frames}; mkdir -p "$out"
# Quickshell only loads files from the config's own folder, so stage the
# preview next to a copy of Palette.js.
stage=$(mktemp -d "$PWD/frames/.preview.XXXXXX")
trap 'rm -rf "$stage"' EXIT
cp dev/preview.qml "$stage/shell.qml"
cp Palette.js "$stage/Palette.js"
cp mosaic.png "$stage/mosaic.png"
OMACUBE_OUT=$out OMACUBE_FRAMES=${2:-1} OMACUBE_FPS=${3:-24} OMACUBE_T0=${4:-3} \
OMACUBE_W=${5:-1920} OMACUBE_H=${6:-1080} OMACUBE_QSB=$qsb \
  /usr/bin/timeout 300 /usr/bin/qs -p "$stage/shell.qml" >/dev/null 2>&1 || true
ls "$out"
