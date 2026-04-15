/* global Float32Array */
import { makeRng } from "../base.js";

const MAX_DROPS = 25;
const MAX_COLORS = 6;

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
uniform float u_fallSpeed;
uniform float u_kMerge;
uniform float u_refract;
uniform float u_shine;
uniform vec3  u_colors[${MAX_COLORS}];
// per-drop packed data:
// A.xy = base (x, y0 offset), A.z = radius-x (half-width), A.w = radius-y (half-height)
// B.x = fall speed mult, B.y = sway amp, B.z = sway freq, B.w = sway phase
uniform vec4  u_dropA[${MAX_DROPS}];
uniform vec4  u_dropB[${MAX_DROPS}];

// ---------- background: slow palette noise ----------
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

vec3 sampleBackground(vec2 p) {
  float totalW = 0.0;
  vec3 accum = vec3(0.0);
  for (int i = 0; i < ${MAX_COLORS}; i++) {
    if (i >= u_colorCount) break;
    float fi = float(i);
    vec2 off = vec2(fi * 4.3, fi * -2.7);
    float n = snoise(vec3(p * 0.9 + off, u_time * 0.06 + fi * 1.7));
    float w = exp(2.0 * n);
    totalW += w;
    accum += u_colors[i] * w;
  }
  return accum / max(totalW, 1e-4);
}

// ---------- droplet SDF ----------
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Returns (x, y) for droplet i at current time, in normalized [0..aspect]x[0..~1.2] space.
vec2 dropPos(int i, float aspect) {
  vec4 A = u_dropA[i];
  vec4 B = u_dropB[i];
  // Vertical cycle: from +0.3 down to -0.4, period depends on fall speed.
  float period = mix(14.0, 6.0, clamp(B.x * u_fallSpeed / 2.0, 0.0, 1.0));
  float phase  = A.y;                       // 0..1 offset in cycle
  float t      = u_time * u_fallSpeed * B.x;
  float f      = fract(phase + t / period); // 0..1, wraps
  float y      = mix(1.25, -0.35, f);
  // Lateral sway
  float sway = sin(u_time * B.z + B.w) * B.y;
  float x    = A.x * aspect + sway;
  return vec2(x, y);
}

float dropSdf(int i, vec2 p, float aspect) {
  vec2 c = dropPos(i, aspect);
  vec4 A = u_dropA[i];
  // Elongated vertical capsule-ish SDF using ellipse scaling.
  vec2 q = p - c;
  q.x /= A.z;
  q.y /= A.w;
  return (length(q) - 1.0) * min(A.z, A.w);
}

// Full scene SDF via smooth min across all drops.
// Merge factor is scaled down to droplet scale so default k ~ 0.2 means
// "merge when within 20% of droplet width", not 20% of screen.
float sceneSdf(vec2 p, float aspect) {
  float d = 1e9;
  float k = max(1e-4, u_kMerge * 0.05);
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= u_count) break;
    d = smin(d, dropSdf(i, p, aspect), k);
  }
  return d;
}

// Finite-diff gradient of SDF → surface normal (2D)
vec2 sceneNormal(vec2 p, float aspect) {
  float e = 0.0008;
  float dx = sceneSdf(p + vec2(e, 0.0), aspect) - sceneSdf(p - vec2(e, 0.0), aspect);
  float dy = sceneSdf(p + vec2(0.0, e), aspect) - sceneSdf(p - vec2(0.0, e), aspect);
  return normalize(vec2(dx, dy) + 1e-6);
}

