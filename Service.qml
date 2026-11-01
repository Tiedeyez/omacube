pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland

// Omacube: an animated desktop background of an endless isometric stack of
// 3x3 puzzle cubes that turn their layers and tumble, drawn flat by one
// fragment shader (shaders/omacube.frag) on a layer-shell surface per screen.
// Every workspace switch rolls the whole stack 120 degrees, the isometric
// view's own symmetry, so the pattern clicks back into line like a cube turn.
//
// Nothing here reads or writes files, runs processes or touches the network.
// It sits on the "bottom" layer (above the stock wallpaper, below windows)
// with an empty input region, so clicks fall through to the desktop.
Item {
  id: root

  // ---- tuning ------------------------------------------------------------
  // Fraction of screen resolution the shader renders at (then upscaled).
  readonly property real renderScale: 0.75
  // Redraws per second. The shader only redraws when the clock ticks.
  readonly property int fps: 24
  // Solved-cube sticker colours: +x, -x, +y, -y, +z, -z. With white up and
  // green in front, red is on the right: the standard colour scheme.
  readonly property var stickers: ["#c41e3a", "#ff5800", "#f4f4f4", "#ffd500", "#009e60", "#0051ba"]
  readonly property color plastic: "#0b0b0d"
  readonly property color voidColor: "#040406"

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

      color: root.voidColor
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "tiedeyez-omacube"
      WlrLayershell.layer: WlrLayer.Bottom
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      mask: Region {}

      Item {
        id: canvas
        anchors.fill: parent
        readonly property int texW: Math.max(2, Math.round(width * root.renderScale))
        readonly property int texH: Math.max(2, Math.round(height * root.renderScale))
        layer.enabled: true
        layer.smooth: true
        layer.textureSize: Qt.size(texW, texH)

        ShaderEffect {
          anchors.fill: parent
          fragmentShader: Qt.resolvedUrl("shaders/omacube.frag.qsb")
          property real time: root.clock % root.cubeLoop
          property real drift: root.drift
          property real spin: root.spin
          property real aspect: width / Math.max(1, height)
          property real texel: 1 / canvas.texH
          property color c0: root.stickers[0]
          property color c1: root.stickers[1]
          property color c2: root.stickers[2]
          property color c3: root.stickers[3]
          property color c4: root.stickers[4]
          property color c5: root.stickers[5]
          property color bodyColor: root.plastic
          property color bgColor: root.voidColor
        }
      }
    }
  }
}
