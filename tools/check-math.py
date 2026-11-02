#!/usr/bin/env python3
"""Check the maths behind Omacube's shader, independently of the GPU.

Python standard library only. Every check here re-derives a claim the shader
(shaders/omacube.frag) and Service.qml rely on, using plain arithmetic and
brute force rather than the shader's shortcuts:

  geometry   the distance function of a cube with a turning layer is exact
  bound      no point of any cube, turning or not, is farther than R from
             its centre
  scene      the 8-cell distance estimate never overestimates (so the ray
             march can never step through a cube), checked against a brute
             force over every nearby cell; the previous scheme is checked too
  stack      the stack is a down-set, so at rest every visible face is whole:
             exact rays from across each exposed face, tested against every
             nearby cube, never show part of a face (no triangles)
  colours    "undo every move back to solved" gives the same colours as
             physically turning a solved cube, and every state is legal
  cycle      bursts fit their windows, nothing jumps, cubes move only in
             their class's window and only fully slid out
  physics    cubes turning in place collided; free cubes slid out by LIFT
             clear every neighbour, and neighbours in a layer take turns
  words      word sites keep faces whole; the glyphs fit each cube and read
             undistorted; printed fragments come home exactly
  events     a word solves, holds and re-scrambles with no jump, turning only
             fully slid out, inside its class's windows
  loop       the clock wrap and the workspace-slide wrap are seamless
  camera     the view is a true, unmirrored isometric projection, and the
             stickers use the standard colour scheme
  easing     the turn curve starts at 0, ends exactly at 1, overshoots ~10%
  antialias  a pixel step on screen lands in the sticker's face plane

Run:  python3 tools/check-math.py        (exit status 0 = all checks pass)
"""

import math
import random
import sys
from fractions import Fraction

P = 3.0                 # lattice pitch
H = 0.5                 # cubie half size
R = 1.5 * math.sqrt(3)  # cube circumradius
SLOT = Fraction(19, 20)  # 0.95 s
CYCLE = 14
TURN = 0.6
FILL = 0.74             # the distance test's random scene
SWITCH = 0.92           # the stack's per-cell switch chance (shader FILL)
LIFT = 0.63             # how far a free cube slides out along each axis before it turns
WIN = 4189.5 / 420      # 9.975 s: one class window; classes 0, 1, 2 take turns
LIFT_S = 0.33           # seconds an ordinary slide out, or back in, takes
EPOCH = 12 * WIN        # 119.7 s: one chance per word site for a word
EV_LEAD = 0.1           # seconds into its window a word cube starts
EV_LIFT = 0.25          # seconds: slide out / back around a speed-solve or re-scramble
EV_MOVE = 0.4           # seconds per speed-solve move (it turns in the first 60%)
EV_SOLVE, EV_SCRAMBLE = 0, 6   # windows of the epoch where class 0 solves / re-scrambles
SITE_ROW, SITE_BLOCK, SITE_LEN, SITE_SLACK = 4, 16, 8, 7
GLYPH = 3.6             # a glyph cell spans 3.6 x 3.6 world units, centred on the cube
PAN_CELLS = 3072        # the workspace slide wraps every 3072 cells (a multiple of 3)

failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


# ---- vector helpers ---------------------------------------------------------

def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def norm(a): return math.sqrt(dot(a, a))
def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def rot_axis(p, a, t):
    """Right-handed rotation about coordinate axis a (0, 1, 2) by angle t."""
    c, s = math.cos(t), math.sin(t)
    x, y, z = p
    if a == 0:
        return (x, c * y - s * z, s * y + c * z)
    if a == 1:
        return (c * x + s * z, y, -s * x + c * z)
    return (c * x - s * y, s * x + c * y, z)


def rot90(v, a, d):
    """Exact quarter turn, the shader's rot90(): same as rot_axis(v, a, d*pi/2)."""
    x, y, z = v
    if a == 0:
        return (x, -d * z, d * y)
    if a == 1:
        return (d * z, y, -d * x)
    return (-d * y, d * x, z)


def sd_box(p, b):
    q = [abs(c) - b for c in p]
    outside = math.sqrt(sum(max(c, 0.0) ** 2 for c in q))
    return outside + min(max(q), 0.0)


def clamp(x, lo, hi): return max(lo, min(hi, x))
def rnd(x): return math.floor(x + 0.5)


# ---- one cube ---------------------------------------------------------------

def cube_sdf(q, axis, layer, ang):
    """The shader's cubeSDF(): nearest cubie by rounding, with a turning layer."""
    turning = abs(ang) > 1e-4
    if turning and layer == 2:
        qr = rot_axis(q, axis, -ang)
        cell = tuple(clamp(rnd(c), -1, 1) for c in qr)
        return sd_box(sub(qr, cell), H)
    c = [clamp(rnd(v), -1, 1) for v in q]
    if turning and c[axis] == layer:
        c[axis] = (1 if q[axis] >= 0 else -1) if layer == 0 else 0
    d = sd_box(sub(q, tuple(c)), H)
    if turning:
        qr = rot_axis(q, axis, -ang)
        cm = [clamp(rnd(v), -1, 1) for v in qr]
        cm[axis] = layer
        d = min(d, sd_box(sub(qr, tuple(cm)), H))
    return d


def cube_sdf_brute(q, axis, layer, ang):
    """Union of all 27 cubies, each placed explicitly (the ground truth)."""
    best = 1e9
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for k in (-1, 0, 1):
                c = (i, j, k)
                moving = abs(ang) > 1e-4 and (layer == 2 or c[axis] == layer)
                local = sub(rot_axis(q, axis, -ang), c) if moving else sub(q, c)
                best = min(best, sd_box(local, H))
    return best


def random_state(rng):
    axis = rng.randrange(3)
    layer = rng.choice((-1, 0, 1, 2))
    ang = rng.uniform(-1.1, 1.1) * math.pi / 2  # includes the ~10% overshoot
    if rng.random() < 0.25:
        ang = 0.0
    return axis, layer, ang


