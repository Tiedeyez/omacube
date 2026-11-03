#version 440
// Omacube: an endless isometric stack of puzzle cubes, drawn flat: 3x3x3,
// and every 2.5 minutes another size up to 17x17x17 (MATH.md, "Cube sizes").
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
// Here and there a giant solved cube corner, built from the same cubes,
// rises out of the pile: white top, red right face, green left face. On the
// red face, OMARCHY is a sticker mosaic, yellow on red, across 10 x 2 real
// cube states. Every couple of minutes those cubes take turns popping out of
// the wall, scramble, push back in, then pop out again and turn back into
// the word.
//
// A sticker's colour is found by undoing every move back to the solved cube
// (or, on the word, back to its mosaic state), so colours travel with the
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
    float pan;      // camera position along screen-right, world units, in [-1, 1) * 3072 * 3 sqrt 2 / 2
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
    vec2 hOrigin;   // the height map's first column (ci, cj)
    vec2 hSize;     // the height map's size in columns
    float mapPass;  // 1: draw the height map, 2: the motion map, instead of the picture
    float restPass; // 1: draw the stack at rest (no bursts, no pops) for the rest cache
    float useRest;  // 1: pixels nothing moves near are copied from the rest cache
    vec3 restPans;  // the pan each of the three rest caches was drawn at
    vec3 restOk;    // 1 where that cache is drawn and current
    vec2 strip;     // rest pass: draw x in [strip.x, strip.y), copy the rest of the cache
    vec4 wave;      // theme or size change: x = progress 0..1, y = 1 while it runs, z = 1 for a size change
    vec4 o0;        // the previous theme's colours, as c0 .. bgColor, while the wave runs
    vec4 o1;
    vec4 o2;
    vec4 o3;
    vec4 o4;
    vec4 o5;
    vec4 oBody;
    vec4 oBg;
    vec4 sizes;     // x: cubies along an edge of the wall's cubes (3 .. 17; 0 = 3), y: the old size during a size wave
};
// The 20 mosaic states (tools/build-mosaic.py): row k holds cube k's 54
// sticker colours as index * 32, at x = face * 9 + (u + 1) * 3 + (v + 1).
layout(binding = 1) uniform sampler2D mosaic;
// The stack's height map: for each cell column on screen, how many cells
// above the always-full layers hold a cube (MATH.md, "The height map").
// This shader draws it too, in a tiny pass of its own (mapPass = 1).
layout(binding = 2) uniform sampler2D heights;
// The rest cache: the same picture with every cube at rest, drawn by this
// shader (restPass = 1) only when the camera or the colours change. A pixel
// no moving cube can reach is copied from it (MATH.md, "The rest cache").
layout(binding = 3) uniform sampler2D rest;
// The motion map: for each cell column, 1 if a cube in it is mid-burst now.
// Same layout as the height map; this shader draws it every frame, in a
// tiny pass of its own (mapPass = 2).
layout(binding = 4) uniform sampler2D motion;
// Two more rest caches, usually the neighbouring workspaces', so a workspace
// slide copies the picture too (MATH.md, "Slides from the cache").
layout(binding = 5) uniform sampler2D rest1;
layout(binding = 6) uniform sampler2D rest2;

const float HALF_PI = 1.5707963;
const float P = 3.0;          // lattice pitch: neighbouring cubes touch
const float H = 0.5;          // cubie half size, so a cube spans -1.5 .. 1.5
const float R = 2.5980762;    // a cube's circumradius, 1.5 * sqrt(3)
const float VIEW = 15.0;      // half the screen height, world units
const float PAN_PERIOD = 13033.3921908;  // 3072 * 3 sqrt 2: the slide wraps here
// The theme wave (MATH.md, "The theme wave"): a front sweeps the screen
// along WAVE_DIR; each sticker flips over like a card as it passes, showing
// the new theme's colour on its back. A sticker's flip runs over WAVE_B
// world units of the front's travel.
const vec2 WAVE_DIR = vec2(0.89442719, -0.44721360);   // rightwards and down, unit
const float WAVE_B = 7.5;
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

// The monument (MATH.md, "The monument"): a giant solved cube corner at one
// site per 32 cells along the row direction (70% of sites). Its apex sits
// at y = 4 with coordinate sum 13; the word is on its +x face, one row of
// cubes below the top edge, 10 cubes wide and 2 tall.
const float MONO_Y = 4.0;
const float SITE_STEP = 32.0;
const float SITE_P = 0.7;
const float POP = 3.05;       // a mosaic cube pops out along +x this far (least that clears: 3)
const float POP_S = 0.6;      // seconds to pop out, or back in
const float W_EPOCH = 119.7;  // the word re-forms once per epoch; 35 of them make the loop
const float W_SLOT = 5.0;     // seconds per mosaic class (4 classes)
const float W_SCRAMBLE = 99.7;// when the scramble slots begin
const float W_MOVE = 0.4;     // seconds per mosaic move
const float W_MOVES = 8.0;    // moves in a mosaic cube's scramble


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

// ---- cells and the stack -------------------------------------------------------

// Cell id modulo 1024 on each axis. Multiplying by 1/1024 is exact.
vec3 cellKey(vec3 id) { return id - PERIOD * floor(id * (1.0 / PERIOD)); }

// Which class a cell is in. The six neighbours of a cell in its layer differ
// from it by (1,-1,0), (1,0,-1), (0,1,-1) and their negatives, which change
// x - y by 2, 1 or -1: never a multiple of 3, so neighbours never share one.
float classOf(vec3 id) { return imod(id.x - id.y, 3.0); }

