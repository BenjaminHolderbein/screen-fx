/* global Float32Array */
import { makeRng } from "../base.js";

const MAX_DROPS = 25;
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
uniform int   u_colorCount;
uniform int   u_cardCount;
uniform float u_fallSpeed;
uniform float u_kMerge;
uniform float u_refract;   // refractionStrength (0.2..1.5)
uniform float u_shine;     // highlightSharpness (Phong exponent for tight glint)
uniform float u_chroma;    // chromatic dispersion (0..0.08)
uniform vec3  u_colors[${MAX_COLORS}];

// Per-drop packed data:
// A.xy = base (x, phase), A.z = radius-x (half-width), A.w = radius-y (half-height)
// B.x = fall speed mult, B.y = sway amp, B.z = sway freq, B.w = sway phase
uniform vec4  u_dropA[${MAX_DROPS}];
uniform vec4  u_dropB[${MAX_DROPS}];

// Per-card data:
// C.xy = base position (normalized, .x across aspect), C.z = half-width, C.w = half-height
// D.x = parallax speed, D.y = color index (float), D.z = stripe flag (0/1), D.w = corner radius
uniform vec4  u_cardC[${MAX_CARDS}];
uniform vec4  u_cardD[${MAX_CARDS}];

// ---------- hash / noise ----------
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

// ---------- background: gaussian blobs + hard-edged cards ----------
vec3 gaussBlobs(vec2 p) {
  // Slow, soft, palette-colored blobs — the "window pane background".
  float totalW = 0.0;
  vec3 accum = vec3(0.0);
  for (int i = 0; i < ${MAX_COLORS}; i++) {
    if (i >= u_colorCount) break;
    float fi = float(i);
    // Drifting blob center in screen-normalized [0,1]^2.
    vec2 bc = vec2(
      0.5 + 0.35 * sin(u_time * 0.04 + fi * 1.9),
      0.5 + 0.30 * cos(u_time * 0.035 + fi * 2.3)
    );
    vec2 d = v_uv - bc;
    float w = exp(-dot(d, d) * 6.0);
    totalW += w;
    accum += u_colors[i] * w;
  }
  return accum / max(totalW, 1e-4);
}

// Rounded box SDF (half-size b, radius r). Positive outside.
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 colorFromIndex(float idx) {
  int ii = int(floor(idx + 0.5));
  // clamp
  ii = ii < 0 ? 0 : ii;
  ii = ii >= ${MAX_COLORS} ? ${MAX_COLORS} - 1 : ii;
  for (int k = 0; k < ${MAX_COLORS}; k++) {
    if (k == ii) return u_colors[k];
  }
  return u_colors[0];
}

vec3 sampleBackdrop(vec2 p) {
  // Start with soft gaussian blobs in palette colors.
  vec3 col = gaussBlobs(p) * 0.85 + 0.08;

  // Overlay hard-edged rounded-rect cards scrolling at varied parallax speeds.
  for (int i = 0; i < ${MAX_CARDS}; i++) {
    if (i >= u_cardCount) break;
    vec4 C = u_cardC[i];
    vec4 D = u_cardD[i];
    // Scroll horizontally, wrap around aspect.
    float aspect = u_res.x / max(u_res.y, 1.0);
    float xShift = u_time * D.x * 0.05;
    float cx = mod(C.x + xShift + 1.0, aspect + 0.6) - 0.3;
    vec2 c = vec2(cx, C.y);
    vec2 b = vec2(C.z, C.w);
    float r = D.w;
    float d = sdRoundBox(p - c, b, r);

    // Card body color
    vec3 cardCol = colorFromIndex(D.y);

    // Stripe pattern on flagged cards (high-frequency horizontal stripes).
    float stripeMix = 0.0;
    if (D.z > 0.5) {
      float s = sin((p.y - c.y) * 140.0);
      stripeMix = smoothstep(-0.1, 0.1, s) * 0.5;
      vec3 stripeCol = colorFromIndex(D.y + 1.0);
      cardCol = mix(cardCol, stripeCol, stripeMix);
    }

    // Hard fill with tiny anti-alias, plus thin 1-2px border.
    float aa = 0.0015;
    float inside = 1.0 - smoothstep(-aa, aa, d);
    col = mix(col, cardCol, inside * 0.92);

    // Border: narrow band just inside the edge.
    float borderPx = 0.0022;
    float borderBand = smoothstep(borderPx + aa, borderPx, abs(d)) * inside;
    vec3 borderCol = cardCol * 0.35 + vec3(0.02);
    col = mix(col, borderCol, borderBand * 0.9);
  }

  return col;
}

