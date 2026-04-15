/* global Float32Array */
import { makeRng } from "../base.js";

const MAX_SHAPES = 8;
const MAX_COLORS = 6;
const MAX_CARDS = 6;

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform vec2  u_res;
uniform float u_time;
uniform int   u_count;
uniform int   u_palCount;
uniform int   u_cardCount;
uniform vec3  u_palette[${MAX_COLORS}];
// xyzw: cx, cy, halfLen, radius  (world coords; x in aspect-corrected space, y in [-1,1])
uniform vec4  u_shape[${MAX_SHAPES}];
// Cards: xy = center, zw = halfsize
uniform vec4  u_cardA[${MAX_CARDS}];
// x = palette idx (float), y = parallax speed, z = stripe flag (0/1), w = rotation (radians)
uniform vec4  u_cardB[${MAX_CARDS}];
uniform float u_neckBoost;
uniform float u_highlightSharpness;
uniform float u_chroma;
uniform float u_bevelDepth;

// --- hash / noise for soft background blobs ---
vec3 hash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float snoise(vec3 p) {
  const float K1 = 1.0 / 3.0;
  const float K2 = 1.0 / 6.0;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - 2.0 * K2);
  vec3 d3 = d0 - (1.0 - 3.0 * K2);
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h * h * h * h * vec4(
    dot(d0, hash3(i)),
    dot(d1, hash3(i + i1)),
    dot(d2, hash3(i + i2)),
    dot(d3, hash3(i + 1.0))
  );
  return dot(vec4(31.316), n);
}

vec3 paletteColor(int idx) {
  // safe palette lookup
  for (int i = 0; i < ${MAX_COLORS}; i++) {
    if (i == idx) return u_palette[i];
  }
  return u_palette[0];
}

// Soft gaussian color blobs (slow-moving) base layer.
vec3 softBlobs(vec2 p, float t) {
  float totalW = 0.0;
  vec3 accum = vec3(0.0);
  for (int i = 0; i < ${MAX_COLORS}; i++) {
    if (i >= u_palCount) break;
    float fi = float(i);
    // slow drifting centers
    vec2 c = vec2(
      sin(t * 0.07 + fi * 1.7) * 1.1,
      cos(t * 0.06 + fi * 2.3) * 0.7
    );
    float d = distance(p, c);
    float w = exp(-d * d * 0.9);
    // tiny bit of low-freq noise in weight so blobs aren't perfectly symmetric
    w *= 0.8 + 0.2 * snoise(vec3(p * 0.4, t * 0.05 + fi));
    totalW += w;
    accum += u_palette[i] * max(w, 0.0);
  }
  return accum / max(totalW, 1e-3);
}

// Rounded rectangle SDF (2D). Negative inside.
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// 2D rotation
vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Edge-rich backdrop: soft blobs + scrolling parallax cards with borders.
vec3 backdrop(vec2 p, float t) {
  vec3 col = softBlobs(p, t);

  // Scrolling parallax cards
  for (int i = 0; i < ${MAX_CARDS}; i++) {
    if (i >= u_cardCount) break;
    vec4 A = u_cardA[i];
    vec4 B = u_cardB[i];
    float par = B.y;
    // scroll horizontally at parallax speed
    vec2 c = A.xy;
    c.x = mod(c.x + t * par + 3.0, 6.0) - 3.0;
    vec2 localP = rot2(p - c, -B.w);
    vec2 halfSize = A.zw;
    float corner = min(halfSize.x, halfSize.y) * 0.25;
    float d = sdRoundRect(localP, halfSize, corner);

    int palIdx = int(B.x);
    vec3 fill = paletteColor(palIdx);
    // fill alpha (hard edge w/ tiny AA)
    float fillA = 1.0 - smoothstep(-0.003, 0.003, d);
    // border band: ~1.5px world equivalent; use small pixel-ish width
    float bw = 0.012;
    float bd = abs(d);
    float borderA = (1.0 - smoothstep(bw * 0.6, bw, bd)) * (d < bw ? 1.0 : 0.0);
    // Border colour = complementary palette color
    int borderIdx = int(mod(B.x + 2.0, float(u_palCount)));
    vec3 borderCol = paletteColor(borderIdx) * 1.25 + 0.08;

    // optional stripe pattern (high-frequency detail) when z > 0.5
    if (B.z > 0.5 && fillA > 0.0) {
      float stripe = 0.5 + 0.5 * sin(localP.y * 60.0);
      stripe = smoothstep(0.35, 0.65, stripe);
      int sIdx = int(mod(B.x + 1.0, float(u_palCount)));
      vec3 stripeCol = paletteColor(sIdx);
      fill = mix(fill, stripeCol, stripe * 0.65);
    }

    col = mix(col, fill, fillA);
    col = mix(col, borderCol, borderA);
  }

  return col;
}

