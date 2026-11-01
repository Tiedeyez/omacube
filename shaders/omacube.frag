#version 440
// Omacube: an endless zoom into the corner of a 3x3x3 twisty puzzle cube.
//
// Every cube's corner cubie at (1,1,1) is itself a whole cube, one third the
// size, so all cubes share the outer corner F = (1.5, 1.5, 1.5). The camera
// looks at F and the scene scales up about F; after one level (x3) the image
// repeats exactly, which gives a seamless infinite zoom.
//
// Each cube scrambles itself with 8 real layer turns, rests, then plays the
// inverse sequence to solve itself. Sticker colours are derived by undoing the
// completed turns, so colours travel with the turning layers.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;       // animation clock, seconds (wrapped by the host)
    float zoom;       // zoom position in levels; fract = phase within a level
    float spin;       // camera roll, radians
    float aspect;     // width / height
    vec4 c0;          // sticker colour for +x faces
    vec4 c1;          // -x
    vec4 c2;          // +y
    vec4 c3;          // -y
    vec4 c4;          // +z
    vec4 c5;          // -z
    vec4 bodyColor;   // cubie plastic
    vec4 bgColor;     // anything a ray misses
};

const float PI = 3.14159265;
const float H = 0.465;          // cubie half size (pitch 1.0)
const float R = 0.075;          // cubie corner rounding
const vec3 F = vec3(1.5);       // shared corner, the zoom fixed point
const int LMIN = -3;            // outer levels drawn around the current one
const int LMAX = 4;             // inner levels drawn before the tiny tip is capped

const float SLOT = 0.9;         // seconds per move slot
const float TURN = 0.62;        // fraction of a slot spent turning
const float CYCLE = 20.0;       // 8 scramble, 2 rest, 8 solve, 2 rest

float hash1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