def test_geometry(rng):
    worst = 0.0
    inside_ok = True
    for _ in range(10000):
        state = random_state(rng)
        q = tuple(rng.uniform(-3.2, 3.2) for _ in range(3))
        fast = cube_sdf(q, *state)
        true = cube_sdf_brute(q, *state)
        if true > 0:
            worst = max(worst, abs(fast - true))
        elif fast > 1e-12:
            inside_ok = False
    check("geometry: cube distance is exact outside the cube", worst < 1e-12, f"max error {worst:.1e}")
    check("geometry: points inside a cube read as inside", inside_ok)


def test_bound(rng):
    worst = 0.0
    for _ in range(4000):
        axis, layer, ang = random_state(rng)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    c = (i, j, k)
                    moving = abs(ang) > 1e-4 and (layer == 2 or c[axis] == layer)
                    for corner in ((sx, sy, sz) for sx in (-H, H) for sy in (-H, H) for sz in (-H, H)):
                        p = add(c, corner)
                        if moving:
                            p = rot_axis(p, axis, ang)
                        worst = max(worst, norm(p))
    check("bound: every cube point stays within R = 1.5*sqrt(3) of its centre",
          worst <= R + 1e-12, f"max {worst:.6f}, R {R:.6f}")
    # highest coordinate sum a top-layer cube (cell sum 0) can reach
    check("bound: top-layer cubes never reach above coordinate sum 4.5",
          abs(R * math.sqrt(3) - 4.5) < 1e-12 and 4.6 > 4.5)


# ---- the scene ----------------------------------------------------------------

class Scene:
    """Random occupancy and a random frozen turn for every cell near the origin."""

    def __init__(self, rng, span=4):
        self.cells = {}
        for i in range(-span, span + 1):
            for j in range(-span, span + 1):
                for k in range(-span, span + 1):
                    if rng.random() < FILL:
                        self.cells[(i, j, k)] = random_state(rng)

    def cube(self, cid, p):
        return cube_sdf(sub(p, mul(cid, P)), *self.cells[cid])

    def brute(self, p):
        """True distance: every cell within two steps (farther ones are > 1.9 away)."""
        c0 = tuple(rnd(v / P) for v in p)
        best = 1e9
        for di in range(-2, 3):
            for dj in range(-2, 3):
                for dk in range(-2, 3):
                    cid = (c0[0] + di, c0[1] + dj, c0[2] + dk)
                    if cid in self.cells:
                        best = min(best, self.cube(cid, p))
        return best

    def near8(self, p):
        c0 = tuple(rnd(v / P) for v in p)
        q0 = sub(p, mul(c0, P))
        sd = tuple(1 if v >= 0 else -1 for v in q0)
        best = 1e9
        for o in ((a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)):
            cid = (c0[0] + o[0] * sd[0], c0[1] + o[1] * sd[1], c0[2] + o[2] * sd[2])
            if cid in self.cells:
                best = min(best, self.cube(cid, p))
        return best, q0

    def fast_new(self, p):
        best, q0 = self.near8(p)
        far = P + min(abs(v) for v in q0) - R
        return min(best, far)

    def fast_old(self, p):
        best, q0 = self.near8(p)
        if best > 1e8:
            b = [P / 2 - abs(v) for v in q0]
            best = max(min(b), 0.0) + 0.05
        return best


def test_scene(rng):
    scene = Scene(rng)
    new_bad = old_bad = exact = total = 0
    worst_old = 0.0
    for _ in range(40000):
        p = tuple(rng.uniform(-6.0, 6.0) for _ in range(3))
        true = scene.brute(p)
        if true <= 0:
            continue
        total += 1
        new = scene.fast_new(p)
        old = scene.fast_old(p)
        if new > true + 1e-9:
            new_bad += 1
        if abs(new - true) < 1e-9:
            exact += 1
        if old > true + 1e-9:
            old_bad += 1
            worst_old = max(worst_old, old - true)
    check("scene: new estimate never overestimates the true distance", new_bad == 0,
          f"{new_bad} of {total} samples")
    print(f"      (new estimate is exact at {100.0 * exact / total:.1f}% of samples, "
          f"a safe underestimate elsewhere)")
    check("scene: the previous estimate was unsafe (expected to fail before the fix)",
          old_bad > 0, f"overestimated at {old_bad} of {total} samples, by up to {worst_old:.2f}")


# ---- the stack: whole faces only ------------------------------------------------

def make_switch(seed, chance):
    memo = {}
    def on(c):
        if c not in memo:
            memo[c] = random.Random(f"{seed}:{c}").random() < chance
        return memo[c]
    return on


def occupied_old(c, on):
    """The previous rule: top four layers filled independently at random."""
    s = sum(c)
    return s <= 0 and (s <= -4 or on(c))


def occupied_new(c, on):
    """The shader's occupied(): a cell holds a cube only if its whole down-cone
    inside the top four layers is switched on."""
    s = sum(c)
    if s > 0:
        return False
    if s <= -4:
        return True
    room = s + 3
    for a in range(4):
        for b in range(4):
            for d in range(4):
                if a + b + d <= room and not on((c[0] - a, c[1] - b, c[2] - d)):
                    return False
    return True


def ray_hits_box(p, d, lo, hi):
    tmin, tmax = 1e-9, 1e9
    for k in range(3):
        t1 = (lo[k] - p[k]) / d[k]
        t2 = (hi[k] - p[k]) / d[k]
        tmin = max(tmin, min(t1, t2))
        tmax = min(tmax, max(t1, t2))
    return tmax > tmin + 1e-9          # a real overlap, not a touch


def memoize(f):
    memo = {}
    def g(c):
        if c not in memo:
            memo[c] = f(c)
        return memo[c]
    return g


