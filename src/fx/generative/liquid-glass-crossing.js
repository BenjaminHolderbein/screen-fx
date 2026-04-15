/* global Float32Array */
import { makeRng } from "../base.js";

const MAX_SHAPES = 8;
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
uniform int   u_palCount;
uniform vec3  u_palette[${MAX_COLORS}];
// xyzw: cx, cy, halfLen, radius
uniform vec4  u_shape[${MAX_SHAPES}];
uniform float u_neckBoost;
uniform float u_highlightSharpness;
uniform float u_dispersion;

// --- hash / noise for background palette blend ---
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

vec3 paletteSample(vec2 p, float t) {
  // slow noise-driven weighted blend of palette colors
  float totalW = 0.0;
  vec3 accum = vec3(0.0);
  for (int i = 0; i < ${MAX_COLORS}; i++) {
    if (i >= u_palCount) break;
    float fi = float(i);
    float n = snoise(vec3(p * 0.6 + vec2(fi * 3.17, fi * 1.91), t * 0.08 + fi * 0.7));
    float w = exp(1.8 * n);
    totalW += w;
    accum += u_palette[i] * w;
  }
  return accum / max(totalW, 1e-4);
}

// Capsule SDF: horizontal axis.
// cx,cy center; halfLen half-length along x; r radius.
float sdCapsule(vec2 p, vec2 c, float halfLen, float r) {
  vec2 q = p - c;
  q.x -= clamp(q.x, -halfLen, halfLen);
  return length(q) - r;
}

// Classic polynomial smin.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// k modulated by proximity of two capsule centers normalized by combined radii.
// Returns a k in [kMin, kMax] that peaks when centers approach.
float neckK(vec4 a, vec4 b) {
  float rSum = a.w + b.w;
  float dx = a.x - b.x;
  float dy = a.y - b.y;
  float d = sqrt(dx * dx + dy * dy);
  // proximity measured relative to combined radii * 1.5 gate; extra horizontal gap along half-lens
  float gate = rSum * 1.5 + (a.z + b.z) * 0.5;
  float t = 1.0 - clamp(d / max(gate, 1e-3), 0.0, 1.0);
  // smooth rise
  t = t * t * (3.0 - 2.0 * t);
  return mix(0.015, 0.12, t);
}

