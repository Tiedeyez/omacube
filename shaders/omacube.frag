#version 440
// Omacube: an endless isometric stack of 3x3x3 puzzle cubes, drawn flat.
//
// The camera is orthographic and looks straight down the (1,1,1) diagonal,
// so a 3D stack of cubes reads as interlocking hexagonal stars. Every cube
// is a legal puzzle state: a solved cube put through its own scramble. On
// its own clock it makes three moves (a layer turn or a whole-cube tumble),
// rests, undoes them, and rests again. A sticker's colour is found by
// undoing every move back to the solved cube, so colours always travel
// with the turning layers. MATH.md explains each step and how it is tested.
//
// Qt may run this as GLSL ES 1.00, so it uses no bitwise operators and
// never indexes a vector with a variable.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;     // seconds, wrapped by the host every 4189.5 s (70 min)
    float drift;    // camera position along the lattice vector (3,3,-6), in [0, 1024)
    float spin;     // view roll, radians
    float aspect;   // width / height
    float texel;    // 1 / rendered height in pixels
    vec4 c0;        // sticker colours of the solved cube: +x, -x, +y, -y, +z, -z
    vec4 c1;
    vec4 c2;
    vec4 c3;
    vec4 c4;
    vec4 c5;
    vec4 bodyColor; // plastic: the lines between stickers and the inner faces
    vec4 bgColor;   // anything a ray misses
};

const float HALF_PI = 1.5707963;
const float P = 3.0;          // lattice pitch: neighbouring cubes touch
const float H = 0.5;          // cubie half size, so a cube spans -1.5 .. 1.5
const float R = 2.5980762;    // a cube's circumradius, 1.5 * sqrt(3)
const float VIEW = 15.0;      // half the screen height, world units
const float FILL = 0.74;      // chance a cell in the top four layers holds a cube
const float SLOT = 0.95;      // seconds per move slot at speed 8/8
const float TURN = 0.6;       // fraction of a slot spent turning
const float CYCLE = 14.0;     // slots per cycle: 3 moves, 4 rest, 3 undo, 4 rest
const float PERIOD = 1024.0;  // the cell hash repeats every 1024 cells per axis
const float BASE = 5000.0;    // sequence key of a cube's base scramble
const float EPS = 0.004;      // a ray this close to a surface has hit it
const float TMAX = 20.0;      // every ray hits within 12.2 units (see MATH.md)

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

// The same rotation by dir * 90 degrees, done exactly on whole numbers.
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

// ---- cells and cubes -------------------------------------------------------------

// Cell id modulo 1024 on each axis. Multiplying by 1/1024 is exact.
vec3 cellKey(vec3 id) { return id - PERIOD * floor(id * (1.0 / PERIOD)); }

// The stack fills the half-space of cells whose ids sum to 0 or less. The top
// four layers have random gaps, which make the stair-stepped hexagonal stars.
bool occupied(vec3 id, vec3 key) {
    float s = id.x + id.y + id.z;
    if (s > 0.5) return false;
    return s < -3.5 || hash13(key) < FILL;
}

// Speed m / 8 with m in {6, 7, 8, 9, 10, 12}. A cycle lasts 13.3 s * m / 8,
// and 4189.5 s (13.3 s * 2520 / 8, with 2520 = lcm of those m) is a whole
// number of cycles at every speed, so the host's clock wrap is seamless.
float speedM(vec3 key) {
    float k = min(floor(hash13(key + vec3(2048.0, 0.0, 0.0)) * 6.0), 5.0);
    return k < 4.5 ? 6.0 + k : 12.0;
}
float phaseOf(vec3 key)  { return hash13(key + vec3(0.0, 2048.0, 0.0)) * CYCLE; }
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

// The three moves of one cycle. Geometry and colour both use this one
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

float easeTurn(float x) {
    // a fast flick that overshoots ~10% and settles exactly at 1
    x = clamp(x, 0.0, 1.0);
    float y = x - 1.0;
    return 1.0 + 2.7 * y * y * y + 1.7 * y * y;
}

