#!/usr/bin/env python3
"""Build mosaic.png: the cube states that spell OMARCHY on the monument wall.

Python standard library only. The word is a sticker mosaic, the way people
build pictures from real puzzle cubes: each sticker is one pixel. It sits on
the red (+x) face of a giant solved cube corner, in yellow, across a block of
10 x 2 cubes. Every cube must be a legal state, so this script assigns real
corner and edge pieces, each by a proper rotation from its home, to show the
pattern; then fixes the three invariants (corner twist, edge flip,
permutation parity) with pieces nobody sees. A letter pixel can fall on a
centre sticker, and a centre only changes colour when the whole cube turns,
so each cube may also be turned as a whole (any of the 24 orientations).

The text block starts one row of cubes below the giant cube's top edge, so
text cubes never show their top. Cubes in the first column (c = 0) also show
their +z face, part of the green left face, so it must be all green.

Writes mosaic.png: 64 x 32, 8-bit grey. Row k (0..19, k = r * 10 + c) holds
cube k's 54 sticker colours, at x = face * 9 + (u + 1) * 3 + (v + 1), as
colour index * 32. Faces are +x, -x, +y, -y, +z, -z (the shader's c0..c5);
(u, v) are the face's in-plane coordinates: (y, z) on x faces, (x, z) on y
faces, (x, y) on z faces.

  python3 tools/build-mosaic.py            (writes mosaic.png, prints the wall)
"""

import itertools
import os
import struct
import sys
import zlib

INK, PAPER = 3, 0                 # yellow on red
COLS, ROWS = 10, 2                # cubes in the text block

# 6-row pixel font after the Omarchy wordmark: tall, square-cut letters.
FONT = {
    "O": ["###", "#.#", "#.#", "#.#", "#.#", "###"],
    "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#"],
    "A": ["###", "#.#", "#.#", "###", "#.#", "#.#"],
    "R": ["##.", "#.#", "#.#", "##.", "#.#", "#.#"],
    "C": ["###", "#..", "#..", "#..", "#..", "###"],
    "H": ["#.#", "#.#", "#.#", "###", "#.#", "#.#"],
    "Y": ["#.#", "#.#", "#.#", ".#.", ".#.", ".#."],
}


def bitmap():
    """The 6 x 30 sticker picture: the word, one blank column between letters."""
    rows = [""] * 6
    for i, ch in enumerate("OMARCHY"):
        for y in range(6):
            rows[y] += ("." if i else "") + FONT[ch][y]
    width = COLS * 3
    assert len(rows[0]) <= width
    return [r.ljust(width, ".") for r in rows]


# ---- cube geometry -------------------------------------------------------------

AXES = [(1, 0, 0), (0, 1, 0), (0, 0, 1)]


def normal_colour(n):
    """Solved colour of the face with normal n: +x, -x, +y, -y, +z, -z -> 0..5."""
    for a in range(3):
        if n[a]:
            return 2 * a + (0 if n[a] > 0 else 1)


def slot_index(c, n):
    f = normal_colour(n)
    a = [k for k in range(3) if n[k]][0]
    u, v = [c[k] for k in range(3) if k != a]
    return f * 9 + (u + 1) * 3 + (v + 1)


def matmul(M, v):
    return tuple(sum(M[i][j] * v[j] for j in range(3)) for i in range(3))


def det(M):
    return (M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
            - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
            + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]))


ROTATIONS = []
for perm in itertools.permutations(range(3)):
    for signs in itertools.product((1, -1), repeat=3):
        M = [[0] * 3 for _ in range(3)]
        for i in range(3):
            M[i][perm[i]] = signs[i]
        if det(M) == 1:
            ROTATIONS.append(M)
assert len(ROTATIONS) == 24

CORNERS = [c for c in itertools.product((-1, 1), repeat=3)]
EDGES = [c for c in itertools.product((-1, 0, 1), repeat=3) if sum(map(abs, c)) == 2]


def stickers_at_home(h):
    """(normal, colour) of each sticker of the piece whose home is h."""
    return [(tuple(h[k] if k == a else 0 for k in range(3)), normal_colour(
        tuple(h[k] if k == a else 0 for k in range(3)))) for a in range(3) if h[a]]


def placements(h, s):
    """Every proper rotation taking piece h to slot s, as {slot index: colour}."""
    out = []
    for M in ROTATIONS:
        if matmul(M, h) != s:
            continue
        out.append({slot_index(s, matmul(M, n)): col for n, col in stickers_at_home(h)})
    return out


