#version 440
// Omacube: an endless isometric stack of 3x3x3 puzzle cubes, drawn flat.
//
// The camera is orthographic and looks straight down the (1,1,1) diagonal,
// which turns a 3D lattice of cubes into interlocking hexagonal stars. Most
// cubes sit still; each one, on its own clock, makes three moves (a layer
// turn or a whole-cube tumble), rests, then undoes them in reverse. Sticker
// colours are found by undoing the completed moves, so colours travel with
// the turning layers.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;       // animation clock, seconds (wrapped by the host)
    float zoom;       // drift along the field, in cube pitches
    float spin;       // view roll, radians (120 degree steps line up)
    float aspect;     // width / height
    vec4 c0;          // sticker colours
    vec4 c1;
    vec4 c2;
    vec4 c3;
    vec4 c4;
    vec4 c5;
    vec4 bodyColor;   // cube plastic and the lines between stickers
    vec4 bgColor;     // empty space
};

const float PI = 3.14159265;
const float P = 3.0;            // lattice pitch: cubes touch, like the stack
const float H = 0.5;            // cubie half size (cube spans -1.5 .. 1.5)
const float VIEW = 15.0;         // half the screen height, in world units
const float FILL = 0.74;        // fraction of lattice cells holding a cube

const float SLOT = 0.95;        // seconds per slot (scaled per cube)
const float TURN = 0.6;         // fraction of a slot spent moving
const float CYCLE = 14.0;       // 3 moves, 4 rest, 3 undo, 4 rest

float hash1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

