#version 440
// Omacube: an endless isometric stack of 3x3x3 puzzle cubes, drawn flat.
//
// The camera is orthographic and looks straight down the (1,1,1) diagonal,
// so a 3D stack of cubes reads as interlocking hexagonal stars. Every cube
// is a legal puzzle state: a solved cube put through its own scramble.
//
// The physics are real. Neighbouring cubes touch, so a cube can only move
// when it is free (nothing in front of it on any axis). It slides straight
// out of the pile along the view axis, so on screen it stays put, until its
// turning layers clear every neighbour, makes three moves, rests, undoes
// them, and settles back. Neighbours in a layer would hit each other if both
// moved, so they take turns: each cube belongs to one of three classes and
// moves only inside its class's window.
//
// Some rows of top-layer cubes are picture cubes printed with the Omarchy
// logo and O M A R C H Y. Now and then a row speed-solves, holds the word,
// and scrambles again. A sticker's colour, and its print, are found by
// undoing every move back to the solved cube, so they travel with the
// turning layers. MATH.md explains each step and how it is tested.
//
// Qt may run this as GLSL ES 1.00, so it uses no bitwise operators and
// never indexes a vector with a variable.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;     // seconds, wrapped by the host every 4189.5 s (70 min)
    float pan;      // camera position along screen-right, world units, in [0, 3072 * 3 sqrt 2)
    float aspect;   // width / height
    float texel;    // 1 / rendered height in pixels
    float pixelArt; // 1: hard pixel edges and pixel-snapped panning; 0: smooth
    vec4 c0;        // sticker colours of the solved cube: +x, -x, +y, -y, +z, -z
    vec4 c1;
    vec4 c2;
    vec4 c3;
    vec4 c4;
    vec4 c5;
    vec4 bodyColor; // plastic: the lines between stickers, the inner faces, the print
    vec4 bgColor;   // anything a ray misses
};
// The Omarchy lockup, one 512 px cell per glyph: logo, O, M, A, R, C, H, Y.
layout(binding = 1) uniform sampler2D glyphs;

const float HALF_PI = 1.5707963;
const float P = 3.0;          // lattice pitch: neighbouring cubes touch
const float H = 0.5;          // cubie half size, so a cube spans -1.5 .. 1.5
const float R = 2.5980762;    // a cube's circumradius, 1.5 * sqrt(3)
const float VIEW = 15.0;      // half the screen height, world units
const float FILL = 0.92;      // chance a cell in the top four layers is switched on
const float SLOT = 0.95;      // seconds per move slot at speed 8/8
const float TURN = 0.6;       // fraction of a move's time spent turning
const float PERIOD = 1024.0;  // the cell hash repeats every 1024 cells per axis
const float BASE = 5000.0;    // sequence key of a cube's base scramble
const float EPS = 0.004;      // a ray this close to a surface has hit it
const float TMAX = 20.0;      // every ray hits within 13.4 units (see MATH.md)

// Physics (MATH.md, "Physics"): how far a free cube slides out along each
// axis before it turns, and the windows the three classes take turns in.
const float LIFT = 0.63;      // > 3 / sqrt(2) - 1.5 = 0.6213, the least that clears
const float WIN = 9.975;      // seconds per class window; 420 of them make the loop
const float LIFT_S = 0.33;    // seconds an ordinary slide out, or back in, takes

// Words (MATH.md, "Words"): where the lockup is printed and when it is spelled.
const float SITE_ROW = 4.0;   // every 4th row of the top layer can hold sites
const float SITE_BLOCK = 16.0;// one possible site per 16 cells of such a row
const float SITE_LEN = 8.0;   // logo + O M A R C H Y
const float SITE_P = 0.75;    // chance a block holds a site
const float EPOCH = 119.7;    // 12 windows: one chance per site for a word
const float EVENT_P = 0.7;    // chance a site spells its word in an epoch
const float EV_LEAD = 0.1;    // seconds into its window a word cube starts
const float EV_LIFT = 0.25;   // seconds: slide out / back around a solve
const float EV_MOVE = 0.4;    // seconds per solve move: a quick, legible solve
const float EV_SOLVE = 0.0;   // window of the epoch where class 0 solves
const float EV_SCRAMBLE = 6.0;// and where it scrambles again
const float GLYPH = 3.6;      // a glyph cell spans 3.6 x 3.6 world units

// ---- arithmetic helpers ------------------------------------------------------

// a mod b for whole numbers, exact: (a + 0.5) / b is never near an integer.
float imod(float a, float b) { return a - b * floor((a + 0.5) / b); }

float comp(vec3 v, float a) { return a < 0.5 ? v.x : (a < 1.5 ? v.y : v.z); }

vec3 setComp(vec3 v, float a, float x) {
    if (a < 0.5) v.x = x; else if (a < 1.5) v.y = x; else v.z = x;
    return v;
}

