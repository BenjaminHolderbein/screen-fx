/* global Float32Array */
import { makeRng } from "../base.js";

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

uniform float u_time;
uniform vec2  u_res;
uniform int   u_count;
uniform vec3  u_colors[${MAX_COLORS}];
uniform vec2  u_seedOffsets[${MAX_COLORS}];
uniform float u_seedPhase;

uniform float u_rippleScale;
uniform float u_flowSpeed;
uniform float u_thickness;
uniform float u_caustic;
uniform float u_specular;
uniform float u_dispersion;

// --- hash / noise ---
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
  float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, float t) {
  // 2 big soft octaves — produces flowing waves, not mush
  float v = 0.7 * vnoise(p + vec2(t * 0.2, -t * 0.15));
  v += 0.35 * vnoise(p * 2.1 + vec2(3.1, 1.7) + vec2(t * 0.3, -t * 0.22));
  return v;
}

// Height field — the "glass sheet". Low frequency so you can see waves flow.
float height(vec2 uv, float t) {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * u_rippleScale + vec2(u_seedPhase, -u_seedPhase * 0.7);
  return fbm(p, t);
}

// Background color field — palette weighted by slow FBM
vec3 background(vec2 uv, float t) {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 1.3;
  float totalW = 0.0;
  vec3 accum = vec3(0.0);
  for (int i = 0; i < ${MAX_COLORS}; i++) {
    if (i >= u_count) break;
    vec2 off = u_seedOffsets[i];
    float n = vnoise(p * 1.2 + off + vec2(t * 0.05, -t * 0.04) * float(i + 1));
    float w = exp(2.4 * n);
    totalW += w;
    accum += u_colors[i] * w;
  }
  return accum / max(totalW, 1e-4);
}