// Capsule SDF: horizontal axis.
float sdCapsule(vec2 p, vec2 c, float halfLen, float r) {
  vec2 q = p - c;
  q.x -= clamp(q.x, -halfLen, halfLen);
  return length(q) - r;
}

// Classic polynomial smin (returns value; mixed interior).
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// k modulated by proximity of two capsule centers normalized by combined radii.
float neckK(vec4 a, vec4 b) {
  float rSum = a.w + b.w;
  float dx = a.x - b.x;
  float dy = a.y - b.y;
  float d = sqrt(dx * dx + dy * dy);
  float gate = rSum * 1.5 + (a.z + b.z) * 0.5;
  float t = 1.0 - clamp(d / max(gate, 1e-3), 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  return mix(0.015, 0.12, t);
}

// Combine returns: x = smin field (signed, negative inside),
//                  y = raw min (hard union, negative inside).
// neckness = raw - smin (positive in the bridge).
vec2 combine(vec2 p) {
  float raw = 1e5;
  float sdfs[${MAX_SHAPES}];
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= u_count) { sdfs[i] = 1e5; continue; }
    vec4 s = u_shape[i];
    float d = sdCapsule(p, s.xy, s.z, s.w);
    sdfs[i] = d;
    raw = min(raw, d);
  }
  float acc = 1e5;
  for (int j = 0; j < ${MAX_SHAPES}; j++) {
    if (j >= u_count) break;
    if (j == 0) { acc = sdfs[0]; continue; }
    vec4 sj = u_shape[j];
    float bestD = 1e5;
    float k = 0.02;
    for (int i = 0; i < ${MAX_SHAPES}; i++) {
      if (i >= j) break;
      vec4 si = u_shape[i];
      float dd = distance(si.xy, sj.xy);
      if (dd < bestD) {
        bestD = dd;
        k = neckK(si, sj);
      }
    }
    acc = smin(acc, sdfs[j], k);
  }
  return vec2(acc, raw);
}

// Gradient of the smin field.
vec2 fieldGrad(vec2 p, float h) {
  vec2 c;
  c.x = combine(p + vec2(h, 0.0)).x - combine(p - vec2(h, 0.0)).x;
  c.y = combine(p + vec2(0.0, h)).x - combine(p - vec2(0.0, h)).x;
  return c / (2.0 * h);
}

// world->screen-uv helper so we can sample backdrop with a world-space offset.
vec2 worldToUv(vec2 wp, float aspect) {
  return vec2(wp.x / aspect * 0.5 + 0.5, wp.y * 0.5 + 0.5);
}