// Right-handed rotation about coordinate axis a (0, 1, 2) by angle t.
vec3 rotA(vec3 p, float a, float t) {
    float c = cos(t), s = sin(t);
    if (a < 0.5) return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
    if (a < 1.5) return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// The same rotation by dir * 90 degrees, done exactly: every coefficient is 0 or +-1.
vec3 rot90(vec3 v, float a, float dir) {
    if (a < 0.5) return vec3(v.x, -dir * v.z, dir * v.y);
    if (a < 1.5) return vec3(dir * v.z, v.y, -dir * v.x);
    return vec3(-dir * v.y, dir * v.x, v.z);
}

float sdBox(vec3 p, float b) {
    vec3 q = abs(p) - vec3(b);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Hash of a vector of whole numbers, after Dave Hoskins' "Hash without Sine"
// (MIT). It uses no trig, so it does not depend on how accurate a GPU's
// sin() is, and it does not magnify rounding the way fract(sin(x) * 43758.5)
// does. Every input below is a whole number small enough to be exact.
float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

// ---- cells, word sites and the stack -------------------------------------------

// Cell id modulo 1024 on each axis. Multiplying by 1/1024 is exact.
vec3 cellKey(vec3 id) { return id - PERIOD * floor(id * (1.0 / PERIOD)); }

// Which class a cell is in. The six neighbours of a cell in its layer differ
// from it by (1,-1,0), (1,0,-1), (0,1,-1) and their negatives, which change
// x - y by 2, 1 or -1: never a multiple of 3, so neighbours never share one.
float classOf(vec3 id) { return imod(id.x - id.y, 3.0); }

// The letter a top-layer cell carries, 0 (logo) to 7 (Y), or -1. Sites sit in
// every 4th row of the top layer, at most one per 16-cell block, 8 cells long,
// at a random offset that leaves at least two cells between sites.
float siteLetter(vec3 id) {
    if (abs(id.x + id.y + id.z) > 0.5) return -1.0;
    vec3 key = cellKey(id);
    if (imod(key.y, SITE_ROW) > 0.5) return -1.0;
    float block = floor(key.x * (1.0 / SITE_BLOCK));
    if (hash13(vec3(block, key.y, 3001.0)) >= SITE_P) return -1.0;
    float off = min(floor(hash13(vec3(block, key.y, 3002.0)) * 7.0), 6.0);
    float k = key.x - block * SITE_BLOCK - off;
    return (k > -0.5 && k < SITE_LEN - 0.5) ? k : -1.0;
}

// The stack is a down-set: whenever a cell holds a cube, so do the cells
// behind it along -x, -y and -z. Seen down the diagonal, the surface of a
// down-set is made of whole faces only. A face is exposed when the cell in
// front of it is empty, and every cell that could cover any part of that
// face lies further along all three axes than that empty cell, so it is
// empty too. Random holes with cubes above them would instead show faces cut
// into triangles.
//
// Cells whose ids sum to more than 0 are empty and below -3 are full. In the
// four layers between, each cell is switched on at random, and a cell holds a
// cube only if every cell of its down-cone inside those layers is on: the
// cells id - (a, b, c) with a, b, c >= 0. That cone rule is what makes it a
// down-set, and missing cells leave the stair-stepped hexagonal stars.
// Word sites are always present, and so is everything in their down-cones;
// a union of down-sets is a down-set, so faces stay whole.
bool occupied(vec3 id) {
    float s = id.x + id.y + id.z;
    if (s > 0.5) return false;
    if (s < -3.5) return true;
#if defined(OMACUBE_OLD_FILL)
    return hash13(cellKey(id)) < 0.74;  // the previous rule, to demonstrate its bug
#endif
    // is a site cell id + (a, b, c) with a + b + c = -s? Sites sit only in
    // rows where y is a multiple of 4, so b is fixed.
    float b = imod(-cellKey(id).y, SITE_ROW);
    for (int a = 0; a < 4; a++) {
        float c = -s - float(a) - b;
        if (c < -0.5) break;
        if (siteLetter(id + vec3(float(a), b, c)) > -0.5) return true;
    }
    float room = s + 3.0;               // 0..3: cone depth left inside the band
    for (int a = 0; a < 4; a++) {
        if (float(a) > room + 0.5) break;
        for (int b = 0; b < 4; b++) {
            if (float(a + b) > room + 0.5) break;
            for (int c = 0; c < 4; c++) {
                if (float(a + b + c) > room + 0.5) break;
                if (hash13(cellKey(id - vec3(float(a), float(b), float(c)))) >= FILL) return false;
            }
        }
    }
    return true;
}

// A cube is free when the three cells in front of it are empty; in a down-set
// that empties every cell further along all three axes, so its slide out
// along (1,1,1) is clear. Top-layer cubes are always free.
bool freeAt(vec3 id) {
    if (id.x + id.y + id.z > -0.5) return true;
    return !occupied(id + vec3(1.0, 0.0, 0.0)) && !occupied(id + vec3(0.0, 1.0, 0.0))
        && !occupied(id + vec3(0.0, 0.0, 1.0));
}

// ---- moves -------------------------------------------------------------------------

// Speed m / 8 with m in {6, ..., 11}: a move slot lasts 0.95 s * m / 8.
float speedM(vec3 key) {
    return 6.0 + min(floor(hash13(key + vec3(2048.0, 0.0, 0.0)) * 6.0), 5.0);
}
float cubeIdOf(vec3 key) { return floor(hash13(key + vec3(0.0, 0.0, 2048.0)) * 65536.0); }
float baseLen(vec3 key)  { return min(floor(hash13(key + vec3(2048.0, 2048.0, 0.0)) * 21.0), 20.0); }

// A move code v (0..19) decodes to: axis step 1 or 2 (consecutive moves never
// share an axis, so no move cancels the one before), layer -1, 0, 1 or the
// whole cube (2 in 5 moves), and direction +1 or -1. All exact.
void decode(float v, out float stp, out float layer, out float dir) {
    stp = imod(v, 2.0) + 1.0;
    float code = imod(floor(v * 0.5), 5.0);
    layer = code < 2.5 ? code - 1.0 : 2.0;
    dir = v < 9.5 ? 1.0 : -1.0;
}

float moveCode(float id, float seq, float j) { return min(floor(hash13(vec3(id, seq, j)) * 20.0), 19.0); }
float firstAxis(float id, float seq) { return min(floor(hash13(vec3(id, seq, 63.0)) * 3.0), 2.0); }

// The three moves of one burst. Geometry and colour both use this one
// function, so they cannot disagree about which layer turned.
void cycleMoves(float id, float seq, out vec3 ax, out vec3 ly, out vec3 dr) {
    float stp, layer, dir;
    float a = firstAxis(id, seq);
    decode(moveCode(id, seq, 0.0), stp, layer, dir);
    ax.x = a; ly.x = layer; dr.x = dir;
    decode(moveCode(id, seq, 1.0), stp, layer, dir);
    a = imod(a + stp, 3.0);
    ax.y = a; ly.y = layer; dr.y = dir;
    decode(moveCode(id, seq, 2.0), stp, layer, dir);
    a = imod(a + stp, 3.0);
    ax.z = a; ly.z = layer; dr.z = dir;
}

// Move j of a cube's base scramble. homeOf() walks the same sequence.
void baseMove(float id, float j, out float axis, out float layer, out float dir) {
    float stp;
    float a = firstAxis(id, BASE);
    for (int i = 1; i < 20; i++) {
        if (float(i) > j + 0.5) break;
        decode(moveCode(id, BASE, float(i)), stp, layer, dir);
        a = imod(a + stp, 3.0);
    }
    decode(moveCode(id, BASE, j), stp, layer, dir);
    axis = a;
}

float easeTurn(float x) {
    // a fast flick that overshoots ~10% and settles exactly at 1
    x = clamp(x, 0.0, 1.0);
    float y = x - 1.0;
    return 1.0 + 2.7 * y * y * y + 1.7 * y * y;
}

struct Cube {
    float id;      // hashes this cube's moves
    float cycKey;  // which burst it is in (its moves change every burst)
    float pre;     // moves of this burst applied, 0..3
    float nb;      // moves of the base scramble applied (fewer while a word solves)
    float axis;    // the move in progress: axis, layer, angle (0 = none)
    float layer;
    float ang;
    float lift;    // how far it has slid out along each axis, 0..LIFT
    float letter;  // printed glyph, or -1
    float src;     // where the move in progress comes from: 0 none, 1 pair, 2 base
    float idx;     // which move of that source
    float sgn;     // +1 making it, -1 undoing it
};

void noMove(inout Cube c) {
    c.axis = 0.0; c.layer = 0.0; c.ang = 0.0; c.src = 0.0; c.idx = -1.0; c.sgn = 1.0;
}

// An ordinary cube. Once in each window of its class, at a random moment,
// a free cube slides out, makes three moves, rests, undoes them, and
// settles back. Outside that burst every cube rests at its base scramble, so
// the free test is only needed during one.
void ordinaryState(vec3 cid, vec3 key, inout Cube c) {
    float cls = classOf(cid);
    float w = floor(time / WIN);
    if (imod(w - cls, 3.0) > 0.5) return;
    float sl = SLOT * speedM(key) / 8.0;                // seconds per move slot
    float burst = 2.0 * LIFT_S + (6.0 + TURN) * sl;     // at most 9.73 s < WIN
    float j = floor((w - cls) / 3.0 + 0.5);             // which of its class's windows
    c.cycKey = imod(j, 140.0);                          // 140 per loop, new moves each
    float tau = time - w * WIN - hash13(vec3(c.id, c.cycKey, 77.0)) * (WIN - burst - 0.05);
    if (tau < 0.0 || tau >= burst || !freeAt(cid)) return;
    if (tau < LIFT_S) {
        c.lift = LIFT * smoothstep(0.0, 1.0, tau / LIFT_S);
        return;
    }
    float u = tau - LIFT_S;
    if (u < (6.0 + TURN) * sl) {
        float k = min(floor(u / sl), 6.0);              // slots: 3 moves, rest, 3 undone
        float f = u - k * sl;
        c.lift = LIFT;
        if (k > 2.5 && k < 3.5) { c.pre = 3.0; return; }
        c.src = 1.0;
        if (k < 2.5) { c.pre = k; c.idx = k; c.sgn = 1.0; }
        else         { c.pre = 7.0 - k; c.idx = 6.0 - k; c.sgn = -1.0; }
#if !defined(OMACUBE_STATIC)
        vec3 ax, ly, dr;
        cycleMoves(c.id, c.cycKey, ax, ly, dr);
        c.axis = comp(ax, c.idx);
        c.layer = comp(ly, c.idx);
        c.ang = c.sgn * comp(dr, c.idx) * easeTurn(f / (TURN * sl)) * HALF_PI;
#endif
        return;
    }
    c.lift = LIFT * (1.0 - smoothstep(0.0, 1.0, (u - (6.0 + TURN) * sl) / LIFT_S));
}

// A word cube. It rests at its base scramble, except in an epoch where its
// site spells the word: then, in its class's window, it slides out, undoes
// its whole scramble at speed, and settles; holds the word; and in a later
// window of its class does the scramble again.
void siteState(vec3 cid, vec3 key, float nbase, inout Cube c) {
    float ep = floor(time / EPOCH);
    float block = floor(key.x * (1.0 / SITE_BLOCK));
    if (hash13(vec3(block, key.y, 4000.0 + imod(ep, 35.0))) >= EVENT_P) return;  // 35 epochs a loop
    float T0 = ep * EPOCH;
    float cls = classOf(cid);
    float R0 = T0 + (EV_SCRAMBLE + cls) * WIN + EV_LEAD;
    bool undo = time < R0;
    float u = time - (undo ? T0 + (EV_SOLVE + cls) * WIN + EV_LEAD : R0);
    if (u < EV_LIFT) {
        c.nb = undo ? nbase : 0.0;
        c.lift = LIFT * smoothstep(0.0, 1.0, u / EV_LIFT);   // 0 while u < 0
        return;
    }
    u -= EV_LIFT;
    if (u < nbase * EV_MOVE) {
        float j = floor(u / EV_MOVE);
        float f = u - j * EV_MOVE;
        c.lift = LIFT;
        c.src = 2.0;
        if (undo) { c.nb = nbase - j; c.idx = nbase - 1.0 - j; c.sgn = -1.0; }
        else      { c.nb = j;         c.idx = j;               c.sgn = 1.0; }
#if !defined(OMACUBE_STATIC)
        float dir;
        baseMove(c.id, c.idx, c.axis, c.layer, dir);
        c.ang = c.sgn * dir * easeTurn(f / (EV_MOVE * TURN)) * HALF_PI;
#endif
        return;
    }
    c.nb = undo ? 0.0 : nbase;
    c.lift = LIFT * (1.0 - smoothstep(0.0, 1.0, (u - nbase * EV_MOVE) / EV_LIFT));
}

Cube cubeState(vec3 cid) {
    Cube c;
    vec3 key = cellKey(cid);
    c.id = cubeIdOf(key);
    c.cycKey = 0.0; c.pre = 0.0; c.lift = 0.0;
    c.nb = baseLen(key);
    c.letter = siteLetter(cid);
    noMove(c);
    if (c.letter > -0.5) siteState(cid, key, c.nb, c);
    else ordinaryState(cid, key, c);       // tests freeAt() only mid-burst
#if defined(OMACUBE_STATIC)
    c.lift = 0.0;                        // self-check 6: nothing turns or slides
#endif
    return c;
}

// Distance to one cube centred at the origin of q. The nearest cubie comes
// from rounding to the grid and clamping to the cube; cubies touch (H = 0.5),
// so this is exact everywhere outside the cube.
float cubeSDF(vec3 q, float axis, float layer, float ang, out vec3 cell, out vec3 lp, out bool moving) {
    moving = false;
    bool turning = abs(ang) > 1e-4;
    if (turning && layer > 1.5) {                       // the whole cube tumbles
        vec3 qr = rotA(q, axis, -ang);
        cell = clamp(floor(qr + 0.5), -1.0, 1.0);
        lp = qr - cell;
        moving = true;
        return sdBox(lp, H);
    }
    vec3 c = clamp(floor(q + 0.5), -1.0, 1.0);
    if (turning && comp(c, axis) == layer) {
        // that layer is drawn below; take the nearest layer that stays put
        float other = layer == 0.0 ? (comp(q, axis) >= 0.0 ? 1.0 : -1.0) : 0.0;
        c = setComp(c, axis, other);
    }
    cell = c;
    lp = q - c;
    float d = sdBox(lp, H);
    if (turning) {
        vec3 qr = rotA(q, axis, -ang);
        vec3 cm = setComp(clamp(floor(qr + 0.5), -1.0, 1.0), axis, layer);
        float dm = sdBox(qr - cm, H);
        if (dm < d) { d = dm; cell = cm; lp = qr - cm; moving = true; }
    }
    return d;
}

struct Hit {
    vec3 cell;     // cubie, in its cube's frame before the move in progress
    vec3 lp;       // hit point relative to that cubie, same frame
    vec3 key;      // the cube's cell key
    vec3 cid;      // the cube's lattice cell
    float id;      // the cube's move hash id
    float cycKey;
    float pre;
    float nb;
    float letter;
    float axis;    // rotation of the cubie's frame (ang = 0: not moving)
    float ang;
    float lift;    // how far the cube has slid out: it is nearer by lift * sqrt(3)
#if defined(OMACUBE_DEBUG)
    float src;     // geometry's view of the move in progress
    float idx;
    float sgn;
    float mvAxis;
    float mvLayer;
    float mvAng;
#endif
};

void fillHit(inout Hit hit, Cube cb, vec3 id, vec3 cell, vec3 lp, bool moving) {
    hit.cell = cell; hit.lp = lp; hit.key = cellKey(id); hit.cid = id;
    hit.id = cb.id; hit.cycKey = cb.cycKey; hit.pre = cb.pre; hit.nb = cb.nb;
    hit.letter = cb.letter;
    hit.axis = cb.axis; hit.ang = moving ? cb.ang : 0.0;
    hit.lift = cb.lift;
#if defined(OMACUBE_DEBUG)
    hit.src = cb.src; hit.idx = cb.idx; hit.sgn = cb.sgn;
    hit.mvAxis = cb.axis; hit.mvLayer = cb.layer; hit.mvAng = cb.ang;
#endif
}

// Drawing a slid-out cube. It slides along (1,1,1), straight towards the
// viewer, so a ray hits exactly the same point of it as before, only nearer,
// by lift * sqrt(3). So the march below runs on the stack with every cube in
// its cell (turning layers and all), where it can take long, safe steps, and
// main() then checks the few cubes that are slid out right now and cover the
// pixel, and keeps whichever surface is nearest. MATH.md, "Drawing it".

// Distance from p to the nearest cube, every cube in its cell. The eight
// cells around p (its own and the neighbours on the sides p is closest to)
// are measured exactly. Any other cube's centre is at least 3 + min|q0| from
// p, and no part of a cube is farther than R from its centre, so those cubes
// are at least 3 + min|q0| - R away. Taking that as a cap keeps the estimate
// from ever exceeding the true distance, so the march cannot step through a cube.
// Per-ray cache. A ray usually spends several steps among the same eight
// cells, so each cell's occupancy and cube state is worked out once, the
// first time the ray needs it, and reused while the ray stays there.
vec3 gId0;
vec3 gSd;
float gKnown[8];                        // 0 = not worked out, 1 = empty, 2 = a cube
Cube gCube[8];

float mapScene(vec3 p, out Hit hit) {
    vec3 id0 = floor(p * (1.0 / P) + 0.5);
    vec3 q0 = p - id0 * P;
    vec3 sd = vec3(q0.x >= 0.0 ? 1.0 : -1.0, q0.y >= 0.0 ? 1.0 : -1.0, q0.z >= 0.0 ? 1.0 : -1.0);
    vec3 aq = abs(q0);
    if (id0 != gId0 || sd != gSd) {
        gId0 = id0;
        gSd = sd;
        for (int i = 0; i < 8; i++) gKnown[i] = 0.0;
    }
#if defined(OMACUBE_NO_FAR_BOUND)
    float d = 1e9;      // the previous scheme, kept only to demonstrate its bug
#else
    float d = P + min(aq.x, min(aq.y, aq.z)) - R;
#endif
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        vec3 o = vec3(imod(fi, 2.0), imod(floor(fi * 0.5), 2.0), floor(fi * 0.25));
        vec3 id = id0 + o * sd;
        vec3 q = p - id * P;
        if (length(q) - R > d) continue;                // too far to matter
        if (gKnown[i] < 0.5) {
            gKnown[i] = occupied(id) ? 2.0 : 1.0;
            if (gKnown[i] > 1.5) gCube[i] = cubeState(id);
        }
        if (gKnown[i] < 1.5) continue;
        Cube cb = gCube[i];
        vec3 cell, lp;
        bool moving;
        float dc = cubeSDF(q, cb.axis, cb.layer, cb.ang, cell, lp, moving);
        if (dc < d) {
            d = dc;
            fillHit(hit, cb, id, cell, lp, moving);
        }
    }
#if defined(OMACUBE_NO_FAR_BOUND)
    if (d > 1e8) {
        vec3 b = P * 0.5 - aq;
        d = max(min(b.x, min(b.y, b.z)), 0.0) + 0.05;
    }
#endif
    return d;
}

// One cube on its own, in its cell: where along the ray it is first hit.
bool traceCube(vec3 id, Cube cb, vec3 ro, vec3 fw, inout Hit hit, out float t) {
    vec3 c = id * P;
    float tc = dot(c - ro, fw);
    t = tc - R;
    for (int i = 0; i < 64; i++) {
        vec3 cell, lp;
        bool moving;
        float d = cubeSDF(ro + fw * t - c, cb.axis, cb.layer, cb.ang, cell, lp, moving);
        if (d < EPS) { fillHit(hit, cb, id, cell, lp, moving); return true; }
        t += d;
        if (t > tc + R) return false;
    }
    return false;
}

#if defined(OMACUBE_DEBUG)
// The direct way, for self-check 8: march the stack with every cube where it
// really is, slid out or not. A cube's centre lies on each axis in
// [3j, 3j + LIFT]; the eight cells are the two nearest such intervals on each
// axis, and on any other cell's axis the interval is at least
// 3 + |q| - LIFT/2 away, so 3 + min|q| - LIFT/2 - R (at least 0.087) caps
// the estimate safely. Correct, but the small cap makes it slow.
float mapSceneSlid(vec3 p, out Hit hit) {
    vec3 id0 = floor((p - 0.5 * LIFT) * (1.0 / P) + 0.5);
    vec3 q0 = p - id0 * P - 0.5 * LIFT;
    vec3 sd = vec3(q0.x >= 0.0 ? 1.0 : -1.0, q0.y >= 0.0 ? 1.0 : -1.0, q0.z >= 0.0 ? 1.0 : -1.0);
    vec3 aq = abs(q0);
    if (id0 != gId0 || sd != gSd) {
        gId0 = id0;
        gSd = sd;
        for (int i = 0; i < 8; i++) gKnown[i] = 0.0;
    }
    float d = P + min(aq.x, min(aq.y, aq.z)) - 0.5 * LIFT - R;
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        vec3 o = vec3(imod(fi, 2.0), imod(floor(fi * 0.5), 2.0), floor(fi * 0.25));
        vec3 id = id0 + o * sd;
        if (length(p - id * P - 0.5 * LIFT) - R - 0.5 * LIFT * 1.7320508 > d) continue;
        if (gKnown[i] < 0.5) {
            gKnown[i] = occupied(id) ? 2.0 : 1.0;
            if (gKnown[i] > 1.5) gCube[i] = cubeState(id);
        }
        if (gKnown[i] < 1.5) continue;
        Cube cb = gCube[i];
        vec3 cell, lp;
        bool moving;
        float dc = cubeSDF(p - id * P - vec3(cb.lift), cb.axis, cb.layer, cb.ang, cell, lp, moving);
        if (dc < d) {
            d = dc;
            fillHit(hit, cb, id, cell, lp, moving);
        }
    }
    return d;
}
#endif

