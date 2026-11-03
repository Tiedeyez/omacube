import QtQuick
import Quickshell
import Quickshell.Wayland
import "egg.js" as Logic

// Omacube's easter egg (MATH.md, "The easter egg"): the cube picked out of
// the wall, floating free over the desktop, yours to turn. No window: a
// clear overlay surface with the cube on it, which takes the keyboard only
// while you play. Esc puts the cube back.
PanelWindow {
  id: egg

  // given by Service.qml
  required property int n                // n x n x n
  required property var startStickers    // its state when picked (egg.js layout)
  required property var colours          // the theme palette
  required property real startX          // where it sits in the wall, and its half size, in pixels
  required property real startY
  required property real startHalf
  signal finished()
  property bool test: false              // dev/egg-test.sh: leave the keyboard alone
  readonly property alias cubeView: view
  readonly property alias sceneView: scene
  function key(letter, prime) { userTurn(Logic.keyMove(n, rot, letter, 1, prime)) }
  function testSolved() { stickers = Logic.solvedState(n); stickerCanvas().requestPaint() }
  function stickerCanvas() { return stateCanvas }

  color: "transparent"
  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.namespace: "tiedeyez-omacube-egg"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.keyboardFocus: test ? WlrKeyboardFocus.None : WlrKeyboardFocus.Exclusive

  // ---- state ------------------------------------------------------------------
  property var stickers: startStickers
  property var q: Logic.isoQuat()                    // orientation, cube -> view
  property var omega: [0, 0, 0]                      // spin, view axis * rad/s
  readonly property var isoQ: Logic.isoQuat()
  readonly property var playQ: Logic.qnorm(Logic.qmul(Logic.quat([0, 1, 0], 0.32), Logic.isoQuat()))
  property real pose: 0                              // 0: in the wall, 1: floating at the centre
  property real zoom: 1
  property real clock: 0
  property string phase: "intro"                     // intro, play, outro
  property var poseFromQ: isoQ
  property var poseToQ: playQ

  // the turn in progress, and the queue
  property var queue: []
  property var current: null                         // {axis, layer, dir, t, dur, record}
  property real turnAngle: 0
  property bool waitingPaint: false
  property var history: []
  property int moves: 0
  property real startedAt: -1
  property string banner: ""
  property real celebrate: 0
  property bool help: true
  // the celebration when it is solved: seconds since, or -1
  property real winT: -1
  property var parts: []                             // confetti
  readonly property real hop: winT >= 0 && winT < 0.7 ? Math.sin(Math.PI * winT / 0.7) * height * 0.07 : 0
  readonly property real popScale: winT >= 0 && winT < 0.5 ? 1 + 0.14 * Math.sin(Math.PI * winT / 0.5) : 1

  readonly property real playHalf: Math.min(width, height) * 0.17 * zoom
  readonly property real half: (startHalf + (playHalf - startHalf) * pose) * popScale
  readonly property real cx: startX + (width / 2 - startX) * pose
  readonly property real cy: startY + (height / 2 - startY) * pose + Math.sin(clock * 1.3) * height * 0.008 * pose - hop
  readonly property var rot: Logic.rows(q)

  // ---- the intro and the outro ------------------------------------------------------
  NumberAnimation on pose {
    id: intro
    from: 0; to: 1; duration: 950; easing.type: Easing.OutBack; easing.overshoot: 1.2
    onFinished: { egg.phase = "play"; helpFade.restart() }
  }
  NumberAnimation {
    id: outro
    target: egg; property: "pose"; to: 0; duration: 750; easing.type: Easing.InOutCubic
    onFinished: egg.finished()
  }
  // intro: from the wall's view to the play view; outro: from wherever you
  // left it back to the wall's view (pose runs 1 -> 0)
  onPoseChanged: if (phase !== "play") q = Logic.slerp(poseFromQ, poseToQ, Math.max(0, Math.min(1, pose)))
  function leave() {
    if (phase === "outro") return
    intro.stop()                                     // Esc during the intro
    phase = "outro"
    omega = [0, 0, 0]
    poseFromQ = isoQ
    poseToQ = q
    outro.from = pose
    outro.restart()
  }

  // ---- turning --------------------------------------------------------------------
  function push(mv, record, dur) {
    var list = queue.slice()
    list.push({ axis: mv.axis, layer: mv.layer, dir: mv.dir, record: record, dur: dur || 0.2 })
    queue = list
  }
  function userTurn(mv) {
    if (!mv || phase !== "play") return
    if (startedAt < 0) startedAt = clock
    push(mv, true)
  }
  function step(dt) {
    clock += dt
    celebrate = Math.max(0, celebrate - dt * 0.6)
    if (winT >= 0) {
      winT += dt
      // confetti: thrown out of the cube, falling, tumbling, fading
      var g = height * 1.7, live = []
      for (var i = 0; i < parts.length; i++) {
        var c = parts[i]
        var vy = c.vy + g * dt
        var o = { x: c.x + c.vx * dt, y: c.y + vy * dt, vx: c.vx * Math.exp(-0.6 * dt), vy: vy, r: c.r + c.vr * dt, vr: c.vr,
                  col: c.col, size: c.size, life: c.life - dt }
        if (o.life > 0 && o.y < height + 40) live.push(o)
      }
      parts = live
      if (winT > 3 && parts.length === 0) winT = -1
    }
    // the turn in progress
    if (current && !waitingPaint) {
      current.t += dt / current.dur
      if (current.t >= 1) {
        turnAngle = current.dir * Math.PI / 2          // looks the same as 0 with the new state
        stickers = Logic.apply(n, stickers, current)
        waitingPaint = true
        stateCanvas.requestPaint()
      } else {
        turnAngle = current.dir * Logic.easeTurn(current.t) * Math.PI / 2
      }
    }
    if (!current && queue.length > 0 && !waitingPaint) {
      var list = queue.slice()
      var mv = list.shift()
      queue = list
      current = { axis: mv.axis, layer: mv.layer, dir: mv.dir, t: 0, dur: mv.dur, record: mv.record }
    }
    // free spin: angular momentum, slowed by a little friction
    var w = Math.sqrt(omega[0] * omega[0] + omega[1] * omega[1] + omega[2] * omega[2])
    if (phase === "play" && !spin.active && w > 1e-3) {
      q = Logic.qnorm(Logic.qmul(Logic.quat(omega, w * dt), q))
      var k = Math.exp(-1.6 * dt)
      omega = [omega[0] * k, omega[1] * k, omega[2] * k]
    }
    // a whole-cube turn from the keyboard
    if (wholeTurn.active) {
      wholeTurn.t = Math.min(1, wholeTurn.t + dt / 0.28)
      q = Logic.slerp(wholeTurn.from, wholeTurn.to, Logic.easeTurn(wholeTurn.t))
      if (wholeTurn.t >= 1) wholeTurn.active = false
    }
  }
  function turnDone() {
    var mv = current
    current = null
    turnAngle = 0
    waitingPaint = false
    if (mv.record) {
      var h = history.slice()
      h.push({ axis: mv.axis, layer: mv.layer, dir: mv.dir })
      history = h
      moves++
      if (Logic.isSolved(n, stickers)) {
        var secs = Math.round(clock - startedAt)
        banner = "Solved!\n" + moves + (moves === 1 ? " move" : " moves") + "  ·  " + Math.floor(secs / 60) + ":" + ("0" + secs % 60).slice(-2)
        win()
      }
    }
  }
  // Solved: it hops, takes a spin that friction slows (the same physics as a
  // fling), pulses gold, and throws confetti in its six colours; a ring of
  // light spreads out from it.
  function win() {
    celebrate = 1
    winT = 0
    wholeTurn.active = false
    omega = [0, 13, 0]
    var list = []
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * Math.PI * 2
      var sp = height * (0.45 + Math.random() * 0.9)
      list.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - height * 0.6,
                  r: Math.random() * 360, vr: (Math.random() - 0.5) * 900,
                  col: colours.stickers[i % 6], size: height * (0.008 + Math.random() * 0.008), life: 1.6 + Math.random() * 1.0 })
    }
    parts = list
    ring.restart()
    bannerFade.restart()
  }
  QtObject {
    id: wholeTurn
    property bool active: false
    property real t: 0
    property var from: null
    property var to: null
  }
  function rotateWhole(axisView, sign) {
    if (phase !== "play") return
    omega = [0, 0, 0]
    var base = wholeTurn.active ? wholeTurn.to : q
    wholeTurn.from = q
    wholeTurn.to = Logic.qnorm(Logic.qmul(Logic.quat(axisView, sign * Math.PI / 2), base))
    wholeTurn.t = 0
    wholeTurn.active = true
  }

  FrameAnimation {
    running: true
    onTriggered: egg.step(Math.min(frameTime, 0.05))
  }

  // ---- the state texture ----------------------------------------------------------
  Canvas {
    id: stateCanvas
    x: -200; y: -200
    width: 102; height: 18
    renderStrategy: Canvas.Immediate
    onPaint: {
      var ctx = getContext("2d")
      ctx.fillStyle = "rgb(0,0,0)"
      ctx.fillRect(0, 0, 102, 18)
      for (var f = 0; f < 6; f++)
        for (var v = 0; v < egg.n; v++)
          for (var u = 0; u < egg.n; u++) {
            var ci = egg.stickers[Logic.index(f, u, v)]
            ctx.fillStyle = "rgb(" + (ci + 1) * 32 + ",0,0)"
            ctx.fillRect(f * 17 + u, 1 + v, 1, 1)
          }
    }
    onPainted: if (egg.waitingPaint) egg.turnDone()
    Component.onCompleted: requestPaint()
  }
  ShaderEffectSource {
    id: stateTex
    sourceItem: stateCanvas
    hideSource: true
    smooth: false
    textureSize: Qt.size(102, 18)
    visible: false
  }

  // ---- the scene --------------------------------------------------------------------
  // (one item, so dev/egg-test.sh can take a picture of it)
  Item {
    id: scene
    anchors.fill: parent
    Rectangle {
      anchors.fill: parent
      color: "black"
      opacity: 0.22 * egg.pose
    }

    ShaderEffect {
      id: view
      readonly property real size: egg.half * 4.4
      width: size; height: size
      x: egg.cx - size / 2; y: egg.cy - size / 2
      fragmentShader: Qt.resolvedUrl("shaders/eggcube.frag.qsb")
      property vector4d r0: Qt.vector4d(egg.rot[0][0], egg.rot[0][1], egg.rot[0][2], 0)
      property vector4d r1: Qt.vector4d(egg.rot[1][0], egg.rot[1][1], egg.rot[1][2], 0)
      property vector4d r2: Qt.vector4d(egg.rot[2][0], egg.rot[2][1], egg.rot[2][2], 0)
      property vector4d turn: egg.current ? Qt.vector4d(egg.current.axis, egg.current.layer, egg.turnAngle, 0) : Qt.vector4d(0, 0, 0, 0)
      readonly property real dpr: egg.devicePixelRatio || 1
      // drawn at twice the resolution and scaled down, for smooth edges, at
      // most 2048 pixels a side; geo.w: one of those pixels, in half sizes
      readonly property real texSide: Math.max(2, Math.min(size * dpr * 2, 2048))
      property vector4d geo: Qt.vector4d(egg.n, egg.half / (size / 2), 1, 2 / texSide)
      property vector4d glow: Qt.vector4d(egg.phase === "intro" ? 1 - 0.85 * egg.pose : (egg.phase === "outro" ? 1 - 0.85 * egg.pose : 0.15), egg.celebrate, 0, 0)
      property color c0: egg.colours.stickers[0]
      property color c1: egg.colours.stickers[1]
      property color c2: egg.colours.stickers[2]
      property color c3: egg.colours.stickers[3]
      property color c4: egg.colours.stickers[4]
      property color c5: egg.colours.stickers[5]
      property color bodyColor: egg.colours.plastic
      property var stickers: stateTex
      layer.enabled: true
      layer.smooth: true
      layer.textureSize: Qt.size(texSide, texSide)
    }

    // ---- the celebration --------------------------------------------------------------
    Rectangle {
      id: ringItem
      property real t: 1
      width: egg.half * (1.6 + 7 * t); height: width
      x: egg.cx - width / 2; y: egg.cy - height / 2
      radius: width / 2
      color: "transparent"
      border.color: "#ffd02e"
      border.width: Math.max(2, egg.half * 0.12 * (1 - t))
      opacity: t < 1 ? 0.9 * (1 - t) : 0
      NumberAnimation on t { id: ring; running: false; from: 0; to: 1; duration: 900; easing.type: Easing.OutCubic }
    }
    Repeater {
      model: egg.parts.length
      Rectangle {
        required property int index
        readonly property var p: egg.parts[index] || ({ x: 0, y: 0, size: 0, r: 0, col: "transparent", life: 0 })
        width: p.size; height: p.size * 0.6
        x: p.x - width / 2; y: p.y - height / 2
        rotation: p.r
        color: p.col
        opacity: Math.min(1, p.life / 0.6)
        antialiasing: true
      }
    }
  }

  // ---- the mouse --------------------------------------------------------------------
  function toCube(mx, my) {
    var k = 1.5 / egg.half
    return [(mx - egg.cx) * k, -(my - egg.cy) * k]
  }
  MouseArea {
    id: mouse
    anchors.fill: parent
    property var hit: null
    property var press: null
    property bool turned: false
    property real lastT: 0
    property var lastP: null
    onPressed: (m) => {
      press = toCubeP(m.x, m.y)
      hit = egg.phase === "play" ? Logic.pick(egg.n, egg.rot, press[0], press[1]) : null
      turned = false
      spin.active = !hit
      lastP = [m.x, m.y]
      lastT = egg.clock
      egg.omega = [0, 0, 0]
    }
    function toCubeP(x, y) { return egg.toCube(x, y) }
    onPositionChanged: (m) => {
      if (hit) {
        if (turned) return
        var p = toCubeP(m.x, m.y)
        var mv = Logic.dragMove(egg.n, egg.rot, hit, p[0] - press[0], p[1] - press[1])
        if (mv) { turned = true; egg.userTurn(mv) }
        return
      }
      if (!spin.active || egg.phase !== "play") return
      var dx = m.x - lastP[0], dy = m.y - lastP[1]
      var d = Math.sqrt(dx * dx + dy * dy)
      if (d < 0.5) return
      var ang = d / egg.half * 0.9
      var axis = [dy / d, dx / d, 0]
      egg.q = Logic.qnorm(Logic.qmul(Logic.quat(axis, ang), egg.q))
      var dt = Math.max(egg.clock - lastT, 1 / 120)
      var w = Math.min(ang / dt, 25)                   // at most 4 turns a second
      egg.omega = [axis[0] * w, axis[1] * w, 0]
      lastP = [m.x, m.y]
      lastT = egg.clock
    }
    onReleased: {
      // a fling keeps spinning; a slow release stops
      if (spin.active && egg.clock - lastT > 0.08) egg.omega = [0, 0, 0]
      spin.active = false
      hit = null
    }
    onWheel: (w) => { egg.zoom = Math.max(0.55, Math.min(1.7, egg.zoom * Math.pow(1.1, w.angleDelta.y / 120))) }
  }
  QtObject { id: spin; property bool active: false }

  // ---- the keyboard -------------------------------------------------------------------
  Item {
    id: keys
    focus: true
    property int depth: 1
    Timer { id: depthReset; interval: 1500; onTriggered: keys.depth = 1 }
    Keys.onPressed: (e) => {
      var shift = (e.modifiers & Qt.ShiftModifier) !== 0
      var ctrl = (e.modifiers & Qt.ControlModifier) !== 0
      if (e.key === Qt.Key_Escape) { egg.leave(); e.accepted = true; return }
      if (egg.phase !== "play") return
      var letters = { [Qt.Key_R]: "R", [Qt.Key_L]: "L", [Qt.Key_U]: "U", [Qt.Key_D]: "D", [Qt.Key_F]: "F", [Qt.Key_B]: "B",
                      [Qt.Key_M]: "M", [Qt.Key_E]: "E", [Qt.Key_S]: "S" }
      if (e.key >= Qt.Key_1 && e.key <= Qt.Key_9) { depth = e.key - Qt.Key_0; depthReset.restart() }
      else if (ctrl && e.key === Qt.Key_Z || e.key === Qt.Key_Backspace) {
        if (egg.history.length > 0) {
          var h = egg.history.slice()
          var last = h.pop()
          egg.history = h
          egg.moves = Math.max(0, egg.moves - 1)
          egg.push(Logic.inverse(last), false)
        }
      }
      else if (letters[e.key] !== undefined) {
        egg.userTurn(Logic.keyMove(egg.n, egg.rot, letters[e.key], depth, shift))
        depth = 1
      }
      else if (e.key === Qt.Key_X) egg.rotateWhole([1, 0, 0], shift ? 1 : -1)
      else if (e.key === Qt.Key_Y) egg.rotateWhole([0, 1, 0], shift ? 1 : -1)
      else if (e.key === Qt.Key_Z) egg.rotateWhole([0, 0, 1], shift ? 1 : -1)
      else if (e.key === Qt.Key_Left) egg.rotateWhole([0, 1, 0], -1)
      else if (e.key === Qt.Key_Right) egg.rotateWhole([0, 1, 0], 1)
      else if (e.key === Qt.Key_Up) egg.rotateWhole([1, 0, 0], -1)
      else if (e.key === Qt.Key_Down) egg.rotateWhole([1, 0, 0], 1)
      else if (e.key === Qt.Key_Space) {
        var list = Logic.scramble(egg.n, 14 + 2 * egg.n)
        for (var i = 0; i < list.length; i++) egg.push(list[i], false, 0.07)
        egg.history = []
        egg.moves = 0
        egg.startedAt = -1
      }
      else if (e.key === Qt.Key_H || e.key === Qt.Key_Question) { egg.help = !egg.help; helpFade.stop(); hintBox.opacity = egg.help ? 1 : 0 }
      else return
      e.accepted = true
    }
  }

  // ---- words ----------------------------------------------------------------------------
  Rectangle {
    id: hintBox
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    anchors.bottomMargin: parent.height * 0.06
    width: hint.implicitWidth + 36; height: hint.implicitHeight + 20
    radius: height / 2
    color: Qt.rgba(0, 0, 0, 0.55)
    opacity: 0
    visible: egg.phase === "play"
    Text {
      id: hint
      anchors.centerIn: parent
      color: "white"
      font.pixelSize: Math.max(13, egg.height * 0.016)
      horizontalAlignment: Text.AlignHCenter
      text: egg.help
        ? "Drag a sticker to turn its layer  ·  drag around the cube to spin it  ·  scroll to zoom\n"
          + "R L U D F B turn faces (Shift reverses, 2-9 first for deeper layers" + (egg.n % 2 ? ", M E S slices" : "") + ")  ·  arrows or X Y Z turn the cube\n"
          + "Space scrambles  ·  Ctrl+Z undoes  ·  H hides this  ·  Esc puts it back"
        : "H for help  ·  Esc puts it back"
    }
    Behavior on opacity { NumberAnimation { duration: 400 } }
  }
  Timer {
    id: helpFade
    interval: 9000
    onTriggered: { egg.help = false; hintBox.opacity = 0.75 }
    onRunningChanged: if (running) hintBox.opacity = 1
  }
  Text {
    id: bannerText
    anchors.horizontalCenter: parent.horizontalCenter
    y: parent.height * 0.1
    text: egg.banner
    color: "#ffd02e"
    font.pixelSize: Math.max(22, egg.height * 0.04)
    font.bold: true
    horizontalAlignment: Text.AlignHCenter
    lineHeight: 1.1
    style: Text.Outline
    styleColor: Qt.rgba(0, 0, 0, 0.6)
    opacity: 0
    Behavior on opacity { NumberAnimation { duration: 500 } }
  }
  Timer {
    id: bannerFade
    interval: 5000
    onRunningChanged: if (running) bannerText.opacity = 1
    onTriggered: bannerText.opacity = 0
  }
}
