/* global Float32Array */
import { makeRng } from "../base.js";

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
uniform vec3  u_colors[6];
uniform vec2  u_seedOffsets[6];

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

void main() {
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 1.4;

  float totalW = 0.0;
  vec3 accum = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    if (i >= u_count) break;
    vec2 off = u_seedOffsets[i];
    float n = snoise(vec3(p * 1.1 + off, u_time * 0.15 + float(i) * 1.7));
    float w = exp(2.2 * n);
    totalW += w;
    accum += u_colors[i] * w;
  }
  vec3 col = accum / max(totalW, 1e-4);

  float g = snoise(vec3(p * 3.0, u_time * 0.2 + 11.0)) * 0.04;
  col += g;

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
    throw new Error("animated-gradient shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "animated-gradient",
  label: "Animated Gradient",
  category: "gradient",
  params: {
    count: { type: "number", default: 4, min: 3, max: 6, step: 1, label: "Color Count" },
    color1: { type: "color", default: "#ff4d6d", label: "Color 1" },
    color2: { type: "color", default: "#7c3aed", label: "Color 2" },
    color3: { type: "color", default: "#1e90ff", label: "Color 3" },
    color4: { type: "color", default: "#00d4a6", label: "Color 4" },
    color5: { type: "color", default: "#ffb347", label: "Color 5" },
    color6: { type: "color", default: "#ff80bf", label: "Color 6" },
    speed: { type: "number", default: 1.0, min: 0, max: 4, step: 0.05, label: "Speed" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("animated-gradient: webgl2 unavailable");

    const rng = makeRng(seed);
    const offsets = new Float32Array(12);
    for (let i = 0; i < 6; i++) {
      offsets[i * 2] = (rng() - 0.5) * 200;
      offsets[i * 2 + 1] = (rng() - 0.5) * 200;
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
      throw new Error("animated-gradient link: " + log);
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

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uCount = gl.getUniformLocation(prog, "u_count");
    const uColors = gl.getUniformLocation(prog, "u_colors");
    const uOffsets = gl.getUniformLocation(prog, "u_seedOffsets");

    let w = canvas.width;
    let h = canvas.height;
    const colorBuf = new Float32Array(18);

    const draw = (time) => {
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);

      const count = Math.max(3, Math.min(6, Math.round(params.count)));
      for (let i = 0; i < 6; i++) {
        const key = "color" + (i + 1);
        const rgb = hexToRgb(params[key] || "#000000");
        colorBuf[i * 3] = rgb[0];
        colorBuf[i * 3 + 1] = rgb[1];
        colorBuf[i * 3 + 2] = rgb[2];
      }

      gl.uniform1f(uTime, time * (params.speed ?? 1));
      gl.uniform2f(uRes, w, h);
      gl.uniform1i(uCount, count);
      gl.uniform3fv(uColors, colorBuf);
      gl.uniform2fv(uOffsets, offsets);

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