def face_coverage(occ, span=5):
    """For every exposed face (cube units, unit cubes on integer cells), cast
    rays towards the viewer from 25 points on the face; return the number of
    faces that are partly covered and the number fully covered."""
    view = (1.0, 1.0, 1.0)
    offsets = (-0.45, -0.25, 0.0, 0.25, 0.45)
    partial = covered = faces = 0
    for i in range(-span, span + 1):
        for j in range(-span, span + 1):
            for k in range(-span, span + 1):
                c = (i, j, k)
                if not -6 <= sum(c) <= 0 or not occ(c):
                    continue
                for ax in range(3):
                    n = [0, 0, 0]
                    n[ax] = 1
                    if occ(add(c, tuple(n))):
                        continue                    # not an exposed face
                    faces += 1
                    t1, t2 = [a for a in range(3) if a != ax]
                    hit = 0
                    for u in offsets:
                        for v in offsets:
                            p = list(c)
                            p[ax] += 0.5
                            p[t1] += u
                            p[t2] += v
                            blocked = False
                            for w in ((a, b, d) for a in range(-1, 5) for b in range(-1, 5) for d in range(-1, 5)):
                                q = add(c, w)
                                if q == c or sum(q) > 0 or not occ(q):
                                    continue
                                if ray_hits_box(p, view, add(q, (-0.5,) * 3), add(q, (0.5,) * 3)):
                                    blocked = True
                                    break
                            hit += blocked
                    if 0 < hit < 25:
                        partial += 1
                    elif hit == 25:
                        covered += 1
    return partial, covered, faces


def test_stack():
    on = make_switch(1, SWITCH)
    down = all(not occupied_new(c, on) or all(occupied_new(add(c, e), on)
                                               for e in ((-1, 0, 0), (0, -1, 0), (0, 0, -1)))
               for c in ((i, j, k) for i in range(-6, 7) for j in range(-6, 7) for k in range(-6, 7)))
    check("stack: every cube has cubes behind it along -x, -y and -z (a down-set)", down)
    partial, covered, faces = face_coverage(memoize(lambda c: occupied_new(c, on)))
    check("stack: at rest, every exposed face is seen whole (no triangles)",
          partial == 0 and covered == 0, f"{faces} faces, {partial} partly hidden, {covered} hidden")
    old_on = make_switch(2, FILL)
    partial, covered, faces = face_coverage(memoize(lambda c: occupied_old(c, old_on)))
    check("stack: the previous random fill showed cut faces (expected before the fix)",
          partial > 0, f"{partial} of {faces} faces partly hidden")


# ---- moves and colours --------------------------------------------------------

FACES = {(1, 0, 0): "red", (-1, 0, 0): "orange", (0, 1, 0): "white",
         (0, -1, 0): "yellow", (0, 0, 1): "green", (0, 0, -1): "blue"}
OPPOSITE = {"red": "orange", "orange": "red", "white": "yellow",
            "yellow": "white", "green": "blue", "blue": "green"}


