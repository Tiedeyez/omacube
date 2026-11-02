pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import "Palette.js" as Palette

// Omacube: an animated desktop background of an endless isometric stack of
// 3x3 puzzle cubes that turn their layers and tumble, drawn flat by one
// fragment shader (shaders/omacube.frag) on a layer-shell surface per screen.
// Every workspace switch rolls the whole stack 120 degrees, the isometric
// view's own symmetry, so the pattern clicks back into line like a cube turn.
// The cubes take their colours from the active Omarchy theme.
//
// It reads two small files, the active theme's colors.toml and theme.name;
// writes nothing, runs no processes and touches no network (DISCLOSURE.md).
// It sits on the "bottom" layer (above the stock wallpaper, below windows)
// with an empty input region, so clicks fall through to the desktop.
Item {
  id: root

  // ---- tuning ------------------------------------------------------------
  // Pixel art: each art pixel is this many screen pixels, drawn with hard
  // edges in the theme's exact colours. 0 = smooth, antialiased rendering at
  // renderScale. Pixel art is also far cheaper: about 1/30 of the pixels.
  readonly property int pixelSize: 4
  // Smooth mode only: fraction of screen resolution the shader renders at.
  readonly property real renderScale: 0.75
  // Redraws per second. The shader only redraws when the clock ticks.
  readonly property int fps: 24

  // ---- colours from the active theme --------------------------------------
  // Palette.js maps the theme's red, orange, foreground (as white), yellow,
  // green and blue onto the stickers (+x, -x, +y, -y, +z, -z), and its
  // background onto the plastic. The Omacube theme sets the classic cube.
  // `omarchy theme set` swaps the new theme in and then writes theme.name,
  // so a change to theme.name means the new colors.toml is ready to read.
  readonly property string currentDir: {
    var home = Quickshell.env("HOME")
    return home ? home + "/.local/state/omarchy/current" : ""
  }
  property var palette: Palette.CLASSIC
  property bool colorsReady: false     // no crossfade for the first load

  function applyColors(text) {
    palette = Palette.fromText(text)
    colorsReady = true
  }

  FileView {
    id: themeColors
    path: root.currentDir ? root.currentDir + "/theme/colors.toml" : ""
    watchChanges: false
    printErrors: false
    onLoaded: root.applyColors(text())
    onLoadFailed: root.applyColors("")
  }
  FileView {
    path: root.currentDir ? root.currentDir + "/theme.name" : ""
    watchChanges: true
    printErrors: false
    onFileChanged: themeColors.reload()
  }

  // ---- one seamless loop ---------------------------------------------------
  // Every cube's cycle lasts 13.3 s * m / 8 for some m in {6,7,8,9,10,12},
  // and 4189.5 s (about 70 min) is a whole number of cycles for every m, so
  // the shader's clock wraps there with nothing changing on screen. The field
  // drifts 1024 lattice steps every 11 of those loops (about 12.8 h), and the
  // shader's cell hash repeats every 1024 cells, so the drift wraps
  // seamlessly too. Short loops keep the 32-bit time in the shader precise.
  readonly property real cubeLoop: 4189.5
  readonly property real driftLoop: 46084.5
  property real clock: 0

  // Net workspace steps; turnPos eases towards it. One step rolls the view
  // 120 degrees (the isometric view's own symmetry) and slides the field
  // half a lattice step. Both wrap with no visible jump: the roll every
  // 3 steps (360 degrees), the slide every 1024 lattice steps.
  property int turns: 0
  property real turnPos: turns
  Behavior on turnPos { NumberAnimation { duration: 1100; easing.type: Easing.OutBack; easing.overshoot: 1.6 } }

  function wrap(x, m) { return ((x % m) + m) % m }
  readonly property real spin: 2.0943951024 * wrap(turnPos, 3)
  readonly property real drift: wrap(clock / driftLoop * 1024 + 0.5 * turnPos, 1024)

  readonly property bool anyVisible: {
    var ws = screenWindows.instances
    for (var i = 0; i < ws.length; i++) {
      if (ws[i] && !ws[i].covered) return true
    }
    return false
  }

  Timer {
    interval: Math.round(1000 / root.fps)
    repeat: true
    running: root.anyVisible
    property double last: Date.now()
    onRunningChanged: last = Date.now()
    onTriggered: {
      var now = Date.now()
      var dt = Math.min((now - last) / 1000, 0.25)
      last = now
      root.clock = (root.clock + dt) % root.driftLoop
    }
  }

  // ---- workspace turn --------------------------------------------------------
  property int lastWorkspace: -1
  Connections {
    target: Hyprland
    function onFocusedWorkspaceChanged() { root.workspaceMoved() }
  }
  function workspaceMoved() {
    var ws = Hyprland.focusedWorkspace
    if (!ws) return
    var id = ws.id
    if (lastWorkspace !== -1 && id !== lastWorkspace && id > 0 && lastWorkspace > 0)
      turns += id > lastWorkspace ? 1 : -1
    lastWorkspace = id
  }
  Component.onCompleted: workspaceMoved()

  // ---- one surface per screen ---------------------------------------------
  Variants {
    id: screenWindows
    model: Quickshell.screens

    PanelWindow {
      id: panel
      required property var modelData
      screen: modelData

      // Stop redrawing while a fullscreen window hides the desktop.
      readonly property var monitor: Hyprland.monitorFor(modelData)
      readonly property bool covered: !!(monitor && monitor.activeWorkspace && monitor.activeWorkspace.hasFullscreen)

      color: root.palette.empty
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "tiedeyez-omacube"
      WlrLayershell.layer: WlrLayer.Bottom
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      mask: Region {}

      Item {
        id: canvas
        // Pixel art needs a whole number of screen pixels per art pixel, so
        // the canvas is sized in art pixels and may overhang the screen edge
        // by less than one art pixel; it stays centred.
        // the window's own scale (1.25 here); the screen object reports a
        // rounded-up value (2) that rendering does not use
        readonly property real dpr: panel.devicePixelRatio || 1
        readonly property bool pixelArt: root.pixelSize > 0
        readonly property int texW: pixelArt ? Math.max(2, Math.ceil(panel.width * dpr / root.pixelSize))
                                             : Math.max(2, Math.round(panel.width * root.renderScale))
        readonly property int texH: pixelArt ? Math.max(2, Math.ceil(panel.height * dpr / root.pixelSize))
                                             : Math.max(2, Math.round(panel.height * root.renderScale))
        width: pixelArt ? texW * root.pixelSize / dpr : panel.width
        height: pixelArt ? texH * root.pixelSize / dpr : panel.height
        anchors.centerIn: parent
        layer.enabled: true
        layer.smooth: !pixelArt                 // nearest-neighbour upscale for pixel art
        layer.textureSize: Qt.size(texW, texH)

        ShaderEffect {
          anchors.fill: parent
          fragmentShader: Qt.resolvedUrl("shaders/omacube.frag.qsb")
          property real time: root.clock % root.cubeLoop
          property real drift: root.drift
          property real spin: root.spin
          property real aspect: width / Math.max(1, height)
          property real texel: 1 / canvas.texH
          property real pixelArt: canvas.pixelArt ? 1 : 0
          property color c0: root.palette.stickers[0]
          property color c1: root.palette.stickers[1]
          property color c2: root.palette.stickers[2]
          property color c3: root.palette.stickers[3]
          property color c4: root.palette.stickers[4]
          property color c5: root.palette.stickers[5]
          property color bodyColor: root.palette.plastic
          property color bgColor: root.palette.empty
          // crossfade to a new theme's colours
          Behavior on c0 { enabled: root.colorsReady; ColorAnimation { duration: 900 } }
          Behavior on c1 { enabled: root.colorsReady; ColorAnimation { duration: 900 } }
          Behavior on c2 { enabled: root.colorsReady; ColorAnimation { duration: 900 } }
          Behavior on c3 { enabled: root.colorsReady; ColorAnimation { duration: 900 } }
          Behavior on c4 { enabled: root.colorsReady; ColorAnimation { duration: 900 } }
          Behavior on c5 { enabled: root.colorsReady; ColorAnimation { duration: 900 } }
          Behavior on bodyColor { enabled: root.colorsReady; ColorAnimation { duration: 900 } }
          Behavior on bgColor { enabled: root.colorsReady; ColorAnimation { duration: 900 } }
        }
      }
    }
  }
}
