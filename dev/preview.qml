// Development preview for dev/preview.sh: renders the shader at a fixed size
// on a click-through bottom-layer surface and saves numbered PNG frames.
import QtQuick
import Quickshell
import Quickshell.Wayland

ShellRoot {
    id: root
    readonly property string outDir: Quickshell.env("OMACUBE_OUT")
    readonly property int frames: parseInt(Quickshell.env("OMACUBE_FRAMES") || "1")
    readonly property real fps: parseFloat(Quickshell.env("OMACUBE_FPS") || "24")
    readonly property real t0: parseFloat(Quickshell.env("OMACUBE_T0") || "3")
    readonly property int w: parseInt(Quickshell.env("OMACUBE_W") || "1920")
    readonly property int h: parseInt(Quickshell.env("OMACUBE_H") || "1080")
    property int frame: 0

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
            property real time: root.t0 + root.frame / root.fps
            property real zoom: time / 16.0
            property real spin: 0
            property real aspect: width / height
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
