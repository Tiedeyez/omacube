.pragma library
// Omacube's easter egg: the logic of the floating cube (MATH.md, "The easter
// egg"). The state is the colour of every sticker of an n x n x n cube, by
// where it sits now: sticker (u, v) of face f (+x, -x, +y, -y, +z, -z) is
// cubie c with outward normal along that face, exactly as omacube.frag's pick
// pass writes it and eggcube.frag reads it. Moves are quarter turns about a
// cube axis, of one layer (its centred coordinate) or the whole cube (WHOLE),
// with the same rotation as the shaders' rot90.
//
// Plain JavaScript with no Qt in it, so tools/check-egg.mjs can test it.

var WHOLE = 99
var SIDE = 17          // the state texture's stride: the biggest cube

// ---- vectors and the shaders' rotation ----------------------------------------

function rot90(v, a, dir) {
    if (a === 0) return [v[0], -dir * v[2], dir * v[1]]
    if (a === 1) return [dir * v[2], v[1], -dir * v[0]]
    return [-dir * v[1], dir * v[0], v[2]]
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

// ---- quaternions (w, x, y, z) for the cube's orientation, cube -> view ---------

function quat(axis, angle) {
    var l = Math.sqrt(dot(axis, axis)) || 1
    var s = Math.sin(angle / 2) / l
    return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s]
}
function qmul(a, b) {
    return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
            a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
            a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
            a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]]
}
function qnorm(q) {
    var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
function slerp(a, b, t) {
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
    if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d }
    if (d > 0.9995) return qnorm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t])
    var th = Math.acos(d), s = Math.sin(th)
    var wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s
    return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb]
}
// The rotation's rows: view = rows . cube
function rows(q) {
    var w = q[0], x = q[1], y = q[2], z = q[3]
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]]
}
// The wall's isometric view: view right, up and towards the viewer are the
// camera's rt, up and -fw (omacube.frag), so these are its rows.
function isoQuat() {
    var r = [[0.70710678, 0, -0.70710678], [-0.40824829, 0.81649658, -0.40824829], [0.57735027, 0.57735027, 0.57735027]]
    var tr = r[0][0] + r[1][1] + r[2][2]
    var w = Math.sqrt(1 + tr) / 2
    return qnorm([w, (r[2][1] - r[1][2]) / (4 * w), (r[0][2] - r[2][0]) / (4 * w), (r[1][0] - r[0][1]) / (4 * w)])
}

// ---- the state -------------------------------------------------------------------

function index(f, u, v) { return f * SIDE * SIDE + v * SIDE + u }

// sticker (f, u, v) -> its cubie and outward normal
function place(n, f, u, v) {
    var m = (n - 1) / 2, a = u - m, b = v - m
    var s = f % 2 === 0 ? m : -m, fa = Math.floor(f / 2)
    var c = fa === 0 ? [s, a, b] : (fa === 1 ? [a, s, b] : [a, b, s])
    var nrm = [0, 0, 0]
    nrm[fa] = s > 0 ? 1 : -1
    return { c: c, n: nrm }
}
// and back
function slot(n, c, nrm) {
    var m = (n - 1) / 2
    var fa = nrm[0] !== 0 ? 0 : (nrm[1] !== 0 ? 1 : 2)
    var f = 2 * fa + (nrm[fa] > 0 ? 0 : 1)
    var ab = fa === 0 ? [c[1], c[2]] : (fa === 1 ? [c[0], c[2]] : [c[0], c[1]])
    return index(f, Math.round(ab[0] + m), Math.round(ab[1] + m))
}

function solvedState(n) {
    var st = new Array(6 * SIDE * SIDE)
    for (var i = 0; i < st.length; i++) st[i] = -1
    for (var f = 0; f < 6; f++)
        for (var v = 0; v < n; v++)
            for (var u = 0; u < n; u++) st[index(f, u, v)] = f
    return st
}

// One quarter turn: every sticker on the turning layer moves with it.
function apply(n, st, mv) {
    var out = st.slice()
    for (var f = 0; f < 6; f++)
        for (var v = 0; v < n; v++)
            for (var u = 0; u < n; u++) {
                var p = place(n, f, u, v)
                if (mv.layer !== WHOLE && p.c[mv.axis] !== mv.layer) continue
                out[slot(n, rot90(p.c, mv.axis, mv.dir), rot90(p.n, mv.axis, mv.dir))] = st[index(f, u, v)]
            }
    return out
}

function inverse(mv) { return { axis: mv.axis, layer: mv.layer, dir: -mv.dir } }

// Solved: every face one colour (on any cube, whatever colours it shows).
function isSolved(n, st) {
    for (var f = 0; f < 6; f++) {
        var c0 = st[index(f, 0, 0)]
        for (var v = 0; v < n; v++)
            for (var u = 0; u < n; u++)
                if (st[index(f, u, v)] !== c0) return false
    }
    return true
}

