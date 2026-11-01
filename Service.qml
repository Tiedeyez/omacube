pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland

// Omacube: an animated desktop background of endlessly nested 3x3 puzzle
// cubes, drawn by one fragment shader (shaders/omacube.frag) on a layer-shell
// surface per screen. Every workspace switch twists the view 120 degrees and
// dives one level deeper (or back out, when you go to a lower workspace).
//
// Nothing here reads or writes files, runs processes or touches the network.
// It sits on the "bottom" layer (above the stock wallpaper, below windows)
// with an empty input region, so clicks fall through to the desktop.
Item {
  id: root

  // ---- tuning ------------------------------------------------------------
  // Fraction of screen resolution the shader renders at (then upscaled).
  readonly property real renderScale: 0.4
  // Redraws per second. The shader only redraws when the clock ticks.
  readonly property int fps: 24
  // Seconds to dive one level (x3) deeper.
  readonly property real secondsPerLevel: 16
  // Classic sticker colours: +x, -x, +y, -y, +z, -z
  readonly property var stickers: ["#c41e3a", "#ff5800", "#f4f4f4", "#ffd500", "#009e60", "#0051ba"]
  readonly property color plastic: "#0b0b0d"
  readonly property color voidColor: "#040406"

  // ---- shared clock --------------------------------------------------------
  // time wraps every 6912 s (a multiple of the 18 s move cycle and of the
  // 16 s level) so float precision never degrades; once per wrap the cubes'
  // scramble states and the camera wobble reset.
  property real clock: 0
  readonly property real wrapSeconds: 6912
  property real zoomKick: 0
  property real spinKick: 0
  Behavior on zoomKick { NumberAnimation { duration: 1100; easing.type: Easing.OutBack; easing.overshoot: 1.3 } }
  Behavior on spinKick { NumberAnimation { duration: 1100; easing.type: Easing.OutBack; easing.overshoot: 1.6 } }

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
      root.clock = (root.clock + dt) % root.wrapSeconds
    }
  }

  // ---- workspace twist -----------------------------------------------------
  property int lastWorkspace: -1
  Connections {
    target: Hyprland
    function onFocusedWorkspaceChanged() { root.workspaceMoved() }
  }
  function workspaceMoved() {
    var ws = Hyprland.focusedWorkspace
    if (!ws) return
    var id = ws.id
    if (lastWorkspace !== -1 && id !== lastWorkspace && id > 0 && lastWorkspace > 0) {
      var dir = id > lastWorkspace ? 1 : -1
      zoomKick += dir
      spinKick += dir * 2.0943951   // 120 degrees: the corner's own symmetry
      // keep the kick offsets small so float precision stays exact
      if (Math.abs(zoomKick) > 300) zoomKick = 0
    }
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
        anchors.fill: parent
        layer.enabled: true
        layer.smooth: true
        layer.textureSize: Qt.size(Math.max(2, Math.round(width * root.renderScale)),
                                   Math.max(2, Math.round(height * root.renderScale)))

        ShaderEffect {
          anchors.fill: parent
          fragmentShader: Qt.resolvedUrl("shaders/omacube.frag.qsb")
          property real time: root.clock
          property real zoom: root.clock / root.secondsPerLevel + root.zoomKick
          property real spin: root.spinKick
          property real aspect: width / Math.max(1, height)
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
