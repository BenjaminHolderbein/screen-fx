import { makeRng } from "../base.js";

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform sampler2D u_src;
uniform vec2 u_res;
uniform vec2 u_slabCenter;
uniform vec2 u_slabHalf;
uniform float u_slabRadius;
uniform float u_refraction;
uniform float u_bevelDepth;
uniform float u_bevelWidth;
uniform float u_chroma;
uniform float u_chromaPower;
uniform vec2 u_lightDir;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 fragUV = gl_FragCoord.xy / u_res.xy;
  float aspect = u_res.x / u_res.y;
  vec2 pAspect = vec2(fragUV.x * aspect, fragUV.y);

  float sdfRaw = sdRoundBox(pAspect - u_slabCenter, u_slabHalf, u_slabRadius);
  float dInside = -sdfRaw;

  float bevelPx = u_bevelWidth;
  float edge = clamp(1.0 - smoothstep(0.0, bevelPx, dInside), 0.0, 1.0);

  vec2 fromCenter = pAspect - u_slabCenter;
  float flen = length(fromCenter) + 1e-6;
  vec2 radial = fromCenter / flen;

  float offsetAmt = edge * u_refraction + pow(edge, 10.0) * u_bevelDepth;
  vec2 offsetAspect = radial * offsetAmt;
  vec2 sampleOffsetUV = vec2(-offsetAspect.x / aspect, -offsetAspect.y);

  float chromaMask = pow(edge, u_chromaPower);
  float chromaAmt = u_chroma * chromaMask;
  vec2 offR = sampleOffsetUV * (1.0 + chromaAmt);
  vec2 offG = sampleOffsetUV;
  vec2 offB = sampleOffsetUV * (1.0 - chromaAmt);

  vec3 bg = texture(u_src, fragUV).rgb;

  if (dInside <= 0.0) {
    outColor = vec4(bg, 1.0);
    return;
  }

  vec3 refracted;
  refracted.r = texture(u_src, fragUV + offR).r;
  refracted.g = texture(u_src, fragUV + offG).g;
  refracted.b = texture(u_src, fragUV + offB).b;

  vec2 eps = vec2(0.0018, 0.0);
  float sdx = sdRoundBox(pAspect + eps.xy - u_slabCenter, u_slabHalf, u_slabRadius)
            - sdRoundBox(pAspect - eps.xy - u_slabCenter, u_slabHalf, u_slabRadius);
  float sdy = sdRoundBox(pAspect + eps.yx - u_slabCenter, u_slabHalf, u_slabRadius)
            - sdRoundBox(pAspect - eps.yx - u_slabCenter, u_slabHalf, u_slabRadius);
  vec2 gradOut = normalize(vec2(sdx, sdy) + vec2(1e-6));

  vec2 L = normalize(u_lightDir);
  float nz = 1.0 - edge * 0.9;
  vec3 N = normalize(vec3(gradOut * edge, nz));
  vec3 L3 = normalize(vec3(L, 0.35));
  vec3 V3 = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L3 + V3);

  float broad = pow(max(0.0, dot(N, L3)), 5.0) * 0.32;
  float tight = pow(max(0.0, dot(N, H)), 28.0) * 1.0;

  float band = smoothstep(-0.006, 0.0, sdfRaw) * (1.0 - smoothstep(0.0, 0.012, sdfRaw));
  float facing = dot(gradOut, L);
  float rim = band * max(facing, 0.0);
  float innerShadow = band * max(-facing, 0.0);

  vec3 tint = vec3(0.92, 0.96, 1.02);
  vec3 col = refracted * tint;

  col += vec3(1.0) * (broad + tight);
  col += vec3(1.0) * rim * 0.8;
  col -= vec3(0.08, 0.1, 0.14) * innerShadow;
  col += vec3(0.6, 0.7, 0.85) * pow(edge, 10.0) * 0.25;

  outColor = vec4(col, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("liquid-glass-slab postfx shader: " + log);
  }
  return sh;
}

