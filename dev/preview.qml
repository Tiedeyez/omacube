// Development preview for dev/preview.sh and dev/selfcheck.sh: renders the
// shader at a fixed size on a click-through bottom-layer surface and saves
// numbered PNG frames. Nothing here is part of the running plugin.
import QtQuick
import Quickshell
import Quickshell.Wayland

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
            property color c0: "#c41e3a"
            property color c1: "#ff5800"
            property color c2: "#f4f4f4"
            property color c3: "#ffd500"
            property color c4: "#009e60"
            property color c5: "#0051ba"
            property color bodyColor: "#0b0b0d"
            property color bgColor: "#040406"
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
