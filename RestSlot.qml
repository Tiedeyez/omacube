import QtQuick

// Omacube's rest cache, one per workspace a screen keeps (Service.qml).
// One workspace's picture with every cube at rest, drawn by the same shader
// (restPass = 1) over a height map of its own (MATH.md, "The rest cache").
// It has no clock, so it redraws only when it is given another workspace,
// new colours or a new size. Each screen keeps three: its workspace's and
// both neighbours', so a workspace slide copies them too.
Item {
  id: slot
  property int turn: 0
  property var colours: null           // the palette it was drawn with; null: not drawn
  property int size: 3                 // and the size of the wall's cubes (n x n x n)
  property real aspect: 1
  property real texel: 1
  property real pixelArt: 0
  property int texW: 2
  property int texH: 2
  property real fxW: 1
  property real fxH: 1
  property real panPeriod: 1
  property var mosaic
  property url shader
  property real panShift: 0            // dev/preview.qml frames a spot with it
  // Drawing: in `pieces` vertical strips, one per frame, so a neighbour's
  // picture never costs one long frame. done: drawn and complete.
  property int pieces: 1
  property int piece: 0
  property bool drawing: false
  property bool done: false
  property real stripLo: 0
  property real stripHi: 1
  signal drawn()
  function draw(t, c, n, z) {
    turn = t; colours = c; size = z || 3; pieces = n; piece = 0; done = false; drawing = true
    stripLo = 0; stripHi = 1 / n
    cache.scheduleUpdate()
  }
  function invalidate() { done = false; drawing = false }
  Timer { id: nextPiece; interval: 0; onTriggered: cache.scheduleUpdate() }
  // as Service.qml's centred(): wrapped into [-panPeriod/2, panPeriod/2)
  readonly property real pan: (((turn * 30 * aspect + panShift + panPeriod / 2) % panPeriod) + panPeriod) % panPeriod - panPeriod / 2
  readonly property alias cache: cache

  ShaderEffect {
    id: map
    readonly property real halfU: 15 * slot.aspect * 0.47140452
    readonly property real u0: slot.pan * 0.47140452 - halfU
    property vector2d hOrigin: Qt.vector2d(Math.floor(u0) - 5, Math.floor((u0 - 15 * 0.81649658) / 2) - 5)
    property vector2d hSize: Qt.vector2d(Math.ceil(2 * halfU) + 14, Math.ceil(halfU + 15 * 0.81649658) + 14)
    property real mapPass: 1
    property real restPass: 0; property real useRest: 0
    property vector3d restPans; property vector3d restOk; property vector2d strip
    property vector4d wave; property vector4d sizes; property color o0; property color o1; property color o2; property color o3; property color o4; property color o5; property color oBody; property color oBg
    property var rest: slot.mosaic; property var rest1: slot.mosaic; property var rest2: slot.mosaic
    property var motion: slot.mosaic
    property var heights: slot.mosaic
    property var mosaic: slot.mosaic
    width: hSize.x; height: hSize.y
    blending: false
    fragmentShader: slot.shader
    property real time; property real pan; property real aspect; property real texel; property real pixelArt
    property color c0; property color c1; property color c2; property color c3; property color c4; property color c5
    property color bodyColor; property color bgColor
    layer.enabled: true
    layer.smooth: false
    layer.textureSize: Qt.size(hSize.x, hSize.y)
  }
  ShaderEffect {
    id: still
    width: slot.fxW; height: slot.fxH
    blending: false
    fragmentShader: slot.shader
    property var heights: map
    property vector2d hOrigin: map.hOrigin
    property vector2d hSize: map.hSize
    property real mapPass: 0
    property real restPass: 1
    property real useRest: 0
    property vector3d restPans; property vector3d restOk
    property vector4d wave; property color o0; property color o1; property color o2; property color o3; property color o4; property color o5; property color oBody; property color oBg
    property vector2d strip: Qt.vector2d(slot.stripLo, slot.stripHi)
    property var rest: cache             // its own last contents, kept outside the strip
    property var rest1: slot.mosaic; property var rest2: slot.mosaic
    property var motion: slot.mosaic
    property real time: 0
    property vector4d sizes: Qt.vector4d(slot.size, 0, 0, 0)
    property real pan: slot.pan
    property real aspect: slot.aspect
    property var mosaic: slot.mosaic
    property real texel: slot.texel
    property real pixelArt: slot.pixelArt
    property color c0: slot.colours ? slot.colours.stickers[0] : "black"
    property color c1: slot.colours ? slot.colours.stickers[1] : "black"
    property color c2: slot.colours ? slot.colours.stickers[2] : "black"
    property color c3: slot.colours ? slot.colours.stickers[3] : "black"
    property color c4: slot.colours ? slot.colours.stickers[4] : "black"
    property color c5: slot.colours ? slot.colours.stickers[5] : "black"
    property color bodyColor: slot.colours ? slot.colours.plastic : "black"
    property color bgColor: slot.colours ? slot.colours.empty : "black"
  }
  ShaderEffectSource {
    id: cache
    // nothing to draw until the slot is given a workspace
    sourceItem: slot.colours ? still : null
    hideSource: true
    smooth: false
    live: false                          // drawn only by draw(), strip by strip
    recursive: true                      // it reads itself
    textureSize: Qt.size(slot.texW, slot.texH)
    visible: false
    onScheduledUpdateCompleted: {
      if (!slot.drawing) return
      slot.piece++
      if (slot.piece >= slot.pieces) {
        slot.drawing = false
        slot.done = true
        slot.drawn()
      } else {
        slot.stripLo = slot.piece / slot.pieces
        slot.stripHi = (slot.piece + 1) / slot.pieces
        nextPiece.start()
      }
    }
  }
}
