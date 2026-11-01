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
    // loop (4189.5 s) or one drift loop (1024) later must look the same
    readonly property real timeOffset: parseFloat(Quickshell.env("OMACUBE_TIME_OFFSET") || "0")
    readonly property real driftOffset: parseFloat(Quickshell.env("OMACUBE_DRIFT_OFFSET") || "0")
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
            width: root.w; height: root.h
            fragmentShader: "file://" + Quickshell.env("OMACUBE_QSB")
            // same formulas as Service.qml
            readonly property real clock: root.wrap(root.t0 + root.frame / root.fps, 46084.5)
            property real time: root.wrap(clock, 4189.5) + root.timeOffset
            property real drift: root.wrap(clock / 46084.5 * 1024 + 0.5 * root.turns, 1024) + root.driftOffset
            property real spin: 2.0943951024 * root.wrap(root.turns, 3)
            property real aspect: width / height
            property real texel: 1 / height
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
