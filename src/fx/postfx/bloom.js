const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Pass 1: extract bright pixels
const FRAG_BRIGHT = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_res;
uniform float u_threshold;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 c = texture(u_src, uv);
  float brightness = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float contrib = smoothstep(u_threshold, u_threshold + 0.15, brightness);
  outColor = vec4(c.rgb * contrib, 1.0);
}
`;

// Pass 2/3: separable Gaussian blur
const FRAG_BLUR = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_res;
uniform vec2 u_dir; // (1,0) for horizontal, (0,1) for vertical
uniform float u_radius;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 texel = 1.0 / u_res;

  // Gaussian weights for up to 20 taps
  float sigma = max(u_radius * 0.5, 1.0);
  vec4 sum = texture(u_src, uv) * 1.0;
  float wTotal = 1.0;

  int samples = int(min(u_radius, 20.0));
  for (int i = 1; i <= 20; i++) {
    if (i > samples) break;
    float fi = float(i);
    float w = exp(-(fi * fi) / (2.0 * sigma * sigma));
    vec2 off = u_dir * texel * fi;
    sum += texture(u_src, uv + off) * w;
    sum += texture(u_src, uv - off) * w;
    wTotal += 2.0 * w;
  }

  outColor = sum / wTotal;
}
`;

// Pass 4: composite original + blurred bloom
const FRAG_COMPOSITE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_src;       // original
uniform sampler2D u_bloom;     // blurred bright
uniform vec2 u_res;
uniform float u_intensity;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 orig = texture(u_src, uv);
  vec4 bloom = texture(u_bloom, uv);
  outColor = vec4(orig.rgb + bloom.rgb * u_intensity, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("bloom postfx shader: " + log);
  }
  return sh;
}

function linkProgram(gl, vertSrc, fragSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("bloom postfx link: " + gl.getProgramInfoLog(prog));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

function createFBO(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

function deleteFBO(gl, fbo) {
  gl.deleteTexture(fbo.tex);
  gl.deleteFramebuffer(fbo.fb);
}

/** @type {import("./base.js").PostFxModule} */
export default {
  id: "bloom",
  label: "Bloom",
  params: {
    threshold: { type: "number", default: 0.6, min: 0.3, max: 1.0, step: 0.05, label: "Threshold" },
    intensity: { type: "number", default: 0.8, min: 0.0, max: 2.0, step: 0.05, label: "Intensity" },
    radius: { type: "number", default: 8, min: 1, max: 20, step: 1, label: "Radius" },
  },
  init(ctx, params) {
    const { canvas, gl } = ctx;

    // Build programs
    const brightProg = linkProgram(gl, VERT, FRAG_BRIGHT);
    const blurProg = linkProgram(gl, VERT, FRAG_BLUR);
    const compositeProg = linkProgram(gl, VERT, FRAG_COMPOSITE);

    // Shared fullscreen triangle VAO
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Source texture (uploaded from srcCanvas each frame)
    const srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Uniform locations
    const uBright = {
      src: gl.getUniformLocation(brightProg, "u_src"),
      res: gl.getUniformLocation(brightProg, "u_res"),
      threshold: gl.getUniformLocation(brightProg, "u_threshold"),
    };
    const uBlur = {
      src: gl.getUniformLocation(blurProg, "u_src"),
      res: gl.getUniformLocation(blurProg, "u_res"),
      dir: gl.getUniformLocation(blurProg, "u_dir"),
      radius: gl.getUniformLocation(blurProg, "u_radius"),
    };
    const uComp = {
      src: gl.getUniformLocation(compositeProg, "u_src"),
      bloom: gl.getUniformLocation(compositeProg, "u_bloom"),
      res: gl.getUniformLocation(compositeProg, "u_res"),
      intensity: gl.getUniformLocation(compositeProg, "u_intensity"),
    };

    let w = canvas.width;
    let h = canvas.height;
    // Half-res FBOs for blur (better perf + wider blur at same kernel)
    let halfW = Math.max(1, w >> 1);
    let halfH = Math.max(1, h >> 1);
    let fboA = createFBO(gl, halfW, halfH); // bright extract -> hblur input
    let fboB = createFBO(gl, halfW, halfH); // hblur output -> vblur input

    function drawTri() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    return {
      apply(srcCanvas, _dt, _time) {
        // Upload source
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

        const threshold = params.threshold ?? 0.6;
        const intensity = params.intensity ?? 0.8;
        const radius = params.radius ?? 8;

        // Pass 1: extract bright pixels into fboA at half res
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.fb);
        gl.viewport(0, 0, halfW, halfH);
        gl.useProgram(brightProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform1i(uBright.src, 0);
        gl.uniform2f(uBright.res, halfW, halfH);
        gl.uniform1f(uBright.threshold, threshold);
        drawTri();

        // Pass 2: horizontal blur fboA -> fboB
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.fb);
        gl.viewport(0, 0, halfW, halfH);
        gl.useProgram(blurProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboA.tex);
        gl.uniform1i(uBlur.src, 0);
        gl.uniform2f(uBlur.res, halfW, halfH);
        gl.uniform2f(uBlur.dir, 1.0, 0.0);
        gl.uniform1f(uBlur.radius, radius);
        drawTri();

        // Pass 3: vertical blur fboB -> fboA
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.fb);
        gl.viewport(0, 0, halfW, halfH);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboB.tex);
        gl.uniform1i(uBlur.src, 0);
        gl.uniform2f(uBlur.res, halfW, halfH);
        gl.uniform2f(uBlur.dir, 0.0, 1.0);
        gl.uniform1f(uBlur.radius, radius);
        drawTri();

        // Pass 4: composite original + bloom to screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.useProgram(compositeProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform1i(uComp.src, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, fboA.tex);
        gl.uniform1i(uComp.bloom, 1);
        gl.uniform2f(uComp.res, w, h);
        gl.uniform1f(uComp.intensity, intensity);
        drawTri();
      },

      resize(nw, nh) {
        w = nw;
        h = nh;
        halfW = Math.max(1, w >> 1);
        halfH = Math.max(1, h >> 1);
        // Recreate FBOs at new half resolution
        deleteFBO(gl, fboA);
        deleteFBO(gl, fboB);
        fboA = createFBO(gl, halfW, halfH);
        fboB = createFBO(gl, halfW, halfH);
      },

      dispose() {
        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(brightProg);
        gl.deleteProgram(blurProg);
        gl.deleteProgram(compositeProg);
        gl.deleteTexture(srcTex);
        deleteFBO(gl, fboA);
        deleteFBO(gl, fboB);
      },
    };
  },
};