// ---- colour ------------------------------------------------------------------------

vec3 stickerColor(vec3 n) {
    if (n.x > 0.5) return c0.rgb;
    if (n.x < -0.5) return c1.rgb;
    if (n.y > 0.5) return c2.rgb;
    if (n.y < -0.5) return c3.rgb;
    if (n.z > 0.5) return c4.rgb;
    return c5.rgb;
}

// Undo one quarter turn if the cubie at c is part of it. The point l on the
// sticker turns with it, so printed stickers keep their orientation.
void undoMove(inout vec3 c, inout vec3 n, inout vec3 l, float axis, float layer, float dir) {
    if (layer > 1.5 || abs(comp(c, axis) - layer) < 0.5) {
        c = rot90(c, axis, -dir);
        n = rot90(n, axis, -dir);
        l = rot90(l, axis, -dir);
    }
}

// Where a sticker started on the solved cube: undo this burst's applied
// moves, newest first, then the applied part of the base scramble, newest
// first. The base moves are decoded once, forwards, then undone backwards.
void homeOf(Hit h, inout vec3 c, inout vec3 n, inout vec3 l) {
    if (h.pre > 0.5) {
        vec3 ax, ly, dr;
        cycleMoves(h.id, h.cycKey, ax, ly, dr);
        if (h.pre > 2.5) undoMove(c, n, l, ax.z, ly.z, dr.z);
        if (h.pre > 1.5) undoMove(c, n, l, ax.y, ly.y, dr.y);
        undoMove(c, n, l, ax.x, ly.x, dr.x);
    }
    float axs[20];
    float lys[20];
    float drs[20];
    float stp, layer, dir;
    float a = firstAxis(h.id, BASE);
    for (int j = 0; j < 20; j++) {
        if (float(j) >= h.nb) break;
        decode(moveCode(h.id, BASE, float(j)), stp, layer, dir);
        if (j > 0) a = imod(a + stp, 3.0);              // consecutive moves change axis
        axs[j] = a; lys[j] = layer; drs[j] = dir;
    }
    for (int i = 0; i < 20; i++) {                      // undo base moves nb-1 .. 0
        int j = 19 - i;
        if (float(j) >= h.nb) continue;
        undoMove(c, n, l, axs[j], lys[j], drs[j]);
    }
}