// ---------- droplet SDF ----------
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

vec2 dropPos(int i, float aspect) {
  vec4 A = u_dropA[i];
  vec4 B = u_dropB[i];
  float period = mix(14.0, 6.0, clamp(B.x * u_fallSpeed / 2.0, 0.0, 1.0));
  float phase  = A.y;
  float t      = u_time * u_fallSpeed * B.x;
  float f      = fract(phase + t / period);
  float y      = mix(1.25, -0.35, f);
  float sway = sin(u_time * B.z + B.w) * B.y;
  float x    = A.x * aspect + sway;
  return vec2(x, y);
}

float dropSdf(int i, vec2 p, float aspect) {
  vec2 c = dropPos(i, aspect);
  vec4 A = u_dropA[i];
  vec2 q = p - c;
  q.x /= A.z;
  q.y /= A.w;
  return (length(q) - 1.0) * min(A.z, A.w);
}

float sceneSdf(vec2 p, float aspect) {
  float d = 1e9;
  float k = max(1e-4, u_kMerge * 0.05);
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= u_count) break;
    d = smin(d, dropSdf(i, p, aspect), k);
  }
  return d;
}

vec2 sceneNormal(vec2 p, float aspect) {
  float e = 0.0008;
  float dx = sceneSdf(p + vec2(e, 0.0), aspect) - sceneSdf(p - vec2(e, 0.0), aspect);
  float dy = sceneSdf(p + vec2(0.0, e), aspect) - sceneSdf(p - vec2(0.0, e), aspect);
  return normalize(vec2(dx, dy) + 1e-6);
}

