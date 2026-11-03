#version 440
// Omacube's easter egg: one puzzle cube, n x n x n, floating free over the
// desktop (MATH.md, "The easter egg"). The player turns it and spins it;
// this draws it. Unlike the wall it is drawn by casting one ray against at
// most three boxes (the cube; or a turning slab and the blocks either side
// of it), so it needs no marching. The stickers come from a small state
// texture the plugin paints: sticker (u, v) of face f (+x, -x, +y, -y, +z,
// -z) at texel (f * 17 + u, 1 + v), red = (colour index + 1) / 8.
//
// Written to the GLSL ES 1.00 rules, like omacube.frag.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 r0;        // rows of the cube's rotation (cube frame -> view frame)
    vec4 r1;
    vec4 r2;
    vec4 turn;      // x: axis, y: layer (centred coordinate; 99 = whole cube), z: angle
    vec4 geo;       // x: n, y: cube half size / item half height, z: aspect, w: pixel size (item half heights)
    vec4 glow;      // x: yellow glow 0..1, y: celebration pulse 0..1
    vec4 c0;        // sticker colours, as in omacube.frag
    vec4 c1;
    vec4 c2;
    vec4 c3;
    vec4 c4;
    vec4 c5;
    vec4 bodyColor;
};
layout(binding = 1) uniform sampler2D stickers;