void main() {
  vec2 uv = v_uv;
  float t = u_time * u_flowSpeed;

  // sample h and its neighbors for a normal via finite differences
  float e = 0.0025;
  float h  = height(uv, t);
  float hx = height(uv + vec2(e, 0.0), t);
  float hy = height(uv + vec2(0.0, e), t);
  float hxm = height(uv - vec2(e, 0.0), t);
  float hym = height(uv - vec2(0.0, e), t);

  // gradient (central diff)
  vec2 grad = vec2(hx - hxm, hy - hym) / (2.0 * e);
  vec3 normal = normalize(vec3(-grad.x, -grad.y, 1.0));

  // refraction: bend the UV based on normal.xy and thickness
  float k = 0.12 * u_thickness;
  vec2 refr = normal.xy * k;

  // chromatic dispersion — sample background 3 times at slightly different offsets
  float d = u_dispersion * 0.035;
  vec3 bgR = background(uv + refr * (1.0 + d), t);
  vec3 bgG = background(uv + refr * (1.0),     t);
  vec3 bgB = background(uv + refr * (1.0 - d), t);
  vec3 bg = vec3(bgR.r, bgG.g, bgB.b);

  // Beer–Lambert-ish absorption through thick parts.
  // Tint = average of first two palette colors, darkened.
  vec3 tint = (u_colors[0] + u_colors[1]) * 0.5;
  float absorb = clamp(abs(h) * u_thickness * 1.2, 0.0, 1.0);
  vec3 col = mix(bg, bg * (0.35 + 0.5 * tint), absorb);

  // --- Caustics ---
  // Fake caustic bands: sharp peaks where sin(h) crosses, drifting with time.
  // Few bands across the screen because h has low range and low freq.
  float bandPhase = h * 2.4 + t * 0.35;
  float s = sin(bandPhase * 3.14159);
  float bands = pow(max(s, 0.0), 6.0);

  // Secondary finer ripple locked to gradient magnitude — adds shimmer on slopes only.
  float gradMag = length(grad);
  float shimmer = pow(max(sin(h * 5.5 - t * 0.8), 0.0), 10.0) * smoothstep(0.0, 3.5, gradMag);

  float caust = bands * 1.4 + shimmer * 0.9;
  caust *= u_caustic;

  // warm sunlight color from the brightest palette entry we can find (last one by convention)
  vec3 sunColor = u_colors[u_count - 1];
  // boost brightness
  sunColor = sunColor * 1.4 + vec3(0.15);
  col += sunColor * caust;

  // --- Specular ---
  // Slowly orbiting light vector
  float lt = t * 0.35 + u_seedPhase;
  vec3 L = normalize(vec3(cos(lt) * 0.6, sin(lt * 0.7) * 0.6, 0.55));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(normal, H), 0.0), 24.0);
  // broad soft base lighting wash
  float broad = pow(max(dot(normal, L), 0.0), 2.0);
  vec3 specCol = vec3(1.0, 0.97, 0.9);
  col += specCol * (spec * 1.2 + broad * 0.25) * u_specular;

  // subtle vignette & gentle tonemap
  float vig = smoothstep(1.35, 0.45, length(uv - 0.5));
  col *= mix(0.85, 1.0, vig);
  col = col / (1.0 + col * 0.5); // Reinhard-ish

  outColor = vec4(col, 1.0);
}`;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
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
    throw new Error("liquid-glass-veil shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "liquid-glass-veil",
  label: "Liquid Glass · Veil",
  category: "generative",
  params: {
    palette: {
      type: "colorArray",
      default: ["#0c1a3a", "#3a8aff", "#7afcff", "#fff7c2"],
      min: 2,
      max: MAX_COLORS,
      label: "Palette",
    },
    rippleScale: { type: "number", default: 1.8, min: 0.5, max: 4, step: 0.05, label: "Ripple Scale" },
    flowSpeed: { type: "number", default: 0.4, min: 0, max: 2, step: 0.05, label: "Flow Speed" },
    thickness: { type: "number", default: 0.9, min: 0.3, max: 2, step: 0.05, label: "Thickness" },
    causticIntensity: { type: "number", default: 1.0, min: 0, max: 2, step: 0.05, label: "Caustic Strength" },
    specularSweep: { type: "number", default: 0.7, min: 0, max: 1.5, step: 0.05, label: "Specular Sweep" },
    dispersion: { type: "number", default: 0.3, min: 0, max: 1, step: 0.02, label: "Chromatic Dispersion" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("liquid-glass-veil: webgl2 unavailable");

    const rng = makeRng(seed);
    const offsets = new Float32Array(MAX_COLORS * 2);
    for (let i = 0; i < MAX_COLORS; i++) {
      offsets[i * 2] = (rng() - 0.5) * 200;
      offsets[i * 2 + 1] = (rng() - 0.5) * 200;
    }
    const seedPhase = rng() * 6.2831853;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error("liquid-glass-veil link: " + log);
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

    const U = {
      time: gl.getUniformLocation(prog, "u_time"),
      res: gl.getUniformLocation(prog, "u_res"),
      count: gl.getUniformLocation(prog, "u_count"),
      colors: gl.getUniformLocation(prog, "u_colors"),
      offsets: gl.getUniformLocation(prog, "u_seedOffsets"),
      seedPhase: gl.getUniformLocation(prog, "u_seedPhase"),
      rippleScale: gl.getUniformLocation(prog, "u_rippleScale"),
      flowSpeed: gl.getUniformLocation(prog, "u_flowSpeed"),
      thickness: gl.getUniformLocation(prog, "u_thickness"),
      caustic: gl.getUniformLocation(prog, "u_caustic"),
      specular: gl.getUniformLocation(prog, "u_specular"),
      dispersion: gl.getUniformLocation(prog, "u_dispersion"),
    };

    let w = canvas.width;
    let h = canvas.height;
    const colorBuf = new Float32Array(MAX_COLORS * 3);

    const draw = (time) => {
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);

      const palette = Array.isArray(params.palette) ? params.palette : [];
      const count = Math.max(2, Math.min(MAX_COLORS, palette.length));
      for (let i = 0; i < count; i++) {
        const rgb = hexToRgb(palette[i] || "#000000");
        colorBuf[i * 3] = rgb[0];
        colorBuf[i * 3 + 1] = rgb[1];
        colorBuf[i * 3 + 2] = rgb[2];
      }

      gl.uniform1f(U.time, time);
      gl.uniform2f(U.res, w, h);
      gl.uniform1i(U.count, count);
      gl.uniform3fv(U.colors, colorBuf);
      gl.uniform2fv(U.offsets, offsets);
      gl.uniform1f(U.seedPhase, seedPhase);
      gl.uniform1f(U.rippleScale, params.rippleScale ?? 1.8);
      gl.uniform1f(U.flowSpeed, params.flowSpeed ?? 0.4);
      gl.uniform1f(U.thickness, params.thickness ?? 0.9);
      gl.uniform1f(U.caustic, params.causticIntensity ?? 1.0);
      gl.uniform1f(U.specular, params.specularSweep ?? 0.7);
      gl.uniform1f(U.dispersion, params.dispersion ?? 0.3);

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
