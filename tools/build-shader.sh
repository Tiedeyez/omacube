#!/usr/bin/env bash
# Rebuild shaders/omacube.frag.qsb from shaders/omacube.frag.
# Needs qsb from qt6-shadertools (Arch: pacman -S qt6-shadertools).
#   tools/build-shader.sh [output.qsb] [extra qsb args, e.g. -DOMACUBE_DEBUG=1]
set -euo pipefail
cd "$(dirname "$0")/.."
QSB=/usr/lib/qt6/bin/qsb
[ -x "$QSB" ] || { echo "qsb not found at $QSB (install qt6-shadertools)" >&2; exit 1; }
out=${1:-shaders/omacube.frag.qsb}
shift $(( $# > 0 ? 1 : 0 ))
# GLSL ES 1.00 and 3.00, desktop GLSL 1.20 and 1.50, HLSL, Metal: Qt picks the
# one that matches the running graphics API. The shader is written to the
# ES 1.00 rules, so every variant behaves the same.
"$QSB" --glsl "100es,300es,120,150" --hlsl 50 --msl 12 "$@" -o "$out" shaders/omacube.frag
echo "built $out"