// ---- moves from the keyboard, as the cube faces you now ----------------------------

// The cube axis and sign whose face looks most along view direction w.
function faceToward(R, w) {
    var best = -2, axis = 0, sign = 1
    for (var a = 0; a < 3; a++) {
        var d = R[0][a] * w[0] + R[1][a] * w[1] + R[2][a] * w[2]
        if (Math.abs(d) > best) { best = Math.abs(d); axis = a; sign = d > 0 ? 1 : -1 }
    }
    return { axis: axis, sign: sign }
}

var VIEW = { R: [1, 0, 0], L: [-1, 0, 0], U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1] }
var SLICE = { M: "L", E: "D", S: "F" }

// Face letter R L U D F B (depth 1 = the face itself), or slice M E S (the
// middle layer, odd n only), clockwise as seen from that face; prime turns
// back. null if there is no such layer.
function keyMove(n, R, letter, depth, prime) {
    var m = (n - 1) / 2
    var middle = SLICE[letter] !== undefined
    var t = faceToward(R, VIEW[middle ? SLICE[letter] : letter])
    var layer
    if (middle) {
        if (n % 2 === 0) return null
        layer = 0
    } else {
        if (depth < 1 || depth > n) return null
        layer = t.sign * (m - (depth - 1))
    }
    // clockwise seen from the face = -90 degrees about its outward normal
    return { axis: t.axis, layer: layer, dir: (prime ? 1 : -1) * t.sign }
}

// ---- the mouse ---------------------------------------------------------------------

// The ray through view point (x, y) (cube units, y up), against the whole
// cube: the face it enters and the cubie, or null.
function pick(n, R, x, y) {
    var ov = [x, y, 10]
    var o = [0, 1, 2].map(function (a) { return R[0][a] * ov[0] + R[1][a] * ov[1] + R[2][a] * ov[2] })
    var d = [-R[2][0], -R[2][1], -R[2][2]]
    var tN = -1e9, tF = 1e9, axis = -1
    for (var a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (Math.abs(o[a]) > 1.5) return null; continue }
        var t0 = (-1.5 - o[a]) / d[a], t1 = (1.5 - o[a]) / d[a]
        var lo = Math.min(t0, t1), hi = Math.max(t0, t1)
        if (lo > tN) { tN = lo; axis = a }
        tF = Math.min(tF, hi)
    }
    if (tN > tF || tF < 0 || axis < 0) return null
    var p = [o[0] + d[0] * tN, o[1] + d[1] * tN, o[2] + d[2] * tN]
    var m = (n - 1) / 2, off = m - Math.floor(m)
    var c = p.map(function (v) { return Math.max(-m, Math.min(m, Math.floor(v * n / 3 + 0.5 - off) + off)) })
    var nrm = [0, 0, 0]
    nrm[axis] = d[axis] > 0 ? -1 : 1
    c[axis] = nrm[axis] * m
    return { c: c, n: nrm }
}

// A drag of (dx, dy) on screen (view units, y up) from a sticker: the layer
// that turns so the sticker follows the drag, or null if it is too short.
function dragMove(n, R, hit, dx, dy) {
    if (dx * dx + dy * dy < 0.04) return null
    var fa = hit.n[0] !== 0 ? 0 : (hit.n[1] !== 0 ? 1 : 2)
    var best = -1, tb = -1, ts = 1
    for (var a = 0; a < 3; a++) {
        if (a === fa) continue
        var sx = R[0][a], sy = R[1][a]                  // cube axis a on screen
        var al = (sx * dx + sy * dy) / (Math.sqrt(sx * sx + sy * sy) + 1e-9) / Math.sqrt(dx * dx + dy * dy)
        if (Math.abs(al) > best) { best = Math.abs(al); tb = a; ts = al > 0 ? 1 : -1 }
    }
    var t = [0, 0, 0]
    t[tb] = ts
    var k = cross(hit.n, t)                             // turning about k moves n towards t
    var axis = k[0] !== 0 ? 0 : (k[1] !== 0 ? 1 : 2)
    return { axis: axis, layer: hit.c[axis], dir: k[axis] > 0 ? 1 : -1 }
}

// ---- scrambles -----------------------------------------------------------------------

// count random slice turns, never the same axis twice running
function scramble(n, count) {
    var m = (n - 1) / 2, out = [], last = -1
    for (var i = 0; i < count; i++) {
        var axis
        do { axis = Math.floor(Math.random() * 3) } while (axis === last)
        last = axis
        out.push({ axis: axis, layer: Math.floor(Math.random() * n) - m, dir: Math.random() < 0.5 ? 1 : -1 })
    }
    return out
}

// the shaders' flick: overshoots about 10% and settles exactly at 1
function easeTurn(x) {
    x = Math.max(0, Math.min(1, x))
    var y = x - 1
    return 1 + 2.7 * y * y * y + 1.7 * y * y
}