float sdRBox(vec3 p, float b, float r) {
    vec3 q = abs(p) - vec3(b - r);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

vec3 rotA(vec3 p, int a, float ang) {
    float c = cos(ang), s = sin(ang);
    if (a == 0) return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
    if (a == 1) return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// Move j of a scramble: axis 0..2, layer -1 or 0 (never the layer that holds
// the nested corner), direction +-1.
void moveOf(float seed, int j, out int axis, out float layer, out float dir) {
    float h = hash1(seed + float(j) * 17.31);
    int m = int(floor(h * 12.0));
    axis = m - (m / 3) * 3;
    layer = ((m / 3) - ((m / 3) / 2) * 2) == 0 ? -1.0 : 0.0;
    dir = m < 6 ? 1.0 : -1.0;
}

float easeTurn(float x) {
    // fast flick with a small overshoot and settle, like a real layer click
    x = clamp(x, 0.0, 1.0);
    float c1 = 1.9, c3 = c1 + 1.0;
    float y = x - 1.0;
    return 1.0 + c3 * y * y * y + c1 * y * y;
}

// State of cube with absolute id A: how many scramble moves are applied before
// the current one (pre), and the move in progress (axis, layer, angle).
void cubeState(float A, out float seed, out int pre, out int axis, out float layer, out float ang) {
    float tt = time / SLOT + hash1(A * 7.13) * CYCLE;
    float cyc = floor(tt / CYCLE);
    float s = tt - cyc * CYCLE;
    seed = A * 31.7 + cyc * 1.37;
    int slot = int(floor(s));
    float f = fract(s);
    axis = 0; layer = 0.0; ang = 0.0;
    float dir;
    if (slot < 8) {                 // scrambling: move j = slot, pre = j
        pre = slot;
        moveOf(seed, slot, axis, layer, dir);
        ang = dir * easeTurn(f / TURN) * 0.5 * PI;
    } else if (slot < 10) {         // rest, fully scrambled
        pre = 8;
    } else if (slot < 18) {         // solving: undo scramble move 17 - slot
        int k = 17 - slot;          // 7 .. 0
        pre = k + 1;
        moveOf(seed, k, axis, layer, dir);
        ang = -dir * easeTurn(f / TURN) * 0.5 * PI;
    } else {                        // rest, solved
        pre = 0;
    }
}

float cubie(vec3 q, vec3 c) { return sdRBox(q - c, H, R); }

// Distance to one cube's 26 outer cubies (the corner (1,1,1) is excluded when
// nested). Layer `layer` on `axis` is turned by `ang`.
float levelSDF(vec3 q, int axis, float layer, float ang, bool nested, out vec3 cell, out bool moving) {
    moving = false;
    vec3 c = clamp(floor(q + 0.5), -1.0, 1.0);
    bool turning = abs(ang) > 1e-4;
    if (turning && c[axis] == layer) {
        // nearest static layer on this axis
        c[axis] = (layer < -0.5) ? 0.0 : (q[axis] > 0.0 ? 1.0 : -1.0);
    }
    float d;
    if (nested && c == vec3(1.0)) {
        d = 1e9;
        for (int i = 0; i < 3; i++) {
            vec3 cc = vec3(1.0); cc[i] = 0.0;
            if (turning && cc[axis] == layer) continue;
            float di = cubie(q, cc);
            if (di < d) { d = di; cell = cc; }
        }
    } else {
        d = cubie(q, c); cell = c;
    }
    if (turning) {
        vec3 qr = rotA(q, axis, -ang);
        vec3 cm = clamp(floor(qr + 0.5), -1.0, 1.0);
        cm[axis] = layer;
        float dm = cubie(qr, cm);
        if (dm < d) { d = dm; cell = cm; moving = true; }
    }
    return d;
}

struct Hit {
    float A;        // absolute cube id
    vec3 cell;      // cubie cell (in the frame before the move in progress)
    vec3 local;     // point relative to that cubie, same frame
    int axis; float layer; float ang; float seed; int pre;
};


vec3 stickerColor(int face);

// ---- background: a drifting lattice of tumbling mini cubes ----------------
mat3 rotXYZ(vec3 a) {
    vec3 c = cos(a), s = sin(a);
    mat3 rx = mat3(1, 0, 0, 0, c.x, s.x, 0, -s.x, c.x);
    mat3 ry = mat3(c.y, 0, -s.y, 0, 1, 0, s.y, 0, c.y);
    mat3 rz = mat3(c.z, s.z, 0, -s.z, c.z, 0, 0, 0, 1);
    return rz * ry * rx;
}

const float CELL = 3.2;

mat3 cellRot(vec3 id) {
    float h1 = hash1(dot(id, vec3(1.0, 57.0, 113.0)));
    float h2 = hash1(dot(id, vec3(7.0, 31.0, 89.0)) + 3.1);
    float h3 = hash1(dot(id, vec3(13.0, 17.0, 71.0)) + 9.7);
    vec3 a = vec3(h1, h2, h3) * 6.2831 + time * (0.15 + 0.35 * vec3(h2, h3, h1)) * sign(vec3(h3, h1, h2) - 0.5);
    return rotXYZ(a);
}

float bgMap(vec3 p, out vec3 id, out vec3 lp) {
    id = floor(p / CELL + 0.5);
    vec3 q = p - id * CELL;
    // keep a sparse field: skip some cells
    if (hash1(dot(id, vec3(3.0, 11.0, 29.0)) + 0.5) < 0.6) {
        lp = vec3(9.0);
        vec3 b = CELL * 0.5 - abs(q);
        return max(min(b.x, min(b.y, b.z)), 0.0) + 0.3;
    }
    lp = cellRot(id) * q;
    return sdRBox(lp, 0.52, 0.07);
}

vec3 bgField(vec3 rd, vec3 fw) {
    vec3 ro = vec3(0.37, 0.71, 0.13) * CELL + fw * time * 0.9;
    float t = 0.5;
    vec3 id, lp;
    bool hit = false;
    for (int i = 0; i < 40; i++) {
        float d = bgMap(ro + rd * t, id, lp);
        if (d < 0.002 * t) { hit = true; break; }
        t += d;
        if (t > 45.0) break;
    }
    vec3 bg = pow(bgColor.rgb, vec3(2.2));
    if (!hit) return bg;
    vec3 al = abs(lp);
    vec3 nl; vec2 fuv; int face;
    if (al.x >= al.y && al.x >= al.z) { nl = vec3(sign(lp.x), 0, 0); fuv = lp.yz; face = lp.x > 0.0 ? 0 : 1; }
    else if (al.y >= al.z)            { nl = vec3(0, sign(lp.y), 0); fuv = lp.xz; face = lp.y > 0.0 ? 2 : 3; }
    else                              { nl = vec3(0, 0, sign(lp.z)); fuv = lp.xy; face = lp.z > 0.0 ? 4 : 5; }
    // 3x3 sticker grid on each face
    vec2 g = fuv / (2.0 * 0.52) * 3.0 + 1.5;
    vec2 gi = clamp(floor(g), 0.0, 2.0);
    vec2 gf = g - gi - 0.5;
    vec2 sq = abs(gf) - vec2(0.3);
    float sd = length(max(sq, 0.0)) + min(max(sq.x, sq.y), 0.0) - 0.08;
    float sticker = 1.0 - smoothstep(-0.03, 0.03, sd);
    // mostly solved, some scrambled stickers
    float hs = hash1(dot(id, vec3(5.0, 23.0, 61.0)) + float(face) * 3.7 + gi.x * 1.3 + gi.y * 2.9);
    int sface = hs < 0.7 ? face : int(floor(hash1(hs * 91.0) * 6.0));
    vec3 sc = pow(stickerColor(sface), vec3(2.2));
    vec3 alb = mix(pow(bodyColor.rgb, vec3(2.2)), sc, sticker);
    vec3 n = transpose(cellRot(id)) * nl;
    vec3 L1 = normalize(vec3(0.55, 0.9, 0.35));
    float dif = max(dot(n, L1), 0.0);
    float spec = pow(max(dot(n, normalize(L1 - rd)), 0.0), 60.0) * 0.5 * sticker;
    vec3 col = alb * (0.18 + 0.9 * dif) + spec;
    float fog = 1.0 - exp(-t * 0.06);
    return mix(col * 0.55, bg, fog);
}

float levelBase() { return floor(zoom); }

// Per-level cube state, computed once per pixel in main() (it depends only on
// time and level), so the march loop does no hashing or trig for it.
const int NLEV = LMAX - LMIN + 1;
float gSeed[NLEV]; float gLayer[NLEV]; float gAng[NLEV]; int gAxis[NLEV]; int gPre[NLEV];

void prepareLevels() {
    float base = levelBase();
    for (int i = 0; i < NLEV; i++) {
        float A = float(LMIN + i) + base;
        cubeState(A, gSeed[i], gPre[i], gAxis[i], gLayer[i], gAng[i]);
    }
}

float mapScene(vec3 p, out Hit hit) {
    float u = zoom - floor(zoom);
    float sc = 27.0 * pow(3.0, u);      // world units per local unit, outer level
    vec3 q = F + (p - F) / sc;
    float d = 1e9;
    float base = levelBase();
    for (int i = 0; i < NLEV; i++) {
        vec3 cell; bool moving;
        bool nested = i < NLEV - 1;
        int axis = gAxis[i]; float layer = gLayer[i]; float ang = gAng[i];
        float dl = levelSDF(q, axis, layer, ang, nested, cell, moving) * sc;
        if (dl < d) {
            d = dl;
            hit.A = float(LMIN + i) + base; hit.cell = cell;
            hit.local = (moving ? rotA(q, axis, -ang) : q) - cell;
            hit.axis = axis; hit.layer = layer; hit.ang = moving ? ang : 0.0;
            hit.seed = gSeed[i]; hit.pre = gPre[i];
        }
        if (!nested) break;
        float hb = sdBox(q - vec3(1.0), vec3(0.5)) * sc;
        if (hb > d) break;
        q = F + (q - F) * 3.0;
        sc /= 3.0;
    }
    return d;
}

float map(vec3 p) { Hit h; return mapScene(p, h); }

vec3 calcNormal(vec3 p, float e) {
    vec2 k = vec2(1.0, -1.0);
    return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) +
                     k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

vec3 stickerColor(int face) {
    if (face == 0) return c0.rgb;
    if (face == 1) return c1.rgb;
    if (face == 2) return c2.rgb;
    if (face == 3) return c3.rgb;
    if (face == 4) return c4.rgb;
    return c5.rgb;
}

// Undo the completed scramble moves to find where a sticker started.
int homeFace(Hit h, vec3 n) {
    vec3 c = h.cell;
    for (int j = 7; j >= 0; j--) {
        if (j >= h.pre) continue;
        int axis; float layer, dir;
        moveOf(h.seed, j, axis, layer, dir);
        if (abs(c[axis] - layer) < 0.5) {
            c = floor(rotA(c, axis, -dir * 0.5 * PI) + 0.5);
            n = floor(rotA(n, axis, -dir * 0.5 * PI) + 0.5);
        }
    }
    vec3 an = abs(n);
    if (an.x > 0.5) return n.x > 0.0 ? 0 : 1;
    if (an.y > 0.5) return n.y > 0.0 ? 2 : 3;
    return n.z > 0.0 ? 4 : 5;
}

void main() {
    prepareLevels();
    vec2 uv = (qt_TexCoord0 - 0.5) * vec2(aspect, -1.0) * 2.0;

    // camera: a slow wobble around the main diagonal, always outside the cube
    float t = time;
    vec3 diag = normalize(vec3(1.0));
    vec3 dirc = normalize(diag + 0.13 * vec3(sin(t * 0.071), sin(t * 0.053 + 1.7), sin(t * 0.061 + 3.1)));
    float D = 3.4;
    vec3 ro = F + dirc * D;
    vec3 fw = normalize(F - ro);
    vec3 up0 = vec3(0.0, 1.0, 0.0);
    vec3 rt = normalize(cross(fw, up0));
    vec3 up = cross(rt, fw);
    float cr = cos(spin), sr = sin(spin);
    vec3 rt2 = cr * rt + sr * up;
    vec3 up2 = -sr * rt + cr * up;
    vec3 rd = normalize(fw * 1.75 + uv.x * rt2 + uv.y * up2);

    float tr = 0.0;
    float dist = 1e9;
    bool hitAny = false;
    float pix = 1.6 / 600.0;            // approx angular pixel size
    for (int i = 0; i < 90; i++) {
        vec3 p = ro + rd * tr;
        dist = map(p);
        if (dist < pix * tr) { hitAny = true; break; }
        tr += dist * 0.85;
        if (tr > 60.0) break;
    }

    vec3 col = bgField(rd, fw);
    if (hitAny) {
        vec3 p = ro + rd * tr;
        Hit h;
        mapScene(p, h);
        vec3 nrm = calcNormal(p, max(pix * tr * 0.5, 1e-5));

        // face of the cubie in its own frame
        vec3 lp = h.local;
        vec3 al = abs(lp);
        vec3 nl;
        vec2 fuv;
        if (al.x >= al.y && al.x >= al.z) { nl = vec3(sign(lp.x), 0, 0); fuv = lp.yz; }
        else if (al.y >= al.z)            { nl = vec3(0, sign(lp.y), 0); fuv = lp.xz; }
        else                              { nl = vec3(0, 0, sign(lp.z)); fuv = lp.xy; }

        bool outer = dot(h.cell, nl) > 0.5;
        // rounded-square sticker mask
        vec2 sq = abs(fuv) - vec2(H - 0.115);
        float sd = length(max(sq, 0.0)) + min(max(sq.x, sq.y), 0.0) - 0.06;
        float aa = 0.012;
        float sticker = outer ? 1.0 - smoothstep(-aa, aa, sd) : 0.0;

        vec3 base = pow(bodyColor.rgb, vec3(2.2));
        vec3 sc = pow(stickerColor(homeFace(h, nl)), vec3(2.2));
        vec3 alb = mix(base, sc, sticker);

        vec3 L1 = normalize(vec3(0.55, 0.9, 0.35));
        vec3 L2 = normalize(vec3(-0.7, 0.2, 0.6));
        float dif = max(dot(nrm, L1), 0.0);
        float dif2 = max(dot(nrm, L2), 0.0);
        vec3 hv = normalize(L1 - rd);
        float spec = pow(max(dot(nrm, hv), 0.0), mix(24.0, 90.0, sticker)) * mix(0.25, 0.7, sticker);
        float fres = pow(1.0 - max(dot(nrm, -rd), 0.0), 4.0);

        // cheap AO from the scene distance a little off the surface
        float scHit = 27.0 * pow(3.0, zoom - floor(zoom)) * pow(3.0, -(h.A - levelBase() - float(LMIN)));
        float e = 0.09 * scHit;
        float ao = clamp(map(p + nrm * e) / e, 0.0, 1.0);
        ao = 0.45 + 0.55 * ao;

        col = alb * (0.16 + 0.95 * dif + 0.28 * dif2) * ao + spec + fres * 0.12 * ao;
    }

    // vignette + gentle depth haze towards the centre tip
    float v = 1.0 - 0.32 * dot(uv * vec2(0.6, 0.8), uv * vec2(0.6, 0.8));
    col *= v;
    col = pow(max(col, 0.0), vec3(0.4545));
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
