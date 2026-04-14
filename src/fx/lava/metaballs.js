import { makeRng } from "../base.js";

const MAX_BLOBS = 12;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform int uCount;
uniform vec4 uBlobs[${MAX_BLOBS}];
uniform vec4 uMotion[${MAX_BLOBS}];
uniform vec4 uShape[${MAX_BLOBS}];
uniform float uSize;
uniform float uSpeed;
uniform float uVariance;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uBg;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;

  float d = 1e9;
  const float TAU = 6.2831853;
  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    if (i >= uCount) break;
    vec4 b = uBlobs[i];
    vec4 m = uMotion[i];
    vec4 s = uShape[i];
    float x = b.x + sin(TAU * t * m.x * 0.15 + m.y) * b.z * uSpeed;
    float y = b.y + sin(TAU * t * m.z * 0.12 + m.y * 1.7) * 0.35 * uSpeed;
    float r = b.w * uSize;
    vec2 q = p - vec2(x * aspect, y);
    float ang = atan(q.y, q.x);
    float wob = sin(ang * s.x + s.y) * 0.6 + sin(ang * s.w - s.y * 1.3) * 0.4;
    float rr = r * (1.0 + wob * s.z * uVariance);
    float di = length(q) - rr;
    d = smin(d, di, 0.12);
  }

  float field = 1.0 - smoothstep(-0.02, 0.06, d);
  float core = 1.0 - smoothstep(-0.18, 0.02, d);
  vec3 hot = mix(uColA, uColB, smoothstep(0.0, 1.0, core));
  hot = mix(hot, uColC, smoothstep(0.5, 1.0, core));
  vec3 col = mix(uBg, hot, field);
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("lava-metaballs shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "lava-metaballs",
  label: "Lava Lamp",
  category: "lava",
  params: {
    count: { type: "number", default: 10, min: 5, max: MAX_BLOBS, step: 1, label: "Blob Count" },
    size: { type: "number", default: 0.3, min: 0.05, max: 0.5, step: 0.01, label: "Size" },
    speed: { type: "number", default: 0.2, min: 0.0, max: 2.0, step: 0.05, label: "Speed" },
    shapeVariance: { type: "number", default: 0.5, min: 0.0, max: 1.0, step: 0.01, label: "Shape Variance" },
    colorA: { type: "color", default: "#ffb347", label: "Color A" },
    colorB: { type: "color", default: "#ef3d2a", label: "Color B" },
    colorC: { type: "color", default: "#b31e7d", label: "Color C" },
    background: { type: "color", default: "#0a0012", label: "Background" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("lava-metaballs: webgl unavailable");

    const rng = makeRng(seed);
    const blobs = new Float32Array(MAX_BLOBS * 4);
    const motion = new Float32Array(MAX_BLOBS * 4);
    const shape = new Float32Array(MAX_BLOBS * 4);
    for (let i = 0; i < MAX_BLOBS; i++) {
      blobs[i * 4 + 0] = rng();
      blobs[i * 4 + 1] = rng();
      blobs[i * 4 + 2] = 0.08 + rng() * 0.22;
      blobs[i * 4 + 3] = 0.5 + rng() * 0.8;
      motion[i * 4 + 0] = 1 + Math.floor(rng() * 2);
      motion[i * 4 + 1] = rng() * 6.28318;
      motion[i * 4 + 2] = 1 + Math.floor(rng() * 3);
      motion[i * 4 + 3] = 0.0;
      shape[i * 4 + 0] = 2 + Math.floor(rng() * 3);
      shape[i * 4 + 1] = rng() * 6.28318;
      shape[i * 4 + 2] = 0.12 + rng() * 0.28;
      shape[i * 4 + 3] = 1 + Math.floor(rng() * 3);
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("lava-metaballs link: " + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(prog, "uRes"),
      time: gl.getUniformLocation(prog, "uTime"),
      count: gl.getUniformLocation(prog, "uCount"),
      blobs: gl.getUniformLocation(prog, "uBlobs[0]"),
      motion: gl.getUniformLocation(prog, "uMotion[0]"),
      shape: gl.getUniformLocation(prog, "uShape[0]"),
      size: gl.getUniformLocation(prog, "uSize"),
      speed: gl.getUniformLocation(prog, "uSpeed"),
      variance: gl.getUniformLocation(prog, "uVariance"),
      colA: gl.getUniformLocation(prog, "uColA"),
      colB: gl.getUniformLocation(prog, "uColB"),
      colC: gl.getUniformLocation(prog, "uColC"),
      bg: gl.getUniformLocation(prog, "uBg"),
    };

    let w = canvas.width;
    let h = canvas.height;
    gl.viewport(0, 0, w, h);

    return {
      update(_dt, time) {
        gl.useProgram(prog);
        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.time, time);
        gl.uniform1i(u.count, Math.max(5, Math.min(MAX_BLOBS, Math.round(params.count))));
        gl.uniform4fv(u.blobs, blobs);
        gl.uniform4fv(u.motion, motion);
        gl.uniform4fv(u.shape, shape);
        gl.uniform1f(u.size, params.size);
        gl.uniform1f(u.speed, params.speed);
        gl.uniform1f(u.variance, Math.max(0, Math.min(1, params.shapeVariance ?? 0.5)));
        gl.uniform3fv(u.colA, hexToRgb(params.colorA));
        gl.uniform3fv(u.colB, hexToRgb(params.colorB));
        gl.uniform3fv(u.colC, hexToRgb(params.colorC));
        gl.uniform3fv(u.bg, hexToRgb(params.background));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      resize(nw, nh) {
        w = nw;
        h = nh;
        gl.viewport(0, 0, w, h);
      },
      dispose() {
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      },
    };
  },
};
