const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform sampler2D u_src;
uniform vec2 u_res;
uniform float u_intensity;
uniform float u_radius;
uniform float u_softness;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 src = texture(u_src, uv);

  // Distance from center, corrected for aspect ratio
  vec2 center = uv - 0.5;
  float aspect = u_res.x / u_res.y;
  center.x *= aspect;
  float dist = length(center);

  float innerRadius = u_radius;
  float outerRadius = u_radius + u_softness;
  float vignette = 1.0 - smoothstep(innerRadius, outerRadius, dist);

  vec3 color = src.rgb * mix(1.0, vignette, u_intensity);
  outColor = vec4(color, src.a);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("vignette postfx shader: " + log);
  }
  return sh;
}

/** @type {import("./base.js").PostFxModule} */
export default {
  id: "vignette",
  label: "Vignette",
  params: {
    intensity: { type: "number", default: 0.5, min: 0.0, max: 1.0, step: 0.05, label: "Intensity" },
    radius: { type: "number", default: 0.4, min: 0.1, max: 1.0, step: 0.05, label: "Radius" },
    softness: { type: "number", default: 0.5, min: 0.1, max: 1.0, step: 0.05, label: "Softness" },
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
      throw new Error("vignette postfx link: " + gl.getProgramInfoLog(prog));
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
      intensity: gl.getUniformLocation(prog, "u_intensity"),
      radius: gl.getUniformLocation(prog, "u_radius"),
      softness: gl.getUniformLocation(prog, "u_softness"),
    };

    let w = canvas.width;
    let h = canvas.height;

    return {
      apply(srcCanvas, _dt, _time) {
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
        gl.uniform1i(u.src, 0);

        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.intensity, params.intensity ?? 0.5);
        gl.uniform1f(u.radius, params.radius ?? 0.4);
        gl.uniform1f(u.softness, params.softness ?? 0.5);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
      },
      resize(nw, nh) {
        w = nw;
        h = nh;
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
