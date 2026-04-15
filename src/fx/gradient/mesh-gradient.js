/* global Float32Array */
import { makeRng } from "../base.js";

const MAX_BLOBS = 6;

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
uniform float u_sigma;
uniform vec3  u_bg;
uniform vec3  u_colors[${MAX_BLOBS}];
uniform vec4  u_drift[${MAX_BLOBS}];
uniform vec2  u_phase[${MAX_BLOBS}];

void main() {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2((v_uv.x - 0.5) * aspect, v_uv.y - 0.5);

  float sigma = u_sigma * 0.5;
  float inv2s2 = 1.0 / (2.0 * sigma * sigma);
  float wSum = 0.0;
  vec3 cSum = vec3(0.0);

  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    if (i >= u_count) break;
    vec4 d = u_drift[i];
    vec2 ph = u_phase[i];
    float cx = (aspect * 0.55) * sin(u_time * d.x + ph.x) + d.z;
    float cy = 0.55 * sin(u_time * d.y + ph.y) + d.w;
    vec2 c = vec2(cx, cy);
    vec2 diff = p - c;
    float d2 = dot(diff, diff);
    float w = exp(-d2 * inv2s2);
    wSum += w;
    cSum += u_colors[i] * w;
  }

  float bgW = 0.15;
  vec3 col = (cSum + u_bg * bgW) / (wSum + bgW);
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
    throw new Error("mesh-gradient shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "mesh-gradient",
  label: "Mesh Gradient",
  category: "gradient",
  params: {
    palette: {
      type: "colorArray",
      default: ["#ff9a76", "#9a76ff", "#76ffa0", "#ffd876"],
      min: 2,
      max: MAX_BLOBS,
      label: "Palette",
    },
    spread: { type: "number", default: 0.7, min: 0.2, max: 1.5, step: 0.05, label: "Spread" },
    speed: { type: "number", default: 0.4, min: 0, max: 2, step: 0.05, label: "Speed" },
    background: { type: "color", default: "#1a0e2a", label: "Background" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("mesh-gradient: webgl2 unavailable");

    const rng = makeRng(seed);
    const drift = new Float32Array(MAX_BLOBS * 4);
    const phase = new Float32Array(MAX_BLOBS * 2);
    for (let i = 0; i < MAX_BLOBS; i++) {
      drift[i * 4 + 0] = 0.12 + rng() * 0.18;
      drift[i * 4 + 1] = 0.1 + rng() * 0.2;
      drift[i * 4 + 2] = (rng() - 0.5) * 0.3;
      drift[i * 4 + 3] = (rng() - 0.5) * 0.3;
      phase[i * 2 + 0] = rng() * Math.PI * 2;
      phase[i * 2 + 1] = rng() * Math.PI * 2;
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
      throw new Error("mesh-gradient link: " + log);
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
    const uSigma = gl.getUniformLocation(prog, "u_sigma");
    const uBg = gl.getUniformLocation(prog, "u_bg");
    const uColors = gl.getUniformLocation(prog, "u_colors");
    const uDrift = gl.getUniformLocation(prog, "u_drift");
    const uPhase = gl.getUniformLocation(prog, "u_phase");

    let w = canvas.width;
    let h = canvas.height;
    const colorBuf = new Float32Array(MAX_BLOBS * 3);

    const draw = (time) => {
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);

      const palette = Array.isArray(params.palette) ? params.palette : [];
      const count = Math.max(2, Math.min(MAX_BLOBS, palette.length));
      colorBuf.fill(0);
      for (let i = 0; i < count; i++) {
        const rgb = hexToRgb(palette[i] || "#000000");
        colorBuf[i * 3] = rgb[0];
        colorBuf[i * 3 + 1] = rgb[1];
        colorBuf[i * 3 + 2] = rgb[2];
      }
      const bg = hexToRgb(params.background || "#000000");

      gl.uniform1f(uTime, time * (params.speed ?? 0.4));
      gl.uniform2f(uRes, w, h);
      gl.uniform1i(uCount, count);
      gl.uniform1f(uSigma, params.spread ?? 0.7);
      gl.uniform3f(uBg, bg[0], bg[1], bg[2]);
      gl.uniform3fv(uColors, colorBuf);
      gl.uniform4fv(uDrift, drift);
      gl.uniform2fv(uPhase, phase);

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