float sdBox(vec3 p, float b) {
    vec3 q = abs(p) - vec3(b);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

vec3 rotA(vec3 p, int a, float ang) {
    float c = cos(ang), s = sin(ang);
    if (a == 0) return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
    if (a == 1) return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// Move j of a cube's cycle: axis 0..2; layer -1, 0, 1, or 2 = the whole cube.
void moveOf(float seed, int j, out int axis, out float layer, out float dir) {
    float h = hash1(seed + float(j) * 17.31);
    axis = int(floor(h * 3.0));
    float h2 = hash1(seed * 1.7 + float(j) * 5.13);
    layer = h2 < 0.4 ? 2.0 : floor(fract(h2 * 7.0) * 3.0) - 1.0;
    dir = hash1(seed * 2.3 + float(j) * 9.7) < 0.5 ? 1.0 : -1.0;
}

float easeTurn(float x) {
    // fast flick with a small overshoot and settle
    x = clamp(x, 0.0, 1.0);
    float c1 = 1.7, c3 = c1 + 1.0;
    float y = x - 1.0;
    return 1.0 + c3 * y * y * y + c1 * y * y;
}

float cycleTime(float seed) {
    float rate = 0.75 + 0.6 * hash1(seed * 3.3);
    return time / (SLOT * rate) + hash1(seed * 7.13) * CYCLE;
}

// How many moves are applied (pre) and the move in progress.
void cubeState(float seed, out int pre, out int axis, out float layer, out float ang) {
    float tt = cycleTime(seed);
    float cyc = floor(tt / CYCLE);
    float s = tt - cyc * CYCLE;
    float mseed = seed + cyc * 1.37;
    int slot = int(floor(s));
    float f = fract(s);
    axis = 0; layer = 0.0; ang = 0.0; pre = 0;
    float dir;
    if (slot < 3) {
        pre = slot;
        moveOf(mseed, slot, axis, layer, dir);
        ang = dir * easeTurn(f / TURN) * 0.5 * PI;
    } else if (slot < 7) {
        pre = 3;
    } else if (slot < 10) {
        int k = 9 - slot;              // undo move 2, 1, 0
        pre = k + 1;
        moveOf(mseed, k, axis, layer, dir);
        ang = -dir * easeTurn(f / TURN) * 0.5 * PI;
    }
}

float cellSeed(vec3 id) { return hash3(id) * 1000.0 + 0.5; }
// The stack fills the half-space below a plane facing the camera, with
// random gaps, so the top layers read as stair-stepped hexagonal stars.
bool occupied(vec3 id) {
    float s = id.x + id.y + id.z;
    if (s > 0.5) return false;
    return s < -3.5 || hash3(id + 0.37) < FILL;
}

// Distance to one cube centred at the origin of q.
float cubeSDF(vec3 q, int axis, float layer, float ang, out vec3 cell, out vec3 lp) {
    bool turning = abs(ang) > 1e-4;
    if (turning && layer > 1.5) {       // whole cube tumbling
        vec3 qr = rotA(q, axis, -ang);
        cell = clamp(floor(qr + 0.5), -1.0, 1.0);
        lp = qr - cell;
        return sdBox(lp, H);
    }
    vec3 c = clamp(floor(q + 0.5), -1.0, 1.0);
    if (turning && c[axis] == layer) {
        float alt = layer == 0.0 ? (q[axis] > 0.0 ? 1.0 : -1.0) : 0.0;
        c[axis] = alt;
    }
    float d = sdBox(q - c, H);
    cell = c; lp = q - c;
    if (turning) {
        vec3 qr = rotA(q, axis, -ang);
        vec3 cm = clamp(floor(qr + 0.5), -1.0, 1.0);
        cm[axis] = layer;
        float dm = sdBox(qr - cm, H);
        if (dm < d) { d = dm; cell = cm; lp = qr - cm; }
    }
    return d;
}

struct Hit { vec3 id; vec3 cell; vec3 lp; float seed; int pre; };

// Nearest cube among this lattice cell and the 7 neighbours on the near
// sides (turning cubes reach past their own cell).
float mapScene(vec3 p, out Hit hit) {
    vec3 id0 = floor(p / P + 0.5);
    vec3 q0 = p - id0 * P;
    vec3 sd = sign(q0 + 1e-6);
    float d = 1e9;
    for (int i = 0; i < 8; i++) {
        float fi = float(i);   // no bitwise ops: Qt may run this as GLSL ES 1.00
        vec3 o = vec3(mod(fi, 2.0), mod(floor(fi / 2.0), 2.0), floor(fi / 4.0)) * sd;
        vec3 id = id0 + o;
        if (!occupied(id)) continue;
        vec3 q = p - id * P;
        float bound = length(q) - 2.6;      // sphere around a turning cube
        if (bound > d) continue;
        float seed = cellSeed(id);
        int pre, axis; float layer, ang;
        cubeState(seed, pre, axis, layer, ang);
        vec3 cell, lp;
        float dc = cubeSDF(q, axis, layer, ang, cell, lp);
        if (dc < d) {
            d = dc;
            hit.id = id; hit.cell = cell; hit.lp = lp; hit.seed = seed; hit.pre = pre;
        }
    }
    // empty neighbourhood: step towards the next cell boundary instead
    if (d > 1e8) {
        vec3 b = P * 0.5 - abs(q0);
        d = max(min(b.x, min(b.y, b.z)), 0.0) + 0.05;
    }
    return d;
}

vec3 stickerColor(int face) {
    if (face == 0) return c0.rgb;
    if (face == 1) return c1.rgb;
    if (face == 2) return c2.rgb;
    if (face == 3) return c3.rgb;
    if (face == 4) return c4.rgb;
    return c5.rgb;
}

int faceIndex(vec3 n) {
    vec3 an = abs(n);
    if (an.x > 0.5) return n.x > 0.0 ? 0 : 1;
    if (an.y > 0.5) return n.y > 0.0 ? 2 : 3;
    return n.z > 0.0 ? 4 : 5;
}

// Undo the completed moves to find the sticker's home, then give each cube a
// fixed scramble: some stickers keep their face colour, the rest are random.
vec3 stickerAt(Hit h, vec3 n) {
    vec3 c = h.cell;
    float mseed = h.seed + floor(cycleTime(h.seed) / CYCLE) * 1.37;
    for (int j = 2; j >= 0; j--) {
        if (j >= h.pre) continue;
        int axis; float layer, dir;
        moveOf(mseed, j, axis, layer, dir);
        if (layer > 1.5 || abs(c[axis] - layer) < 0.5) {
            c = floor(rotA(c, axis, -dir * 0.5 * PI) + 0.5);
            n = floor(rotA(n, axis, -dir * 0.5 * PI) + 0.5);
        }
    }
    int home = faceIndex(n);
    float solved = 0.15 + 0.5 * hash1(h.seed * 5.9);
    float r = hash3(c * 3.1 + n * 7.7 + h.seed);
    int face = r < solved ? home : int(floor(hash1(r * 91.0 + h.seed) * 6.0));
    return stickerColor(face);
}

void main() {
    vec2 uv = (qt_TexCoord0 - 0.5) * vec2(aspect, -1.0) * 2.0 * VIEW;
    float cr = cos(spin), sr = sin(spin);
    uv = vec2(cr * uv.x - sr * uv.y, sr * uv.x + cr * uv.y);

    // orthographic, straight down the diagonal: true isometric
    vec3 fw = -normalize(vec3(1.0));
    vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rt, fw);
    // drift diagonally across the field
    vec3 pan = (rt * 0.8 + up * 0.45) * zoom * P;
    vec3 ro = pan + rt * uv.x + up * uv.y - fw * 9.0;   // above the stack
    vec3 rd = fw;

    float t = 0.0;
    bool hitAny = false;
    Hit h;
    for (int i = 0; i < 80; i++) {
        float d = mapScene(ro + rd * t, h);
        if (d < 0.004) { hitAny = true; break; }
        t += d;
        if (t > 60.0) break;
    }

    vec3 col = bgColor.rgb;
    if (hitAny) {
        mapScene(ro + rd * t, h);
        vec3 lp = h.lp;
        vec3 al = abs(lp);
        vec3 nl; vec2 fuv;
        if (al.x >= al.y && al.x >= al.z) { nl = vec3(sign(lp.x), 0, 0); fuv = lp.yz; }
        else if (al.y >= al.z)            { nl = vec3(0, sign(lp.y), 0); fuv = lp.xz; }
        else                              { nl = vec3(0, 0, sign(lp.z)); fuv = lp.xy; }

        bool outer = dot(h.cell, nl) > 0.5;
        vec2 sq = abs(fuv) - vec2(H - 0.105);
        float sd = length(max(sq, 0.0)) + min(max(sq.x, sq.y), 0.0) - 0.035;
        float aa = 0.022;               // about one rendered pixel
        float sticker = outer ? 1.0 - smoothstep(-aa, aa, sd) : 0.0;
        col = mix(bodyColor.rgb, stickerAt(h, nl), sticker);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
