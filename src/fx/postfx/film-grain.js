const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform sampler2D u_src;
uniform vec2 u_res;
uniform float u_time;
uniform float u_intensity;
uniform float u_size;

// Hash-based pseudo-random — fast, no texture needed
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 src = texture(u_src, uv);

  // Quantize position by grain size to get coarser grain
  vec2 grainCoord = floor(gl_FragCoord.xy / u_size);

  // Discrete grain frames — speed controls frames-per-second of grain change.
  // floor() ensures the pattern holds steady between updates (like real film).
  float frame = floor(u_time);
  float noise = hash(grainCoord + vec2(frame * 1.37, frame * 2.41));

  // Center noise around 0 (-0.5 to 0.5) so it darkens and brightens equally
  float grain = (noise - 0.5) * u_intensity;

  // Apply monochromatic grain additively
  vec3 col = src.rgb + vec3(grain);

  outColor = vec4(col, src.a);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("film-grain postfx shader: " + log);
  }
  return sh;
}

/** @type {import("./base.js").PostFxModule} */
export default {
  id: "film-grain",
  label: "Film Grain",
  params: {
    intensity: { type: "number", default: 0.2, min: 0.0, max: 1.0, step: 0.05, label: "Intensity" },
    speed: { type: "number", default: 30, min: 0, max: 60, step: 1, label: "Speed (fps)" },
    size: { type: "number", default: 1.5, min: 1.0, max: 4.0, step: 0.5, label: "Grain Size" },
  },
  init(ctx, params, _seed) {
    const { canvas, gl } = ctx;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("film-grain postfx link: " + gl.getProgramInfoLog(prog));
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

    const srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const u = {
      src: gl.getUniformLocation(prog, "u_src"),
      res: gl.getUniformLocation(prog, "u_res"),
      time: gl.getUniformLocation(prog, "u_time"),
      intensity: gl.getUniformLocation(prog, "u_intensity"),
      size: gl.getUniformLocation(prog, "u_size"),
    };

    let w = canvas.width;
    let h = canvas.height;
    gl.viewport(0, 0, w, h);

    return {
      apply(srcCanvas, dt, time) {
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
        gl.uniform1i(u.src, 0);

        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.time, time * (params.speed ?? 30));
        gl.uniform1f(u.intensity, params.intensity ?? 0.35);
        gl.uniform1f(u.size, params.size ?? 1.5);

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
        gl.deleteTexture(srcTex);
      },
    };
  },
};
