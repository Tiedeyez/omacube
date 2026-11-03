#!/usr/bin/env bash
# Opens the easter egg without a mouse and without taking the keyboard, turns
# a few faces, and saves what the overlay shows, for a look by eye.
#   dev/egg-test.sh [outdir]
set -euo pipefail
cd "$(dirname "$0")/.."
out=${1:-$PWD/frames/egg}; mkdir -p "$out"
stage=$(mktemp -d "$PWD/frames/.egg.XXXXXX")
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/shaders"
cp Service.qml RestSlot.qml Egg.qml egg.js Palette.js mosaic.png "$stage/"
cp shaders/omacube.frag.qsb shaders/eggcube.frag.qsb "$stage/shaders/"
cat > "$stage/shell.qml" <<QML
import Quickshell
import QtQuick
ShellRoot {
  Service { id: s; eggTest: true }
  property int k: 0
  function shot(name, whole) { if (s.eggItem) (whole ? s.eggItem.sceneView : s.eggItem.cubeView).grabToImage(function (r) { r.saveToFile("$out/" + name + ".png") }) }
  Timer {
    interval: 500; repeat: true; running: true
    onTriggered: {
      k++
      if (k === 30) s.debugEgg()                       // 15 s in: past the first shader compile
      if (k === 31) shot("1-glow-overlay-early")
      if (k === 34) shot("2-floating")
      if (k === 35) { s.eggItem.key("R", false) }
      if (k === 35) { s.eggItem.key("U", false) }
      if (k === 37) shot("3-after-R-U")
      if (k === 38) { s.eggItem.key("U", true); s.eggItem.key("R", true) }
      if (k === 40) { shot("4-undone"); console.warn("EGGTEST solved", s.eggItem.moves, s.eggItem.banner) }
      if (k === 41) { s.eggItem.testSolved() }
      if (k === 42) { s.eggItem.key("F", false) }
      if (k === 43) { s.eggItem.key("F", true) }
      if (k === 44) shot("5-solved-burst", true)
      if (k === 45) shot("6-solved-later", true)
      if (k === 46) console.warn("EGGTEST banner", JSON.stringify(s.eggItem.banner), "moves", s.eggItem.moves)
      if (k === 50) s.eggItem.leave()
      if (k === 55) console.warn("EGGTEST egg", s.egg === null ? "closed" : "open")
      // again, and Esc during the intro
      if (k === 56) s.debugEgg()
      if (k === 58) { console.warn("EGGTEST second", s.eggItem ? s.eggItem.phase : "none"); if (s.eggItem) s.eggItem.leave() }
      if (k === 63) { console.warn("EGGTEST egg after early Esc", s.egg === null ? "closed" : "open"); Qt.quit() }
    }
  }
}
QML
/usr/bin/timeout 80 /usr/bin/qs -p "$stage/shell.qml" > "$out/log.txt" 2>&1 || true
grep -E "EGGTEST|TypeError|ReferenceError|rror|matching property|Cannot|WARN" "$out/log.txt" | grep -v portal | head -20 || true
ls "$out"
