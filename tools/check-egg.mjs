// Checks egg.js, the easter egg's cube logic (MATH.md, "The easter egg").
//   node tools/check-egg.mjs
import { readFileSync } from "node:fs"
const src = readFileSync(new URL("../egg.js", import.meta.url), "utf8").replace(".pragma library", "")
const E = new Function(src + "\nreturn { WHOLE, rot90, quat, qmul, qnorm, rows, isoQuat, index, place, slot, solvedState, apply, inverse, isSolved, keyMove, pick, dragMove, scramble }")()
let failures = 0
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`)
  if (!ok) failures++
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
let rng = 12345
const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648)
Math.random = rand

// rot90 is a true quarter turn, right-handed, as the shaders' rotA
let ok = true
for (const a of [0, 1, 2]) for (const dir of [1, -1]) {
  const v = [0.3, -1.2, 0.7], w = E.rot90(v, a, dir), t = dir * Math.PI / 2, c = Math.cos(t), s = Math.sin(t)
  const r = a === 0 ? [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]] : a === 1 ? [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]] : [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]
  ok &&= r.every((x, i) => Math.abs(x - w[i]) < 1e-12)
}
check("rot90 is the shaders' quarter turn", ok)

// place and slot are inverse, for every sticker of every size
ok = true
for (let n = 3; n <= 17; n++) for (let f = 0; f < 6; f++) for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
  const p = E.place(n, f, u, v)
  ok &&= E.slot(n, p.c, p.n) === E.index(f, u, v)
}
check("every sticker has one place, n = 3 .. 17", ok)

// four quarter turns, and a turn and its inverse, change nothing; the
// colours stay a permutation (n x n of each)
ok = true
let legal = true
for (const n of [3, 4, 5, 8, 13, 17]) {
  const s0 = E.solvedState(n)
  for (let k = 0; k < 30; k++) {
    const m = (n - 1) / 2
    const mv = { axis: Math.floor(rand() * 3), layer: rand() < 0.2 ? E.WHOLE : Math.floor(rand() * n) - m, dir: rand() < 0.5 ? 1 : -1 }
    let s = s0
    for (let i = 0; i < 4; i++) s = E.apply(n, s, mv)
    ok &&= same(s, s0)
    ok &&= same(E.apply(n, E.apply(n, s0, mv), E.inverse(mv)), s0)
  }
  let s = s0
  const moves = E.scramble(n, 40)
  for (const mv of moves) s = E.apply(n, s, mv)
  const counts = [0, 0, 0, 0, 0, 0]
  for (let f = 0; f < 6; f++) for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) counts[s[E.index(f, u, v)]]++
  legal &&= counts.every(c => c === n * n) && !E.isSolved(n, s)
  for (const mv of moves.slice().reverse()) s = E.apply(n, s, E.inverse(mv))
  ok &&= E.isSolved(n, s) && same(s, s0)
}
check("turns are permutations that undo exactly", ok)
check("a scrambled cube keeps n x n of each colour and is not solved", legal)

// keys follow standard notation, seen as the cube faces you
const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const moved = (mv, v) => E.rot90(v, mv.axis, mv.dir)
const eq = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-12)
check("R takes the front face up", eq(moved(E.keyMove(3, I, "R", 1, false), [0, 0, 1]), [0, 1, 0]))
check("U takes the front face left", eq(moved(E.keyMove(3, I, "U", 1, false), [0, 0, 1]), [-1, 0, 0]))
check("F takes the top face right", eq(moved(E.keyMove(3, I, "F", 1, false), [0, 1, 0]), [1, 0, 0]))
check("L, D and B mirror R, U and F", eq(moved(E.keyMove(3, I, "L", 1, false), [0, 0, 1]), [0, -1, 0])
  && eq(moved(E.keyMove(3, I, "D", 1, false), [0, 0, 1]), [1, 0, 0]) && eq(moved(E.keyMove(3, I, "B", 1, false), [0, 1, 0]), [-1, 0, 0]))
check("prime turns back", E.keyMove(3, I, "R", 1, true).dir === -E.keyMove(3, I, "R", 1, false).dir)
check("depth picks the layer in from the face", E.keyMove(8, I, "R", 2, false).layer === 2.5 && E.keyMove(8, I, "L", 3, false).layer === -1.5)
check("M follows L, on odd cubes only", E.keyMove(5, I, "M", 1, false).layer === 0 && E.keyMove(5, I, "M", 1, false).dir === E.keyMove(5, I, "L", 1, false).dir && E.keyMove(4, I, "M", 1, false) === null)
// turned cube: keys follow the view, not the cube
const R90 = E.rows(E.quat([0, 1, 0], Math.PI / 2))   // cube +x now faces the viewer... -x? check by vector
const front = E.keyMove(3, R90, "F", 1, false)
check("after turning the cube, F is the face towards you", Math.abs(R90[2][front.axis] * (front.layer > 0 ? 1 : -1) - 1) < 1e-9)

// the mouse: picking finds the face seen, and dragging a sticker moves it along the drag
ok = true
let picked = 0
for (let k = 0; k < 400; k++) {
  const q = E.qnorm([rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5])
  const R = E.rows(q), n = 3 + Math.floor(rand() * 15)
  const hit = E.pick(n, R, rand() * 3 - 1.5, rand() * 3 - 1.5)
  if (!hit) continue
  picked++
  const nv = [0, 1, 2].map(i => R[i][0] * hit.n[0] + R[i][1] * hit.n[1] + R[i][2] * hit.n[2])
  ok &&= nv[2] > 0                                    // the face picked faces the viewer
  const ang = rand() * Math.PI * 2, dx = Math.cos(ang), dy = Math.sin(ang)
  const mv = E.dragMove(n, R, hit, dx, dy)
  // the way the layer's turn starts moving the face under the finger:
  // dir * (axis x n), on screen, is within 90 degrees of the drag
  const k = [0, 0, 0]; k[mv.axis] = mv.dir
  const v = [k[1] * hit.n[2] - k[2] * hit.n[1], k[2] * hit.n[0] - k[0] * hit.n[2], k[0] * hit.n[1] - k[1] * hit.n[0]]
  const ds = [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2]]
  ok &&= ds[0] * dx + ds[1] * dy > 0
  ok &&= mv.layer === hit.c[mv.axis]
}
check("picking finds a face towards you; a drag turns the sticker's own layer along it", ok && picked > 200, `${picked} picks`)

// the wall's isometric view
const iso = E.rows(E.isoQuat())
check("isoQuat is the wall camera", eq(iso[0], [0.70710678, 0, -0.70710678].map(x => x)) || Math.abs(iso[0][0] - 0.70710678) < 1e-6 && Math.abs(iso[2][1] - 0.57735027) < 1e-6)

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed")
process.exit(failures ? 1 : 0)