// Monument sites. Site m's apex is (5 + 32m + j, 4, 4 - 32m - j) for a
// jitter j in 0..7, so it sits at u = x - z = 1 + 64m + 2j. A cell within
// reach of an apex (inside its corner, coordinate sum >= -3) is at most 16
// from it in u, so the site it could belong to is unique.
bool siteUsed(float m) { return hash13(vec3(imod(m, 32.0), 5002.0, 7.0)) < SITE_P; }
vec3 siteApex(float m) {
    float j = floor(hash13(vec3(imod(m, 32.0), 5001.0, 7.0)) * 8.0);
    return vec3(5.0 + SITE_STEP * m + j, MONO_Y, 4.0 - SITE_STEP * m - j);
}
float siteNear(float u) { return floor((u + 15.0) / (2.0 * SITE_STEP)); }
bool inMonument(vec3 v, out vec3 T) {
    float m = siteNear(v.x - v.z);
    T = siteApex(m);
    return siteUsed(m) && v.x <= T.x && v.y <= T.y && v.z <= T.z;
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
// A monument's corner, every cell at or behind its apex on all three axes,
// is a down-set too, and a union of down-sets is a down-set.
//
// The cone rule for one cell of the band (coordinate sum -3..0).
bool coneOn(vec3 id) {
    float room = id.x + id.y + id.z + 3.0;  // 0..3: cone depth left inside the band
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

// The rule itself, cell by cell. The picture reads it from the height map
// below; this is what draws the map and what the self-checks compare with.
bool occupiedRule(vec3 id) {
    float s = id.x + id.y + id.z;
    if (s < -3.5) return true;
    vec3 T;
    if (inMonument(id, T)) return true;
    if (s > 0.5) return false;
#if defined(OMACUBE_OLD_FILL)
    return hash13(cellKey(id)) < 0.74;  // the previous rule, to demonstrate its bug
#endif
    return coneOn(id);
}

// ---- the height map ------------------------------------------------------------
//
// Cell id lies in column (ci, cj) = (id.x - id.z, id.y - id.z), the line of
// cells (ci + n, cj + n, n) running along the view axis (1, 1, 1). In a
// down-set, a cell's cube means a cube in the cell behind it along -x, -y
// and -z, so in the cell id - (1, 1, 1) too: down a column the cells hold a
// cube up to some top cell and are empty above it. One number per column,
// its top, describes the whole stack. The cells with sum below -3.5 are
// always full; the top of those in column (ci, cj) is
// nBase = floor((-3.5 - ci - cj) / 3), exact because (-3.5 - ci - cj) / 3
// is never a whole number. Above it lie at most two cells of the band, then
// only a monument's corner can reach higher.

float nBaseOf(float ci, float cj) { return floor((-3.5 - ci - cj) / 3.0); }

// A column's top cell, worked out from the rule: up to 2 cone tests and a
// monument test, against the rule's one cone test per cell queried.
float columnTopRule(float ci, float cj) {
    float nb = nBaseOf(ci, cj);
    float top = nb;
    for (int k = 1; k < 3; k++) {                       // the band cells, lowest first
        float n = nb + float(k);
        vec3 id = vec3(ci + n, cj + n, n);
        if (id.x + id.y + id.z > 0.5) break;            // above the band
        if (!coneOn(id)) break;                         // and so every cell above it
        top = n;
    }
    // a monument's corner holds every cell <= its apex T: n <= T - (ci, cj, 0)
    float m = siteNear(ci);                             // a cell's u = x - z is ci
    if (siteUsed(m)) {
        vec3 T = siteApex(m);
        top = max(top, min(min(T.x - ci, T.y - cj), T.z));
    }
    return top;
}

// A column's top cell, read from the map. The map spans every column on
// screen plus 5 on each side, and a ray only ever looks up cells within
// about 3 columns of its own spot, so every lookup lands inside it; self-check
// 9 compares every lookup the drawing makes with the rule. (A fallback to the
// rule for off-map columns made the compiled shader bigger and slower.)
float columnTop(float ci, float cj) {
    vec2 xy = vec2(ci, cj) - hOrigin;
#if defined(OMACUBE_MAP_SHIFT)
    xy.x += 1.0;                        // self-check 9x: the map read one column off
#endif
    return nBaseOf(ci, cj) + floor(texture(heights, (xy + 0.5) / hSize).r * 255.0 + 0.5);
}

#if defined(OMACUBE_DEBUG) && OMACUBE_DEBUG == 9
bool gMapBad = false;                   // self-check 9: the map disagreed with the rule
#endif

bool occupied(vec3 id) {
    float s = id.x + id.y + id.z;
    if (s < -3.5) return true;          // no lookup for the full layers
    if (s > 13.5) return false;         // nor above every monument apex (sum 13)
#if defined(OMACUBE_OLD_FILL)
    return occupiedRule(id);            // not a down-set: no height map
#else
    bool r = id.z <= columnTop(id.x - id.z, id.y - id.z);
#if defined(OMACUBE_DEBUG) && OMACUBE_DEBUG == 9
    if (r != occupiedRule(id)) gMapBad = true;
#endif
    return r;
#endif
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
// whole cube (WHOLE, 2 in 5 moves), and direction +1 or -1. All exact.
const float WHOLE = 99.0;
void decode(float v, out float stp, out float layer, out float dir) {
    stp = imod(v, 2.0) + 1.0;
    float code = imod(floor(v * 0.5), 5.0);
    layer = code < 2.5 ? code - 1.0 : WHOLE;
    dir = v < 9.5 ? 1.0 : -1.0;
}

// A move's hash times 20: its whole part is the move code, and its fraction
// picks the slice on a bigger cube.
float moveHash(float id, float seq, float j) { return hash13(vec3(id, seq, j)) * 20.0; }
float codeOf(float mh) { return min(floor(mh), 19.0); }
float moveCode(float id, float seq, float j) { return codeOf(moveHash(id, seq, j)); }

// On an n x n x n cube (MATH.md, "Cube sizes") a slice move turns any one of
// the n layers, at centred coordinate -m .. m, m = (n - 1) / 2, chosen by
// the fraction of the move's hash (no second hash); the 3 x 3 x 3 keeps the
// layer the move code gives.
float sliceOf(float layer, float n, float mh) {
    if (layer > 50.0 || n < 3.5) return layer;
    return min(floor((mh - floor(mh)) * n), n - 1.0) - 0.5 * (n - 1.0);
}
float firstAxis(float id, float seq) { return min(floor(hash13(vec3(id, seq, 63.0)) * 3.0), 2.0); }

// The three moves of one burst. Geometry and colour both use this one
// function, so they cannot disagree about which layer turned.
void cycleMoves(float id, float seq, float n, out vec3 ax, out vec3 ly, out vec3 dr) {
    float stp, layer, dir;
    float a = firstAxis(id, seq);
    float mh = moveHash(id, seq, 0.0);
    decode(codeOf(mh), stp, layer, dir);
    ax.x = a; ly.x = sliceOf(layer, n, mh); dr.x = dir;
    mh = moveHash(id, seq, 1.0);
    decode(codeOf(mh), stp, layer, dir);
    a = imod(a + stp, 3.0);
    ax.y = a; ly.y = sliceOf(layer, n, mh); dr.y = dir;
    mh = moveHash(id, seq, 2.0);
    decode(codeOf(mh), stp, layer, dir);
    a = imod(a + stp, 3.0);
    ax.z = a; ly.z = sliceOf(layer, n, mh); dr.z = dir;
}

// Move j of sequence seq (a base scramble or a mosaic scramble); homeOf()
// walks the same sequence.
void seqMove(float id, float seq, float j, out float axis, out float layer, out float dir) {
    float stp;
    float a = firstAxis(id, seq);
    for (int i = 1; i < 20; i++) {
        if (float(i) > j + 0.5) break;
        decode(moveCode(id, seq, float(i)), stp, layer, dir);
        a = imod(a + stp, 3.0);
    }
    decode(moveCode(id, seq, j), stp, layer, dir);
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
    float nb;      // moves of the base scramble applied
    float axis;    // the move in progress: axis, layer, angle (0 = none)
    float layer;
    float ang;
    float lift;    // how far it has slid out along each axis, 0..LIFT
    float tex;     // which mosaic state it is (0..19), or -1
    float pop;     // how far a mosaic cube has popped out along +x
    float rseq;    // sequence key of a mosaic cube's scramble
    float src;     // where the move in progress comes from: 0 none, 1 burst, 2 scramble
    float idx;     // which move of that source
    float sgn;     // +1 making it, -1 undoing it
};

void noMove(inout Cube c) {
    c.axis = 0.0; c.layer = 0.0; c.ang = 0.0; c.src = 0.0; c.idx = -1.0; c.sgn = 1.0;
}

// The size wave (MATH.md, "Cube sizes"): when the wall changes size, a
// front sweeps the screen as the theme wave does, and each cube it passes
// shrinks away at its old size and grows back at the new one. Deeper cubes
// follow a little later (SIZE_LAG world units of the front's travel per unit
// of coordinate sum), so the wall peels away layer by layer.
const float SIZE_LAG = 0.4;
float gSlide = 0.0;                     // the camera's slide, set by main()
float wavePhaseAt(vec2 s);
// A cube's (n, scale, phase). The word's cubes stay 3 x 3 x 3 for their
// mosaic; every other cube, the monument's too, has the wall's size. Kept
// out of the per-ray cube cache: an extra float there cost the HD 520 more
// than working this out again.
vec3 cubeSize(vec3 cid, float tex) {
    if (tex > -0.5) return vec3(3.0, 1.0, 1.0);
    float n = max(sizes.x, 3.0);
    if (wave.y < 0.5 || wave.z < 0.5) return vec3(n, 1.0, 1.0);
    vec3 cw = cid * P;
    vec2 spot = vec2((cw.x - cw.z) * 0.70710678 - gSlide, dot(cw, vec3(-0.40824829, 0.81649658, -0.40824829)));
    float ph = wavePhaseAt(spot - WAVE_DIR * SIZE_LAG * (cid.x + cid.y + cid.z));
    return vec3(ph < 0.5 ? max(sizes.y, 3.0) : n, abs(cos(ph * 3.14159265)), ph);
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
        cycleMoves(c.id, c.cycKey, cubeSize(cid, -1.0).x, ax, ly, dr);
        c.axis = comp(ax, c.idx);
        c.layer = comp(ly, c.idx);
        c.ang = c.sgn * comp(dr, c.idx) * easeTurn(f / (TURN * sl)) * HALF_PI;
#endif
        return;
    }
    c.lift = LIFT * (1.0 - smoothstep(0.0, 1.0, (u - (6.0 + TURN) * sl) / LIFT_S));
}

// A mosaic cube's pop alone: how far out it is now. Each epoch it first
// undoes this epoch's scramble in its class's solve slot, then, after the
// word has stood for 80 s, does the next epoch's scramble in its class's
// scramble slot. Wall neighbours differ in y or z parity, so they never
// share a class and are never out together.
float wallTime(vec3 cid, out bool undo, out float e) {
    e = floor(time / W_EPOCH);
    float u0 = time - e * W_EPOCH;
    float q = imod(cid.y, 2.0) * 2.0 + imod(cid.z, 2.0);
    undo = u0 < W_SCRAMBLE;
    return u0 - (undo ? 0.0 : W_SCRAMBLE) - q * W_SLOT;
}
float wallPop(vec3 cid) {
#if defined(OMACUBE_STATIC)
    return 0.0;
#endif
    bool undo;
    float e;
    float u = wallTime(cid, undo, e);
    if (u < POP_S) return POP * smoothstep(0.0, 1.0, u / POP_S);
    u -= POP_S + W_MOVES * W_MOVE;
    return u < 0.0 ? POP : POP * (1.0 - smoothstep(0.0, 1.0, u / POP_S));
}

void wallState(vec3 cid, inout Cube c) {
    bool undo;
    float e;
    float u = wallTime(cid, undo, e);
    c.rseq = 7000.0 + imod(undo ? e : e + 1.0, 35.0);  // 35 epochs a loop
    if (u < POP_S) {
        c.nb = undo ? W_MOVES : 0.0;
        c.pop = POP * smoothstep(0.0, 1.0, u / POP_S);  // 0 while u < 0
        return;
    }
    u -= POP_S;
    if (u < W_MOVES * W_MOVE) {
        float j = floor(u / W_MOVE);
        float f = u - j * W_MOVE;
        c.pop = POP;
        c.src = 2.0;
        if (undo) { c.nb = W_MOVES - j; c.idx = W_MOVES - 1.0 - j; c.sgn = -1.0; }
        else      { c.nb = j;           c.idx = j;                 c.sgn = 1.0; }
#if !defined(OMACUBE_STATIC)
        float dir;
        seqMove(c.id, c.rseq, c.idx, c.axis, c.layer, dir);
        c.ang = c.sgn * dir * easeTurn(f / (W_MOVE * TURN)) * HALF_PI;
#endif
        return;
    }
    c.nb = undo ? 0.0 : W_MOVES;
    c.pop = POP * (1.0 - smoothstep(0.0, 1.0, (u - W_MOVES * W_MOVE) / POP_S));
}

Cube cubeState(vec3 cid) {
    Cube c;
    vec3 key = cellKey(cid);
    c.id = cubeIdOf(key);
    c.cycKey = 0.0; c.pre = 0.0; c.lift = 0.0; c.tex = -1.0; c.pop = 0.0; c.rseq = 0.0;
    noMove(c);
    vec3 T;
    if (inMonument(cid, T)) {
        // part of the giant cube: solved and still, except the word
        c.nb = 0.0;
        float r = T.y - cid.y;
        float col = T.z - cid.z;
        if (cid.x == T.x && r > 0.5 && r < 2.5 && col > -0.5 && col < 9.5) {
            c.tex = (r - 1.0) * 10.0 + col;
            if (restPass < 0.5) wallState(cid, c);
        }
    } else {
        c.nb = baseLen(key);
        if (restPass < 0.5) ordinaryState(cid, key, c);  // tests freeAt() only mid-burst
    }
#if defined(OMACUBE_STATIC)
    c.lift = 0.0;                        // self-check 6: nothing turns, slides or pops
    c.pop = 0.0;
#endif
    return c;
}

// A box of half sizes b, centred at the origin.
float sdBox3(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// The grid constants of an n x n x n cube at scale sc.
vec4 gridOf(float n, float sc) {
    float m = 0.5 * (n - 1.0);
    return vec4(m, m - floor(m), n / (3.0 * sc), 3.0 * sc / n);
}
vec4 gGrid;                             // the wall's, set once by main()

// cubeSDF for the cube in cell cid (tex: its mosaic state, or -1)
// Distance to the cube in cell cid (tex: its mosaic state, or -1), from q in
// its frame: n cubies along an edge, each 3 / n across (MATH.md, "Cube
// sizes"). The cubies tile the cube, so from outside it is just boxes: the
// whole cube; or, with a slab turning, the slab (rotated) and the blocks on
// either side of it; or, tumbling, the whole cube rotated. This is exact
// outside the cube and does not depend on n. The cubie hit is worked out
// once, at the hit (cubieAt; cell.x = 9 marks it), and lp holds the hit
// point in the frame of the piece hit.
float cubeSDFOf(vec3 q, vec3 cid, float tex, float axis, float layer, float ang, out vec3 cell, out vec3 lp, out bool moving) {
    vec3 z = tex > -0.5 ? vec3(3.0, 1.0, 1.0) : (wave.z > 0.5 ? cubeSize(cid, tex) : vec3(gGrid.x * 2.0 + 1.0, 1.0, 1.0));
    float hb = 1.5 * z.y;                               // the cube's half size
    cell = vec3(9.0);
    moving = false;
    lp = q;
    if (abs(ang) <= 1e-4) return sdBox(q, hb);
    vec3 qr = rotA(q, axis, -ang);
    if (layer > 50.0) { moving = true; lp = qr; return sdBox(qr, hb); }
    float k = 3.0 * z.y / z.x;                          // a cubie's size
    float lo = (layer - 0.5) * k;                       // the slab spans lo .. lo + k along axis
    float qa = comp(q, axis);
    float d = 1e9;
    if (lo > -hb + 1e-3)                                // the block below it
        d = sdBox3(setComp(q, axis, qa - 0.5 * (lo - hb)), setComp(vec3(hb), axis, 0.5 * (lo + hb)));
    if (lo + k < hb - 1e-3)                             // and above
        d = min(d, sdBox3(setComp(q, axis, qa - 0.5 * (lo + k + hb)), setComp(vec3(hb), axis, 0.5 * (hb - lo - k))));
    float ds = sdBox3(setComp(qr, axis, comp(qr, axis) - layer * k), setComp(vec3(hb), axis, 0.5 * k));
    if (ds < d) { moving = true; lp = qr; return ds; }
    return d;
}

// The cubie at a hit (cell.x = 9: not yet known), from lp, the hit point in
// the frame of the piece hit. On the turning slab (ang != 0) it lies in the
// slab's layer; on a block beside a turning slab (layer, ang = 0) it lies
// outside it.
void cubieAt(vec4 G, float axis, float layer, float ang, inout vec3 cell, inout vec3 lp) {
    if (cell.x < 8.5) return;
    vec3 g = lp * G.z;
    vec3 c = clamp(floor(g + (0.5 - G.y)) + G.y, -G.x, G.x);
    if (layer < 50.0) {
        if (abs(ang) > 1e-4) c = setComp(c, axis, layer);
        else if (comp(c, axis) == layer) c = setComp(c, axis, comp(g, axis) < layer ? layer - 1.0 : layer + 1.0);
    }
    cell = c;
    lp = g - c;
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
    float tex;
    float rseq;
    float pop;
    float axis;    // rotation of the cubie's frame (ang = 0: not moving)
    float ang;
    float layer;   // the layer turning in the cube hit, or WHOLE if none
    float lift;    // how far the cube has slid out: it is nearer by lift * sqrt(3)
    float n;       // cubies along an edge, and the cube's scale and size-wave phase
    float sc;      // (filled in once the nearest hit is known: main())
    float ph;
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
    hit.tex = cb.tex; hit.rseq = cb.rseq; hit.pop = cb.pop;
    hit.axis = cb.axis; hit.ang = moving ? cb.ang : 0.0;
    hit.layer = abs(cb.ang) > 1e-4 ? cb.layer : WHOLE;
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
        // A cube popped out of the wall, or slid out of the pile, is drawn
        // by main() where it really is. Only those cubes ever turn, and a
        // slid-out cube covers the same pixels it would in its cell, nearer,
        // so the march can treat its cell as empty and measure every other
        // cube as a plain box.
        if (cb.pop > 0.0 || cb.lift > 0.0) continue;
        float dc = sdBox(q, 1.5 * (wave.z > 0.5 && cb.tex < -0.5 ? cubeSize(id, cb.tex).y : 1.0));
        if (dc < d) {
            d = dc;
            fillHit(hit, cb, id, vec3(9.0), q, false);  // the cubie: cubieAt(), at the hit
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

// One cube on its own, centred off its cell by off: where along the ray it
// is first hit.
// A ray that grazes the edge of a turning slab crawls in small steps; as in
// the main march, one that runs out of steps within a pixel of the cube is a
// silhouette pixel and counts as a hit (before, it showed whatever was
// behind, as a thin coloured line along the slab's edge).
float gPx = 0.0;                        // world units per pixel, set by main()
bool traceCube(vec3 id, Cube cb, vec3 off, vec3 ro, vec3 fw, inout Hit hit, out float t) {
    vec3 c = id * P + off;
    float tc = dot(c - ro, fw);
    t = tc - R;
    float d = 1.0;
    vec3 cell, lp;
    bool moving;
    bool got = false;
    bool left = false;
    for (int i = 0; i < 64; i++) {
        d = cubeSDFOf(ro + fw * t - c, id, cb.tex, cb.axis, cb.layer, cb.ang, cell, lp, moving);
        if (d < EPS) { got = true; break; }
        t += d;
        if (t > tc + R) { left = true; break; }
    }
    got = got || (!left && d < gPx);
    if (got) fillHit(hit, cb, id, cell, lp, moving);
    return got;
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
        if (cb.pop > 0.0) continue;
        vec3 cell, lp;
        bool moving;
        float dc = cubeSDFOf(p - id * P - vec3(cb.lift), id, cb.tex, cb.axis, cb.layer, cb.ang, cell, lp, moving);
        if (dc < d) {
            d = dc;
            fillHit(hit, cb, id, cell, lp, moving);
        }
    }
    // popped mosaic cubes, measured directly
    float m = siteNear((p.x - p.z) / P);
    if (siteUsed(m)) {
        vec3 T = siteApex(m);
        for (int k = 0; k < 20; k++) {
            float fk = float(k);
            float r = 1.0 + floor(fk / 10.0);
            vec3 cid = vec3(T.x, T.y - r, T.z - (fk - 10.0 * (r - 1.0)));
            if (wallPop(cid) <= 0.0) continue;
            Cube cb = cubeState(cid);
            vec3 cell, lp;
            bool moving;
            float dc = cubeSDFOf(p - cid * P - vec3(cb.pop, 0.0, 0.0), cid, cb.tex, cb.axis, cb.layer, cb.ang, cell, lp, moving);
            if (dc < d) {
                d = dc;
                fillHit(hit, cb, cid, cell, lp, moving);
            }
        }
    }
    return d;
}
#endif

// ---- colour ------------------------------------------------------------------------

// Sticker colour i of the current theme, or, old = true, of the one the
// theme wave is replacing.
vec3 paletteColor(float i, bool old) {
    if (old) {
        if (i < 0.5) return o0.rgb;
        if (i < 1.5) return o1.rgb;
        if (i < 2.5) return o2.rgb;
        if (i < 3.5) return o3.rgb;
        if (i < 4.5) return o4.rgb;
        return o5.rgb;
    }
    if (i < 0.5) return c0.rgb;
    if (i < 1.5) return c1.rgb;
    if (i < 2.5) return c2.rgb;
    if (i < 3.5) return c3.rgb;
    if (i < 4.5) return c4.rgb;
    return c5.rgb;
}

// The wave front's position along WAVE_DIR, in world units from the
// screen's centre: it starts a flip band plus a cube beyond one corner and
// ends a cube beyond the opposite one.
float waveFront() {
    float S = VIEW * (aspect * abs(WAVE_DIR.x) + abs(WAVE_DIR.y));
    return mix(-S - WAVE_B - R, S + R, wave.x);
}
// How far through its flip a sticker centred at screen spot s is: 0 not
// started, 1 done (also when no wave runs).
float gFront = 0.0;                     // waveFront(), worked out once by main()
float wavePhase(vec2 s) {
    if (wave.y < 0.5) return 1.0;
    return clamp((gFront - dot(s, WAVE_DIR)) / WAVE_B, 0.0, 1.0);
}
float wavePhaseAt(vec2 s) { return wavePhase(s); }

// The colour index mosaic state k has at sticker slot (c, n).
float mosaicIndex(float k, vec3 c, vec3 n) {
    float f = n.x > 0.5 ? 0.0 : (n.x < -0.5 ? 1.0 : (n.y > 0.5 ? 2.0 : (n.y < -0.5 ? 3.0 : (n.z > 0.5 ? 4.0 : 5.0))));
    vec2 w = abs(n.x) > 0.5 ? c.yz : (abs(n.y) > 0.5 ? c.xz : c.xy);
    float x = f * 9.0 + (w.x + 1.0) * 3.0 + (w.y + 1.0);
    return floor(texture(mosaic, vec2((x + 0.5) / 64.0, (k + 0.5) / 32.0)).r * (255.0 / 32.0) + 0.5);
}

vec3 stickerColor(vec3 n, bool old) {
    float i = n.x > 0.5 ? 0.0 : (n.x < -0.5 ? 1.0 : (n.y > 0.5 ? 2.0 : (n.y < -0.5 ? 3.0 : (n.z > 0.5 ? 4.0 : 5.0))));
    return paletteColor(i, old);
}

// Undo one quarter turn if the cubie at c is part of it.
void undoMove(inout vec3 c, inout vec3 n, float axis, float layer, float dir) {
    if (layer > 50.0 || abs(comp(c, axis) - layer) < 0.25) {
        c = rot90(c, axis, -dir);
        n = rot90(n, axis, -dir);
    }
}

// Where a sticker started on the solved cube: undo this burst's applied
// moves, newest first, then the base scramble, newest first. On the word,
// undo the applied part of the mosaic scramble instead, which leads back to
// the cube's mosaic state. The moves are decoded once, forwards, then
// undone backwards.
void homeOf(Hit h, inout vec3 c, inout vec3 n) {
    if (h.pre > 0.5) {
        vec3 ax, ly, dr;
        cycleMoves(h.id, h.cycKey, h.n, ax, ly, dr);
        if (h.pre > 2.5) undoMove(c, n, ax.z, ly.z, dr.z);
        if (h.pre > 1.5) undoMove(c, n, ax.y, ly.y, dr.y);
        undoMove(c, n, ax.x, ly.x, dr.x);
    }
    float seq = h.tex > -0.5 ? h.rseq : BASE;
    float axs[20];
    float lys[20];
    float drs[20];
    float stp, layer, dir;
    float a = firstAxis(h.id, seq);
    for (int j = 0; j < 20; j++) {
        if (float(j) >= h.nb) break;
        float mh = moveHash(h.id, seq, float(j));
        decode(codeOf(mh), stp, layer, dir);
        if (j > 0) a = imod(a + stp, 3.0);              // consecutive moves change axis
        axs[j] = a; lys[j] = sliceOf(layer, h.n, mh); drs[j] = dir;
    }
    for (int i = 0; i < 20; i++) {                      // undo base moves nb-1 .. 0
        int j = 19 - i;
        if (float(j) >= h.nb) continue;
        undoMove(c, n, axs[j], lys[j], drs[j]);
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
        if (cb.pop > 0.0 || cb.lift > 0.0) continue;        // as mapScene
        vec3 cell, lp;
        bool moving;
        d = min(d, cubeSDFOf(p - id * P, id, cb.tex, cb.axis, cb.layer, cb.ang, cell, lp, moving));
    }
    return d;
}
#endif

void main() {
    // The height map pass: one texel per column, ci = hOrigin.x + x and
    // cj = hOrigin.y + y, holding top - nBase (0..8) as a byte.
    if (mapPass > 0.5) {
        vec2 c = hOrigin + floor(qt_TexCoord0 * hSize);
        if (mapPass < 1.5) {
            fragColor = vec4((columnTopRule(c.x, c.y) - nBaseOf(c.x, c.y)) / 255.0, 0.0, 0.0, 1.0);
            return;
        }
        // the motion map: the column's band cells, only those of the class
        // whose window it is can be mid-burst
        float w = floor(time / WIN);
        float nTop = floor(-(c.x + c.y) / 3.0);
        float moving = 0.0;
        for (int k = 0; k < 2; k++) {
            float n = nTop - float(k);
            vec3 b = vec3(c.x + n, c.y + n, n);
            if (b.x + b.y + b.z < -4.5) break;
            if (imod(w - classOf(b), 3.0) > 0.5) continue;
            Cube cb = cubeState(b);
            if (cb.lift > 0.0 && occupied(b)) moving = 1.0;
        }
        fragColor = vec4(moving, 0.0, 0.0, 1.0);
        return;
    }
    gId0 = vec3(1e9);                                  // empty ray cache
    gSd = vec3(0.0);
    // Snap to the pixel centre. The interpolated coordinate can differ in its
    // last bits between the screen pass and the rest-cache pass (another
    // target size or scale), and that was enough to flip about 0.2% of pixels
    // by 1/255 between cached and live on an RTX 4070 SUPER. The snapped
    // centre is the same number in both passes.
    vec2 res = vec2(aspect, 1.0) / texel;
    vec2 tc = (floor(qt_TexCoord0 * res) + 0.5) / res;
    // A cache is drawn a strip per frame; outside the strip it keeps what it
    // holds (rest, here, is the cache itself).
    if (restPass > 0.5 && (tc.x < strip.x || tc.x >= strip.y)) {
        fragColor = texture(rest, tc);
        return;
    }
    vec2 uv = (tc - 0.5) * vec2(aspect, -1.0) * (2.0 * VIEW);

    // Orthographic camera down the (1,1,1) diagonal. rt, up and fw are
    // orthonormal with rt x up = -fw, so this is a true isometric projection
    // and the image is not mirrored. +y points up the screen.
    vec3 fw = vec3(-0.57735027);
    vec3 rt = vec3(0.70710678, 0.0, -0.70710678);
    vec3 up = vec3(-0.40824829, 0.81649658, -0.40824829);

    // Workspace switches slide the camera sideways along rt. rt lies in the
    // plane of the stack's top, so the camera stays the same height above it.
    // t = 0 is at coordinate sum 4.6: with every cube in its cell, no part of
    // the pile reaches above 4.5. Near a monument the ray starts where it
    // enters the monument's corner, an octant it cannot reach before.
    float px = 2.0 * VIEW * texel;                      // world units per pixel
    float slide = pixelArt > 0.5 ? floor(pan / px + 0.5) * px : pan;  // whole pixels in pixel art
    gSlide = slide;
    gPx = px;
    gGrid = gridOf(max(sizes.x, 3.0), 1.0);
    gFront = waveFront();
    vec3 ro = rt * (slide + uv.x) + up * uv.y - fw * 2.6558;
    vec2 sp = vec2(slide + uv.x, uv.y);                 // the ray's spot on screen
    float fi = sp.x * 0.47140452;                       // sqrt(2) / 3: the spot's u = x - z
    float mS = siteNear(fi);
    bool mono = siteUsed(mS);
    vec3 TS = siteApex(mS);
    float fj = (sp.y * 0.81649658 + fi) * 0.5;          // sqrt(6) / 3
    float win = floor(time / WIN);

    // The rest cache. A cube changes the picture only inside its own outline
    // on screen, within R of its column's spot, whether it slides, turns or
    // not; anything else it does to a ray far from it is the length of a
    // march step. So where no cube within R is mid-burst and no word cube is
    // near, the picture is the stack at rest, already drawn.
    if (useRest > 0.5 && restPass < 0.5) {
        bool dyn = false;
        for (int di = -1; di <= 1; di++) {
            for (int dj = -1; dj <= 1; dj++) {
                float ci = floor(fi + 0.5) + float(di);
                float cj = floor(fj + 0.5) + float(dj);
                vec2 cp = vec2(ci * 2.1213203, (2.0 * cj - ci) * 1.2247449);
                if (length(cp - sp) > R + px) continue;
#if defined(OMACUBE_MOTION_RULE)
                // self-check 11: the same test worked out cell by cell
                float nTop = floor(-(ci + cj) / 3.0);
                for (int k = 0; k < 2; k++) {
                    float n = nTop - float(k);
                    vec3 b = vec3(ci + n, cj + n, n);
                    if (b.x + b.y + b.z < -4.5) break;
                    if (imod(win - classOf(b), 3.0) > 0.5) continue;
                    Cube cb = cubeState(b);
                    if (cb.lift > 0.0 && occupied(b)) dyn = true;
                }
#else
                if (texture(motion, (vec2(ci, cj) - hOrigin + 0.5) / hSize).r > 0.5) dyn = true;
#endif
            }
        }
        // the word's cubes, at home or anywhere on the way out along +x
        if (mono && abs(fi - (TS.x - TS.z) - 5.5) < 9.0) {
            vec2 po = vec2(0.70710678, -0.40824829) * POP;   // (POP, 0, 0) on screen
            for (int k = 0; k < 20; k++) {
                float fk = float(k);
                float r = 1.0 + floor(fk / 10.0);
                vec3 cw = vec3(TS.x, TS.y - r, TS.z - (fk - 10.0 * (r - 1.0))) * P;
                vec2 a = sp - vec2(dot(cw, rt), dot(cw, up));
                if (length(a - po * clamp(dot(a, po) / dot(po, po), 0.0, 1.0)) > R + px) continue;
                // the cache shows it solved into the word, in its wall
                Cube cb = cubeState(cw / P);
                if (cb.pop > 0.0 || cb.nb > 0.5) dyn = true;
            }
        }
#if defined(OMACUBE_DEBUG) && OMACUBE_DEBUG == 10
        // self-check 10 view: the pixels drawn live (white) over the cache (dim)
        vec3 rc = texture(rest, tc).rgb;
        fragColor = vec4(dyn ? vec3(1.0) : rc * 0.3, 1.0);
        return;
#endif
        // During a theme wave, a pixel well ahead of the front shows the old
        // theme and one well behind it the new: each is copied from a cache
        // drawn in that theme (restOk 2: old, 1: new). Stickers within R of
        // the pixel's spot are the only ones it can show, so only a band of
        // WAVE_B + 2 (R + px) is drawn live.
        float need = 1.0;
        if (wave.y > 0.5) {
            float a = gFront - dot(uv, WAVE_DIR);
            // (a size wave lets the top cubes, coordinate sum down to -4,
            // lag behind by up to 4 SIZE_LAG)
            float lagB = wave.z > 0.5 ? 4.0 * SIZE_LAG : 0.0;
            need = a < -(R + px) ? 2.0 : (a > WAVE_B + R + px + lagB ? 1.0 : 0.0);
        }
        if (!dyn && need > 0.5) {
            // A cache drawn at another pan holds the same picture shifted
            // sideways by the difference (the camera slides in its own
            // plane), so during a slide each pixel reads whichever cache
            // covers it. At rest the difference is exactly 0.
            vec3 sS = pixelArt > 0.5 ? floor(restPans / px + 0.5) * px : restPans;
            vec3 d = slide - sS;
            d -= PAN_PERIOD * floor(d / PAN_PERIOD + 0.5);
            vec3 x = tc.x + d / (2.0 * VIEW * aspect);
            if (restOk.x == need && x.x >= 0.0 && x.x < 1.0) { fragColor = texture(rest, vec2(x.x, tc.y)) * qt_Opacity; return; }
            if (restOk.y == need && x.y >= 0.0 && x.y < 1.0) { fragColor = texture(rest1, vec2(x.y, tc.y)) * qt_Opacity; return; }
            if (restOk.z == need && x.z >= 0.0 && x.z < 1.0) { fragColor = texture(rest2, vec2(x.z, tc.y)) * qt_Opacity; return; }
        }
    }

    float tStart = 0.0;
    if (mono) {
        vec3 te3 = (ro - TS * P - 1.5) * 1.7320508;
        tStart = min(0.0, max(te3.x, max(te3.y, te3.z)) - 0.05);
    }

    // Sphere tracing: mapScene never overestimates, so stepping by d can
    // never pass through a cube. Most rays hit in about 9 steps. A ray that
    // runs alongside a face tumbled edge-on to the view crawls in small
    // steps; the worst seen in testing took about 216, hence the budget.
    float t = tStart;
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
                if (b.x + b.y + b.z < -4.5) break;      // a free cube has an empty cell in front: sum >= -4
                if (restPass > 0.5 || imod(win - classOf(b), 3.0) > 0.5) continue;
                Cube cb = cubeState(b);
                if (cb.lift <= 0.0 || !occupied(b)) continue;
                Hit hy;
                float ty;
                if (traceCube(b, cb, vec3(0.0), ro, fw, hy, ty) && ty - cb.lift * 1.7320508 < tBest) {
                    tBest = ty - cb.lift * 1.7320508;
                    h = hy;
                    hitAny = true;
                    grazed = false;
                }
            }
        }
    }
    // Mosaic cubes popped out of the wall: the march left their cells empty
    // (so the hole shows the giant cube behind); draw each at its spot.
    if (mono && abs(fi - (TS.x - TS.z) - 5.5) < 9.0) {
        for (int k = 0; k < 20; k++) {
            float fk = float(k);
            float r = 1.0 + floor(fk / 10.0);
            vec3 cid = vec3(TS.x, TS.y - r, TS.z - (fk - 10.0 * (r - 1.0)));
            float pop = restPass > 0.5 ? 0.0 : wallPop(cid);
            if (pop <= 0.0) continue;
            vec3 cw = cid * P + vec3(pop, 0.0, 0.0);
            if (length(vec2(dot(cw, rt), dot(cw, up)) - sp) > R) continue;
            Cube cb = cubeState(cid);
            Hit hy;
            float ty;
            if (traceCube(cid, cb, vec3(cb.pop, 0.0, 0.0), ro, fw, hy, ty) && ty < tBest) {
                tBest = ty;
                h = hy;
                hitAny = true;
                grazed = false;
            }
        }
    }

    // the hit cube's size, and the cubie hit if the march left it to here
    if (hitAny) {
        vec3 z = cubeSize(h.cid, h.tex);
        h.n = z.x; h.sc = z.y; h.ph = z.z;
        cubieAt(gridOf(z.x, max(z.y, 1e-3)), h.axis, h.layer, h.ang, h.cell, h.lp);
    }

    // the theme wave at this pixel and at the hit cube's centre
    float pPix = wavePhase(uv);
    vec3 col = mix(oBg.rgb, bgColor.rgb, smoothstep(0.0, 1.0, pPix));
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

        vec3 cw = h.cid * P + (h.tex > -0.5 ? vec3(h.pop, 0.0, 0.0) : vec3(0.0));
        vec2 cubeSpot = vec2(dot(cw, rt) - slide, dot(cw, up));
        bool sizeWave = wave.z > 0.5;
        vec3 bodyNow = mix(oBody.rgb, bodyColor.rgb, smoothstep(0.0, 1.0, sizeWave ? h.ph : wavePhase(cubeSpot)));
        col = bodyNow;
        float hm = 0.5 * (h.n - 1.0);                   // outermost cubie coordinate
        float hk = h.sc * 3.0 / h.n;                    // world units per cubie
        if (dot(h.cell, nl) > hm - 0.25) {              // outer faces carry stickers
            // Rounded-square sticker: half size 0.43, corner radius 0.035,
            // pulled in a little more on sides where this cubie meets the
            // next cube, so every cube reads on its own in a flat run.
            vec2 ce = fa < 0.5 ? h.cell.yz : (fa < 1.5 ? h.cell.xz : h.cell.xy);
            vec2 lo = vec2(-0.43) + 0.045 * step(hm - 0.25, -ce);
            vec2 hi = vec2(0.43) - 0.045 * step(hm - 0.25, ce);
            vec2 ctr = 0.5 * (lo + hi);
            // The theme wave flips this sticker about its centre line: its
            // width shrinks to |cos| of the flip angle, and past edge-on it
            // shows its back, in the new theme's colour. Its phase comes from
            // its centre's spot on screen (turning layers not counted).
            vec3 sw = cw + rotA((h.cell + nl * 0.5) * hk, h.axis, h.ang);
            float ph = sizeWave ? h.ph : wavePhase(vec2(dot(sw, rt) - slide, dot(sw, up)));
            bool showOld = ph < 0.5;
            // (a size wave shrinks the whole cube instead)
            float squeeze = wave.y > 0.5 && !sizeWave ? max(abs(cos(ph * 3.14159265)), 0.02) : 1.0;   // exactly 1 with no wave
            fuv.x = ctr.x + (fuv.x - ctr.x) / squeeze;
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
            vec3 dx = rotA((rt - fw * (dot(nw, rt) / nf)) * (px / hk), h.axis, -h.ang);
            vec3 dy = rotA((up - fw * (dot(nw, up) / nf)) * (px / hk), h.axis, -h.ang);
            vec2 fx = fa < 0.5 ? dx.yz : (fa < 1.5 ? dx.xz : dx.xy);
            vec2 fy = fa < 0.5 ? dy.yz : (fa < 1.5 ? dy.xz : dy.xy);
            fx.x /= squeeze;
            fy.x /= squeeze;
            float w = max(abs(dot(g, fx)) + abs(dot(g, fy)), 1e-5);
            // pixel art: a pixel is all sticker or all plastic, theme colours only
            float cover = pixelArt > 0.5 ? step(sd, 0.0) : clamp(0.5 - sd / w, 0.0, 1.0);
            shownCover = cover;
            if (cover > 0.0) {
                vec3 c = h.cell, n = nl;
                homeOf(h, c, n);
                vec3 stk = h.tex > -0.5 ? paletteColor(mosaicIndex(h.tex, c, n), showOld) : stickerColor(n, showOld);
                // blend in linear light, then back to sRGB
                vec3 body = pow(bodyNow, vec3(2.2));
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
            cycleMoves(h.id, h.cycKey, h.n, ax3, ly3, dr3);
            ax = comp(ax3, h.idx); ly = comp(ly3, h.idx); dr = comp(dr3, h.idx);
            // making move idx: idx moves applied; undoing it: idx + 1
            if (h.pre != h.idx + (h.sgn > 0.0 ? 0.0 : 1.0)) col = bad;
        } else {
            seqMove(h.id, h.rseq, h.idx, ax, ly, dr);
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
            if (abs(ck) < 0.5 * (h.n - 1.0) - 0.25) continue;
            vec3 c = h.cell;
            vec3 n = setComp(vec3(0.0), fk, sign(ck));
            homeOf(h, c, n);
            if (home0.x > 8.0) home0 = c;
            ok = ok && c == home0 && dot(c, n) > 0.5 * (h.n - 1.0) - 0.25;
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
    if (hitAny && dot(h.cell, nl) > 0.5 * (h.n - 1.0) - 0.25) {
        vec3 front = h.cid + nl;
        vec3 e1 = abs(nl.x) > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 e2 = abs(nl.z) > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
        if (occupied(front + e1) || occupied(front + e2)) col = bad;
    }
#elif OMACUBE_DEBUG == 7
    // the word at rest: a mosaic cube with nothing applied shows only yellow
    // or red on its +x face, and green on +z (first column), so the mosaic
    // states are read the right way round; green tint marks checked pixels
    col = dim;
    if (hitAny && h.tex > -0.5 && h.nb < 0.5 && h.pop <= 0.0 && dot(h.cell, nl) > 0.5) {
        float ci = mosaicIndex(h.tex, h.cell, nl);
        // (a popped neighbour can bare a +z side further along; only the
        // first column's +z belongs to the green face)
        bool first = imod(h.tex, 10.0) < 0.5;
        bool ok = nl.x > 0.5 ? (ci == 0.0 || ci == 3.0) : (nl.z > 0.5 && first ? ci == 4.0 : true);
        col = ok ? vec3(0.0, 0.6, 0.0) : bad;
    }
#elif OMACUBE_DEBUG == 9
    // every cell the drawing looked up in the height map holds a cube
    // exactly when the rule says so; green tint marks checked pixels
    col = gMapBad ? bad : vec3(0.0, 0.6, 0.0) * 0.5 + dim * 0.5;
#elif OMACUBE_DEBUG == 8
    // the fast two-step drawing finds the same cube, at the same spot, as
    // marching the stack directly with every cube where it really is
    col = dim;
    {
        gId0 = vec3(1e9);
        gSd = vec3(0.0);
        vec3 ro2 = ro + fw * (tStart - 6.0);            // above slid-out and popped cubes too (POP * sqrt 3 = 5.3)
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
#endif
#endif
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