def decode(v):
    """The shader's decode(): move code 0..19 -> axis step, layer, direction."""
    step = v % 2 + 1
    code = (v // 2) % 5
    layer = code - 1 if code < 3 else 2
    direction = 1 if v < 10 else -1
    return step, layer, direction


def sequence(rng, length):
    """A move list the way the shader builds one: no two moves share an axis."""
    moves = []
    axis = rng.randrange(3)
    for j in range(length):
        step, layer, direction = decode(rng.randrange(20))
        if j > 0:
            axis = (axis + step) % 3
        moves.append((axis, layer, direction))
    return moves


def in_move(cell, move):
    axis, layer, _ = move
    return layer == 2 or cell[axis] == layer


def solved_stickers():
    st = {}
    for c in ((i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)):
        for n in FACES:
            if dot(c, n) == 1:
                st[(c, n)] = FACES[n]
    return st


def turn_physically(stickers, move):
    axis, _, direction = move
    out = {}
    for (c, n), colour in stickers.items():
        if in_move(c, move):
            c, n = rot90(c, axis, direction), rot90(n, axis, direction)
        out[(c, n)] = colour
    return out


def colour_by_undo(c, n, moves):
    """The shader's stickerAt(): undo moves newest first, colour by home face."""
    for move in reversed(moves):
        if in_move(c, move):
            c, n = rot90(c, move[0], -move[2]), rot90(n, move[0], -move[2])
    return FACES[n], c, n


def legal(stickers):
    counts = {}
    for colour in stickers.values():
        counts[colour] = counts.get(colour, 0) + 1
    if any(v != 9 for v in counts.values()) or len(counts) != 6:
        return False
    by_cubie = {}
    for (c, _), colour in stickers.items():
        by_cubie.setdefault(c, []).append(colour)
    for colours in by_cubie.values():
        if len(set(colours)) != len(colours):
            return False
        if any(OPPOSITE[a] == b for a in colours for b in colours):
            return False
    return True


def test_colours(rng):
    mismatches = illegal = rigid_bad = 0
    for _ in range(1500):
        moves = sequence(rng, rng.randrange(0, 24))
        st = solved_stickers()
        for m in moves:
            st = turn_physically(st, m)
        if not legal(st):
            illegal += 1
        homes = {}
        for (c, n), colour in st.items():
            got, hc, hn = colour_by_undo(c, n, moves)
            if got != colour:
                mismatches += 1
            homes.setdefault(c, set()).add(hc)
            if dot(hc, hn) != 1:
                rigid_bad += 1
        if any(len(h) != 1 for h in homes.values()):
            rigid_bad += 1
    check("colours: undoing moves matches physically turning a solved cube", mismatches == 0,
          f"{mismatches} mismatched stickers")
    check("colours: every state is a legal cube (9 of each colour, valid pieces)", illegal == 0)
    check("colours: every cubie moves rigidly (all its stickers share one home)", rigid_bad == 0)
    consecutive = all(a[0] != b[0] for _ in range(500)
                      for a, b in zip(*(lambda s: (s, s[1:]))(sequence(rng, 20))))
    check("colours: consecutive moves never share an axis (none cancels the last)", consecutive)


def previous_colouring_is_illegal(rng):
    """The old shader coloured stickers at random; count impossible cubies."""
    bad = 0
    for _ in range(200):
        st = solved_stickers()
        solved = 0.15 + 0.5 * rng.random()
        st = {k: (v if rng.random() < solved else rng.choice(list(OPPOSITE))) for k, v in st.items()}
        if not legal(st):
            bad += 1
    check("colours: the previous random colouring was illegal (expected before the fix)",
          bad > 0, f"{bad} of 200 cubes impossible")


def cube_class(c):
    """The shader's classOf(): neighbours in a layer always differ, so they take turns."""
    return (c[0] - c[1]) % 3


SPEEDS = (6, 7, 8, 9, 10, 11)


def burst_seconds(m):
    """Slide out, three moves, a rest, the three undone (the last only turns its
    first 60%), slide back: all inside one window of the cube's class."""
    sl = float(SLOT) * m / 8
    return 2 * LIFT_S + (6 + TURN) * sl


def smooth(x):
    return x * x * (3 - 2 * x)


def ordinary_state(t, cls, m, offset, base, cycle_moves):
    """The shader's ordinaryState(): (applied moves, move in progress, lift).
    Outside a burst every cube rests at its base scramble, so only cubes in a
    burst need the free test; a burst happens only in a window of its class."""
    w = math.floor(t / WIN)
    if (w - cls) % 3:
        return base, None, 0.0
    j = (w - cls) // 3                            # which of its class's windows
    m3 = cycle_moves(j % 140)
    sl = float(SLOT) * m / 8
    tau = t - w * WIN - offset(j % 140) * (WIN - burst_seconds(m) - 0.05)
    if tau < 0 or tau >= burst_seconds(m):
        return base, None, 0.0
    if tau < LIFT_S:
        return base, None, LIFT * smooth(tau / LIFT_S)
    u = tau - LIFT_S
    if u < (6 + TURN) * sl:
        k = min(int(u / sl), 6)
        f = u - k * sl
        if k < 3:
            pre, mv, sgn = k, m3[k], 1
        elif k == 3:
            return base + m3, None, LIFT               # rest, still out
        else:
            pre, mv, sgn = 7 - k, m3[6 - k], -1
        return base + m3[:pre], (mv, sgn * mv[2] * ease(f / (TURN * sl)) * math.pi / 2), LIFT
    v = u - (6 + TURN) * sl
    return base, None, LIFT * (1 - smooth(min(v / LIFT_S, 1.0)))


def test_schedule(rng):
    jumps = lift_jumps = outside = low = over = 0
    for _ in range(400):
        cls, m = rng.randrange(3), rng.choice(SPEEDS)
        base = sequence(rng, rng.randrange(0, 21))
        memo_m, memo_o = {}, {}
        def cycle_moves(k):
            if k not in memo_m:
                memo_m[k] = sequence(rng, 3)
            return memo_m[k]
        def offset(k):
            if k not in memo_o:
                memo_o[k] = rng.random()
            return memo_o[k]
        sl = float(SLOT) * m / 8
        over += burst_seconds(m) > WIN - 0.05
        state = lambda t: ordinary_state(t % 4189.5, cls, m, offset, base, cycle_moves)
        w0 = rng.randrange(0, 420 - 6)
        cuts = [4189.5]                            # the clock wrap
        for w in range(w0, w0 + 6):
            cuts.append(w * WIN)
            if (w - cls) % 3 == 0:
                j = (w - cls) // 3
                st = w * WIN + offset(j % 140) * (WIN - burst_seconds(m) - 0.05)
                cuts += [st, st + LIFT_S] + [st + LIFT_S + k * sl for k in range(7)]
                cuts += [st + LIFT_S + k * sl + TURN * sl for k in range(7)]
                cuts += [st + LIFT_S + (6 + TURN) * sl + LIFT_S]
        for b in cuts:
            a1, i1, l1 = state(b - 1e-7)
            a2, i2, l2 = state(b + 1e-7)
            jumps += pose_gap(pose_of(a1, i1), pose_of(a2, i2)) > 1e-4
            lift_jumps += abs(l1 - l2) > 1e-4
        for k in range(3000):
            t = w0 * WIN + 6 * WIN * k / 3000
            a, inp, l = state(t)
            busy = l > 0 or (inp is not None and abs(inp[1]) > 1e-9)
            outside += busy and math.floor(t / WIN) % 3 != cls
            if inp is not None and abs(inp[1]) > 1e-9 and abs(inp[1]) < math.pi / 2 - 1e-9:
                low += l != LIFT
    check("cycle: every burst fits inside one window, at every speed", over == 0)
    check("cycle: no cubie ever jumps (window edges, burst edges, the clock wrap)", jumps == 0,
          f"{jumps} jumps")
    check("cycle: the slide out and back is continuous", lift_jumps == 0)
    check("cycle: a cube is out of the pile only inside its own class's window", outside == 0)
    check("cycle: every turn happens fully slid out", low == 0)
    check("cycle: neighbours in a layer always differ in class, so they never move together",
          all(cube_class(o) != 0 for o in ((1, -1, 0), (1, 0, -1), (0, 1, -1), (-1, 1, 0), (-1, 0, 1), (0, -1, 1))))


# ---- loop and slide -----------------------------------------------------------

def test_loop():
    check("loop: 4189.5 s is exactly 420 class windows (140 per class, each with new moves)",
          abs(WIN * 420 - 4189.5) < 1e-9 and 420 % 3 == 0)
    # the workspace slide wraps every 3072 lattice steps of (3, 0, -3): cell ids shift by
    # 3072 * (1, 0, -1), which keeps id mod 1024 (so every hash and every word site),
    # the layer sum, and x - y mod 3 (so every cube's class) unchanged
    rng = random.Random(7)
    shift = (PAN_CELLS, 0, -PAN_CELLS)
    same = True
    for _ in range(10000):
        cid = tuple(rng.randrange(-5000, 5000) for _ in range(3))
        moved = add(cid, shift)
        same &= tuple(v % 1024 for v in cid) == tuple(v % 1024 for v in moved)
        same &= sum(cid) == sum(moved) and cube_class(cid) == cube_class(moved)
    check("loop: the slide wrap maps every cell onto one with the same hash, layer and class", same)
    check("loop: the event clock wraps with the cube clock (35 whole epochs, each 12 windows)",
          abs(EPOCH * 35 - 4189.5) < 1e-9)


# ---- physics: only free cubes move, and they slide out before they turn ----------
#
# Neighbouring cubes touch, and a turning layer's corners sweep out to
# 1.5 * sqrt(2) from the axis, so a cube turning in place cuts into the cubes
# beside it. A cube may move only when it is free: no cube in front of it on
# any axis (in a down-set that empties every cell further along all three
# axes). It slides straight out along (1, 1, 1), which is the view direction,
# so on screen it does not move, until its turning layers clear every
# neighbour; it turns only while fully out, and settles back between bursts.

E3 = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
CUBIES = [(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)]


def cube_boxes(centre, move=None, ang=0.0):
    """The 27 cubies as oriented boxes (centre, axes); move = (axis, layer)."""
    out = []
    for c in CUBIES:
        if move and ang and (move[1] == 2 or c[move[0]] == move[1]):
            p = rot_axis(c, move[0], ang)
            ax = [rot_axis(e, move[0], ang) for e in E3]
        else:
            p, ax = c, E3
        out.append((add(centre, p), ax))
    return out


def boxes_overlap(a, b, tol=1e-9):
    """Separating-axis test for two cubies of half size H; touching is allowed."""
    (ca, aa), (cb, ab) = a, b
    d = sub(cb, ca)
    if dot(d, d) > 3.0 + 1e-9:
        return False
    axes = list(aa) + list(ab)
    for u in aa:
        for v in ab:
            w = cross(u, v)
            n = norm(w)
            if n > 1e-9:
                axes.append(mul(w, 1 / n))
    for L in axes:
        ra = sum(H * abs(dot(u, L)) for u in aa)
        rb = sum(H * abs(dot(v, L)) for v in ab)
        if abs(dot(d, L)) >= ra + rb - tol:
            return False
    return True


def cubes_overlap(a, b):
    return any(boxes_overlap(x, y) for x in a for y in b)


TURNS = [(a, l) for a in range(3) for l in (-1, 0, 1, 2)]
ANGLES = [math.radians(x) for x in (10, 30, 45, 60, 80, 90)]
# neighbours a free cube can have: any cell not further along all three axes
NEIGHBOURS = [o for o in ((i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1))
              if o != (0, 0, 0) and min(o) < 0]


def peak_angle():
    return max(ease(i / 2000) for i in range(2001)) * math.pi / 2


def test_physics(rng):
    angles = ANGLES + [peak_angle()]
    out = (LIFT, LIFT, LIFT)
    old = new = 0
    for move in TURNS:
        for ang in angles:
            for o in NEIGHBOURS:
                other = cube_boxes(mul(o, P))
                old += cubes_overlap(cube_boxes((0, 0, 0), move, ang), other)
                new += cubes_overlap(cube_boxes(out, move, ang), other)
    check("physics: a cube turning in place cut into its neighbours (expected before the fix)",
          old > 0, f"{old} colliding move/angle/neighbour cases")
    check("physics: a free cube slid out by LIFT clears every neighbour, every move, every angle",
          new == 0, f"{new} collisions, overshoot peak {math.degrees(peak_angle()):.1f} deg")
    need = 3 / math.sqrt(2) - 1.5
    check("physics: LIFT is above the least clearing slide 3/sqrt(2) - 1.5",
          need < LIFT < need + 0.02, f"least {need:.4f}, LIFT {LIFT}")
    # two free cubes, each anywhere in its own schedule
    def pose(c):
        if rng.random() < 0.5:                             # turning: fully out
            return cube_boxes(add(c, out), rng.choice(TURNS), rng.choice(angles))
        u = rng.uniform(0, LIFT)                           # sliding: square on
        return cube_boxes(add(c, (u, u, u)))
    layer_nb = [(1, -1, 0), (1, 0, -1), (0, 1, -1), (-1, 1, 0), (-1, 0, 1), (0, -1, 1)]
    others = [o for o in ((i, j, k) for i in range(-1, 2) for j in range(-1, 2) for k in range(-1, 2))
              if min(o) < 0 < max(o) and o not in layer_nb]
    bad = sum(cubes_overlap(pose((0, 0, 0)), pose(mul(rng.choice(others), P))) for _ in range(1200))
    check("physics: free cubes that are not neighbours in a layer never collide, whatever each does",
          bad == 0, f"{bad} of 1200 random pairs")
    nb = sum(cubes_overlap(pose((0, 0, 0)), pose(mul(rng.choice(layer_nb), P))) for _ in range(600))
    check("physics: neighbours in a layer can collide when both move (expected: so they take turns)",
          nb > 0, f"{nb} of 600 random pairs")
    # free cubes: three empty cells in front means every cell further along is empty
    on = make_switch(5, SWITCH)
    occ = memoize(lambda c: occupied_new(c, on))
    ok = True
    for c in ((i, j, k) for i in range(-5, 6) for j in range(-5, 6) for k in range(-5, 6)):
        if not -3 <= sum(c) <= 0 or not occ(c) or any(occ(add(c, e)) for e in E3):
            continue
        ok &= not any(occ(add(c, (a, b, d))) for a in range(4) for b in range(4) for d in range(4)
                      if (a, b, d) != (0, 0, 0))
    check("physics: a free cube has nothing anywhere ahead of it, so its slide out is clear", ok)
    s3, s2, s6 = math.sqrt(3), math.sqrt(2), math.sqrt(6)
    rt, up = (1 / s2, 0.0, -1 / s2), (-1 / s6, 2 / s6, -1 / s6)
    check("physics: the slide is along the view axis, so the cube stays put on screen",
          abs(dot((1, 1, 1), rt)) < 1e-12 and abs(dot((1, 1, 1), up)) < 1e-12)
    # drawing: a cube slid along (1, 1, 1) is hit by an orthographic ray at
    # the same point of the cube, only nearer by lift * sqrt(3), so main()
    # can march every cube in its cell and correct the slid-out ones after
    fw = (-1 / s3, -1 / s3, -1 / s3)
    def trace(centre, ro, move, ang):
        t = 0.0
        for _ in range(400):
            q = sub(add(ro, mul(fw, t)), centre)
            d = cube_sdf(q, move[0], move[1], ang)
            if d < 1e-7:
                return t, q
            t += d
            if t > 30:
                return None, None
        return None, None
    worst = 0.0
    same = True
    for _ in range(300):
        move, ang = rng.choice(TURNS), rng.choice(angles)
        u = rng.uniform(0, LIFT)
        ro = add(add(mul(rt, rng.uniform(-2.6, 2.6)), mul(up, rng.uniform(-2.6, 2.6))), mul(fw, -12))
        t0, q0 = trace((0, 0, 0), ro, move, ang)
        t1, q1 = trace((u, u, u), ro, move, ang)
        if t0 is None or t1 is None:
            same &= t0 is None and t1 is None
            continue
        worst = max(worst, abs((t0 - t1) - u * s3), norm(sub(q0, q1)))
    check("drawing: a slid-out cube shows the same point, nearer by lift*sqrt(3) (fast drawing is exact)",
          same and worst < 1e-5, f"worst error {worst:.1e}")


class LiftedScene(Scene):
    """Scene with every cube slid out by its own amount in [0, LIFT]."""

    def __init__(self, rng, span=4):
        super().__init__(rng, span)
        self.lift = {c: rng.choice((0.0, LIFT, rng.uniform(0, LIFT))) for c in self.cells}

    def cube(self, cid, p):
        u = self.lift[cid]
        return cube_sdf(sub(sub(p, mul(cid, P)), (u, u, u)), *self.cells[cid])

    def fast(self, p):
        """The shader's mapScene(): cells picked around lattice + LIFT/2, capped."""
        h = LIFT / 2
        c0 = tuple(rnd((v - h) / P) for v in p)
        q0 = tuple(p[k] - c0[k] * P - h for k in range(3))
        sd = tuple(1 if v >= 0 else -1 for v in q0)
        best = P + min(abs(v) for v in q0) - h - R
        for o in ((a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)):
            cid = (c0[0] + o[0] * sd[0], c0[1] + o[1] * sd[1], c0[2] + o[2] * sd[2])
            if cid in self.cells:
                best = min(best, self.cube(cid, p))
        return best


def test_lifted_scene(rng):
    scene = LiftedScene(rng)
    bad = total = 0
    for _ in range(30000):
        p = tuple(rng.uniform(-6.0, 6.0) for _ in range(3))
        true = scene.brute(p)
        if true <= 0:
            continue
        total += 1
        bad += scene.fast(p) > true + 1e-9
    check("scene: with cubes slid out, the estimate still never overestimates", bad == 0,
          f"{bad} of {total} samples")
    check("scene: the far-cell cap stays positive, so the march always advances",
          P - LIFT / 2 - R > 0, f"minimum cap {P - LIFT / 2 - R:.3f}")


# ---- words: cubes that spell the Omarchy lockup ------------------------------------

def site_of(c, site_hash):
    """The shader's siteLetter(): which letter (0..7) a top-layer cell carries, or None.
    site_hash(row, block) -> (is_site, offset)."""
    if sum(c) != 0:
        return None
    kx, ky = c[0] % 1024, c[1] % 1024
    if ky % SITE_ROW:
        return None
    block = kx // SITE_BLOCK
    is_site, off = site_hash(ky, block)
    k = kx - block * SITE_BLOCK - off
    return k if is_site and 0 <= k < SITE_LEN else None


def occupied_words(c, on, site_hash):
    """occupied() with word sites: their cells and down-cones are always filled."""
    s = sum(c)
    if s > 0:
        return False
    if s <= -4:
        return True
    for a in range(4):
        for b in range(4 - a):
            d = -s - a - b
            if d >= 0 and site_of(add(c, (a, b, d)), site_hash) is not None:
                return True
    return occupied_new(c, on)


def read_png_gray(path):
    """Minimal PNG reader for an 8-bit greyscale, non-interlaced image."""
    import struct, zlib
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, w = 8, b"", 0
    while pos < len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, inter = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and ctype == 0 and inter == 0, "glyphs.png must be 8-bit grey"
        elif kind == b"IDAT":
            idat += body
        pos += 12 + n
    raw, rows, prev = zlib.decompress(idat), [], bytearray(w)
    for y in range(h):
        f, line = raw[y * (w + 1)], bytearray(raw[y * (w + 1) + 1:(y + 1) * (w + 1)])
        for x in range(w):
            a = line[x - 1] if x else 0
            b, c = prev[x], (prev[x - 1] if x else 0)
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, rows


def test_words(rng):
    import os
    sites = {}
    def site_hash(row, block):
        if (row, block) not in sites:
            sites[(row, block)] = (rng.random() < 0.75, rng.randrange(SITE_SLACK))
        return sites[(row, block)]
    on = make_switch(9, SWITCH)
    occ = memoize(lambda c: occupied_words(c, on, site_hash))
    cells = [(i, j, k) for i in range(-40, 40) for j in range(-8, 9) for k in range(-40, 40)
             if -5 <= i + j + k <= 1]
    down = all(not occ(c) or all(occ(add(c, e)) for e in ((-1, 0, 0), (0, -1, 0), (0, 0, -1)))
               for c in cells)
    check("words: word sites keep the stack a down-set (so faces stay whole)", down)
    letters = {}
    for c in cells:
        k = site_of(c, site_hash)
        if k is not None:
            letters.setdefault((c[1], (c[0] % 1024) // SITE_BLOCK), {})[k] = c
    whole = all(sorted(v) == list(range(SITE_LEN)) for v in letters.values()
                if all(-40 < c[0] < 39 and -40 < c[2] < 39 for c in v.values()))
    free = all(occ(c) and not any(occ(add(c, e)) for e in E3) for v in letters.values() for c in v.values())
    check("words: every site is 8 present, free cubes on the top layer", whole and free and len(letters) > 0,
          f"{len(letters)} sites")
    s2, s6 = math.sqrt(2), math.sqrt(6)
    rt, up = (1 / s2, 0.0, -1 / s2), (-1 / s6, 2 / s6, -1 / s6)
    step = mul((1, 0, -1), P)
    check("words: a site's letters run left to right in one level row on screen",
          dot(step, rt) > 0 and abs(dot(step, up)) < 1e-12 and abs(sum(step)) < 1e-12)
    # the printed glyphs: inside each cube's outline, with a margin, so a solved
    # cube carries a whole glyph on its three visible faces
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "glyphs.png")
    w, h, rows = read_png_gray(path)
    ok_size = (w, h) == (512 * SITE_LEN, 512)
    worst = 9.0
    inked = []
    for k in range(SITE_LEN):
        n = 0
        for y in range(0, 512, 2):
            for x in range(0, 512, 2):
                if rows[y][k * 512 + x] < 128:
                    continue
                n += 1
                gx = ((x + 0.5) / 512 - 0.5) * GLYPH
                gy = (0.5 - (y + 0.5) / 512) * GLYPH
                worst = min(worst, 1.5 * s2 - abs(gx), 1.5 * math.sqrt(1.5) * 2 - abs(gy) - abs(gx) / math.sqrt(3))
        inked.append(n)
    check("words: glyphs.png holds the logo and O M A R C H Y, 512 px cells", ok_size and min(inked) > 500,
          f"{w}x{h}, ink {inked}")
    check("words: every glyph stays inside its cube's outline on screen", worst > 0.05,
          f"closest {worst:.3f} units")
    # the print is anamorphic: a point on a visible face of a solved cube shows
    # at its own screen offset, (p.rt, p.up), so the glyph reads undistorted
    ok = True
    for _ in range(2000):
        n = rng.choice(E3)
        t1, t2 = [e for e in E3 if e != n]
        hp = add(add(mul(n, 1.5), mul(t1, rng.uniform(-1.5, 1.5))), mul(t2, rng.uniform(-1.5, 1.5)))
        t = dot(hp, (1, 1, 1)) / 3
        foot = sub(hp, (t, t, t))                         # where the view ray through hp lands
        ok &= abs(dot(foot, rt) - dot(hp, rt)) < 1e-12 and abs(dot(foot, up) - dot(hp, up)) < 1e-12
    check("words: the print maps each face point to its own screen spot (reads undistorted)", ok)
    # picture-cube stickers: undoing the moves on the hit point, not just the
    # cubie and normal, brings a printed fragment home, orientation included
    bad = 0
    for _ in range(300):
        moves = sequence(rng, rng.randrange(1, 21))
        for c0 in CUBIES:
            for n0 in FACES:
                if dot(c0, n0) != 1:
                    continue
                t0 = add(mul(n0, 0.5), (0.3 * (n0[0] == 0), 0.2 * (n0[1] == 0), -0.1 * (n0[2] == 0)))
                c, n, t = c0, n0, t0
                for m in moves:                           # turn physically
                    if in_move(c, m):
                        c, n, t = rot90(c, m[0], m[2]), rot90(n, m[0], m[2]), rot90(t, m[0], m[2])
                for m in reversed(moves):                 # the shader's homeOf()
                    if in_move(c, m):
                        c, n, t = rot90(c, m[0], -m[2]), rot90(n, m[0], -m[2]), rot90(t, m[0], -m[2])
                bad += (c, n) != (c0, n0) or norm(sub(t, t0)) > 1e-12
    check("words: printed fragments come home exactly, centre orientation included", bad == 0)


# ---- events: a site speed-solves, holds the word, and re-scrambles -----------------

def pose_of(applied, inprog):
    """Every cubie's displayed position and rotation (rows), from home."""
    out = {}
    for h in CUBIES:
        pos, M = h, E3
        for m in applied:
            if in_move(pos, m):
                pos = rot90(pos, m[0], m[2])
                M = tuple(rot90(r, m[0], m[2]) for r in M)
        if inprog and in_move(pos, inprog[0]):
            m, ang = inprog
            pos = rot_axis(pos, m[0], ang)
            M = tuple(rot_axis(r, m[0], ang) for r in M)
        out[h] = (pos, M)
    return out


def pose_gap(a, b):
    return max(max(norm(sub(a[h][0], b[h][0])), max(norm(sub(x, y)) for x, y in zip(a[h][1], b[h][1])))
               for h in a)


def site_state(t, T0, cls, base, active):
    """The shader's siteState(): a word cube rests at its base scramble, except
    in an epoch with a word. Then, in its class's window, it slides out,
    speed-solves (undoes its scramble), settles; holds the word; and in a
    later window of its class slides out, re-scrambles and settles."""
    n = len(base)
    if not active or not T0 <= t < T0 + EPOCH:
        return base, None, 0.0
    S = T0 + (EV_SOLVE + cls) * WIN + EV_LEAD
    R = T0 + (EV_SCRAMBLE + cls) * WIN + EV_LEAD
    def burst(u, undo):
        if u < 0:
            return (base if undo else []), None, 0.0
        if u < EV_LIFT:
            return (base if undo else []), None, LIFT * smooth(u / EV_LIFT)
        u -= EV_LIFT
        if u < n * EV_MOVE:
            j = int(u / EV_MOVE)
            f = u - j * EV_MOVE
            if undo:
                mv = base[n - 1 - j]
                return base[:n - j], (mv, -mv[2] * ease(f / (EV_MOVE * TURN)) * math.pi / 2), LIFT
            mv = base[j]
            return base[:j], (mv, mv[2] * ease(f / (EV_MOVE * TURN)) * math.pi / 2), LIFT
        u -= n * EV_MOVE
        return ([] if undo else base), None, LIFT * (1 - smooth(min(u / EV_LIFT, 1.0)))
    return burst(t - S, True) if t < R else burst(t - R, False)


def test_events(rng):
    longest = EV_LEAD + 2 * EV_LIFT + 20 * EV_MOVE
    check("events: a solve or re-scramble of up to 20 moves fits in one window",
          longest < WIN, f"{longest:.2f} s of {WIN:.4f}")
    check("events: epochs start on a class-0 window, so a word cube's windows are its class's",
          abs(EPOCH / WIN - 12) < 1e-12 and 12 % 3 == 0)
    hold = (EV_SCRAMBLE * WIN + EV_LEAD) - (2 * WIN + longest)
    check("events: the whole word holds still and solved for at least 30 s", hold >= 30.0,
          f"shortest full-word hold {hold:.2f} s")
    check("events: every event is over before the next epoch begins",
          (EV_SCRAMBLE + 2) * WIN + longest < EPOCH)
    jumps = lift_jumps = low = unsolved = outside = 0
    for _ in range(400):
        cls = rng.randrange(3)
        base = sequence(rng, rng.randrange(0, 21))
        n = len(base)
        T0 = EPOCH * rng.randrange(35)
        state = lambda t: site_state(t, T0, cls, base, True)
        S = T0 + (EV_SOLVE + cls) * WIN + EV_LEAD
        R = T0 + (EV_SCRAMBLE + cls) * WIN + EV_LEAD
        cuts = [T0, T0 + EPOCH]
        for st in (S, R):
            cuts += [st, st + EV_LIFT, st + EV_LIFT + n * EV_MOVE, st + 2 * EV_LIFT + n * EV_MOVE]
            cuts += [st + EV_LIFT + j * EV_MOVE for j in range(n)]
            cuts += [st + EV_LIFT + j * EV_MOVE + TURN * EV_MOVE for j in range(n)]
        for b in cuts:
            a1, i1, l1 = state(b - 1e-7)
            a2, i2, l2 = state(b + 1e-7)
            jumps += pose_gap(pose_of(a1, i1), pose_of(a2, i2)) > 1e-4
            lift_jumps += abs(l1 - l2) > 1e-4
        for k in range(2000):
            t = T0 + EPOCH * k / 2000
            a, inp, l = state(t)
            busy = l > 0 or (inp is not None and abs(inp[1]) > 1e-9)
            outside += busy and math.floor(round(t / WIN, 9)) % 3 != cls
            if inp is not None and 1e-9 < abs(inp[1]) < math.pi / 2 - 1e-9:
                low += l != LIFT
        for k in range(60):
            t = T0 + 3 * WIN + (EV_SCRAMBLE - 3) * WIN * k / 60
            a, inp, l = state(t)
            unsolved += bool(a) or inp is not None or l != 0
    check("events: no cubie ever jumps, entering, inside, or leaving an event", jumps == 0,
          f"{jumps} jumps")
    check("events: the slide out and back is continuous throughout", lift_jumps == 0)
    check("events: a word cube is out of the pile only inside its own class's window", outside == 0)
    check("events: every speed-solve and re-scramble turn happens fully slid out", low == 0)
    check("events: during the hold every word cube is exactly solved, at rest in the pile", unsolved == 0)


# ---- camera, colour scheme, easing, antialiasing ----------------------------------

def test_camera():
    s3, s2, s6 = math.sqrt(3), math.sqrt(2), math.sqrt(6)
    fw = (-1 / s3, -1 / s3, -1 / s3)
    rt = (1 / s2, 0.0, -1 / s2)
    up = (-1 / s6, 2 / s6, -1 / s6)
    ortho = all(abs(dot(a, b)) < 1e-12 for a, b in ((fw, rt), (fw, up), (rt, up)))
    unit = all(abs(norm(v) - 1) < 1e-12 for v in (fw, rt, up))
    check("camera: view basis is orthonormal", ortho and unit)
    check("camera: right x up points at the viewer (image not mirrored)",
          norm(sub(cross(rt, up), mul(fw, -1))) < 1e-12)
    # isometric: the three axes project to equal lengths, 120 degrees apart
    proj = [(dot(a, rt), dot(a, up)) for a in ((1, 0, 0), (0, 1, 0), (0, 0, 1))]
    lengths = [math.hypot(*p) for p in proj]
    angles = sorted(math.degrees(math.atan2(p[1], p[0])) % 360 for p in proj)
    gaps = [angles[1] - angles[0], angles[2] - angles[1], 360 - angles[2] + angles[0]]
    check("camera: true isometric (axes equal length, 120 degrees apart)",
          max(lengths) - min(lengths) < 1e-12 and all(abs(g - 120) < 1e-9 for g in gaps))
    # +y is up on screen, so white is the top face of a resting cube
    check("camera: +y (white) points up the screen", proj[1][1] > 0 and abs(proj[1][0]) < 1e-12)
    # standard Western scheme: white up, green front, red on the right.
    # In a right-handed frame, right = up x front.
    check("colours: standard scheme (white up, green front, red right)",
          cross((0, 1, 0), (0, 0, 1)) == (1, 0, 0))
    # rot90 agrees with the continuous rotation at +-90 degrees
    agree = all(norm(sub(rot90(v, a, d), rot_axis(v, a, d * math.pi / 2))) < 1e-12
                for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1), (1, -1, 1)) for a in range(3) for d in (1, -1))
    check("rotation: exact quarter turns match the continuous rotation", agree)
    # the workspace slide moves the camera along rt only: straight sideways on
    # screen, and at a constant height above the stack (rt has coordinate sum 0)
    check("camera: the workspace slide is purely horizontal and keeps the camera's height",
          abs(dot(rt, (1, 1, 1))) < 1e-12 and abs(dot(rt, up)) < 1e-12 and abs(dot(rt, fw)) < 1e-12)


