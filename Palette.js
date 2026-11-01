.pragma library
// Map an Omarchy theme's colors.toml onto the cube's six sticker colours.
//
// Pure functions, no I/O: Service.qml hands in the file's text, and
// tools/check-palette.mjs runs this same file against every installed theme.
//
// Stickers go by role, so opposite faces stay opposite whatever the theme:
//   +x red      <- red          -x orange <- orange (or red/yellow mixed)
//   +y white    <- foreground   -y yellow <- yellow
//   +z green    <- green        -z blue   <- blue
// The plastic (the lines between stickers) is the theme's background.
//
// A theme can also set the cube's colours exactly with optional keys:
// omacube_red, omacube_orange, omacube_white, omacube_yellow, omacube_green,
// omacube_blue, omacube_plastic and omacube_empty. Omarchy ignores keys it
// doesn't know. The Omacube theme uses them for the classic cube, so picking
// it in the theme switcher gives the original colours, while its ordinary
// red, blue and so on stay readable as terminal colours.

// The classic cube: also the fallback when a theme gives no colours at all.
var CLASSIC = {
    stickers: ["#c41e3a", "#ff5800", "#f4f4f4", "#ffd500", "#009e60", "#0051ba"],
    plastic: "#0b0b0d",
    empty: "#040406"
}

// Two colours closer than this (straight-line distance in RGB, 0..1 per
// channel) are hard to tell apart on a sticker.
var MIN_DISTANCE = 0.12

// colors.toml lines look like `red = "#f7768e"`. Only six-digit hex values
// are accepted, so nothing else from the file is ever used. At most 64 KiB
// and 512 lines are looked at.
function parse(text) {
    var keys = {}
    var lines = String(text || "").slice(0, 65536).split("\n")
    for (var i = 0; i < lines.length && i < 512; i++) {
        var m = lines[i].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']?(#[0-9A-Fa-f]{6})(?![0-9A-Fa-f])/)
        if (m) keys[m[1]] = m[2].toLowerCase()
    }
    return keys
}

function rgb(hex) {
    return [parseInt(hex.substr(1, 2), 16) / 255,
            parseInt(hex.substr(3, 2), 16) / 255,
            parseInt(hex.substr(5, 2), 16) / 255]
}

function distance(a, b) {
    var p = rgb(a), q = rgb(b)
    return Math.sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2]))
}

function hex2(v) {
    var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16)
    return s.length < 2 ? "0" + s : s
}

function mix(a, b) {
    var p = rgb(a), q = rgb(b)
    return "#" + hex2((p[0] + q[0]) / 2) + hex2((p[1] + q[1]) / 2) + hex2((p[2] + q[2]) / 2)
}

function first(keys, names) {
    for (var i = 0; i < names.length; i++)
        if (keys[names[i]]) return keys[names[i]]
    return ""
}

function farFromAll(c, chosen) {
    for (var i = 0; i < chosen.length; i++)
        if (distance(c, chosen[i]) < MIN_DISTANCE) return false
    return true
}

// keys: the result of parse(). Returns { stickers: [6 hex], plastic, empty }.
function fromKeys(keys) {
    var roles = ["red", "orange", "white", "yellow", "green", "blue"]
    var red = first(keys, ["red", "color1"])
    var yellow = first(keys, ["yellow", "color3"])
    var wanted = [
        red,
        first(keys, ["orange"]) || (red && yellow ? mix(red, yellow) : ""),
        first(keys, ["foreground", "color7", "bright_foreground", "color15"]),
        yellow,
        first(keys, ["green", "color2"]),
        first(keys, ["blue", "color4"])
    ]
    var exact = []
    var found = 0
    for (var w = 0; w < 6; w++) {
        exact.push(keys["omacube_" + roles[w]] || "")
        if (exact[w] || wanted[w]) found++
    }
    if (found < 4) return CLASSIC          // not a usable palette

    // Spare theme colours, used only when a role's colour is missing or
    // nearly the same as one already on the cube.
    var spareNames = ["cyan", "color6", "magenta", "color5", "accent",
                      "bright_red", "color9", "bright_yellow", "color11",
                      "bright_green", "color10", "bright_blue", "color12",
                      "bright_cyan", "color14", "bright_magenta", "color13"]
    var spares = []
    for (var s = 0; s < spareNames.length; s++)
        if (keys[spareNames[s]]) spares.push(keys[spareNames[s]])

    var stickers = []
    for (var i = 0; i < 6; i++) {
        if (exact[i]) { stickers.push(exact[i]); continue }   // the theme's own choice
        var c = wanted[i]
        if (!c || !farFromAll(c, stickers)) {
            var swap = ""
            for (var j = 0; j < spares.length && !swap; j++)
                if (farFromAll(spares[j], stickers)) swap = spares[j]
            // nothing distinct left (a monochrome theme): keep the theme's own
            // colour, or borrow one of its spares; classic only as a last resort
            c = swap || c || spares[0] || CLASSIC.stickers[i]
        }
        stickers.push(c)
    }
    var plastic = first(keys, ["omacube_plastic", "background", "color0"]) || CLASSIC.plastic
    var empty = first(keys, ["omacube_empty", "darker_background", "dark_background", "background", "color0"]) || CLASSIC.empty
    return { stickers: stickers, plastic: plastic, empty: empty }
}

function fromText(text) {
    return fromKeys(parse(text))
}
