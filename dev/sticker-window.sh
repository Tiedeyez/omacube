#!/usr/bin/env bash
# Open one demo window that looks like a cube sticker: a foot terminal filled
# with a sticker colour, showing a big number. For demos and videos of the
# cube-face tiling. Close it with the usual close-window binding.
#   dev/sticker-window.sh <number> [hex colour without #]
set -euo pipefail
n=${1:?number}
colours=(f4f4f4 ffd500 c41e3a ff5800 009e60 0051ba)
bg=${2:-${colours[$(( (n - 1) % 6 ))]}}
export LANG=C.UTF-8 LC_ALL=C.UTF-8
exec /usr/bin/foot -a omacube-sticker -T "sticker $n" \
  -o "colors-dark.background=$bg" -o "colors-dark.foreground=0b0b0d" -o "colors-dark.alpha=1.0" \
  -o "font=monospace:size=64" -o "cursor.style=beam" -o "cursor.blink=no" \
  /usr/bin/sh -c 'printf "\033[?25l\n  %s" "$1"; exec /usr/bin/sleep infinity' sh "$n"
