#!/usr/bin/env bash
# GPU self-checks: build debug variants of the shader and render them in the
# current Wayland session. Each variant paints a failed check magenta; the
# PNG counter then reports how many failing pixels each frame has.
#   1  the distance estimate never exceeds a brute-force 27-cell distance
#   1x the same check on the previous (unsafe) scheme: expected to FAIL
#   2  the move the geometry animates is the move colour undoes
#   3  march cost: no ray runs out of steps (max grey = most steps used)
#   4  every visible cubie is a rigid copy of one solved cubie
#   6  with nothing turning, no visible face is partly covered by a cube
#      in front of it: no triangles, only whole faces
#   6x the same check on the previous random fill: expected to FAIL
#   7  the word at rest shows only yellow and red on its face (mosaic read right)
#   8  the fast drawing (march every cube in its cell, then add slid-out cubes
#      nearer by lift * sqrt 3) matches marching the slid-out stack directly
#   9  every cell the drawing looks up in the height map holds a cube
#      exactly when the occupancy rule says so
#   9x the same check with the map read one column off: expected to FAIL
#   10 the rest cache: a frame that copies still pixels from the cache is
#      the frame drawn wholly live, but for a few edge pixels next to a
#      moving cube, where the march stops within EPS of the surface at a
#      slightly different point (at most 0.1% of pixels)
#   11 the motion map marks exactly the pixels the per-cell rule does
#   5  both loops are seamless: the picture one cube loop later (time +
#      4189.5 s) and one slide wrap later (3072 cells) is the same picture,
#      while two ordinary frames 1/24 s apart already differ by a few percent
# Frames go to ./frames/selfcheck/ (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."
out=$PWD/frames/selfcheck
rm -rf "$out"; mkdir -p "$out"
times=${SELFCHECK_TIMES:-"2.37 11.9 20.0 40.2 3600.5 46080.7"}
W=${SELFCHECK_W:-1600}; H=${SELFCHECK_H:-900}
mono_pan=${SELFCHECK_MONO_PAN:-286.529}     # 2 sites along: a monument is in frame
mono_times=${SELFCHECK_MONO_TIMES:-"3.0 13.0 50.0 101.6 112.0"}
status=0
for mode in 1 1x 2 3 4 6 6x 7 8 9 9x; do
  case $mode in
    9x) defs=(-DOMACUBE_DEBUG=9 -DOMACUBE_MAP_SHIFT) ;;
    1x) defs=(-DOMACUBE_DEBUG=1 -DOMACUBE_NO_FAR_BOUND) ;;
    6)  defs=(-DOMACUBE_DEBUG=6 -DOMACUBE_STATIC) ;;
    6x) defs=(-DOMACUBE_DEBUG=6 -DOMACUBE_STATIC -DOMACUBE_OLD_FILL) ;;
    *)  defs=(-DOMACUBE_DEBUG=$mode) ;;
  esac
  qsb=$out/mode-$mode.qsb
  tools/build-shader.sh "$qsb" "${defs[@]}" >/dev/null
  for t in $times; do
    dir=$out/mode-$mode-t$t
    dev/preview.sh "$dir" 1 24 "$t" "$W" "$H" "$qsb" >/dev/null
  done
  # framed on a monument (site 2): solve, word, scramble
  for t in $mono_times; do
    dir=$out/mode-$mode-tm$t
    OMACUBE_PAN=$mono_pan dev/preview.sh "$dir" 1 24 "$t" "$W" "$H" "$qsb" >/dev/null
  done
  echo "== self-check $mode"
  if [ "$mode" = 1x ] || [ "$mode" = 6x ] || [ "$mode" = 9x ]; then
    /usr/bin/python3 -I tools/png-stats.py "$out"/mode-$mode-t*/f00000.png || true
  elif [ "$mode" = 8 ]; then
    /usr/bin/python3 -I tools/png-stats.py --allow 1e-5 "$out"/mode-$mode-t*/f00000.png || status=1
  else
    /usr/bin/python3 -I tools/png-stats.py "$out"/mode-$mode-t*/f00000.png || status=1
  fi
done
echo "== self-check 10 and 11"
tools/build-shader.sh "$out/mask-map.qsb" -DOMACUBE_DEBUG=10 >/dev/null
tools/build-shader.sh "$out/mask-rule.qsb" -DOMACUBE_DEBUG=10 -DOMACUBE_MOTION_RULE >/dev/null
tools/build-shader.sh "$out/plain.qsb" >/dev/null
check_rest() {   # name, then env for both renders
  local name=$1; shift
  env "$@" dev/preview.sh "$out/live-$name" 1 24 "$t" "$W" "$H" "$out/plain.qsb" >/dev/null
  env "$@" OMACUBE_REST=1 dev/preview.sh "$out/rest-$name" 1 24 "$t" "$W" "$H" "$out/plain.qsb" >/dev/null
  env "$@" OMACUBE_REST=1 dev/preview.sh "$out/mmap-$name" 1 24 "$t" "$W" "$H" "$out/mask-map.qsb" >/dev/null
  env "$@" OMACUBE_REST=1 dev/preview.sh "$out/mrule-$name" 1 24 "$t" "$W" "$H" "$out/mask-rule.qsb" >/dev/null
  /usr/bin/python3 -I tools/png-stats.py --same "$out/live-$name/f00000.png" "$out/rest-$name/f00000.png" 0.001 || status=1
  /usr/bin/python3 -I tools/png-stats.py --same "$out/mrule-$name/f00000.png" "$out/mmap-$name/f00000.png" || status=1
}
for t in $times; do check_rest "t$t" OMACUBE_PAN=0; done
for t in $mono_times; do check_rest "tm$t" OMACUBE_PAN=$mono_pan; done
echo "== self-check 5"
dev/preview.sh "$out/loop-a" 1 24 2.37 "$W" "$H" >/dev/null
OMACUBE_TIME_OFFSET=4189.5 dev/preview.sh "$out/loop-t" 1 24 2.37 "$W" "$H" >/dev/null
OMACUBE_PAN_OFFSET=13033.3921908 dev/preview.sh "$out/loop-d" 1 24 2.37 "$W" "$H" >/dev/null
dev/preview.sh "$out/loop-c" 1 24 2.4116667 "$W" "$H" >/dev/null
printf "one cube loop later   "; /usr/bin/python3 -I tools/png-stats.py --diff "$out/loop-a/f00000.png" "$out/loop-t/f00000.png"
printf "one slide wrap later   "; /usr/bin/python3 -I tools/png-stats.py --diff "$out/loop-a/f00000.png" "$out/loop-d/f00000.png"
printf "1/24 s later          "; /usr/bin/python3 -I tools/png-stats.py --diff "$out/loop-a/f00000.png" "$out/loop-c/f00000.png"
exit $status