// Combine all shapes: return vec3(sminAll, rawMin, bestDistIdxUnused).
// We need rawMin (hard min) for neckness. sminAll is full pairwise smin cascade
// where each incorporation uses k modulated by that new shape's closest existing
// neighbor. Simpler: compute rawMin first, then do cascade where k per step
// depends on distance to current accumulator via finding nearest previously
// included shape center.
vec2 combine(vec2 p) {
  float raw = 1e5;
  // per-shape sdf
  float sdfs[${MAX_SHAPES}];
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= u_count) { sdfs[i] = 1e5; continue; }
    vec4 s = u_shape[i];
    float d = sdCapsule(p, s.xy, s.z, s.w);
    sdfs[i] = d;
    raw = min(raw, d);
  }

  // Smooth combine, k_ij modulated by pairwise proximity.
  // Accumulate: start with shape 0, then for each subsequent shape j,
  // find the closest already-included shape i (by center distance) and use
  // neckK(i, j) as the smin k for this merge step.
  float acc = 1e5;
  for (int j = 0; j < ${MAX_SHAPES}; j++) {
    if (j >= u_count) break;
    if (j == 0) {
      acc = sdfs[0];
      continue;
    }
    vec4 sj = u_shape[j];
    // find closest prior shape center
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

// Estimate gradient (normal) of the smin field via tiny offsets.
vec2 fieldGrad(vec2 p, float h) {
  vec2 c;
  c.x = combine(p + vec2(h, 0.0)).x - combine(p - vec2(h, 0.0)).x;
  c.y = combine(p + vec2(0.0, h)).x - combine(p - vec2(0.0, h)).x;
  return c / (2.0 * h);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.0;

  vec2 cmb = combine(p);
  float sd = cmb.x;
  float raw = cmb.y;
  float neckness = max(0.0, raw - sd);

  // background color
  vec3 bg = paletteSample(p, u_time);

  // outside: just background with subtle vignette
  if (sd > 0.02) {
    outColor = vec4(bg, 1.0);
    return;
  }

  // Inside / near glass
  vec2 grad = fieldGrad(p, 0.004);
  vec2 N = length(grad) > 1e-5 ? normalize(grad) : vec2(0.0, 1.0);

  // Refraction: bend the background sample along -N, stronger in neck.
  float baseRefraction = 0.12;
  float refrAmt = baseRefraction * (1.0 + neckness * u_neckBoost * 6.0);

  // Chromatic dispersion — sample r/g/b along slightly different offsets at silhouette.
  float edgeWeight = smoothstep(0.0, -0.2, sd); // 1 deep, 0 at edge
  float disp = u_dispersion * (1.0 - edgeWeight) * 0.06 * (1.0 + neckness * u_neckBoost * 2.0);

  vec2 refrDir = -N;
  vec2 rUV = p + refrDir * refrAmt * (1.0 + disp);
  vec2 gUV = p + refrDir * refrAmt;
  vec2 bUV = p + refrDir * refrAmt * (1.0 - disp);

  vec3 refr = vec3(
    paletteSample(rUV, u_time).r,
    paletteSample(gUV, u_time).g,
    paletteSample(bUV, u_time).b
  );

  // Glass tint + slight brightening
  vec3 glass = refr * 1.05 + 0.04;

  // Edge highlight band (silhouette glow)
  float edge = exp(-pow(sd / 0.04, 2.0) * 1.8);
  // extra edge brightness at neck
  float edgeBoost = 1.0 + neckness * u_neckBoost * 3.0;
  glass += vec3(0.55, 0.65, 0.85) * edge * 0.35 * edgeBoost;

  // Specular: per-shape soft Phong against orbiting light.
  vec3 N3 = normalize(vec3(N, 0.85));
  float ang = u_time * 0.25;
  vec3 L = normalize(vec3(cos(ang), sin(ang) * 0.4 + 0.4, 0.9));
  float spec = pow(max(dot(N3, L), 0.0), u_highlightSharpness);
  // only show spec inside the body, not background
  float bodyMask = smoothstep(0.01, -0.06, sd);
  glass += vec3(1.0) * spec * 0.55 * bodyMask;

  // Blend glass over background near the silhouette band
  float glassMix = smoothstep(0.02, -0.02, sd);
  vec3 col = mix(bg, glass, glassMix);

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
    highlightSharpness: { type: "number", default: 24, min: 8, max: 64, step: 1, label: "Specular Sharpness" },
    dispersion: { type: "number", default: 0.4, min: 0.0, max: 1.0, step: 0.02, label: "Chromatic Dispersion" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("liquid-glass-crossing: webgl2 unavailable");

    const rng = makeRng(seed);

    // Per-capsule seeded state. Held in JS, advanced each frame.
    // fields: halfLen, radius, y, dir (+1 / -1), speed factor, swayPhase,
    //         swayAmp, x (current), spawnedSide (for recycle)
    const shapes = [];
    for (let i = 0; i < MAX_SHAPES; i++) {
      const halfLen = 0.22 + rng() * 0.28;
      const radius = 0.06 + rng() * 0.06;
      const y = (rng() - 0.5) * 1.5; // world y in [-0.75, 0.75]
      const dir = rng() < 0.5 ? -1 : 1;
      const spd = 0.12 + rng() * 0.22;
      const phase = rng() * Math.PI * 2;
      const amp = 0.02 + rng() * 0.05;
      // stagger initial x across the world so things cross right away
      const startX = (rng() - 0.5) * 3.0;
      shapes.push({
        halfLen,
        radius,
        y,
        dir,
        spd,
        phase,
        amp,
        x: startX,
      });
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
      palette: gl.getUniformLocation(prog, "u_palette"),
      shape: gl.getUniformLocation(prog, "u_shape"),
      neckBoost: gl.getUniformLocation(prog, "u_neckBoost"),
      highlightSharpness: gl.getUniformLocation(prog, "u_highlightSharpness"),
      dispersion: gl.getUniformLocation(prog, "u_dispersion"),
    };

    let w = canvas.width;
    let h = canvas.height;
    gl.viewport(0, 0, w, h);

    const shapeBuf = new Float32Array(MAX_SHAPES * 4);
    const palBuf = new Float32Array(MAX_COLORS * 3);

    let lastTime = 0;
    // We use accumulated seeded time to drive deterministic motion (no reliance on dt).
    // Since the contract passes `time`, we use that directly for x-position.

    // Pre-compute world bound for recycling (world x roughly [-aspect, aspect]).
    // Use a safe bound of 2 in either direction for spawn seed.
    function worldBound() {
      return Math.max(1.2, w / Math.max(h, 1)) + 0.8;
    }

    // Compute position from seeded parameters and current time (deterministic).
    function positionFor(s, time) {
      const bound = worldBound();
      const travel = 2 * bound; // distance per cycle
      const rawX = s.x + s.dir * (s.spd * (params.speed ?? 0.6)) * time;
      // wrap into [-bound, bound] preserving determinism
      const shifted = rawX + bound; // into [0, ...]
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

        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.time, time);
        gl.uniform1i(u.count, count);
        gl.uniform1i(u.palCount, palCount);
        gl.uniform3fv(u.palette, palBuf);
        gl.uniform4fv(u.shape, shapeBuf);
        gl.uniform1f(u.neckBoost, params.neckBoost ?? 1.5);
        gl.uniform1f(u.highlightSharpness, params.highlightSharpness ?? 24);
        gl.uniform1f(u.dispersion, params.dispersion ?? 0.4);

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