def solved_state():
    st = [None] * 54
    for c in itertools.product((-1, 0, 1), repeat=3):
        for n, col in stickers_at_home(c) if sum(map(abs, c)) else []:
            st[slot_index(c, n)] = col
    for a in range(3):                                  # centres
        for sgn in (1, -1):
            n = tuple(sgn if k == a else 0 for k in range(3))
            st[slot_index(n, n)] = normal_colour(n)
    return st


# ---- invariants (standard, checked against random turns in check-math.py) -------

def corner_twist(s, stick):
    """Twist of the piece in corner slot s: where its white/yellow sticker sits in
    the slot's faces, taken in right-handed order starting at the y face."""
    ny = (0, s[1], 0)
    others = [(s[0], 0, 0), (0, 0, s[2])]
    nA, nB = others
    if det([list(ny), list(nA), list(nB)]) < 0:
        nA, nB = nB, nA
    for t, n in enumerate((ny, nA, nB)):
        if stick[slot_index(s, n)] in (2, 3):
            return t
    raise ValueError("corner without a white or yellow sticker")


def edge_flip(s, stick):
    """0 when the edge's primary sticker (white/yellow, else green/blue) is on the
    slot's primary face (its y face, else its z face)."""
    faces = [tuple(s[k] if k == a else 0 for k in range(3)) for a in range(3) if s[a]]
    ref = [n for n in faces if n[1]] or [n for n in faces if n[2]]
    cols = {n: stick[slot_index(s, n)] for n in faces}
    has_y = any(c in (2, 3) for c in cols.values())
    primary = [n for n, c in cols.items() if (c in (2, 3) if has_y else c in (4, 5))][0]
    return 0 if primary == ref[0] else 1