struct Cube {
    float id;      // hashes this cube's moves
    float cycKey;  // which cycle it is in (its moves change every cycle)
    float pre;     // moves of this cycle already complete, 0..3
    float axis;    // the move in progress: axis, layer, angle (0 = none)
    float layer;
    float ang;
    float idx;     // which of the three moves is in progress (-1 = none)
};

Cube cubeState(vec3 key) {
    Cube c;
    c.id = cubeIdOf(key);
    float m = speedM(key);
    float tt = time * (8.0 / SLOT) / m + phaseOf(key);   // in slots
    float cyc = floor(tt / CYCLE);
    float s = tt - cyc * CYCLE;
    // a rounded division can leave s a hair outside [0, CYCLE): fold it back
    if (s < 0.0) { s += CYCLE; cyc -= 1.0; }
    if (s >= CYCLE) { s -= CYCLE; cyc += 1.0; }
    // cycles per loop at this speed; taking the cycle number modulo it keeps
    // the moves identical across the clock wrap
    c.cycKey = imod(cyc, floor(2520.0 / m + 0.5));
    float slot = floor(s);
    float f = s - slot;
    c.pre = 0.0; c.axis = 0.0; c.layer = 0.0; c.ang = 0.0; c.idx = -1.0;
    float sgn = 1.0;
    if (slot < 2.5)      { c.idx = slot; c.pre = slot; }                    // moves 0, 1, 2
    else if (slot < 6.5) { c.pre = 3.0; }                                   // rest
    else if (slot < 9.5) { c.idx = 9.0 - slot; c.pre = c.idx + 1.0; sgn = -1.0; } // undo 2, 1, 0
    if (c.idx > -0.5) {
        vec3 ax, ly, dr;
        cycleMoves(c.id, c.cycKey, ax, ly, dr);
        c.axis = comp(ax, c.idx);
        c.layer = comp(ly, c.idx);
        c.ang = sgn * comp(dr, c.idx) * easeTurn(f / TURN) * HALF_PI;
    }
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
    float id;      // the cube's move hash id
    float cycKey;
    float pre;
    float axis;    // rotation of the cubie's frame (ang = 0: not moving)
    float ang;
#if defined(OMACUBE_DEBUG)
    float idx;     // geometry's view of the move in progress
    float mvLayer;
    float mvAng;
#endif
};