vec3 sampleBackdropWorld(vec2 wp, float t) {
  return backdrop(wp, t);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.0;

  vec2 cmb = combine(p);
  float sd = cmb.x;              // negative inside smin-merged silhouette
  float raw = cmb.y;             // negative inside raw union
  float neckness = max(0.0, raw - sd); // positive in bridge

  // --- Edge-rich backdrop (base) ---
  vec3 bg = sampleBackdropWorld(p, u_time);

  // Fully outside glass: just background.
  if (sd > 0.03) {
    outColor = vec4(bg, 1.0);
    return;
  }

  // d is "positive inside" for bevel math (per recipe).
  float d = -sd;

  // Gradient of the SDF (points outward from surface).
  vec2 grad = fieldGrad(p, 0.004);
  vec2 gradN = length(grad) > 1e-5 ? normalize(grad) : vec2(0.0, 1.0);
  // gradD is the direction opposite the outward normal; used for the refraction
  // offset so the edge bends towards the interior.
  vec2 gradD = -gradN;

  // Screen-scale bevel width. Convert pixel width to world units.
  // World range per screen-height = 2.0; so world-per-pixel = 2 / res.y.
  float worldPerPx = 2.0 / max(u_res.y, 1.0);
  float bevelPx = u_bevelDepth * min(u_res.x, u_res.y);
  float bevelWorld = bevelPx * worldPerPx;

  // Edge weight: 1 at silhouette, 0 deep inside (using d = positive inside).
  float edge = 1.0 - smoothstep(0.0, bevelWorld, d);

  // Neck boost factor applied to refraction / bevel / chroma / rim.
  float neckMul = 1.0 + neckness * u_neckBoost * 8.0;

  // Base refraction strength in world units.
  float refraction = 0.18;
  float bevelDepth = u_bevelDepth;

  // Edge-concentrated refraction + tight rim lip (pow(edge,10)).
  float offsetAmt = edge * refraction + pow(edge, 10.0) * bevelDepth;
  offsetAmt *= neckMul;

  vec2 offset = gradD * offsetAmt;

  // Per-channel chromatic offset along the SAME vector.
  float chroma = u_chroma * (1.0 + neckness * u_neckBoost * 2.0);
  vec2 offR = offset * (1.0 + chroma);
  vec2 offG = offset;
  vec2 offB = offset * (1.0 - chroma);

  vec3 col;
  col.r = sampleBackdropWorld(p + offR, u_time).r;
  col.g = sampleBackdropWorld(p + offG, u_time).g;
  col.b = sampleBackdropWorld(p + offB, u_time).b;

  // Subtle glass tint (<5%).
  col = col * vec3(0.99, 1.00, 1.02) + 0.008;

  // --- Dual-scale specular ---
  vec3 N3 = normalize(vec3(gradN, 0.9));
  float ang = u_time * 0.22;
  vec3 L = normalize(vec3(cos(ang), sin(ang) * 0.35 + 0.45, 0.8));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float broad = pow(max(0.0, dot(N3, L)), 2.0) * 0.25;
  float tight = pow(max(0.0, dot(N3, H)), u_highlightSharpness) * 1.0;

  // spec fades deep inside (keep it on the surface/edge zone)
  float bodyMask = smoothstep(0.0, bevelWorld * 1.5, d);
  float specMask = mix(1.0, 0.5, clamp(d / (bevelWorld * 2.0), 0.0, 1.0));
  col += vec3(1.0) * (broad + tight) * specMask;

  // --- Rim highlight + inner shadow band ---
  // Band near silhouette: 4-8 px, centered around d ~ bevelWorld*0.2
  float rimPx = 6.0;
  float rimWorld = rimPx * worldPerPx;
  float rimBand = exp(-pow((d - rimWorld * 0.5) / rimWorld, 2.0) * 2.2);
  float facing = dot(gradN, L.xy); // +1 on light side, -1 on dark
  float rimBright = max(0.0, facing);
  float rimDark = max(0.0, -facing);
  float rimMul = 1.0 + neckness * u_neckBoost * 3.0;
  col += vec3(0.75, 0.82, 1.0) * rimBand * rimBright * 0.55 * rimMul;
  col -= vec3(0.25, 0.22, 0.30) * rimBand * rimDark * 0.35;

  // Blend glass over backdrop with a small AA band at silhouette.
  float glassMix = smoothstep(0.01, -0.01, sd);
  vec3 outCol = mix(bg, col, glassMix);

  outColor = vec4(max(outCol, 0.0), 1.0);
}`;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("liquid-glass-crossing shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "liquid-glass-crossing",
  label: "Liquid Glass · Crossing",
  category: "generative",
  params: {
    palette: {
      type: "colorArray",
      default: ["#2c1a4a", "#6b4ce6", "#ff6ec7", "#7afcff"],
      min: 2,
      max: MAX_COLORS,
      label: "Palette",
    },
    shapeCount: { type: "number", default: 6, min: 5, max: MAX_SHAPES, step: 1, label: "Shape Count" },
    speed: { type: "number", default: 0.6, min: 0.2, max: 2.0, step: 0.05, label: "Drift Speed" },
    neckBoost: { type: "number", default: 1.5, min: 0.5, max: 3.0, step: 0.05, label: "Neck Refraction" },
    highlightSharpness: { type: "number", default: 28, min: 8, max: 96, step: 1, label: "Specular Sharpness" },
    chroma: { type: "number", default: 0.35, min: 0.0, max: 1.0, step: 0.02, label: "Chromatic Dispersion" },
    bevelDepth: { type: "number", default: 0.08, min: 0.02, max: 0.2, step: 0.005, label: "Bevel Depth" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("liquid-glass-crossing: webgl2 unavailable");

    const rng = makeRng(seed);

    // --- Capsule shapes (unchanged: horizontal drift, bidirectional) ---
    const shapes = [];
    for (let i = 0; i < MAX_SHAPES; i++) {
      const halfLen = 0.22 + rng() * 0.28;
      const radius = 0.06 + rng() * 0.06;
      const y = (rng() - 0.5) * 1.5;
      const dir = rng() < 0.5 ? -1 : 1;
      const spd = 0.12 + rng() * 0.22;
      const phase = rng() * Math.PI * 2;
      const amp = 0.02 + rng() * 0.05;
      const startX = (rng() - 0.5) * 3.0;
      shapes.push({ halfLen, radius, y, dir, spd, phase, amp, x: startX });
    }

    // --- Edge-rich backdrop cards ---
    const cards = [];
    for (let i = 0; i < MAX_CARDS; i++) {
      const cx = (rng() - 0.5) * 5.0;
      const cy = (rng() - 0.5) * 1.6;
      const hw = 0.25 + rng() * 0.6;
      const hh = 0.15 + rng() * 0.45;
      const palIdx = Math.floor(rng() * MAX_COLORS);
      const parallax = (rng() < 0.5 ? -1 : 1) * (0.05 + rng() * 0.35);
      const stripe = rng() < 0.35 ? 1 : 0;
      const rot = (rng() - 0.5) * 0.6;
      cards.push({ cx, cy, hw, hh, palIdx, parallax, stripe, rot });
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error("liquid-glass-crossing link: " + log);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const u = {
      res: gl.getUniformLocation(prog, "u_res"),
      time: gl.getUniformLocation(prog, "u_time"),
      count: gl.getUniformLocation(prog, "u_count"),
      palCount: gl.getUniformLocation(prog, "u_palCount"),
      cardCount: gl.getUniformLocation(prog, "u_cardCount"),
      palette: gl.getUniformLocation(prog, "u_palette"),
      shape: gl.getUniformLocation(prog, "u_shape"),
      cardA: gl.getUniformLocation(prog, "u_cardA"),
      cardB: gl.getUniformLocation(prog, "u_cardB"),
      neckBoost: gl.getUniformLocation(prog, "u_neckBoost"),
      highlightSharpness: gl.getUniformLocation(prog, "u_highlightSharpness"),
      chroma: gl.getUniformLocation(prog, "u_chroma"),
      bevelDepth: gl.getUniformLocation(prog, "u_bevelDepth"),
    };

    let w = canvas.width;
    let h = canvas.height;
    gl.viewport(0, 0, w, h);

    const shapeBuf = new Float32Array(MAX_SHAPES * 4);
    const palBuf = new Float32Array(MAX_COLORS * 3);
    const cardABuf = new Float32Array(MAX_CARDS * 4);
    const cardBBuf = new Float32Array(MAX_CARDS * 4);

    let lastTime = 0;

    function worldBound() {
      return Math.max(1.2, w / Math.max(h, 1)) + 0.8;
    }

    function positionFor(s, time) {
      const bound = worldBound();
      const travel = 2 * bound;
      const rawX = s.x + s.dir * (s.spd * (params.speed ?? 0.6)) * time;
      const shifted = rawX + bound;
      const wrapped = ((shifted % travel) + travel) % travel;
      const x = wrapped - bound;
      const sway = Math.sin(time * 0.7 + s.phase) * s.amp;
      return [x, s.y + sway];
    }

    return {
      update(_dt, time) {
        lastTime = time;
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);

        const palette = Array.isArray(params.palette) ? params.palette : [];
        const palCount = Math.max(2, Math.min(MAX_COLORS, palette.length));
        for (let i = 0; i < palCount; i++) {
          const rgb = hexToRgb(palette[i] || "#000000");
          palBuf[i * 3] = rgb[0];
          palBuf[i * 3 + 1] = rgb[1];
          palBuf[i * 3 + 2] = rgb[2];
        }

        const count = Math.max(5, Math.min(MAX_SHAPES, Math.round(params.shapeCount ?? 6)));

        for (let i = 0; i < MAX_SHAPES; i++) {
          const s = shapes[i];
          const [x, y] = positionFor(s, time);
          shapeBuf[i * 4 + 0] = x;
          shapeBuf[i * 4 + 1] = y;
          shapeBuf[i * 4 + 2] = s.halfLen;
          shapeBuf[i * 4 + 3] = s.radius;
        }

        // Cards: pack. X is in world; shader wraps into [-3,3].
        for (let i = 0; i < MAX_CARDS; i++) {
          const c = cards[i];
          cardABuf[i * 4 + 0] = c.cx;
          cardABuf[i * 4 + 1] = c.cy;
          cardABuf[i * 4 + 2] = c.hw;
          cardABuf[i * 4 + 3] = c.hh;
          cardBBuf[i * 4 + 0] = Math.min(palCount - 1, c.palIdx % palCount);
          cardBBuf[i * 4 + 1] = c.parallax;
          cardBBuf[i * 4 + 2] = c.stripe;
          cardBBuf[i * 4 + 3] = c.rot;
        }

        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.time, time);
        gl.uniform1i(u.count, count);
        gl.uniform1i(u.palCount, palCount);
        gl.uniform1i(u.cardCount, MAX_CARDS);
        gl.uniform3fv(u.palette, palBuf);
        gl.uniform4fv(u.shape, shapeBuf);
        gl.uniform4fv(u.cardA, cardABuf);
        gl.uniform4fv(u.cardB, cardBBuf);
        gl.uniform1f(u.neckBoost, params.neckBoost ?? 1.5);
        gl.uniform1f(u.highlightSharpness, params.highlightSharpness ?? 28);
        gl.uniform1f(u.chroma, params.chroma ?? 0.35);
        gl.uniform1f(u.bevelDepth, params.bevelDepth ?? 0.08);

        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
      },
      resize(nw, nh) {
        w = nw;
        h = nh;
        gl.viewport(0, 0, w, h);
      },
      dispose() {
        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(prog);
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
        void lastTime;
      },
    };
  },
};