def piece_at(s, stick):
    """Which piece (by home position) sits in slot s."""
    faces = [tuple(s[k] if k == a else 0 for k in range(3)) for a in range(3) if s[a]]
    home = [0, 0, 0]
    for n in faces:
        col = stick[slot_index(s, n)]
        home[col // 2] = 1 if col % 2 == 0 else -1
    return tuple(home)


def parity(perm):
    seen, p = set(), 0
    for i in range(len(perm)):
        if i in seen:
            continue
        j, length = i, 0
        while j not in seen:
            seen.add(j)
            j = perm[j]
            length += 1
        p ^= (length - 1) & 1
    return p


def invariants(stick):
    tw = sum(corner_twist(s, stick) for s in CORNERS) % 3
    fl = sum(edge_flip(s, stick) for s in EDGES) % 2
    cp = parity([CORNERS.index(piece_at(s, stick)) for s in CORNERS])
    ep = parity([EDGES.index(piece_at(s, stick)) for s in EDGES])
    return tw, fl, cp, ep


def legal(stick):
    tw, fl, cp, ep = invariants(stick)
    counts = [stick.count(k) for k in range(6)]
    pieces = sorted(piece_at(s, stick) for s in CORNERS) == sorted(CORNERS) and \
        sorted(piece_at(s, stick) for s in EDGES) == sorted(EDGES)
    return tw == 0 and fl == 0 and cp == ep and counts == [9] * 6 and pieces


# ---- building one mosaic cube -----------------------------------------------------

def requirements(r, c, bits):
    """Allowed colour per slot index (None = free) for text cube (r, c)."""
    req = [None] * 54
    for yl in (-1, 0, 1):
        for zl in (-1, 0, 1):
            i, j = 1 - yl, 1 - zl                       # row down, column left to right
            on = bits[3 * r + i][3 * c + j] == "#"
            req[slot_index((1, yl, zl), (1, 0, 0))] = INK if on else PAPER
    if c == 0:
        for xl in (-1, 0, 1):
            for yl in (-1, 0, 1):
                req[slot_index((xl, yl, 1), (0, 0, 1))] = 4
    return req


def build_cube(req):
    """A legal state meeting req: try each whole-cube orientation O (identity
    first), solving in the cube's own frame, then turn the result by O."""
    order = sorted(ROTATIONS, key=lambda M: M != [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    for M in order:
        local = [None] * 54
        for c in itertools.product((-1, 0, 1), repeat=3):
            for a in range(3):
                for sgn in (1, -1):
                    n = tuple(sgn if k == a else 0 for k in range(3))
                    if c[a] != sgn:
                        continue
                    local[slot_index(c, n)] = req[slot_index(matmul(M, c), matmul(M, n))]
        try:
            st = build_framed(local)
        except ValueError:
            continue
        world = [None] * 54
        for c in itertools.product((-1, 0, 1), repeat=3):
            for a in range(3):
                for sgn in (1, -1):
                    n = tuple(sgn if k == a else 0 for k in range(3))
                    if c[a] == sgn:
                        world[slot_index(matmul(M, c), matmul(M, n))] = st[slot_index(c, n)]
        return world
    raise ValueError("no orientation works")


def build_framed(req):
    solved = solved_state()
    for k, want in enumerate(req):                       # centres are fixed
        if want is not None and solved[k] is not None and k % 9 == 4 and want != solved[k]:
            raise ValueError("a centre cannot change colour")
    stick = [solved[k] if k % 9 == 4 else None for k in range(54)]

    def fits(pl):
        return all(req[k] is None or req[k] == col for k, col in pl.items())

    def constrained(s):
        faces = [tuple(s[k] if k == a else 0 for k in range(3)) for a in range(3) if s[a]]
        return any(req[slot_index(s, n)] is not None for n in faces)

    def assign(slots, pieces):
        slots = sorted(slots, key=lambda s: not constrained(s))
        used = set()
        result = {}

        def go(i):
            if i == len(slots):
                return True
            s = slots[i]
            for h in pieces:
                if h in used:
                    continue
                for pl in placements(h, s):
                    if fits(pl):
                        used.add(h)
                        result[s] = pl
                        if go(i + 1):
                            return True
                        used.discard(h)
                        del result[s]
            return False
        if not go(0):
            raise ValueError("pattern impossible")
        return result

    for s, pl in itertools.chain(assign(CORNERS, CORNERS).items(), assign(EDGES, EDGES).items()):
        for k, col in pl.items():
            stick[k] = col

    def free_slots(slots):
        return [s for s in slots if not constrained(s)]

    def replace(s, pl):
        for k, col in pl.items():
            stick[k] = col

    # corner twist: turn one unseen corner in place
    tw, _, _, _ = invariants(stick)
    if tw:
        s = free_slots(CORNERS)[0]
        h = piece_at(s, stick)
        for pl in placements(h, s):
            old = [stick[k] for k in pl]
            replace(s, pl)
            if invariants(stick)[0] == 0:
                break
            for k, col in zip(pl, old):
                stick[k] = col
    # permutation parity: swap two unseen edges
    _, _, cp, ep = invariants(stick)
    if cp != ep:
        a, b = free_slots(EDGES)[:2]
        ha, hb = piece_at(a, stick), piece_at(b, stick)
        replace(a, placements(hb, a)[0])
        replace(b, placements(ha, b)[0])
    # edge flip: flip one unseen edge
    if invariants(stick)[1]:
        s = free_slots(EDGES)[0]
        h = piece_at(s, stick)
        for pl in placements(h, s):
            old = [stick[k] for k in pl]
            replace(s, pl)
            if invariants(stick)[1] == 0:
                break
            for k, col in zip(pl, old):
                stick[k] = col
    if not legal(stick):
        raise ValueError("could not make the state legal")
    if any(want is not None and stick[k] != want for k, want in enumerate(req)):
        raise ValueError("fix-up disturbed a visible sticker")
    return stick


def build_all():
    bits = bitmap()
    return bits, [build_cube(requirements(r, c, bits)) for r in range(ROWS) for c in range(COLS)]


def write_png(path, w, h, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def wall_picture(states):
    """The +x faces of the text block as text, read back from the states."""
    out = []
    for r in range(ROWS):
        for i in range(3):
            line = ""
            for c in range(COLS):
                st = states[r * COLS + c]
                for j in range(3):
                    col = st[slot_index((1, 1 - i, 1 - j), (1, 0, 0))]
                    line += "#" if col == INK else ("." if col == PAPER else "?")
            out.append(line)
    return out


def main():
    bits, states = build_all()
    rows = [[0] * 64 for _ in range(32)]
    for k, st in enumerate(states):
        for x, col in enumerate(st):
            rows[k][x] = col * 32
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mosaic.png")
    write_png(path, 64, 32, rows)
    print("\n".join(wall_picture(states)))
    print(f"wrote mosaic.png: {len(states)} legal cube states")
    return 0


if __name__ == "__main__":
    sys.exit(main())