// Nearest drop — returns index, outputs drop SDF and center.
int nearestDrop(vec2 p, float aspect, out float bestD, out vec2 bestC, out vec2 bestR) {
  bestD = 1e9;
  int idx = 0;
  bestC = vec2(0.0);
  bestR = vec2(0.05, 0.1);
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= u_count) break;
    float d = dropSdf(i, p, aspect);
    if (d < bestD) {
      bestD = d;
      idx = i;
      bestC = dropPos(i, aspect);
      vec4 A = u_dropA[i];
      bestR = vec2(A.z, A.w);
    }
  }
  return idx;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);

  vec3 bg = sampleBackdrop(p);

  // Drop shadow.
  float dShadow = sceneSdf(p + vec2(0.0, 0.008), aspect);
  float shadow = 1.0 - smoothstep(-0.01, 0.02, dShadow);
  bg *= mix(1.0, 0.78, shadow * 0.55);

  float d = sceneSdf(p, aspect);

  if (d > 0.0015) {
    outColor = vec4(bg, 1.0);
    return;
  }

  vec2 N = sceneNormal(p, aspect);

  // Positive inside (flip sign).
  float dIn = -d;

  // Nearest drop gives us per-droplet radius → bevel scales with droplet size.
  float _nd;
  vec2 dropC;
  vec2 dropR;
  int di = nearestDrop(p, aspect, _nd, dropC, dropR);
  float dropRadius = min(dropR.x, dropR.y);

  // --- (1) Edge-concentrated refraction with bevel lip ---
  // refraction = 0.015 * refractionStrength; bevelDepth = 0.08 * refractionStrength
  float refraction = 0.015 * u_refract;
  float bevelDepth = 0.08 * u_refract;
  float bevelWidth = 0.35; // fraction of droplet radius
  float bevelPx = bevelWidth * dropRadius;

  float edge = 1.0 - smoothstep(0.0, bevelPx, dIn);
  float offsetAmt = edge * refraction + pow(edge, 10.0) * bevelDepth;

  // Direction: from drop center outward, projected — but we want the backdrop
  // to bend *toward* the edge, so use -N (into the glass) blended with radial.
  vec2 radial = normalize(p - dropC + 1e-6);
  vec2 dir = normalize(mix(-N, radial, 0.5) + 1e-6);
  vec2 offset = dir * offsetAmt;

  // --- (2) Per-channel chromatic offset ---
  float chroma = u_chroma;
  vec3 col;
  col.r = sampleBackdrop(p + offset * (1.0 + chroma)).r;
  col.g = sampleBackdrop(p + offset              ).g;
  col.b = sampleBackdrop(p + offset * (1.0 - chroma)).b;

  // Slight (≤5%) tint from gaussian backdrop to keep glassy neutrality.
  // No heavy tint — glass, not water.

  // --- (3) Dual-scale specular per droplet ---
  // Slowly orbiting light.
  float la = u_time * 0.35;
  vec3 L3 = normalize(vec3(cos(la) * 0.7, 0.7, 0.55));
  vec2 L = L3.xy;
  // Drop-local normal (on raw ellipse, not merged).
  vec2 qn = (p - dropC) / dropR;
  vec3 Ndrop3 = normalize(vec3(qn, sqrt(max(1.0 - dot(qn, qn), 0.0001))));
  // Half-vector (view = +Z).
  vec3 V3 = vec3(0.0, 0.0, 1.0);
  vec3 H3 = normalize(L3 + V3);

  float broad = pow(max(0.0, dot(Ndrop3, L3)), 2.0) * 0.25;
  float tight = pow(max(0.0, dot(Ndrop3, H3)), u_shine) * 1.0;

  // Limit specular to inside the droplet body (attenuated by thickness).
  float thickness = clamp(dIn / (dropRadius * 0.9), 0.0, 1.0);
  float specMask  = smoothstep(0.02, 0.35, thickness);
  col += vec3(1.0) * (broad + tight) * specMask;

  // --- (4) Rim highlight on light-facing side + inner shadow on opposite side ---
  // Use merged normal for rim so merged shapes still read as one glass body.
  float rimFace = dot(N, L);                     // +1 light side, -1 dark side
  // Tight band around the silhouette (a few px).
  float rimBand = smoothstep(0.004, 0.0, dIn) * smoothstep(0.0, 0.0005, dIn);
  float rimLight  = max(0.0, rimFace)  * rimBand;
  float rimShadow = max(0.0, -rimFace) * rimBand;
  col += vec3(1.0) * rimLight * 0.9;
  col *= (1.0 - rimShadow * 0.35);

  outColor = vec4(col, 1.0);
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
    throw new Error("liquid-glass-rain shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "liquid-glass-rain",
  label: "Liquid Glass · Rain",
  category: "generative",
  params: {
    palette: {
      type: "colorArray",
      default: ["#1a3a5c", "#7afcff", "#a78bfa", "#ffd6e0"],
      min: 2,
      max: MAX_COLORS,
      label: "Palette",
    },
    density: { type: "number", default: 18, min: 8, max: MAX_DROPS, step: 1, label: "Droplet Count" },
    fallSpeed: { type: "number", default: 0.6, min: 0, max: 2, step: 0.05, label: "Fall Speed" },
    mergeSoftness: { type: "number", default: 0.2, min: 0.05, max: 0.4, step: 0.01, label: "Merge Softness" },
    refractionStrength: { type: "number", default: 0.7, min: 0.2, max: 1.5, step: 0.05, label: "Refraction" },
    highlightSharpness: { type: "number", default: 32, min: 8, max: 64, step: 1, label: "Specular Sharpness" },
    chroma: { type: "number", default: 0.03, min: 0, max: 0.08, step: 0.005, label: "Chromatic Dispersion" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("liquid-glass-rain: webgl2 unavailable");

    const rng = makeRng(seed);
    const dropA = new Float32Array(MAX_DROPS * 4);
    const dropB = new Float32Array(MAX_DROPS * 4);
    for (let i = 0; i < MAX_DROPS; i++) {
      const w = 0.04 + rng() * 0.05;
      const h = w * (1.6 + rng() * 1.9);
      dropA[i * 4 + 0] = rng();
      dropA[i * 4 + 1] = rng();
      dropA[i * 4 + 2] = w;
      dropA[i * 4 + 3] = h;
      const sizeNorm = (w - 0.04) / 0.05;
      dropB[i * 4 + 0] = 1.3 - sizeNorm * 0.7;
      dropB[i * 4 + 1] = 0.01 + rng() * 0.02;
      dropB[i * 4 + 2] = 0.4 + rng() * 0.9;
      dropB[i * 4 + 3] = rng() * 6.28318;
    }

    // Backdrop cards — 4–6 rounded-rects, 1–2 with stripes.
    const cardCount = 5;
    const cardC = new Float32Array(MAX_CARDS * 4);
    const cardD = new Float32Array(MAX_CARDS * 4);
    for (let i = 0; i < cardCount; i++) {
      const bx = rng() * 1.4 + 0.1;
      const by = 0.15 + rng() * 0.7;
      const hw = 0.07 + rng() * 0.13;
      const hh = 0.05 + rng() * 0.09;
      cardC[i * 4 + 0] = bx;
      cardC[i * 4 + 1] = by;
      cardC[i * 4 + 2] = hw;
      cardC[i * 4 + 3] = hh;
      const speed = 0.15 + rng() * 0.6; // varied parallax
      const colorIdx = Math.floor(rng() * MAX_COLORS);
      const stripe = i < 2 && rng() > 0.3 ? 1 : 0; // 1-2 cards with stripes
      const corner = 0.008 + rng() * 0.02;
      cardD[i * 4 + 0] = speed * (rng() > 0.5 ? 1 : -1);
      cardD[i * 4 + 1] = colorIdx;
      cardD[i * 4 + 2] = stripe;
      cardD[i * 4 + 3] = corner;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("liquid-glass-rain link: " + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const u = {
      res: gl.getUniformLocation(prog, "u_res"),
      time: gl.getUniformLocation(prog, "u_time"),
      count: gl.getUniformLocation(prog, "u_count"),
      colorCount: gl.getUniformLocation(prog, "u_colorCount"),
      cardCount: gl.getUniformLocation(prog, "u_cardCount"),
      fallSpeed: gl.getUniformLocation(prog, "u_fallSpeed"),
      kMerge: gl.getUniformLocation(prog, "u_kMerge"),
      refract: gl.getUniformLocation(prog, "u_refract"),
      shine: gl.getUniformLocation(prog, "u_shine"),
      chroma: gl.getUniformLocation(prog, "u_chroma"),
      colors: gl.getUniformLocation(prog, "u_colors"),
      dropA: gl.getUniformLocation(prog, "u_dropA"),
      dropB: gl.getUniformLocation(prog, "u_dropB"),
      cardC: gl.getUniformLocation(prog, "u_cardC"),
      cardD: gl.getUniformLocation(prog, "u_cardD"),
    };

    let w = canvas.width;
    let h = canvas.height;
    const colorBuf = new Float32Array(MAX_COLORS * 3);

    const draw = (time) => {
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);

      const palette = Array.isArray(params.palette) ? params.palette : [];
      const cc = Math.max(2, Math.min(MAX_COLORS, palette.length));
      colorBuf.fill(0);
      for (let i = 0; i < cc; i++) {
        const rgb = hexToRgb(palette[i] || "#000000");
        colorBuf[i * 3] = rgb[0];
        colorBuf[i * 3 + 1] = rgb[1];
        colorBuf[i * 3 + 2] = rgb[2];
      }

      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.time, time);
      gl.uniform1i(u.count, Math.max(1, Math.min(MAX_DROPS, Math.round(params.density ?? 18))));
      gl.uniform1i(u.colorCount, cc);
      gl.uniform1i(u.cardCount, cardCount);
      gl.uniform1f(u.fallSpeed, params.fallSpeed ?? 0.6);
      gl.uniform1f(u.kMerge, params.mergeSoftness ?? 0.2);
      gl.uniform1f(u.refract, params.refractionStrength ?? 0.7);
      gl.uniform1f(u.shine, params.highlightSharpness ?? 32);
      gl.uniform1f(u.chroma, params.chroma ?? 0.03);
      gl.uniform3fv(u.colors, colorBuf);
      gl.uniform4fv(u.dropA, dropA);
      gl.uniform4fv(u.dropB, dropB);
      gl.uniform4fv(u.cardC, cardC);
      gl.uniform4fv(u.cardD, cardD);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    };

    draw(0);

    return {
      update(_dt, time) {
        draw(time);
      },
      resize(nw, nh) {
        w = nw;
        h = nh;
      },
      dispose() {
        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(prog);
      },
    };
  },
};
