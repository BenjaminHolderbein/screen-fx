/* global Float32Array */
import { makeRng } from "../base.js";

const MAX_COLORS = 8;
const MAX_LAYERS = 5;

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
uniform float u_zoom;
uniform int   u_layers;
uniform int   u_count;
uniform vec3  u_colors[${MAX_COLORS}];
uniform vec4  u_phases[${MAX_LAYERS}];

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(u_count);
  int i0 = int(floor(scaled));
  int i1 = int(mod(float(i0 + 1), float(u_count)));
  float f = scaled - floor(scaled);
  vec3 c0 = vec3(0.0);
  vec3 c1 = vec3(0.0);
  for (int k = 0; k < ${MAX_COLORS}; k++) {
    if (k == i0) c0 = u_colors[k];
    if (k == i1) c1 = u_colors[k];
  }
  return mix(c0, c1, f);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * u_zoom * 6.0;

  float v = 0.0;
  for (int i = 0; i < ${MAX_LAYERS}; i++) {
    if (i >= u_layers) break;
    vec4 ph = u_phases[i];
    float fi = float(i);
    v += sin(p.x * ph.x + u_time * ph.z + ph.w);
    v += sin(p.y * ph.y + u_time * (ph.z * 0.9) + ph.w * 1.3);
    v += sin((p.x + p.y) * (ph.x * 0.5 + ph.y * 0.5) + u_time * ph.z * 1.1);
    float cx = p.x + 0.5 * sin(u_time * 0.3 + fi);
    float cy = p.y + 0.5 * cos(u_time * 0.27 + fi * 1.3);
    v += sin(sqrt(cx * cx + cy * cy) * (ph.x * 0.7) + u_time * ph.z);
  }

  v /= float(u_layers) * 4.0;
  float t = v * 0.5 + 0.5;

  vec3 col = samplePalette(t);
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
    throw new Error("plasma shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "plasma",
  label: "Plasma",
  category: "retro",
  params: {
    speed: { type: "number", default: 1.0, min: 0, max: 3, step: 0.05, label: "Speed" },
    complexity: { type: "number", default: 3, min: 1, max: 5, step: 1, label: "Complexity" },
    zoom: { type: "number", default: 1.0, min: 0.3, max: 3, step: 0.05, label: "Zoom" },
    palette: {
      type: "colorArray",
      default: ["#ff006e", "#8338ec", "#3a86ff", "#06ffa5"],
      min: 2,
      max: MAX_COLORS,
      label: "Palette",
    },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("plasma: webgl2 unavailable");

    const rng = makeRng(seed);
    const phases = new Float32Array(MAX_LAYERS * 4);
    for (let i = 0; i < MAX_LAYERS; i++) {
      phases[i * 4 + 0] = 0.6 + rng() * 1.4;
      phases[i * 4 + 1] = 0.6 + rng() * 1.4;
      phases[i * 4 + 2] = 0.5 + rng() * 1.2;
      phases[i * 4 + 3] = rng() * Math.PI * 2;
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
      throw new Error("plasma link: " + log);
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

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uZoom = gl.getUniformLocation(prog, "u_zoom");
    const uLayers = gl.getUniformLocation(prog, "u_layers");
    const uCount = gl.getUniformLocation(prog, "u_count");
    const uColors = gl.getUniformLocation(prog, "u_colors");
    const uPhases = gl.getUniformLocation(prog, "u_phases");

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
        colorBuf[i * 3 + 0] = rgb[0];
        colorBuf[i * 3 + 1] = rgb[1];
        colorBuf[i * 3 + 2] = rgb[2];
      }

      const layers = Math.max(1, Math.min(MAX_LAYERS, Math.round(params.complexity ?? 3)));
      const zoom = 1 / Math.max(0.05, params.zoom ?? 1);

      gl.uniform1f(uTime, time * (params.speed ?? 1));
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uZoom, zoom);
      gl.uniform1i(uLayers, layers);
      gl.uniform1i(uCount, count);
      gl.uniform3fv(uColors, colorBuf);
      gl.uniform4fv(uPhases, phases);

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
