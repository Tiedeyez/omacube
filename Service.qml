pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import "Palette.js" as Palette

// Omacube: an animated desktop background of an endless isometric stack of
// puzzle cubes (3x3x3, and every 2.5 minutes another size up to 17x17x17)
// that turn their layers and tumble, drawn flat by one
// fragment shader (shaders/omacube.frag) on a layer-shell surface per screen.
// Every workspace switch slides the stack sideways one screen width, with the
// windows. Free cubes slide out of the pile to turn, so no layer ever passes
// through another. Here and there a giant solved cube corner rises out of the
// pile with OMARCHY in a sticker mosaic on its face. The cubes take their
// colours from the active Omarchy theme.
//
// It reads three small files, the active theme's colors.toml and theme.name
// and its own entry in ~/.config/omarchy/shell.json (optional settings),
// plus its own mosaic.png, and asks Hyprland whether each window is floating
// (for pauseUnderWindows); writes nothing, runs no processes and touches no
// network (DISCLOSURE.md).
// It sits on the "bottom" layer (above the stock wallpaper, below windows).
// Clicks fall through to the desktop, except on a small square at the centre
// of the screen: a double-click there starts the easter egg (Egg.qml), which
// takes the keyboard only while you play.
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
  // cubeSizes: every 2.5 minutes the wall's cubes change size, between
  // 3 x 3 x 3 and 17 x 17 x 17, in a wave. false: always 3 x 3 x 3.
  readonly property bool defaultCubeSizes: true
  // easterEgg: double-click the cube at the centre of the screen to take it
  // out of the wall and play with it. false: the background takes no clicks.
  readonly property bool defaultEasterEgg: true

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
  readonly property bool cubeSizes: typeof settings.cubeSizes === "boolean"
    ? settings.cubeSizes : defaultCubeSizes
  readonly property bool easterEgg: typeof settings.easterEgg === "boolean"
    ? settings.easterEgg : defaultEasterEgg

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
  property bool colorsReady: false     // no theme wave for the first load

  // A theme change after the first load plays the theme wave on every screen.
  // The old palette is handed over in a property: caches are matched to a
  // palette by identity, and a signal argument would arrive as a copy.
  property var previousPalette: null
  signal themeSwapped()
  function applyColors(text) {
    var wave = colorsReady
    previousPalette = palette
    palette = Palette.fromText(text)
    colorsReady = true
    if (wave) themeSwapped()
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

  // ---- cube sizes ----------------------------------------------------------
  // The wall's cubes share one size, n x n x n, which changes every 15 class
  // windows (149.625 s): 28 sizes make exactly one loop, so the loop stays
  // seamless. The order is shuffled, always a visible step, and covers every
  // size from 3 to 17 (MATH.md, "Cube sizes").
  readonly property var sizeTable: [3, 6, 4, 9, 5, 12, 7, 17, 10, 3, 8, 14, 6, 11,
                                    4, 15, 9, 13, 5, 16, 7, 12, 3, 10, 6, 13, 8, 5]
  readonly property real sizeEpoch: cubeLoop / sizeTable.length
  readonly property int cubeN: cubeSizes ? sizeTable[Math.floor(clock / sizeEpoch) % sizeTable.length] : 3
  property int previousSize: 3
  property int lastSize: 3
  signal sizeSwapped()
  onCubeNChanged: { previousSize = lastSize; lastSize = cubeN; sizeSwapped() }

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
  // pan wraps into [-m/2, m/2): near turn 0, either way, world coordinates
  // stay small and float32 keeps sticker edges exact
  function centred(x, m) { return wrap(x + m / 2, m) - m / 2 }

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
    lastSize = cubeN
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

  // ---- the easter egg ---------------------------------------------------------
  // (MATH.md, "The easter egg") Double-click the cube at the centre of the
  // screen: it glows yellow, lifts out of the wall, leaving its hole, and
  // floats to the middle of the screen, starting from the state it was in,
  // yours to turn (Egg.qml). Esc puts it back.
  property var egg: null              // {cid, n, stickers, panel, x, y, half}
  property real eggGlow: 0
  property bool eggHole: false
  property bool eggOpen: false
  // for dev/egg-test.sh: take no keyboard, and a way in without a mouse
  property bool eggTest: false
  readonly property alias eggItem: eggLoader.item
  function debugEgg() {
    var p = screenWindows.instances[0]
    if (p) p.eggPick(p.width / 2, p.height / 2)
  }
  function startEgg(info) {
    if (egg) return
    egg = info
    eggIntro.restart()
  }
  SequentialAnimation {
    id: eggIntro
    NumberAnimation { target: root; property: "eggGlow"; from: 0; to: 1; duration: 450; easing.type: Easing.OutCubic }
    PauseAnimation { duration: 250 }
    ScriptAction { script: { root.eggHole = true; root.eggOpen = true; root.eggGlow = 0 } }
  }
  SequentialAnimation {
    id: eggOutro
    ScriptAction { script: { root.eggOpen = false; root.eggHole = false; root.eggGlow = 1 } }
    NumberAnimation { target: root; property: "eggGlow"; to: 0; duration: 700; easing.type: Easing.InCubic }
    ScriptAction { script: root.egg = null }
  }
  LazyLoader {
    id: eggLoader
    active: root.eggOpen && root.egg !== null
    Egg {
      test: root.eggTest
      screen: root.egg.panel.screen
      n: root.egg.n
      startStickers: root.egg.stickers
      colours: root.palette
      startX: root.egg.x
      startY: root.egg.y
      startHalf: root.egg.half
      onFinished: eggOutro.restart()
    }
  }

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
      // Clicks fall through to the desktop, except on a small square at the
      // centre while the easter egg is on: a double-click there picks out
      // the cube under the pointer.
      mask: Region { item: eggTarget }
      Item {
        id: eggTarget
        anchors.centerIn: parent
        width: root.easterEgg && !root.egg && !panel.covered ? Math.round(panel.height * 0.2) : 0
        height: width
        MouseArea {
          anchors.fill: parent
          onDoubleClicked: (m) => panel.eggPick(eggTarget.x + m.x, eggTarget.y + m.y)
        }
      }
      // The pick pass: one ray, through the point picked, and what it hits:
      // the cube's cell, size and every sticker (omacube.frag, mapPass 3),
      // read back through a canvas.
      property var pickGrab: null
      property vector2d pickAt: Qt.vector2d(0.5, 0.5)
      function eggPick(px, py) {
        pickAt = Qt.vector2d((px - canvas.x) / canvas.width, (py - canvas.y) / canvas.height)
        pickFx.visible = true
        pickFx.grabToImage(function (r) {
          pickFx.visible = false
          panel.pickGrab = r
          pickImage.source = r.url
        }, Qt.size(102, 18))
      }
      Image {
        id: pickImage
        width: 102; height: 18
        visible: false
        smooth: false
        cache: false
        onStatusChanged: if (status === Image.Ready && panel.pickGrab) pickCanvas.requestPaint()
      }
      Canvas {
        id: pickCanvas
        width: 102; height: 18
        renderStrategy: Canvas.Immediate
        onPaint: {
          if (!panel.pickGrab) return
          var ctx = getContext("2d")
          ctx.drawImage(pickImage, 0, 0)
          var d = ctx.getImageData(0, 0, 102, 18).data
          panel.pickGrab = null
          pickImage.source = ""
          panel.eggRead(d)
        }
      }
      function eggRead(d) {
        function px(x, y, c) { return d[(y * 102 + x) * 4 + c] }
        if (px(2, 0, 2) < 1) return                      // the ray hit nothing
        var cid = [px(0, 0, 0) * 256 + px(0, 0, 1) - 32768, px(0, 0, 2) * 256 + px(1, 0, 0) - 32768, px(1, 0, 1) * 256 + px(1, 0, 2) - 32768]
        var n = px(2, 0, 0)
        if (n < 3 || n > 17) return
        var st = []
        for (var i = 0; i < 6 * 17 * 17; i++) st.push(-1)
        for (var f = 0; f < 6; f++)
          for (var v = 0; v < n; v++)
            for (var u = 0; u < n; u++)
              st[f * 289 + v * 17 + u] = Math.round(px(f * 17 + u, 1 + v, 0) / 32) - 1
        // where the cube sits on screen: its centre's spot, as the shader's camera
        var w = [cid[0] * 3, cid[1] * 3, cid[2] * 3]
        var sx = (w[0] - w[2]) * 0.70710678 - fx.pan
        var sy = -0.40824829 * w[0] + 0.81649658 * w[1] - 0.40824829 * w[2]
        var tx = sx / (30 * fx.aspect) + 0.5, ty = 0.5 - sy / 30
        root.startEgg({ cid: cid, n: n, stickers: st, panel: panel,
                        x: canvas.x + tx * canvas.width, y: canvas.y + ty * canvas.height,
                        half: canvas.height * 1.5 / 30 })
      }
      readonly property bool eggHere: root.egg !== null && root.egg.panel === panel
      ShaderEffect {
        id: pickFx
        visible: false
        width: 102; height: 18
        fragmentShader: fx.fragmentShader
        property real mapPass: 3
        property real restPass: 0
        property real useRest: 0
        property var heights: heightMap
        property vector2d hOrigin: heightMap.hOrigin
        property vector2d hSize: heightMap.hSize
        property var rest: mosaicData; property var rest1: mosaicData; property var rest2: mosaicData
        property var motion: motionMap
        property var mosaic: mosaicData
        property vector3d restPans; property vector3d restOk; property vector2d strip
        property real time: fx.time
        property real pan: fx.pan
        property real aspect: fx.aspect
        property real texel: fx.texel
        property real pixelArt: fx.pixelArt
        property color c0: fx.c0; property color c1: fx.c1; property color c2: fx.c2
        property color c3: fx.c3; property color c4: fx.c4; property color c5: fx.c5
        property color bodyColor: fx.bodyColor; property color bgColor: fx.bgColor
        property vector4d wave; property vector4d sizes: fx.sizes
        property color o0; property color o1; property color o2; property color o3; property color o4; property color o5; property color oBody; property color oBg
        property vector4d egg
        property vector4d eggFx: Qt.vector4d(0, 0, panel.pickAt.x, panel.pickAt.y)
      }

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
        property real restPass: 0; property real useRest: 0
        property vector3d restPans; property vector3d restOk; property vector2d strip
        property vector4d wave; property vector4d sizes; property color o0; property color o1; property color o2; property color o3; property color o4; property color o5; property color oBody; property color oBg
        property vector4d egg; property vector4d eggFx
        property var rest: mosaicData; property var rest1: mosaicData; property var rest2: mosaicData
        property var motion: mosaicData
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

      // The motion map: one texel per cell column, as the height map, set where
      // a cube in that column is mid-burst. Redrawn every frame (it is tiny),
      // it tells the picture where it must ray-march instead of copying the
      // rest cache.
      ShaderEffect {
        id: motionMap
        property vector2d hOrigin: heightMap.hOrigin
        property vector2d hSize: heightMap.hSize
        property real mapPass: 2
        property real restPass: 0; property real useRest: 0
        property vector3d restPans; property vector3d restOk; property vector2d strip
        property vector4d wave; property vector4d sizes; property color o0; property color o1; property color o2; property color o3; property color o4; property color o5; property color oBody; property color oBg
        property vector4d egg; property vector4d eggFx
        property var rest1: mosaicData; property var rest2: mosaicData
        width: hSize.x; height: hSize.y
        blending: false
        fragmentShader: heightMap.fragmentShader
        property var mosaic: mosaicData
        property var heights: heightMap
        property var rest: mosaicData            // unused in this pass, like these
        property var motion: mosaicData
        property real time: fx.time
        property real pan; property real aspect; property real texel; property real pixelArt
        property color c0; property color c1; property color c2; property color c3; property color c4; property color c5
        property color bodyColor; property color bgColor
        layer.enabled: true
        layer.smooth: false
        layer.textureSize: Qt.size(hSize.x, hSize.y)
      }

      // The rest caches (RestSlot above). Most of the screen is still at any
      // moment (cubes take turns to move), so the picture copies those
      // pixels from a cache and ray-marches only where a cube is mid-burst or
      // the word is out (MATH.md, "The rest cache"). The three caches hold
      // this workspace and both neighbours, so a slide copies them too,
      // shifted (MATH.md, "Slides from the cache"). After a slide settles,
      // the one missing neighbour is drawn; after a theme change, all three,
      // one at a time.
      readonly property bool sliding: root.turnPos !== root.turns
      readonly property var slots: [slotA, slotB, slotC]
      // 1: drawn as the screen shows it now (theme and size); 2: as it was
      // before the wave that is running
      function slotOk(s) {
        if (!s.done) return 0
        if (s.colours === showPalette && s.size === showSize) return 1
        return waving && s.colours === fromPalette && s.size === fromSize ? 2 : 0
      }
      function restPlan() {
        if (sliding || waving) return
        for (var k = 0; k < 3; k++) if (slots[k].drawing) return   // one at a time
        var want = [root.turns, root.turns + 1, root.turns - 1]
        for (var i = 0; i < want.length; i++) {
          var held = false
          for (var j = 0; j < 3; j++) if (slots[j].turn === want[i] && slotOk(slots[j]) === 1) held = true
          if (held) continue
          var pick = null
          for (j = 0; j < 3 && !pick; j++) if (slotOk(slots[j]) !== 1) pick = slots[j]
          for (j = 0; j < 3 && !pick; j++) if (want.indexOf(slots[j].turn) < 0) pick = slots[j]
          // this workspace's picture at once, a neighbour's a strip a frame
          pick.draw(want[i], showPalette, i === 0 ? 1 : 8, showSize)
          return
        }
      }
      Timer { id: restStagger; interval: 100; onTriggered: panel.restPlan() }
      function restReset() {
        for (var k = 0; k < 3; k++) slots[k].invalidate()
        restSettle.restart()
      }
      Connections {
        target: canvas
        function onTexWChanged() { panel.restReset() }
        function onTexHChanged() { panel.restReset() }
        function onPixelArtChanged() { panel.restReset() }
      }
      Timer { id: restSettle; interval: 150; running: true; onTriggered: panel.restPlan() }
      onSlidingChanged: if (!sliding) restSettle.restart()

      // The theme and size waves (MATH.md, "The theme wave", "Cube sizes").
      // This workspace's picture is drawn in the new state first, a strip a
      // frame, while the screen still copies the old one; then a front
      // sweeps across in 1.8 s: stickers flip over to a new theme, cubes
      // shrink away and grow back at a new size. Ahead of the front the old
      // picture is copied, behind it the new one, and only a band around the
      // front is drawn live. A change that comes during a wave waits for it.
      // Cubes never get so small that a sticker is under about 4 pixels.
      function fitSize(n) { return Math.max(3, Math.min(n, Math.floor(canvas.texH / 40))) }
      property var fromPalette: null
      property int fromSize: 3
      property var toPalette: null        // null: no wave
      property int toSize: 3
      readonly property bool waving: toPalette !== null
      readonly property var showPalette: waving ? toPalette : root.palette
      readonly property int showSize: waving ? toSize : fitSize(root.cubeN)
      property real waveT: 0
      Connections {
        target: root
        function onThemeSwapped() { if (!panel.waving) panel.transition(root.previousPalette, panel.fitSize(root.cubeN)) }
        function onSizeSwapped() { if (!panel.waving) panel.transition(root.palette, panel.fitSize(root.previousSize)) }
      }
      function transition(prevPalette, prevSize) {
        var nextSize = fitSize(root.cubeN)
        if (prevPalette === root.palette && prevSize === nextSize) return
        if (covered) { restSettle.restart(); return }    // nothing to see: just redraw
        fromPalette = prevPalette; fromSize = prevSize
        toSize = nextSize; toPalette = root.palette
        waveT = 0
        for (var k = 0; k < 3; k++)
          if (slots[k].turn === root.turns && slotOk(slots[k]) === 1) { waveAnim.start(); return }
        // draw it in a slot that is not holding this workspace's old picture
        var pick = null
        for (k = 0; k < 3 && !pick; k++) if (!(slots[k].turn === root.turns && slotOk(slots[k]) === 2)) pick = slots[k]
        if (!pick) pick = slots[0]
        pick.draw(root.turns, toPalette, 8, toSize)
      }
      function slotDrawn() {
        if (waving && !waveAnim.running) {
          for (var k = 0; k < 3; k++)
            if (slots[k].turn === root.turns && slotOk(slots[k]) === 1) { waveAnim.start(); return }
          return
        }
        restStagger.restart()
      }
      NumberAnimation {
        id: waveAnim
        target: panel; property: "waveT"; from: 0; to: 1
        duration: 1800; easing.type: Easing.InOutSine
        onFinished: {
          var shownPalette = panel.toPalette, shownSize = panel.toSize
          panel.toPalette = null
          panel.waveT = 0
          // a change that came during the wave plays now
          if (root.palette !== shownPalette || panel.fitSize(root.cubeN) !== shownSize) panel.transition(shownPalette, shownSize)
          else restSettle.restart()
        }
      }
      RestSlot { id: slotA; onDrawn: panel.slotDrawn(); aspect: fx.aspect; texel: fx.texel; pixelArt: fx.pixelArt; texW: canvas.texW; texH: canvas.texH; fxW: canvas.width; fxH: canvas.height; panPeriod: root.panPeriod; mosaic: mosaicData; shader: fx.fragmentShader }
      RestSlot { id: slotB; onDrawn: panel.slotDrawn(); aspect: fx.aspect; texel: fx.texel; pixelArt: fx.pixelArt; texW: canvas.texW; texH: canvas.texH; fxW: canvas.width; fxH: canvas.height; panPeriod: root.panPeriod; mosaic: mosaicData; shader: fx.fragmentShader }
      RestSlot { id: slotC; onDrawn: panel.slotDrawn(); aspect: fx.aspect; texel: fx.texel; pixelArt: fx.pixelArt; texW: canvas.texW; texH: canvas.texH; fxW: canvas.width; fxH: canvas.height; panPeriod: root.panPeriod; mosaic: mosaicData; shader: fx.fragmentShader }

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
          property real restPass: 0
          property vector3d restOk: Qt.vector3d(panel.slotOk(slotA), panel.slotOk(slotB), panel.slotOk(slotC))
          property real useRest: restOk.x + restOk.y + restOk.z > 0 ? 1 : 0
          property vector3d restPans: Qt.vector3d(slotA.pan, slotB.pan, slotC.pan)
          property vector2d strip           // used by the rest pass only
          property var rest: slotA.cache
          property var rest1: slotB.cache
          property var rest2: slotC.cache
          property var motion: motionMap
          property real time: panel.shownClock % root.cubeLoop
          // one screen width (2 * VIEW * aspect world units) per workspace
          property real pan: root.centred(root.turnPos * 30 * aspect, root.panPeriod)
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
          property color c0: panel.showPalette.stickers[0]
          property color c1: panel.showPalette.stickers[1]
          property color c2: panel.showPalette.stickers[2]
          property color c3: panel.showPalette.stickers[3]
          property color c4: panel.showPalette.stickers[4]
          property color c5: panel.showPalette.stickers[5]
          property color bodyColor: panel.showPalette.plastic
          property color bgColor: panel.showPalette.empty
          // the theme wave: its progress, and the theme it is replacing
          property vector4d wave: Qt.vector4d(panel.waveT, panel.waving ? 1 : 0, panel.waving && panel.fromSize !== panel.toSize ? 1 : 0, 0)
          property vector4d sizes: Qt.vector4d(panel.showSize, panel.waving ? panel.fromSize : panel.showSize, 0, 0)
          // the easter egg's cube: its glow, and its hole once it has left
          property vector4d egg: panel.eggHere ? Qt.vector4d(root.egg.cid[0], root.egg.cid[1], root.egg.cid[2], 1) : Qt.vector4d(0, 0, 0, 0)
          property vector4d eggFx: Qt.vector4d(panel.eggHere ? root.eggGlow : 0, panel.eggHere && root.eggHole ? 1 : 0, 0, 0)
          readonly property var old: panel.waving ? panel.fromPalette : panel.showPalette
          property color o0: old.stickers[0]
          property color o1: old.stickers[1]
          property color o2: old.stickers[2]
          property color o3: old.stickers[3]
          property color o4: old.stickers[4]
          property color o5: old.stickers[5]
          property color oBody: old.plastic
          property color oBg: old.empty
        }
      }
    }
  }
}