#if defined(OMACUBE_DEBUG)
// Brute-force distance over all 27 surrounding cells, for checking mapScene.
// Cubes two or more cells away are at least 6 - max|q0| - R from p.
float mapRef(vec3 p) {
    vec3 id0 = floor(p * (1.0 / P) + 0.5);
    vec3 aq = abs(p - id0 * P);
    float d = 2.0 * P - max(aq.x, max(aq.y, aq.z)) - R;
    for (int i = 0; i < 27; i++) {
        float fi = float(i);
        vec3 o = vec3(imod(fi, 3.0), imod(floor(fi / 3.0 + 0.01), 3.0), floor(fi / 9.0 + 0.01)) - 1.0;
        vec3 id = id0 + o;
        if (!occupied(id)) continue;
        Cube cb = cubeState(id);
        vec3 cell, lp;
        bool moving;
        d = min(d, cubeSDF(p - id * P, cb.axis, cb.layer, cb.ang, cell, lp, moving));
    }
    return d;
}
#endif

void main() {
    gId0 = vec3(1e9);                                  // empty ray cache
    gSd = vec3(0.0);
    vec2 uv = (qt_TexCoord0 - 0.5) * vec2(aspect, -1.0) * (2.0 * VIEW);

    // Orthographic camera down the (1,1,1) diagonal. rt, up and fw are
    // orthonormal with rt x up = -fw, so this is a true isometric projection
    // and the image is not mirrored. +y points up the screen.
    vec3 fw = vec3(-0.57735027);
    vec3 rt = vec3(0.70710678, 0.0, -0.70710678);
    vec3 up = vec3(-0.40824829, 0.81649658, -0.40824829);

    // Workspace switches slide the camera sideways along rt. rt lies in the
    // plane of the stack's top, so the camera stays the same height above it.
    // Rays start at coordinate sum 4.6: with every cube in its cell, no part
    // of any cube reaches above 4.5.
    float px = 2.0 * VIEW * texel;                      // world units per pixel
    float slide = pixelArt > 0.5 ? floor(pan / px + 0.5) * px : pan;  // whole pixels in pixel art
    vec3 ro = rt * (slide + uv.x) + up * uv.y - fw * 2.6558;

    // Sphere tracing: mapScene never overestimates, so stepping by d can
    // never pass through a cube. Most rays hit in about 9 steps. A ray that
    // runs alongside a face tumbled edge-on to the view crawls in small
    // steps; the worst seen in testing took about 216, hence the budget.
    float t = 0.0;
    float d = 1.0;
    bool hitAny = false;
    Hit h;
#if defined(OMACUBE_DEBUG)
    float steps = 0.0;
    bool unsafe = false;
#endif
    for (int i = 0; i < 256; i++) {
        vec3 p = ro + fw * t;
        d = mapScene(p, h);
#if defined(OMACUBE_DEBUG)
        steps += 1.0;
        if (d > mapRef(p) + 1e-3) unsafe = true;
#endif
        if (d < EPS) { hitAny = true; break; }
        t += d;
        if (t > TMAX) break;
    }
    // If a grazing ray still runs out of steps, it ended beside a face seen
    // almost edge-on. That is a silhouette pixel: if it is within one pixel
    // of a cube, count it as a hit.
    bool grazed = false;
    if (!hitAny && t <= TMAX && d < px) { hitAny = true; grazed = true; }

    // Slid-out cubes are nearer than the march saw them, by lift * sqrt(3).
    // Only free cubes of the class whose window it is can be out, and a cube
    // reaches no farther than R from its centre's column on screen. Columns
    // are the lines (i, j, 0) + n (1, 1, 1); each projects to one point.
    float tBest = hitAny ? t - h.lift * 1.7320508 : 1e9;
    vec2 sp = vec2(slide + uv.x, uv.y);                 // the ray's spot on screen
    float fi = sp.x * 0.47140452;                       // sqrt(2) / 3
    float fj = (sp.y * 0.81649658 + fi) * 0.5;          // sqrt(6) / 3
    float win = floor(time / WIN);
    for (int di = -1; di <= 1; di++) {
        for (int dj = -1; dj <= 1; dj++) {
            float ci = floor(fi + 0.5) + float(di);
            float cj = floor(fj + 0.5) + float(dj);
            vec2 cp = vec2(ci * 2.1213203, (2.0 * cj - ci) * 1.2247449);
            if (length(cp - sp) > R) continue;
            float nTop = floor(-(ci + cj) / 3.0);       // the column's highest cell with sum <= 0
            for (int k = 0; k < 2; k++) {
                float n = nTop - float(k);
                vec3 b = vec3(ci + n, cj + n, n);
                if (b.x + b.y + b.z < -3.5) break;      // below the band nothing moves
                if (hitAny && b == h.cid) continue;     // the march's own cube: done above
                if (imod(win - classOf(b), 3.0) > 0.5) continue;
                Cube cb = cubeState(b);
                if (cb.lift <= 0.0 || !occupied(b)) continue;
                Hit hy;
                float ty;
                if (traceCube(b, cb, ro, fw, hy, ty) && ty - cb.lift * 1.7320508 < tBest) {
                    tBest = ty - cb.lift * 1.7320508;
                    h = hy;
                    hitAny = true;
                    grazed = false;
                }
            }
        }
    }

    vec3 col = bgColor.rgb;
    vec3 nl = vec3(0.0);                                // hit face normal, cubie frame
    float shownCover = 0.0;                             // how much of the pixel is sticker
    if (hitAny) {
        // which face of the cubie was hit, in the cubie's own frame
        vec3 lp = h.lp;
        vec3 al = abs(lp);
        vec2 fuv;
        float fa;
        if (al.x >= al.y && al.x >= al.z) { nl = vec3(sign(lp.x), 0.0, 0.0); fuv = lp.yz; fa = 0.0; }
        else if (al.y >= al.z)            { nl = vec3(0.0, sign(lp.y), 0.0); fuv = lp.xz; fa = 1.0; }
        else                              { nl = vec3(0.0, 0.0, sign(lp.z)); fuv = lp.xy; fa = 2.0; }

        col = bodyColor.rgb;
        if (dot(h.cell, nl) > 0.5) {                    // outer faces carry stickers
            // Rounded-square sticker: half size 0.43, corner radius 0.035,
            // pulled in a little more on sides where this cubie meets the
            // next cube, so every cube reads on its own in a flat run.
            vec2 ce = fa < 0.5 ? h.cell.yz : (fa < 1.5 ? h.cell.xz : h.cell.xy);
            vec2 lo = vec2(-0.43) + 0.045 * step(0.5, -ce);
            vec2 hi = vec2(0.43) - 0.045 * step(0.5, ce);
            vec2 ctr = 0.5 * (lo + hi);
            vec2 sq = abs(fuv - ctr) - (0.5 * (hi - lo) - 0.035);
            float sd = length(max(sq, 0.0)) + min(max(sq.x, sq.y), 0.0) - 0.035;
            // Antialias over exactly one screen pixel. The projection is
            // orthographic, so a one-pixel step on screen moves the hit point
            // linearly within the face plane; measure how much sd changes.
            vec2 rel = fuv - ctr;
            vec2 g = (sq.x > 0.0 && sq.y > 0.0) ? sign(rel) * normalize(sq)
                   : (sq.x > sq.y ? vec2(sign(rel.x), 0.0) : vec2(0.0, sign(rel.y)));
            vec3 nw = rotA(nl, h.axis, h.ang);          // face normal in the world
            float nf = min(dot(nw, fw), -0.05);
            vec3 dx = rotA((rt - fw * (dot(nw, rt) / nf)) * px, h.axis, -h.ang);
            vec3 dy = rotA((up - fw * (dot(nw, up) / nf)) * px, h.axis, -h.ang);
            vec2 fx = fa < 0.5 ? dx.yz : (fa < 1.5 ? dx.xz : dx.xy);
            vec2 fy = fa < 0.5 ? dy.yz : (fa < 1.5 ? dy.xz : dy.xy);
            float w = max(abs(dot(g, fx)) + abs(dot(g, fy)), 1e-5);
            // pixel art: a pixel is all sticker or all plastic, theme colours only
            float cover = pixelArt > 0.5 ? step(sd, 0.0) : clamp(0.5 - sd / w, 0.0, 1.0);
            shownCover = cover;
            if (cover > 0.0) {
                vec3 c = h.cell, n = nl, l = h.lp;
                homeOf(h, c, n, l);
                vec3 stk = stickerColor(n);
                // Picture cubes: the glyph is printed across the three faces
                // that face the viewer when the cube is solved, so that seen
                // from here it reads undistorted: each point carries the ink
                // at its own screen offset from the cube's centre.
                if (h.letter > -0.5 && n.x + n.y + n.z > 0.5) {
                    vec3 hp = c + l;
                    vec2 gq = vec2(dot(hp, rt), dot(hp, up)) * (1.0 / GLYPH) + 0.5;
                    if (gq.x > 0.0 && gq.x < 1.0 && gq.y > 0.0 && gq.y < 1.0) {
                        float ink = texture(glyphs, vec2((h.letter + gq.x) * (1.0 / SITE_LEN), 1.0 - gq.y)).r;
                        ink = pixelArt > 0.5 ? step(0.5, ink) : ink;
                        stk = mix(stk, bodyColor.rgb, ink);
                    }
                }
                // blend in linear light, then back to sRGB
                vec3 body = pow(bodyColor.rgb, vec3(2.2));
                col = pow(mix(body, pow(stk, vec3(2.2)), cover), vec3(1.0 / 2.2));
            }
        }
    }

#if defined(OMACUBE_DEBUG)
    // Self-checks, built only by dev/selfcheck.sh. Magenta marks a failure.
    vec3 bad = vec3(1.0, 0.0, 1.0);
    vec3 dim = col * 0.3;
#if OMACUBE_DEBUG == 1
    // the distance estimate never exceeded the brute-force distance
    col = unsafe ? bad : dim;
#elif OMACUBE_DEBUG == 2
    // the move geometry animates is the move colour will undo or apply next
    col = dim;
    if (hitAny && h.src > 0.5) {
        float ax, ly, dr;
        if (h.src < 1.5) {
            vec3 ax3, ly3, dr3;
            cycleMoves(h.id, h.cycKey, ax3, ly3, dr3);
            ax = comp(ax3, h.idx); ly = comp(ly3, h.idx); dr = comp(dr3, h.idx);
            // making move idx: idx moves applied; undoing it: idx + 1
            if (h.pre != h.idx + (h.sgn > 0.0 ? 0.0 : 1.0)) col = bad;
        } else {
            baseMove(h.id, h.idx, ax, ly, dr);
            // re-scrambling move idx: idx applied; solving it away: idx + 1
            if (h.nb != h.idx + (h.sgn > 0.0 ? 0.0 : 1.0)) col = bad;
        }
        bool same = ax == h.mvAxis && ly == h.mvLayer
                 && (abs(h.mvAng) < 1e-4 || sign(h.sgn * dr) == sign(h.mvAng));
        if (!same) col = bad;
    }
#elif OMACUBE_DEBUG == 3
    // march cost: grey = steps / 256; orange = a grazing silhouette ray,
    // accepted; blue = left the stack; magenta = a ray that truly missed
    if (grazed) col = vec3(1.0, 0.5, 0.0);
    else col = hitAny ? vec3(steps / 256.0) : (t > TMAX ? vec3(0.0, 0.0, 1.0) : bad);
#elif OMACUBE_DEBUG == 4
    // the visible cubie is a rigid copy of one solved cubie
    col = dim;
    if (hitAny) {
        vec3 home0 = vec3(9.0);
        float axisMask = 0.0;
        bool ok = true;
        for (int k = 0; k < 3; k++) {
            float fk = float(k);
            float ck = comp(h.cell, fk);
            if (abs(ck) < 0.5) continue;
            vec3 c = h.cell;
            vec3 n = setComp(vec3(0.0), fk, ck);
            vec3 l = vec3(0.0);
            homeOf(h, c, n, l);
            if (home0.x > 8.0) home0 = c;
            ok = ok && c == home0 && dot(c, n) > 0.5;
            float na = abs(n.x) > 0.5 ? 1.0 : (abs(n.y) > 0.5 ? 2.0 : 4.0);
            ok = ok && imod(floor(axisMask / na), 2.0) < 0.5;
            axisMask += na;
        }
        if (!ok) col = bad;
    }
#elif OMACUBE_DEBUG == 6
    // with nothing turning, a visible pixel on a cube face whose two
    // partial coverers (the cells beside the cell in front of it) hold a
    // cube belongs to a face cut into a triangle
    col = dim;
    if (hitAny && dot(h.cell, nl) > 0.5) {
        vec3 front = h.cid + nl;
        vec3 e1 = abs(nl.x) > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 e2 = abs(nl.z) > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
        if (occupied(front + e1) || occupied(front + e2)) col = bad;
    }
#elif OMACUBE_DEBUG == 8
    // the fast two-step drawing finds the same cube, at the same spot, as
    // marching the stack directly with every cube where it really is
    col = dim;
    {
        gId0 = vec3(1e9);
        gSd = vec3(0.0);
        vec3 ro2 = ro - fw * 1.15;                      // start above slid-out cubes too
        float t2 = 0.0;
        float d2 = 1.0;
        bool hit2 = false;
        Hit h2;
        for (int i = 0; i < 512; i++) {
            d2 = mapSceneSlid(ro2 + fw * t2, h2);
            if (d2 < EPS) { hit2 = true; break; }
            t2 += d2;
            if (t2 > TMAX + 2.0) break;
        }
        // only sticker pixels count: where three touching cubes meet, a ray
        // can slip through a pinhole on the plastic in one march and not the
        // other, while a missed slid-out cube would show across its stickers
        if (shownCover < 0.99 || grazed) {}
        else if (hit2 != hitAny) col = bad;
        else if (hit2 && hitAny) {
            vec3 pa = ro + fw * tBest;                  // where the fast way says
            vec3 pb = ro2 + fw * t2;                    // where the direct way says
            // cubes touch, so on a shared seam either may be credited with
            // the hit; a missed slid-out cube would be off by up to 1.09
            if (abs(dot(pa - pb, fw)) > 0.02) col = bad;
        }
    }
#elif OMACUBE_DEBUG == 7
    // a word cube at rest with nothing applied is exactly solved: every
    // sticker's home is where it is, so the print lines up
    col = dim;
    if (hitAny && h.letter > -0.5 && h.nb < 0.5 && h.pre < 0.5 && dot(h.cell, nl) > 0.5) {
        vec3 c = h.cell, n = nl, l = h.lp;
        homeOf(h, c, n, l);
        if (c != h.cell || n != nl || length(l - h.lp) > 1e-5) col = bad;
        else col = vec3(0.0, 0.6, 0.0);
    }
#endif
#endif
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