/** @type {import("./base.js").PostFxModule} */
export default {
  id: "liquid-glass-slab",
  label: "Liquid Glass · Slab",
  params: {
    slabSize: { type: "number", default: 0.4, min: 0.2, max: 0.6, step: 0.02, label: "Slab Size" },
    refraction: { type: "number", default: 0.015, min: 0.005, max: 0.04, step: 0.001, label: "Refraction" },
    bevelDepth: { type: "number", default: 0.1, min: 0.02, max: 0.2, step: 0.005, label: "Bevel Depth" },
    chroma: { type: "number", default: 0.06, min: 0, max: 0.15, step: 0.005, label: "Chromatic Dispersion" },
    chromaPower: { type: "number", default: 1.5, min: 0.5, max: 4, step: 0.1, label: "Chroma Power" },
    speed: { type: "number", default: 0.5, min: 0.1, max: 3, step: 0.05, label: "Speed" },
  },
  init(ctx, params, seed) {
    const { canvas, gl } = ctx;
    const rng = makeRng(seed);

    const bounce = {
      x: 0, y: 0, vx: 0, vy: 0, inited: false,
      seedUX: rng(), seedUY: rng(), seedVang: rng(),
    };
    const BASE_SPEED = 0.12;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("liquid-glass-slab postfx link: " + gl.getProgramInfoLog(prog));
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
      slabCenter: gl.getUniformLocation(prog, "u_slabCenter"),
      slabHalf: gl.getUniformLocation(prog, "u_slabHalf"),
      slabRadius: gl.getUniformLocation(prog, "u_slabRadius"),
      refraction: gl.getUniformLocation(prog, "u_refraction"),
      bevelDepth: gl.getUniformLocation(prog, "u_bevelDepth"),
      bevelWidth: gl.getUniformLocation(prog, "u_bevelWidth"),
      chroma: gl.getUniformLocation(prog, "u_chroma"),
      chromaPower: gl.getUniformLocation(prog, "u_chromaPower"),
      lightDir: gl.getUniformLocation(prog, "u_lightDir"),
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

        const aspect = w / h;
        const slabSize = Math.max(0.2, Math.min(0.6, params.slabSize ?? 0.4));
        const hw = slabSize * 0.75;
        const hh = slabSize * 0.5;
        const radius = Math.min(hw, hh) * 0.35;

        const minX = hw;
        const maxX = aspect - hw;
        const minY = hh;
        const maxY = 1.0 - hh;
        const speedMul = Math.max(0.1, Math.min(3, params.speed ?? 0.5));

        if (!bounce.inited) {
          bounce.x = minX + bounce.seedUX * Math.max(0, maxX - minX);
          bounce.y = minY + bounce.seedUY * Math.max(0, maxY - minY);
          const ang = bounce.seedVang * Math.PI * 2;
          bounce.vx = Math.cos(ang) * BASE_SPEED;
          bounce.vy = Math.sin(ang) * BASE_SPEED;
          bounce.inited = true;
        }

        const step = Math.min(dt, 0.05);
        bounce.x += bounce.vx * speedMul * step;
        bounce.y += bounce.vy * speedMul * step;

        let hitX = false, hitY = false;
        if (bounce.x < minX) { bounce.x = minX; bounce.vx = Math.abs(bounce.vx); hitX = true; }
        else if (bounce.x > maxX) { bounce.x = maxX; bounce.vx = -Math.abs(bounce.vx); hitX = true; }
        if (bounce.y < minY) { bounce.y = minY; bounce.vy = Math.abs(bounce.vy); hitY = true; }
        else if (bounce.y > maxY) { bounce.y = maxY; bounce.vy = -Math.abs(bounce.vy); hitY = true; }

        if ((hitX || hitY) && rng() < 0.12) {
          const nearCornerX = bounce.x < (minX + maxX) * 0.5 ? minX : maxX;
          const nearCornerY = bounce.y < (minY + maxY) * 0.5 ? minY : maxY;
          const tx = nearCornerX - bounce.x;
          const ty = nearCornerY - bounce.y;
          const tlen = Math.hypot(tx, ty) + 1e-6;
          const blend = 0.18;
          const nvx = bounce.vx * (1 - blend) + (tx / tlen) * BASE_SPEED * blend;
          const nvy = bounce.vy * (1 - blend) + (ty / tlen) * BASE_SPEED * blend;
          const cur = Math.hypot(bounce.vx, bounce.vy) || BASE_SPEED;
          const nn = Math.hypot(nvx, nvy) || 1;
          bounce.vx = (nvx / nn) * cur;
          bounce.vy = (nvy / nn) * cur;
        }

        const lAng = time * 0.08 + 0.6;
        const minDim = Math.min(aspect, 1.0);

        gl.uniform2f(u.res, w, h);
        gl.uniform2f(u.slabCenter, bounce.x, bounce.y);
        gl.uniform2f(u.slabHalf, hw, hh);
        gl.uniform1f(u.slabRadius, radius);
        gl.uniform1f(u.refraction, params.refraction ?? 0.015);
        gl.uniform1f(u.bevelDepth, params.bevelDepth ?? 0.1);
        gl.uniform1f(u.bevelWidth, 0.045 * minDim);
        gl.uniform1f(u.chroma, params.chroma ?? 0.06);
        gl.uniform1f(u.chromaPower, params.chromaPower ?? 1.5);
        gl.uniform2f(u.lightDir, Math.cos(lAng), Math.sin(lAng));

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
