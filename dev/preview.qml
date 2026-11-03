// Development preview for dev/preview.sh and dev/selfcheck.sh (which run it
// from a staging folder next to a copy of Palette.js): renders the
// shader at a fixed size on a click-through bottom-layer surface and saves
// numbered PNG frames. Nothing here is part of the running plugin.
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "Palette.js" as Palette

ShellRoot {
    id: root
    readonly property string outDir: Quickshell.env("OMACUBE_OUT")
    readonly property int frames: parseInt(Quickshell.env("OMACUBE_FRAMES") || "1")
    readonly property real fps: parseFloat(Quickshell.env("OMACUBE_FPS") || "24")
    readonly property real t0: parseFloat(Quickshell.env("OMACUBE_T0") || "3")
    readonly property real turns: parseFloat(Quickshell.env("OMACUBE_TURNS") || "0")
    // added after wrapping, to test that the scene is periodic: one cube
    // loop (4189.5 s) or one 3072-step slide (3072 * 3 sqrt 2 units) later
    // must look the same. OMACUBE_PAN also moves the camera, to frame a spot.
    readonly property real timeOffset: parseFloat(Quickshell.env("OMACUBE_TIME_OFFSET") || "0")
    readonly property real panOffset: parseFloat(Quickshell.env("OMACUBE_PAN_OFFSET") || "0")
        + parseFloat(Quickshell.env("OMACUBE_PAN") || "0")
    readonly property int w: parseInt(Quickshell.env("OMACUBE_W") || "1920")
    readonly property int h: parseInt(Quickshell.env("OMACUBE_H") || "1080")
    property int frame: 0
    // OMACUBE_THEME: a theme's colors.toml to render with (default: classic)
    property var palette: Palette.CLASSIC
    FileView {
        path: Quickshell.env("OMACUBE_THEME") || ""
        printErrors: false
        onLoaded: root.palette = Palette.fromText(text())
    }
    // OMACUBE_OLD_THEME + OMACUBE_WAVE: the theme wave at that progress (0..1),
    // from that theme's colours to OMACUBE_THEME's
    property var oldPalette: null
    FileView {
        path: Quickshell.env("OMACUBE_OLD_THEME") || ""
        printErrors: false
        onLoaded: root.oldPalette = Palette.fromText(text())
    }
    readonly property real waveT: parseFloat(Quickshell.env("OMACUBE_WAVE") || "0")
    // OMACUBE_SIZE: the wall's cube size (default 3). OMACUBE_OLD_SIZE with
    // OMACUBE_WAVE: the size wave from that size (caches in
    // OMACUBE_REST_OLD_TURNS are drawn at it, in the same theme)
    readonly property int size: parseInt(Quickshell.env("OMACUBE_SIZE") || "3")
    readonly property int oldSize: parseInt(Quickshell.env("OMACUBE_OLD_SIZE") || "0") || size
    readonly property bool sizeWave: oldSize !== size

    function wrap(x, m) { return ((x % m) + m) % m }
    function centred(x, m) { return wrap(x + m / 2, m) - m / 2 }

    PanelWindow {
        id: win
        screen: Quickshell.screens[0]
        color: "transparent"
        anchors { top: true; left: true }
        implicitWidth: 1; implicitHeight: 1
        WlrLayershell.namespace: "omacube-dev-preview"
        WlrLayershell.layer: WlrLayer.Bottom
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
        exclusionMode: ExclusionMode.Ignore
        mask: Region {}

        // the height map pass, as in Service.qml
        ShaderEffect {
            id: heightMap
            readonly property real halfU: 15 * fx.aspect * 0.47140452
            readonly property real u0: fx.pan * 0.47140452 - halfU
            property vector2d hOrigin: Qt.vector2d(Math.floor(u0) - 5, Math.floor((u0 - 15 * 0.81649658) / 2) - 5)
            property vector2d hSize: Qt.vector2d(Math.ceil(2 * halfU) + 14, Math.ceil(halfU + 15 * 0.81649658) + 14)
            property real mapPass: 1
            width: hSize.x; height: hSize.y
            blending: false
            fragmentShader: "file://" + Quickshell.env("OMACUBE_QSB")
            property var mosaic: mosaicData
            property var heights: mosaicData        // unused in this pass, like these
            property var rest: mosaicData; property var rest1: mosaicData; property var rest2: mosaicData
            property var motion: mosaicData
            property real restPass: 0; property real useRest: 0
            property vector3d restPans; property vector3d restOk; property vector2d strip
            property vector4d wave; property vector4d sizes; property color o0; property color o1; property color o2; property color o3; property color o4; property color o5; property color oBody; property color oBg; property vector4d egg; property vector4d eggFx
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
            property vector4d wave; property vector4d sizes; property color o0; property color o1; property color o2; property color o3; property color o4; property color o5; property color oBody; property color oBg; property vector4d egg; property vector4d eggFx
            property var rest1: mosaicData; property var rest2: mosaicData
            width: hSize.x; height: hSize.y
            blending: false
            fragmentShader: heightMap.fragmentShader
            property var mosaic: mosaicData
            property var heights: heightMap
            property var rest: mosaicData                // unused in this pass, like these
            property var motion: mosaicData
            property real time: fx.time
            property real pan; property real aspect; property real texel; property real pixelArt
            property color c0; property color c1; property color c2; property color c3; property color c4; property color c5
            property color bodyColor; property color bgColor
            layer.enabled: true
            layer.smooth: false
            layer.textureSize: Qt.size(hSize.x, hSize.y)
        }

        // The rest caches: Service.qml's own RestSlot. OMACUBE_REST=1 draws
        // one per workspace in OMACUBE_REST_TURNS (default: this one), in
        // OMACUBE_REST_PIECES strips (default 8), before the first frame.
        readonly property bool useCache: Quickshell.env("OMACUBE_REST") === "1"
        readonly property var restTurns: (Quickshell.env("OMACUBE_REST_TURNS") || String(Math.round(root.turns))).split(",").map(Number)
        readonly property int pieces: parseInt(Quickshell.env("OMACUBE_REST_PIECES") || "8")
        readonly property var slots: [slotA, slotB, slotC]
        // OMACUBE_REST_OLD_TURNS: more caches, drawn in OMACUBE_OLD_THEME
        readonly property var oldTurns: Quickshell.env("OMACUBE_REST_OLD_TURNS") ? Quickshell.env("OMACUBE_REST_OLD_TURNS").split(",").map(Number) : []
        readonly property int nSlots: Math.min(3, restTurns.length + oldTurns.length)
        readonly property bool cacheDone: !useCache || ((nSlots < 1 || slotA.done) && (nSlots < 2 || slotB.done) && (nSlots < 3 || slotC.done))
        function drawNext() {
            for (var i = 0; i < nSlots; i++) {
                if (slots[i].done || slots[i].drawing) continue
                var old = i >= restTurns.length
                slots[i].draw(old ? oldTurns[i - restTurns.length] : restTurns[i], old ? (root.oldPalette || root.palette) : root.palette, pieces, old ? root.oldSize : root.size)
                return
            }
        }
        function okOf(s) { return !s.done ? 0 : (s.colours === root.palette && s.size === root.size ? 1 : 2) }
        RestSlot { id: slotA; onDrawn: win.drawNext(); aspect: fx.aspect; texel: fx.texel; pixelArt: fx.pixelArt; texW: root.w; texH: root.h; fxW: fx.width; fxH: fx.height; panPeriod: 3072 * 3 * Math.SQRT2; panShift: root.panOffset; mosaic: mosaicData; shader: fx.fragmentShader }
        RestSlot { id: slotB; onDrawn: win.drawNext(); aspect: fx.aspect; texel: fx.texel; pixelArt: fx.pixelArt; texW: root.w; texH: root.h; fxW: fx.width; fxH: fx.height; panPeriod: 3072 * 3 * Math.SQRT2; panShift: root.panOffset; mosaic: mosaicData; shader: fx.fragmentShader }
        RestSlot { id: slotC; onDrawn: win.drawNext(); aspect: fx.aspect; texel: fx.texel; pixelArt: fx.pixelArt; texW: root.w; texH: root.h; fxW: fx.width; fxH: fx.height; panPeriod: 3072 * 3 * Math.SQRT2; panShift: root.panOffset; mosaic: mosaicData; shader: fx.fragmentShader }
        Timer { interval: 300; running: win.useCache; onTriggered: win.drawNext() }

        ShaderEffect {
            id: fx
            // grabs render at the window's scale (e.g. 1.25), so size the
            // item in logical units to get exactly w x h pixels
            width: root.w / (win.devicePixelRatio || 1); height: root.h / (win.devicePixelRatio || 1)
            fragmentShader: "file://" + Quickshell.env("OMACUBE_QSB")
            property var heights: heightMap
            property vector2d hOrigin: heightMap.hOrigin
            property vector2d hSize: heightMap.hSize
            property real mapPass: 0
            property real restPass: 0
            // OMACUBE_REST=1: copy pixels nothing moves near from the rest caches
            property real useRest: win.useCache ? 1 : 0
            property vector3d restOk: Qt.vector3d(win.okOf(slotA), win.okOf(slotB), win.okOf(slotC))
            property vector4d wave: Qt.vector4d(root.waveT, root.oldPalette || root.sizeWave ? 1 : 0, root.sizeWave ? 1 : 0, 0)
            property vector4d sizes: Qt.vector4d(root.size, root.oldSize, 0, 0)
            readonly property var old: root.oldPalette || root.palette
            property color o0: old.stickers[0]; property color o1: old.stickers[1]; property color o2: old.stickers[2]
            property color o3: old.stickers[3]; property color o4: old.stickers[4]; property color o5: old.stickers[5]
            property color oBody: old.plastic; property color oBg: old.empty
            // OMACUBE_EGG="x,y,z,glow,hole": the easter egg's cube glowing, or gone
            readonly property var eggEnv: (Quickshell.env("OMACUBE_EGG") || "").split(",").map(Number)
            property vector4d egg: eggEnv.length === 5 ? Qt.vector4d(eggEnv[0], eggEnv[1], eggEnv[2], 1) : Qt.vector4d(0, 0, 0, 0)
            property vector4d eggFx: eggEnv.length === 5 ? Qt.vector4d(eggEnv[3], eggEnv[4], 0, 0) : Qt.vector4d(0, 0, 0, 0)
            property vector3d restPans: Qt.vector3d(slotA.pan, slotB.pan, slotC.pan)
            property vector2d strip
            property var rest: slotA.cache
            property var rest1: slotB.cache
            property var rest2: slotC.cache
            property var motion: motionMap
            // same formulas as Service.qml
            readonly property real clock: root.wrap(root.t0 + root.frame / root.fps, 4189.5)
            property real time: root.wrap(clock, 4189.5) + root.timeOffset
            property real pan: root.centred(root.turns * 30 * aspect, 3072 * 3 * Math.SQRT2) + root.panOffset
            property real aspect: width / height
            property var mosaic: mosaicData
            Image { id: mosaicData; source: Qt.resolvedUrl("mosaic.png"); visible: false; smooth: false; asynchronous: false }
            property real texel: 1 / root.h
            // OMACUBE_PIXEL=1: hard pixel edges (render at art-pixel size and
            // upscale with nearest neighbour afterwards)
            property real pixelArt: Quickshell.env("OMACUBE_PIXEL") === "1" ? 1 : 0
            property color c0: root.palette.stickers[0]
            property color c1: root.palette.stickers[1]
            property color c2: root.palette.stickers[2]
            property color c3: root.palette.stickers[3]
            property color c4: root.palette.stickers[4]
            property color c5: root.palette.stickers[5]
            property color bodyColor: root.palette.plastic
            property color bgColor: root.palette.empty
        }

        Timer { interval: 600; running: win.cacheDone; onTriggered: root.grab() }
    }

    function grab() {
        fx.grabToImage(function(r) {
            r.saveToFile(root.outDir + "/f" + ("00000" + root.frame).slice(-5) + ".png")
            root.frame++
            if (root.frame >= root.frames) Qt.quit()
            else Qt.callLater(root.grab)
        })
    }
}