float comp(vec3 v, float a) { return a < 0.5 ? v.x : (a < 1.5 ? v.y : v.z); }
vec3 setComp(vec3 v, float a, float x) {
    if (a < 0.5) return vec3(x, v.y, v.z);
    if (a < 1.5) return vec3(v.x, x, v.z);
    return vec3(v.x, v.y, x);
}
vec3 rotA(vec3 p, float a, float t) {
    float c = cos(t), s = sin(t);
    if (a < 0.5) return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
    if (a < 1.5) return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// Ray o + t d against the box c +- h: the entry t and its face normal.
bool rayBox(vec3 o, vec3 d, vec3 c, vec3 h, out float t, out vec3 nrm) {
    vec3 sd = vec3(d.x >= 0.0 ? 1.0 : -1.0, d.y >= 0.0 ? 1.0 : -1.0, d.z >= 0.0 ? 1.0 : -1.0);
    vec3 inv = 1.0 / (sd * max(abs(d), vec3(1e-6)));
    vec3 t0 = (c - h - o) * inv;
    vec3 t1 = (c + h - o) * inv;
    vec3 tn = min(t0, t1);
    vec3 tf = max(t0, t1);
    t = max(tn.x, max(tn.y, tn.z));
    float tF = min(tf.x, min(tf.y, tf.z));
    if (t > tF || tF < 0.0) return false;
    nrm = tn.x >= t ? vec3(-sd.x, 0.0, 0.0) : (tn.y >= t ? vec3(0.0, -sd.y, 0.0) : vec3(0.0, 0.0, -sd.z));
    return true;
}

vec3 palette(float i) {
    if (i < 0.5) return c0.rgb;
    if (i < 1.5) return c1.rgb;
    if (i < 2.5) return c2.rgb;
    if (i < 3.5) return c3.rgb;
    if (i < 4.5) return c4.rgb;
    return c5.rgb;
}

float sdBox(vec3 p, float b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

void main() {
    float n = geo.x;
    float m = 0.5 * (n - 1.0);
    float o = m - floor(m);
    float s = 1.5 / geo.y;                              // cube units per item half height
    vec2 p = (qt_TexCoord0 - 0.5) * vec2(geo.z, -1.0) * 2.0 * s;
    // the view looks down -z; the cube frame is the view turned back by R
    vec3 ov = vec3(p, 10.0);
    vec3 oc = r0.xyz * ov.x + r1.xyz * ov.y + r2.xyz * ov.z;
    vec3 dc = -r2.xyz;

    float axis = turn.x, layer = turn.y, ang = turn.z;
    bool turning = abs(ang) > 1e-4;
    float best = 1e9;
    vec3 bn = vec3(0.0), bp = vec3(0.0);
    bool slab = false;
    float t;
    vec3 nrm;
    if (!turning) {
        if (rayBox(oc, dc, vec3(0.0), vec3(1.5), t, nrm)) { best = t; bn = nrm; bp = oc + dc * t; }
    } else if (layer > 50.0) {
        vec3 orr = rotA(oc, axis, -ang), drr = rotA(dc, axis, -ang);
        if (rayBox(orr, drr, vec3(0.0), vec3(1.5), t, nrm)) { best = t; bn = nrm; bp = orr + drr * t; slab = true; }
    } else {
        float k = 3.0 / n;
        float lo = (layer - 0.5) * k;
        if (lo > -1.5 + 1e-3 && rayBox(oc, dc, setComp(vec3(0.0), axis, 0.5 * (lo - 1.5)), setComp(vec3(1.5), axis, 0.5 * (lo + 1.5)), t, nrm) && t < best) {
            best = t; bn = nrm; bp = oc + dc * t;
        }
        if (lo + k < 1.5 - 1e-3 && rayBox(oc, dc, setComp(vec3(0.0), axis, 0.5 * (lo + k + 1.5)), setComp(vec3(1.5), axis, 0.5 * (1.5 - lo - k)), t, nrm) && t < best) {
            best = t; bn = nrm; bp = oc + dc * t;
        }
        vec3 orr = rotA(oc, axis, -ang), drr = rotA(dc, axis, -ang);
        if (rayBox(orr, drr, setComp(vec3(0.0), axis, layer * k), setComp(vec3(1.5), axis, 0.5 * k), t, nrm) && t < best) {
            best = t; bn = nrm; bp = orr + drr * t; slab = true;
        }
    }

    vec3 gold = vec3(1.0, 0.82, 0.18);
    float gl = glow.x + 0.6 * glow.y;
    if (best > 1e8) {
        // a yellow halo around the cube while it glows
        vec3 q = oc - dc * dot(oc, dc);
        float dd = max(sdBox(q, 1.5), 0.0);
        // (faded to nothing inside the item's inscribed circle, 2.2 half
        // sizes out, so its square edge never shows)
        float a = clamp(gl * 0.85 * exp(-dd / 0.55), 0.0, 1.0) * (1.0 - smoothstep(0.72, 0.98, length(p) / (2.2 * 1.5)));
        fragColor = vec4(gold * a, a) * qt_Opacity;
        return;
    }

    // the cubie hit, as in omacube.frag's cubieAt()
    vec3 g = bp * (n / 3.0);
    vec3 c = clamp(floor(g + (0.5 - o)) + o, -m, m);
    if (turning && layer < 50.0) {
        if (slab) c = setComp(c, axis, layer);
        else if (comp(c, axis) == layer) c = setComp(c, axis, comp(g, axis) < layer ? layer - 1.0 : layer + 1.0);
    }
    vec3 lp = g - c;
    vec3 nCube = slab ? rotA(bn, axis, ang) : bn;      // the face's normal, unturned
    vec3 nView = vec3(dot(r0.xyz, nCube), dot(r1.xyz, nCube), dot(r2.xyz, nCube));

    vec3 col = bodyColor.rgb;
    if (dot(c, bn) > m - 0.25) {                        // outer faces carry stickers
        float fa = abs(bn.x) > 0.5 ? 0.0 : (abs(bn.y) > 0.5 ? 1.0 : 2.0);
        vec2 fuv = fa < 0.5 ? lp.yz : (fa < 1.5 ? lp.xz : lp.xy);
        vec2 ce = fa < 0.5 ? c.yz : (fa < 1.5 ? c.xz : c.xy);
        vec2 lo2 = vec2(-0.43) + 0.045 * step(m - 0.25, -ce);
        vec2 hi2 = vec2(0.43) - 0.045 * step(m - 0.25, ce);
        vec2 ctr = 0.5 * (lo2 + hi2);
        vec2 sq = abs(fuv - ctr) - (0.5 * (hi2 - lo2) - 0.035);
        float sd = length(max(sq, 0.0)) + min(max(sq.x, sq.y), 0.0) - 0.035;
        // a screen pixel is geo.w item half heights; in cubie units on this
        // face it stretches by 1 / |cos| of the face's tilt
        float w = geo.w * s * (n / 3.0) / max(abs(nView.z), 0.2);
        float cover = clamp(0.5 - sd / w, 0.0, 1.0);
        // its state texel: the face the sticker sits on now, and (u, v)
        float sg = comp(bn, fa) > 0.0 ? 0.0 : 1.0;
        float f = 2.0 * fa + sg;
        vec2 uv = ce + m;
        float ci = floor(texture(stickers, (vec2(f * 17.0 + uv.x, 1.0 + uv.y) + 0.5) / vec2(102.0, 18.0)).r * 8.0 + 0.5) - 1.0;
        vec3 body = pow(bodyColor.rgb, vec3(2.2));
        col = pow(mix(body, pow(palette(ci), vec3(2.2)), cover), vec3(1.0 / 2.2));
    }
    // a little light from the upper left, so the faces read as solid
    float lit = 0.74 + 0.26 * max(dot(nView, normalize(vec3(-0.45, 0.6, 0.66))), 0.0);
    col *= lit;
    col = mix(col, gold, 0.3 * clamp(gl, 0.0, 1.0));
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