// Distance from p to the nearest cube. The eight cells around p (its own and
// the neighbours on the sides p is closest to) are measured exactly. Any
// other cube's centre is at least 3 + min|q0| from p, and no part of a cube
// is farther than R from its centre, so those cubes are at least
// 3 + min|q0| - R away. Taking that as a cap keeps the estimate from ever
// exceeding the true distance, so the march cannot step through a cube.
float mapScene(vec3 p, out Hit hit) {
    vec3 id0 = floor(p * (1.0 / P) + 0.5);
    vec3 q0 = p - id0 * P;
    vec3 sd = vec3(q0.x >= 0.0 ? 1.0 : -1.0, q0.y >= 0.0 ? 1.0 : -1.0, q0.z >= 0.0 ? 1.0 : -1.0);
    vec3 aq = abs(q0);
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
        vec3 key = cellKey(id);
        if (!occupied(id, key)) continue;
        Cube cb = cubeState(key);
        vec3 cell, lp;
        bool moving;
        float dc = cubeSDF(q, cb.axis, cb.layer, cb.ang, cell, lp, moving);
        if (dc < d) {
            d = dc;
            hit.cell = cell; hit.lp = lp; hit.key = key;
            hit.id = cb.id; hit.cycKey = cb.cycKey; hit.pre = cb.pre;
            hit.axis = cb.axis; hit.ang = moving ? cb.ang : 0.0;
#if defined(OMACUBE_DEBUG)
            hit.idx = cb.idx; hit.mvLayer = cb.layer; hit.mvAng = cb.ang;
#endif
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

// ---- colour ------------------------------------------------------------------------

vec3 stickerColor(vec3 n) {
    if (n.x > 0.5) return c0.rgb;
    if (n.x < -0.5) return c1.rgb;
    if (n.y > 0.5) return c2.rgb;
    if (n.y < -0.5) return c3.rgb;
    if (n.z > 0.5) return c4.rgb;
    return c5.rgb;
}

// Undo one quarter turn if the cubie at c is part of it.
void undoMove(inout vec3 c, inout vec3 n, float axis, float layer, float dir) {
    if (layer > 1.5 || abs(comp(c, axis) - layer) < 0.5) {
        c = rot90(c, axis, -dir);
        n = rot90(n, axis, -dir);
    }
}

// Where a sticker started on the solved cube: undo this cycle's completed
// moves, newest first, then the cube's base scramble, newest first.
void homeOf(Hit h, inout vec3 c, inout vec3 n) {
    vec3 ax, ly, dr;
    cycleMoves(h.id, h.cycKey, ax, ly, dr);
    if (h.pre > 2.5) undoMove(c, n, ax.z, ly.z, dr.z);
    if (h.pre > 1.5) undoMove(c, n, ax.y, ly.y, dr.y);
    if (h.pre > 0.5) undoMove(c, n, ax.x, ly.x, dr.x);
    float len = baseLen(h.key);
    float stp, layer, dir;
    float a = firstAxis(h.id, BASE);
    for (int j = 1; j < 20; j++) {                      // axis of the last base move
        if (float(j) >= len) break;
        decode(moveCode(h.id, BASE, float(j)), stp, layer, dir);
        a = imod(a + stp, 3.0);
    }
    for (int i = 0; i < 20; i++) {                      // undo base moves len-1 .. 0
        float j = 19.0 - float(i);
        if (j >= len) continue;
        decode(moveCode(h.id, BASE, j), stp, layer, dir);
        undoMove(c, n, a, layer, dir);
        a = imod(a - stp, 3.0);                         // axis of move j - 1
    }
}

vec3 stickerAt(Hit h, vec3 n) {
    vec3 c = h.cell;
    homeOf(h, c, n);
    return stickerColor(n);
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
        vec3 key = cellKey(id);
        if (!occupied(id, key)) continue;
        Cube cb = cubeState(key);
        vec3 cell, lp;
        bool moving;
        d = min(d, cubeSDF(p - id * P, cb.axis, cb.layer, cb.ang, cell, lp, moving));
    }
    return d;
}
#endif

void main() {
    vec2 uv = (qt_TexCoord0 - 0.5) * vec2(aspect, -1.0) * (2.0 * VIEW);

    // Orthographic camera down the (1,1,1) diagonal. rt, up and fw are
    // orthonormal with rt x up = -fw, so this is a true isometric projection
    // and the image is not mirrored. Rolling rt and up by `spin` turns the
    // view; 120 degrees maps the lattice onto itself.
    vec3 fw = vec3(-0.57735027);
    vec3 rt0 = vec3(0.70710678, 0.0, -0.70710678);
    vec3 up0 = vec3(-0.40824829, 0.81649658, -0.40824829);
    float cs = cos(spin), sn = sin(spin);
    vec3 rt = cs * rt0 + sn * up0;
    vec3 up = -sn * rt0 + cs * up0;

    // The camera drifts along (3,3,-6), which lies in the plane of the
    // stack's top, so it stays the same height above the stack. Rays start
    // at coordinate sum 4.6: no part of any cube reaches above 4.5.
    vec3 ro = vec3(3.0, 3.0, -6.0) * drift + rt * uv.x + up * uv.y - fw * 2.6558;

    // Sphere tracing: mapScene never overestimates, so stepping by d can
    // never pass through a cube. Most rays hit in about 9 steps. A ray that
    // runs alongside a face tumbled edge-on to the view crawls in small
    // steps; the worst seen in testing took about 216, hence the budget.
    float pw = 2.0 * VIEW * texel;                      // world units per pixel
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
    if (!hitAny && t <= TMAX && d < pw) { hitAny = true; grazed = true; }

    vec3 col = bgColor.rgb;
    if (hitAny) {
        // which face of the cubie was hit, in the cubie's own frame
        vec3 lp = h.lp;
        vec3 al = abs(lp);
        vec3 nl;
        vec2 fuv;
        float fa;
        if (al.x >= al.y && al.x >= al.z) { nl = vec3(sign(lp.x), 0.0, 0.0); fuv = lp.yz; fa = 0.0; }
        else if (al.y >= al.z)            { nl = vec3(0.0, sign(lp.y), 0.0); fuv = lp.xz; fa = 1.0; }
        else                              { nl = vec3(0.0, 0.0, sign(lp.z)); fuv = lp.xy; fa = 2.0; }

        col = bodyColor.rgb;
        if (dot(h.cell, nl) > 0.5) {                    // outer faces carry stickers
            // rounded-square sticker: half size 0.43, corner radius 0.035
            vec2 sq = abs(fuv) - vec2(0.395);
            float sd = length(max(sq, 0.0)) + min(max(sq.x, sq.y), 0.0) - 0.035;
            // Antialias over exactly one screen pixel. The projection is
            // orthographic, so a one-pixel step on screen moves the hit point
            // linearly within the face plane; measure how much sd changes.
            vec2 g = (sq.x > 0.0 && sq.y > 0.0) ? sign(fuv) * normalize(sq)
                   : (sq.x > sq.y ? vec2(sign(fuv.x), 0.0) : vec2(0.0, sign(fuv.y)));
            vec3 nw = rotA(nl, h.axis, h.ang);          // face normal in the world
            float nf = min(dot(nw, fw), -0.05);
            vec3 dx = rotA((rt - fw * (dot(nw, rt) / nf)) * pw, h.axis, -h.ang);
            vec3 dy = rotA((up - fw * (dot(nw, up) / nf)) * pw, h.axis, -h.ang);
            vec2 fx = fa < 0.5 ? dx.yz : (fa < 1.5 ? dx.xz : dx.xy);
            vec2 fy = fa < 0.5 ? dy.yz : (fa < 1.5 ? dy.xz : dy.xy);
            float w = max(abs(dot(g, fx)) + abs(dot(g, fy)), 1e-5);
            float cover = clamp(0.5 - sd / w, 0.0, 1.0);
            if (cover > 0.0) {
                // blend in linear light, then back to sRGB
                vec3 body = pow(bodyColor.rgb, vec3(2.2));
                vec3 stk = pow(stickerAt(h, nl), vec3(2.2));
                col = pow(mix(body, stk, cover), vec3(1.0 / 2.2));
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
    // the move geometry animated is the move colour will undo
    col = dim;
    if (hitAny && h.idx > -0.5) {
        vec3 ax, ly, dr;
        cycleMoves(h.id, h.cycKey, ax, ly, dr);
        float slot = h.pre < h.idx + 0.5 ? 1.0 : -1.0; // +1 doing, -1 undoing
        float a = slot * comp(dr, h.idx) * abs(h.mvAng) / max(abs(h.mvAng), 1e-9);
        bool same = comp(ly, h.idx) == h.mvLayer && (abs(h.mvAng) < 1e-4 || sign(a) == sign(h.mvAng));
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
            homeOf(h, c, n);
            if (home0.x > 8.0) home0 = c;
            ok = ok && c == home0 && dot(c, n) > 0.5;
            float na = abs(n.x) > 0.5 ? 1.0 : (abs(n.y) > 0.5 ? 2.0 : 4.0);
            ok = ok && imod(floor(axisMask / na), 2.0) < 0.5;
            axisMask += na;
        }
        if (!ok) col = bad;
    }
#endif
#endif
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
