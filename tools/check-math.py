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
  cycle      colours and geometry agree at every slot boundary of a cycle
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


def world_colours(base, moves3, slot, at_end):
    """Sticker colours at world positions at the start or end of a slot."""
    if slot < 3:
        pre, idx, sign = slot, slot, 1
    elif slot < 7:
        pre, idx, sign = 3, None, 0
    elif slot < 10:
        idx = 9 - slot
        pre, sign = idx + 1, -1
    else:
        pre, idx, sign = 0, None, 0
    applied = base + moves3[:pre]
    out = {}
    for c in ((i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)):
        for n in FACES:
            if dot(c, n) != 1:
                continue
            colour = colour_by_undo(c, n, applied)[0]
            wc, wn = c, n
            if idx is not None and at_end and in_move(c, moves3[idx]):
                axis, _, direction = moves3[idx]
                wc, wn = rot90(c, axis, sign * direction), rot90(n, axis, sign * direction)
            out[(wc, wn)] = colour
    return out


def test_cycle(rng):
    breaks = 0
    for _ in range(1000):
        base = sequence(rng, rng.randrange(0, 21))
        moves3, next3 = sequence(rng, 3), sequence(rng, 3)
        for slot in range(CYCLE):
            end = world_colours(base, moves3, slot, at_end=True)
            if slot + 1 < CYCLE:
                start = world_colours(base, moves3, slot + 1, at_end=False)
            else:                                  # next cycle, new moves
                start = world_colours(base, next3, 0, at_end=False)
            if end != start:
                breaks += 1
    check("cycle: colours are continuous across every slot boundary", breaks == 0,
          f"{breaks} jumps")
    # the slot clamp: positions a hair outside [0, 14) are folded back in
    def fold(tt):
        cyc = math.floor(tt / CYCLE)
        s = tt - cyc * CYCLE
        if s < 0:
            s, cyc = s + CYCLE, cyc - 1
        if s >= CYCLE:
            s, cyc = s - CYCLE, cyc + 1
        return cyc, s
    ok = all(0 <= fold(tt)[1] < CYCLE for tt in (14 * 5 - 1e-12, 14 * 5, 14 * 5 + 1e-12, 0.0))
    check("cycle: slot position always lands in [0, 14)", ok)


# ---- loop and slide -----------------------------------------------------------

def test_loop():
    speeds = (6, 7, 8, 9, 10, 12)
    cube_loop = Fraction(133, 10) * 2520 / 8      # seconds, = 4189.5
    ok = cube_loop == Fraction(8379, 2)
    for m in speeds:
        cycles = cube_loop / (SLOT * m / 8 * CYCLE)
        ok &= cycles.denominator == 1 and cycles == Fraction(2520, m)
    check("loop: 4189.5 s is a whole number of cycles at every speed m/8, "
          "m in {6,7,8,9,10,12}", ok)
    # the workspace slide wraps every 1024 lattice steps of (3, 3, -6): cell ids shift by
    # 1024 * (1, 1, -2), which keeps id mod 1024 and the layer sum unchanged
    rng = random.Random(7)
    shift = (1024, 1024, -2048)
    same = True
    for _ in range(10000):
        cid = tuple(rng.randrange(-5000, 5000) for _ in range(3))
        moved = add(cid, shift)
        same &= tuple(v % 1024 for v in cid) == tuple(v % 1024 for v in moved)
        same &= sum(cid) == sum(moved)
    check("loop: the slide wrap maps every cell onto one with the same hash and layer", same)


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
    # a 120 degree roll about the view axis maps each lattice axis onto another
    def rodrigues(v, k, t):
        return add(add(mul(v, math.cos(t)), mul(cross(k, v), math.sin(t))),
                   mul(k, dot(k, v) * (1 - math.cos(t))))
    axes = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    images = [rodrigues(a, fw, 2 * math.pi / 3) for a in axes]
    hits = [[i for i, b in enumerate(axes) if norm(sub(img, b)) < 1e-12] for img in images]
    check("camera: a 120 degree roll maps the lattice onto itself",
          all(len(h) == 1 for h in hits) and len({h[0] for h in hits}) == 3)


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
    test_cycle(rng)
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
