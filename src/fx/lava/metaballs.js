import { makeRng } from "../base.js";

const MAX_BLOBS = 12;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Each blob packed as:
//   uBlobs[i].xy = (x, y) in normalized space (x in [0, aspect], y in [-0.3, 1.3])
//   uBlobs[i].z  = radius (normalized to screen height units)
//   uBlobs[i].w  = fade weight in [0, 1] (0 = invisible, 1 = full contribution)
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform int uCount;
uniform vec4 uBlobs[${MAX_BLOBS}];
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

  float d = 1e9;
  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    if (i >= uCount) break;
    vec4 b = uBlobs[i];
    // Effective radius scaled by fade weight -- as fade goes to 0 the blob
    // shrinks out rather than disappearing abruptly. Clamp to a tiny floor
    // so zero-weight blobs contribute nothing meaningful.
    float r = b.z * b.w;
    if (r < 0.001) continue;
    vec2 q = p - b.xy;
    float di = length(q) - r;
    d = smin(d, di, 0.12);
  }

  float field = 1.0 - smoothstep(-0.02, 0.06, d);
  float core = 1.0 - smoothstep(-0.18, 0.02, d);
  // Vertical gradient across the hot color ramp so the rise direction reads.
  float vgrad = clamp(uv.y, 0.0, 1.0);
  vec3 hot = mix(uColA, uColB, smoothstep(0.0, 1.0, core));
  hot = mix(hot, uColC, smoothstep(0.3, 1.0, vgrad));
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

// y-range over which we travel. Blobs spawn below 0 and exit above 1, so the
// fade-in/out windows sit fully on-screen and spawn/despawn is invisible.
const Y_MIN = -0.25;
const Y_MAX = 1.25;
const Y_SPAN = Y_MAX - Y_MIN;
// Fade windows sit entirely off-screen so blobs cross the visible edge at
// full weight -- the top of a blob can peek up from below at partial weight
// as its center rises through [Y_MIN, 0], giving a natural "emerging from
// below" read instead of a pop-in.
const FADE_IN_END = 0.0;    // fully opaque once center reaches the bottom edge
const FADE_OUT_START = 1.0; // fading begins only after center exits the top

/** @type {import("../base.js").FxModule} */
export default {
  id: "lava-metaballs",
  label: "Lava Lamp",
  category: "lava",
  params: {
    count: { type: "number", default: 10, min: 5, max: MAX_BLOBS, step: 1, label: "Blob Count" },
    size: { type: "number", default: 0.3, min: 0.05, max: 0.5, step: 0.01, label: "Size" },
    speed: { type: "number", default: 0.2, min: 0.0, max: 2.0, step: 0.05, label: "Rise Speed" },
    shapeVariance: { type: "number", default: 0.5, min: 0.0, max: 1.0, step: 0.01, label: "Wobble" },
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

    // Per-blob static state. All initial values come from the seeded RNG so
    // the effect is deterministic for a given seed.
    //   homeX:       base horizontal position in [0, 1]
    //   phase:       initial position along the Y_SPAN cycle in [0, 1)
    //   speedMul:    per-blob rise-speed multiplier (varies flow)
    //   radiusMul:   per-blob radius multiplier (varies blob sizes)
    //   wobbleAmp:   per-blob horizontal wobble amplitude
    //   wobbleFreq:  per-blob horizontal wobble frequency (rad/sec)
    //   wobblePhase: per-blob horizontal wobble phase offset
    const homeX = new Float32Array(MAX_BLOBS);
    const phase = new Float32Array(MAX_BLOBS);
    const speedMul = new Float32Array(MAX_BLOBS);
    const radiusMul = new Float32Array(MAX_BLOBS);
    const wobbleAmp = new Float32Array(MAX_BLOBS);
    const wobbleFreq = new Float32Array(MAX_BLOBS);
    const wobblePhase = new Float32Array(MAX_BLOBS);

    for (let i = 0; i < MAX_BLOBS; i++) {
      homeX[i] = 0.1 + rng() * 0.8;
      phase[i] = rng();
      // Rise speed varies from 0.5x to 1.5x of the global `speed` param so
      // blobs visibly pass each other rather than marching in lockstep.
      speedMul[i] = 0.5 + rng() * 1.0;
      // Radius multiplier varies from 0.6x to 1.4x of the `size` param.
      radiusMul[i] = 0.6 + rng() * 0.8;
      wobbleAmp[i] = 0.02 + rng() * 0.05;
      wobbleFreq[i] = 0.4 + rng() * 0.9;
      wobblePhase[i] = rng() * Math.PI * 2;
    }

    // Packed uniform buffer: one vec4 per blob (see FRAG for layout).
    const packed = new Float32Array(MAX_BLOBS * 4);

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
      count: gl.getUniformLocation(prog, "uCount"),
      blobs: gl.getUniformLocation(prog, "uBlobs[0]"),
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
        const aspect = w / Math.max(1, h);
        const count = Math.max(5, Math.min(MAX_BLOBS, Math.round(params.count)));
        const riseBase = params.speed; // travels Y_SPAN * riseBase * speedMul per second
        const sizeBase = params.size;
        const wobbleScale = Math.max(0, Math.min(1, params.shapeVariance ?? 0.5));

        for (let i = 0; i < count; i++) {
          // Deterministic upward progress. Phase wraps in [0, 1); blob's
          // y walks monotonically upward, wrapping from Y_MAX back to Y_MIN.
          const prog01 = (phase[i] + time * riseBase * speedMul[i] * 0.15) % 1;
          const y = Y_MIN + prog01 * Y_SPAN;

          // Gentle horizontal wobble -- never enough to read as lateral drift.
          const wob = Math.sin(time * wobbleFreq[i] + wobblePhase[i]) * wobbleAmp[i] * wobbleScale;
          const x = (homeX[i] + wob) * aspect;

          // Fade-in from the bottom, fade-out at the top. Smoothstep on both
          // ends; between FADE_IN_END and FADE_OUT_START the blob is at full
          // weight. Using smoothstep on y (not prog01) so the fade happens
          // relative to the visible window regardless of phase.
          // Fade ramps span the off-screen overshoot: weight grows across
          // y in [Y_MIN, FADE_IN_END] and decays across [FADE_OUT_START, Y_MAX].
          let fadeIn;
          if (y <= Y_MIN) fadeIn = 0;
          else if (y >= FADE_IN_END) fadeIn = 1;
          else {
            const t = (y - Y_MIN) / (FADE_IN_END - Y_MIN);
            fadeIn = t * t * (3 - 2 * t);
          }
          let fadeOut;
          if (y >= Y_MAX) fadeOut = 0;
          else if (y <= FADE_OUT_START) fadeOut = 1;
          else {
            const t = 1 - (y - FADE_OUT_START) / (Y_MAX - FADE_OUT_START);
            fadeOut = t * t * (3 - 2 * t);
          }
          const weight = fadeIn * fadeOut;

          const radius = sizeBase * radiusMul[i];

          packed[i * 4 + 0] = x;
          packed[i * 4 + 1] = y;
          packed[i * 4 + 2] = radius;
          packed[i * 4 + 3] = weight;
        }
        // Zero out unused slots so stale values don't leak through the loop.
        for (let i = count; i < MAX_BLOBS; i++) {
          packed[i * 4 + 0] = 0;
          packed[i * 4 + 1] = 0;
          packed[i * 4 + 2] = 0;
          packed[i * 4 + 3] = 0;
        }

        gl.useProgram(prog);
        gl.uniform2f(u.res, w, h);
        gl.uniform1i(u.count, count);
        gl.uniform4fv(u.blobs, packed);
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
