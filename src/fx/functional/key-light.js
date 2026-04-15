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
uniform vec3  u_white;
uniform float u_brightness;
uniform float u_tint;
uniform float u_falloff;

void main() {
  vec2 d = v_uv - 0.5;
  float aspect = u_res.x / max(u_res.y, 1.0);
  d.x *= aspect;
  float r = length(d) / length(vec2(0.5 * aspect, 0.5));
  float vign = 1.0 - u_falloff * r * r;

  vec3 col = u_white;
  col.r += u_tint;
  col.b += u_tint;
  col.g -= u_tint;
  col = clamp(col, 0.0, 1.0);

  col *= u_brightness * vign;
  outColor = vec4(col, 1.0);
}`;

function blackbodyRgb(kelvin) {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("key-light shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "key-light",
  label: "Key Light",
  category: "functional",
  params: {
    temperature: { type: "number", default: 5000, min: 2700, max: 6500, step: 50, label: "Temperature K" },
    brightness: { type: "number", default: 1.0, min: 0, max: 1, step: 0.01, label: "Brightness" },
    tint: { type: "number", default: 0, min: -0.05, max: 0.05, step: 0.005, label: "Tint" },
    falloff: { type: "number", default: 0.15, min: 0, max: 0.5, step: 0.01, label: "Falloff" },
  },
  init(ctx, params, _seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("key-light: webgl2 unavailable");

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error("key-light link: " + log);
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

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uWhite = gl.getUniformLocation(prog, "u_white");
    const uBrightness = gl.getUniformLocation(prog, "u_brightness");
    const uTint = gl.getUniformLocation(prog, "u_tint");
    const uFalloff = gl.getUniformLocation(prog, "u_falloff");

    let w = canvas.width;
    let h = canvas.height;

    const draw = () => {
      const [r, g, b] = blackbodyRgb(params.temperature ?? 5000);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);
      gl.uniform2f(uRes, w, h);
      gl.uniform3f(uWhite, r, g, b);
      gl.uniform1f(uBrightness, params.brightness ?? 1);
      gl.uniform1f(uTint, params.tint ?? 0);
      gl.uniform1f(uFalloff, params.falloff ?? 0);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    };

    draw();

    return {
      update(_dt, _time) {
        draw();
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
