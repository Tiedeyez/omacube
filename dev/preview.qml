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

    function wrap(x, m) { return ((x % m) + m) % m }

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

        ShaderEffect {
            id: fx
            // grabs render at the window's scale (e.g. 1.25), so size the
            // item in logical units to get exactly w x h pixels
            width: root.w / (win.devicePixelRatio || 1); height: root.h / (win.devicePixelRatio || 1)
            fragmentShader: "file://" + Quickshell.env("OMACUBE_QSB")
            // same formulas as Service.qml
            readonly property real clock: root.wrap(root.t0 + root.frame / root.fps, 4189.5)
            property real time: root.wrap(clock, 4189.5) + root.timeOffset
            property real pan: root.wrap(root.turns * 30 * aspect, 3072 * 3 * Math.SQRT2) + root.panOffset
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

        Timer { interval: 600; running: true; onTriggered: root.grab() }
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
