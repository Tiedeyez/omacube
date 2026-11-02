#!/usr/bin/env bash
# Rebuild glyphs.png: the Omarchy branding lockup the cubes spell, one glyph
# per 512x512 cell, white on transparent: the Omarchy logo, then O M A R C H Y.
#   logo     U+E900 from Omarchy's own font, /usr/share/fonts/omarchy/omarchy.ttf
#   letters  the Omarchy Font by Mark Cuda (MIT, unofficial), traced from the
#            official wordmark: https://tinker.markcuda.com/omarchy-font/
# A cell spans 3.6 x 3.6 world units on a cube (MATH.md, "Words"): letters fill
# its height, the square logo 5/6 of it, so both stay inside the cube's hexagon.
# Needs ImageMagick 7 (magick).
set -euo pipefail
cd "$(dirname "$0")/.."
LOGO_FONT=${LOGO_FONT:-/usr/share/fonts/omarchy/omarchy.ttf}
WORD_FONT=${WORD_FONT:-$HOME/.local/share/fonts/omarchy-font.ttf}
for f in "$LOGO_FONT" "$WORD_FONT"; do [ -r "$f" ] || { echo "missing font: $f" >&2; exit 1; }; done
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cell() {  # font text height out
  magick -background black -fill white -font "$1" -pointsize 1200 label:"$2" -trim +repage \
    -resize "x$3" -gravity center -background black -extent 512x512 -colorspace Gray "$4"
}
cell "$LOGO_FONT" $'' 426 "$tmp/0.png"
i=1
for l in O M A R C H Y; do cell "$WORD_FONT" "$l" 512 "$tmp/$i.png"; i=$((i + 1)); done
magick "$tmp"/{0,1,2,3,4,5,6,7}.png +append -colorspace Gray -depth 8 -define png:color-type=0 glyphs.png
echo "built glyphs.png ($(magick identify -format '%wx%h' glyphs.png))"