def ease(x):
    x = clamp(x, 0.0, 1.0)
    y = x - 1.0
    return 1.0 + 2.7 * y ** 3 + 1.7 * y ** 2


def test_easing():
    peak = max(ease(i / 10000) for i in range(10001))
    check("easing: starts at 0, ends exactly at 1", abs(ease(0)) < 1e-12 and ease(1) == 1.0)
    check("easing: overshoots about 10% (a ~99 degree flick that settles at 90)",
          1.09 < peak < 1.11, f"peak {peak:.4f}")


def test_antialias(rng):
    s3, s2, s6 = math.sqrt(3), math.sqrt(2), math.sqrt(6)
    fw = (-1 / s3, -1 / s3, -1 / s3)
    rt = (1 / s2, 0.0, -1 / s2)
    ok = True
    for _ in range(2000):
        n = rot_axis(rot_axis((0, 0, 1), 0, rng.uniform(-1, 1)), 1, rng.uniform(-1, 1))
        if dot(n, fw) > -0.05:
            continue
        e = rt
        disp = sub(e, mul(fw, dot(n, e) / dot(n, fw)))
        ok &= abs(dot(n, disp)) < 1e-12                       # stays in the face plane
        ok &= norm(cross(sub(disp, e), fw)) < 1e-12           # moved only along the ray
    check("antialias: a screen step maps onto the face plane along the view ray", ok)


def main():
    rng = random.Random(20261101)
    test_geometry(rng)
    test_bound(rng)
    test_scene(rng)
    test_stack()
    test_colours(rng)
    previous_colouring_is_illegal(rng)
    test_schedule(rng)
    test_physics(rng)
    test_lifted_scene(rng)
    test_words(rng)
    test_events(rng)
    test_loop()
    test_camera()
    test_easing()
    test_antialias(rng)
    print()
    if failures:
        print(f"{len(failures)} check(s) failed")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