// Nearest drop index for per-drop specular placement
int nearestDrop(vec2 p, float aspect, out float bestD) {
  bestD = 1e9;
  int idx = 0;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= u_count) break;
    float d = dropSdf(i, p, aspect);
    if (d < bestD) { bestD = d; idx = i; }
  }
  return idx;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);

  vec3 bg = sampleBackground(p);

  // Drop shadow: sample SDF slightly above (drops fall, shadow below them).
  float dShadow = sceneSdf(p + vec2(0.0, 0.008), aspect);
  float shadow = 1.0 - smoothstep(-0.01, 0.02, dShadow);
  bg *= mix(1.0, 0.78, shadow * 0.55);

  float d = sceneSdf(p, aspect);

  // Outside silhouette → just background (with shadow already baked in).
  if (d > 0.0015) {
    outColor = vec4(bg, 1.0);
    return;
  }

  vec2 N = sceneNormal(p, aspect);

  // Interior depth → thickness proxy. Drops are ~0.04–0.09 wide so deepest
  // interior depth ≈ -0.04. Normalize to that scale.
  float thickness = clamp(-d / 0.05, 0.0, 1.0);

  // Refract background along normal. Chromatic split per channel.
  float strength = u_refract * (0.02 + 0.06 * thickness);
  vec2 offR = -N * strength * 1.06;
  vec2 offG = -N * strength * 1.00;
  vec2 offB = -N * strength * 0.94;
  vec3 refr;
  refr.r = sampleBackground(p + offR).r;
  refr.g = sampleBackground(p + offG).g;
  refr.b = sampleBackground(p + offB).b;
  // Deeper = more saturated/concentrated colors
  refr = mix(refr, refr * 1.15, thickness);

  // Base glass color = refracted background, slightly darkened at center for density.
  vec3 col = refr * (0.92 + 0.08 * (1.0 - thickness));

  // --- Edge highlight band ---
  // Thin band near d ≈ 0
  float edge = smoothstep(0.002, -0.001, d) * smoothstep(-0.006, -0.002, d);
  col += vec3(1.0) * edge * 0.65;

  // --- Specular: sharp Phong dot, one per drop ---
  // Light vector slowly orbits in 2D
  float la = u_time * 0.35;
  vec2 L = normalize(vec2(cos(la) * 0.7, 0.7));
  // Find which drop we're in (use raw SDF, not smooth). Use drop-local normal
  // for a specular placement that stays on the drop even through merges.
  float _nd;
  int di = nearestDrop(p, aspect, _nd);
  vec2 c = dropPos(di, aspect);
  vec4 A = u_dropA[di];
  // Normal from drop-local ellipse coords
  vec2 q = (p - c) / vec2(A.z, A.w);
  vec2 Ndrop = normalize(q + 1e-6);
  // Pull specular toward top-left of drop via a tilted "viewing" term
  float spec = pow(max(0.0, dot(Ndrop, L)), u_shine);
  // Keep specular only inside drop body (interior thickness)
  spec *= smoothstep(0.15, 0.7, thickness);
  col += vec3(1.0) * spec * 1.6;

  // Subtle rim brighten using merged normal (keeps merged shapes looking wet)
  float rim = pow(max(0.0, dot(N, vec2(0.0, 1.0))), 3.0) * (1.0 - thickness);
  col += vec3(0.9, 0.95, 1.0) * rim * 0.08;

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
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("liquid-glass-rain: webgl2 unavailable");

    const rng = makeRng(seed);
    const dropA = new Float32Array(MAX_DROPS * 4);
    const dropB = new Float32Array(MAX_DROPS * 4);
    for (let i = 0; i < MAX_DROPS; i++) {
      // Tall thin droplets. Width ~0.04–0.09, height 1.5–3.5x the width.
      const w = 0.04 + rng() * 0.05;
      const h = w * (1.6 + rng() * 1.9);
      dropA[i * 4 + 0] = rng();        // normalized x in [0,1] (× aspect at sample)
      dropA[i * 4 + 1] = rng();        // phase 0..1
      dropA[i * 4 + 2] = w;            // half-width
      dropA[i * 4 + 3] = h;            // half-height
      // Larger drops fall slower; smaller drops fall faster.
      const sizeNorm = (w - 0.04) / 0.05;   // 0..1
      dropB[i * 4 + 0] = 1.3 - sizeNorm * 0.7;        // fall speed multiplier (0.6..1.3)
      dropB[i * 4 + 1] = 0.01 + rng() * 0.02;         // sway amplitude
      dropB[i * 4 + 2] = 0.4 + rng() * 0.9;           // sway frequency
      dropB[i * 4 + 3] = rng() * 6.28318;             // sway phase
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
      fallSpeed: gl.getUniformLocation(prog, "u_fallSpeed"),
      kMerge: gl.getUniformLocation(prog, "u_kMerge"),
      refract: gl.getUniformLocation(prog, "u_refract"),
      shine: gl.getUniformLocation(prog, "u_shine"),
      colors: gl.getUniformLocation(prog, "u_colors"),
      dropA: gl.getUniformLocation(prog, "u_dropA"),
      dropB: gl.getUniformLocation(prog, "u_dropB"),
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
      gl.uniform1f(u.fallSpeed, params.fallSpeed ?? 0.6);
      gl.uniform1f(u.kMerge, params.mergeSoftness ?? 0.2);
      gl.uniform1f(u.refract, params.refractionStrength ?? 0.7);
      gl.uniform1f(u.shine, params.highlightSharpness ?? 32);
      gl.uniform3fv(u.colors, colorBuf);
      gl.uniform4fv(u.dropA, dropA);
      gl.uniform4fv(u.dropB, dropB);

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
