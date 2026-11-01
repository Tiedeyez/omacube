#!/usr/bin/env bash
# Rebuild shaders/omacube.frag.qsb from shaders/omacube.frag.
# Needs qsb from qt6-shadertools (Arch: pacman -S qt6-shadertools).
set -euo pipefail
cd "$(dirname "$0")/.."
QSB=/usr/lib/qt6/bin/qsb
[ -x "$QSB" ] || { echo "qsb not found at $QSB (install qt6-shadertools)" >&2; exit 1; }
"$QSB" --glsl "100es,120,150" --hlsl 50 --msl 12 -o shaders/omacube.frag.qsb shaders/omacube.frag
echo "built shaders/omacube.frag.qsb"
