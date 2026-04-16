import { makeRng } from "../base.js";

const MAX_COLORS = 8;

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_res;
uniform float u_time;
uniform float u_scale;
uniform float u_speed;
uniform float u_contrast;
uniform float u_seedOffset;
uniform int u_paletteCount;
uniform vec3 u_palette[${MAX_COLORS}];

vec3 paletteAt(int i) {
  int idx = i % u_paletteCount;
  vec3 c = u_palette[0];
  for (int k = 0; k < ${MAX_COLORS}; k++) {
    if (k == idx) c = u_palette[k];
  }
  return c;
}

vec3 irid(float t) {
  t = fract(t);
  float scaled = t * float(u_paletteCount);
  int i0 = int(floor(scaled)) % u_paletteCount;
  int i1 = (i0 + 1) % u_paletteCount;
  float f = fract(scaled);
  return mix(paletteAt(i0), paletteAt(i1), f);
}

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    s += amp * vnoise(p);
    p = rot * p * 2.02;
    amp *= 0.5;
  }
  return s;
}

vec3 backdrop(vec2 uv) {
  vec2 p = uv * vec2(3.2, 2.4) * u_scale + vec2(u_seedOffset);
  float t = u_time * u_speed;

  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + t * 0.08),
    fbm(p + vec2(5.2, 1.3) - t * 0.11)
  );
  vec2 r = vec2(
    fbm(p + 3.6 * q + vec2(1.7, 9.2) + t * 0.05),
    fbm(p + 3.6 * q + vec2(8.3, 2.8) - t * 0.06)
  );

  float thickness = fbm(p + 4.5 * r + t * 0.03);
  float band = fbm(p * 0.6 + r * 2.0 - t * 0.02);
  float hue = thickness * 1.8 + band * 0.9;

  vec3 irc = irid(hue);

  float swirl = length(r - 0.5) * 2.0;
  float bloom = pow(clamp(swirl, 0.0, 1.0), 1.4);

  float intens = pow(clamp(thickness, 0.0, 1.0), u_contrast * 1.8);

  float e = 0.008;
  float gx = fbm(p + 4.5 * r + t * 0.03 + vec2(e, 0.0)) - thickness;
  float gy = fbm(p + 4.5 * r + t * 0.03 + vec2(0.0, e)) - thickness;
  float gmag = length(vec2(gx, gy)) / e;
  float edgeHi = smoothstep(0.6, 1.6, gmag);

  vec3 dark = vec3(0.015, 0.005, 0.03);
  vec3 col = mix(dark, irc, intens * (0.35 + 0.75 * bloom));

  col += irc * pow(intens, 3.0) * bloom * 0.9;
  col += irid(hue + 0.15) * edgeHi * 0.6;

  float dim = smoothstep(0.45, 0.15, thickness);
  col *= 1.0 - dim * 0.85;

  return col;
}

void main() {
  vec2 fragUV = gl_FragCoord.xy / u_res.xy;
  outColor = vec4(backdrop(fragUV), 1.0);
}
`;

function hexToRgb(hex) {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("oil-spill shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "oil-spill",
  label: "Oil Spill",
  category: "generative",
  params: {
    palette: {
      type: "colorArray",
      default: ["#1a3a5c", "#7ab4ff", "#ff7eb6", "#ffeb70"],
      min: 2,
      max: MAX_COLORS,
      label: "Palette",
    },
    scale: { type: "number", default: 0.3, min: 0.05, max: 3, step: 0.05, label: "Scale" },
    speed: { type: "number", default: 0.05, min: 0, max: 3, step: 0.05, label: "Speed" },
    contrast: { type: "number", default: 1.0, min: 0.3, max: 2, step: 0.05, label: "Contrast" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("oil-spill: webgl2 unavailable");

    const rng = makeRng(seed);
    const seedOffset = rng() * 100.0;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("oil-spill link: " + gl.getProgramInfoLog(prog));
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
      scale: gl.getUniformLocation(prog, "u_scale"),
      speed: gl.getUniformLocation(prog, "u_speed"),
      contrast: gl.getUniformLocation(prog, "u_contrast"),
      seedOffset: gl.getUniformLocation(prog, "u_seedOffset"),
      paletteCount: gl.getUniformLocation(prog, "u_paletteCount"),
      palette: gl.getUniformLocation(prog, "u_palette"),
    };

    let w = canvas.width;
    let h = canvas.height;
    gl.viewport(0, 0, w, h);

    const paletteBuf = new Float32Array(MAX_COLORS * 3);

    return {
      update(dt, time) {
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        const palette = Array.isArray(params.palette) ? params.palette : [];
        const pCount = Math.max(2, Math.min(MAX_COLORS, palette.length));
        for (let i = 0; i < MAX_COLORS; i++) {
          const rgb = hexToRgb(palette[i % pCount] || "#000000");
          paletteBuf[i * 3] = rgb[0];
          paletteBuf[i * 3 + 1] = rgb[1];
          paletteBuf[i * 3 + 2] = rgb[2];
        }

        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.time, time);
        gl.uniform1f(u.scale, Math.max(0.05, Math.min(3, params.scale ?? 0.3)));
        gl.uniform1f(u.speed, Math.max(0, Math.min(3, params.speed ?? 0.05)));
        gl.uniform1f(u.contrast, Math.max(0.3, Math.min(2, params.contrast ?? 1.0)));
        gl.uniform1f(u.seedOffset, seedOffset);
        gl.uniform1i(u.paletteCount, pCount);
        gl.uniform3fv(u.palette, paletteBuf);

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
      },
    };
  },
};
