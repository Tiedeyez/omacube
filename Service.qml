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
// Every workspace switch slides the stack sideways one screen width, with the
// windows. Free cubes slide out of the pile to turn, so no layer ever passes
// through another. Here and there a giant solved cube corner rises out of the
// pile with OMARCHY in a sticker mosaic on its face. The cubes take their
// colours from the active Omarchy theme.
//
// It reads three small files, the active theme's colors.toml and theme.name
// and its own entry in ~/.config/omarchy/shell.json (optional settings),
// plus its own mosaic.png; writes nothing, runs no processes and touches no
// network (DISCLOSURE.md).
// It sits on the "bottom" layer (above the stock wallpaper, below windows)
// with an empty input region, so clicks fall through to the desktop.
Item {
  id: root

  // ---- settings ------------------------------------------------------------
  // The defaults are here. Any of them can be set per machine in the
  // plugin's own entry in ~/.config/omarchy/shell.json, which is watched, so
  // a change applies at once, for example on integrated graphics:
  //   "plugins": [ { "id": "tiedeyez.omacube", "pixelSize": 3, "fps": 20 } ]
  // (`omarchy plugin disable` drops the entry, and its settings with it.)
  //
  // renderWidth, smooth mode (pixelSize 0): the shader renders this many
  // pixels across, then the result is scaled to the screen with mipmapped
  // filtering. 6144 (6K) supersamples a 3440-wide screen about 1.8x.
  // 0 = the screen's resolution.
  readonly property int defaultRenderWidth: 0
  // pixelSize, pixel art instead: each art pixel is this many screen pixels,
  // drawn with hard edges in the theme's exact colours. Far cheaper: 1/9 of
  // the pixels at 3, 1/16 at 4.
  readonly property int defaultPixelSize: 0
  // fps, redraws per second. The shader only redraws when the clock ticks.
  readonly property int defaultFps: 24
  // pauseUnderWindows: hold the animation still while tiled windows fill
  // the workspace (only the gaps between them show it), as it already does
  // under a fullscreen window. Workspace slides still play.
  readonly property bool defaultPauseUnderWindows: true

  property var settings: ({})
  function setting(key, fallback, lo, hi) {
    var v = settings[key]
    return typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback
  }
  readonly property int renderWidth: setting("renderWidth", defaultRenderWidth, 0, 16384)
  readonly property int pixelSize: setting("pixelSize", defaultPixelSize, 0, 32)
  readonly property int fps: setting("fps", defaultFps, 1, 60)
  readonly property bool pauseUnderWindows: typeof settings.pauseUnderWindows === "boolean"
    ? settings.pauseUnderWindows : defaultPauseUnderWindows

  function entryFrom(text) {
    try {
      var config = JSON.parse(text)
      var list = config && Array.isArray(config.plugins) ? config.plugins : []
      for (var i = 0; i < list.length; i++)
        if (list[i] && list[i].id === "tiedeyez.omacube") return list[i]
    } catch (e) {}
    return ({})
  }
  FileView {
    path: {
      var home = Quickshell.env("HOME")
      return home ? home + "/.config/omarchy/shell.json" : ""
    }
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.settings = root.entryFrom(text())
    onLoadFailed: root.settings = ({})
  }

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
  // 4189.5 s (about 70 min) is exactly 420 class windows,
  // so the shader's clock wraps there with nothing changing on screen. A
  // short loop keeps the 32-bit time in the shader precise.
  readonly property real cubeLoop: 4189.5
  property real clock: 0

  // Net workspace steps; turnPos eases towards it. One step slides the field
  // one screen width sideways, with the windows, on the Omacube theme's own
  // workspace curve (cubeClick, 420 ms). The slide wraps every 3072 lattice
  // steps, which maps every cell onto one with the same hash and class, so
  // the wrap shows no jump.
  property int turns: 0
  property real turnPos: turns
  Behavior on turnPos {
    NumberAnimation { duration: 420; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.22, 1.35, 0.36, 1, 1, 1] }
  }
  readonly property real panPeriod: 3072 * 3 * Math.SQRT2

  function wrap(x, m) { return ((x % m) + m) % m }

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
      root.clock = (root.clock + dt) % root.cubeLoop
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
  Component.onCompleted: {
    workspaceMoved()
    if (pauseUnderWindows) Hyprland.refreshToplevels()
  }

  // ---- what covers the desktop -----------------------------------------------
  // Whether a window is tiled or floating comes from Hyprland's client list,
  // which Quickshell reads on request: read it again shortly after any event
  // that can change which windows fill a workspace.
  Timer {
    id: toplevelRefresh
    interval: 60
    onTriggered: Hyprland.refreshToplevels()
  }
  Connections {
    target: Hyprland
    enabled: root.pauseUnderWindows
    function onRawEvent(event) {
      var n = event.name
      if (n === "openwindow" || n === "closewindow" || n === "movewindowv2" || n === "changefloatingmode")
        toplevelRefresh.restart()
    }
  }
  onPauseUnderWindowsChanged: if (pauseUnderWindows) Hyprland.refreshToplevels()

  // ---- one surface per screen ---------------------------------------------
  Variants {
    id: screenWindows
    model: Quickshell.screens

    PanelWindow {
      id: panel
      required property var modelData
      screen: modelData

      // Stop redrawing while a fullscreen window hides the desktop, or tiled
      // windows fill it: the layouts leave only the gaps between them.
      // Floating windows don't count.
      readonly property var monitor: Hyprland.monitorFor(modelData)
      readonly property var workspace: monitor ? monitor.activeWorkspace : null
      readonly property bool tiled: {
        if (!root.pauseUnderWindows || !workspace || !workspace.toplevels) return false
        var list = workspace.toplevels.values
        for (var i = 0; i < list.length; i++) {
          var o = list[i] ? list[i].lastIpcObject : null
          if (o && o.floating === false) return true
        }
        return false
      }
      readonly property bool covered: !!(workspace && workspace.hasFullscreen) || tiled
      // This screen's clock follows the shared one and holds still while the
      // screen is covered, so a covered screen stops redrawing even while
      // another screen keeps the animation going.
      property real shownClock: 0
      Connections {
        target: root
        function onClockChanged() { if (!panel.covered) panel.shownClock = root.clock }
      }

      color: root.palette.empty
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "tiedeyez-omacube"
      WlrLayershell.layer: WlrLayer.Bottom
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      mask: Region {}

      // The stack's height map: a first pass, drawn by the same shader,
      // holding the top cube of every cell column on screen, one texel per
      // column (MATH.md, "The height map"). The picture reads which cells
      // hold a cube from it, instead of hashing up to 20 cells per lookup.
      // It depends only on which columns are on screen, so it redraws only
      // while the stack slides. It sits under the opaque canvas, unseen.
      ShaderEffect {
        id: heightMap
        // columns on screen: ci from u = x * sqrt(2) / 3 across the width,
        // cj = (y * sqrt(6) / 3 + u) / 2, plus a margin of 5 columns that
        // covers every cell a ray looks up beside its own spot
        readonly property real halfU: 15 * fx.aspect * 0.47140452
        readonly property real u0: fx.pan * 0.47140452 - halfU
        property vector2d hOrigin: Qt.vector2d(Math.floor(u0) - 5, Math.floor((u0 - 15 * 0.81649658) / 2) - 5)
        property vector2d hSize: Qt.vector2d(Math.ceil(2 * halfU) + 14, Math.ceil(halfU + 15 * 0.81649658) + 14)
        property real mapPass: 1
        width: hSize.x; height: hSize.y
        blending: false
        fragmentShader: Qt.resolvedUrl("shaders/omacube.frag.qsb")
        property var mosaic: mosaicData
        property var heights: mosaicData        // unused in this pass, like these
        property real time; property real pan; property real aspect; property real texel; property real pixelArt
        property color c0; property color c1; property color c2; property color c3; property color c4; property color c5
        property color bodyColor; property color bgColor
        layer.enabled: true
        layer.smooth: false
        layer.textureSize: Qt.size(hSize.x, hSize.y)
      }

      Item {
        id: canvas
        // Pixel art needs a whole number of screen pixels per art pixel, so
        // the canvas is sized in art pixels and may overhang the screen edge
        // by less than one art pixel; it stays centred.
        // the window's own scale (1.25 here); the screen object reports a
        // rounded-up value (2) that rendering does not use
        readonly property real dpr: panel.devicePixelRatio || 1
        readonly property bool pixelArt: root.pixelSize > 0
        readonly property real screenW: Math.max(1, panel.width * dpr)
        readonly property int texW: pixelArt ? Math.max(2, Math.ceil(screenW / root.pixelSize))
                                             : Math.max(2, root.renderWidth > 0 ? root.renderWidth : Math.round(screenW))
        readonly property int texH: pixelArt ? Math.max(2, Math.ceil(panel.height * dpr / root.pixelSize))
                                             : Math.max(2, Math.round(texW * panel.height / Math.max(1, panel.width)))
        width: pixelArt ? texW * root.pixelSize / dpr : panel.width
        height: pixelArt ? texH * root.pixelSize / dpr : panel.height
        anchors.centerIn: parent
        layer.enabled: true
        layer.smooth: !pixelArt                 // nearest-neighbour upscale for pixel art
        layer.mipmap: !pixelArt && texW > screenW   // clean downscale of a supersampled render
        layer.textureSize: Qt.size(texW, texH)

        ShaderEffect {
          id: fx
          anchors.fill: parent
          fragmentShader: Qt.resolvedUrl("shaders/omacube.frag.qsb")
          property var heights: heightMap
          property vector2d hOrigin: heightMap.hOrigin
          property vector2d hSize: heightMap.hSize
          property real mapPass: 0
          property real time: panel.shownClock % root.cubeLoop
          // one screen width (2 * VIEW * aspect world units) per workspace
          property real pan: root.wrap(root.turnPos * 30 * aspect, root.panPeriod)
          property real aspect: width / Math.max(1, height)
          // the word's 20 cube states, read texel by texel
          property var mosaic: mosaicData
          Image {
            id: mosaicData
            source: Qt.resolvedUrl("mosaic.png")
            visible: false
            smooth: false
          }
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
