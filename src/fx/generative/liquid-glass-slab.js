import { makeRng } from "../base.js";

const MAX_COLORS = 6;

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Fragment shader: churning oil-spill iridescence backdrop + SDF slab
// + edge-concentrated refraction + pow(edge,10) rim lip + per-channel chromatic
// offset + dual-scale specular + rim highlight / inner shadow on opposing edges.
const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_res;
uniform float u_time;
uniform int u_paletteCount;
uniform vec3 u_palette[${MAX_COLORS}];

uniform vec2 u_slabCenter;    // in aspect-space (x scaled by aspect)
uniform vec2 u_slabHalf;      // half-size in aspect-space
uniform float u_slabRadius;   // corner radius
uniform float u_refraction;   // 0.005–0.04
uniform float u_bevelDepth;   // 0.02–0.2
uniform float u_bevelWidth;   // in aspect-space units; fraction of min(res)
uniform float u_chroma;       // 0–0.15
uniform float u_chromaPower;  // non-linear distribution of chroma across the bevel
uniform float u_bgScale;      // backdrop scale multiplier (0.3–3, 1 = default)
uniform float u_bgSpeed;      // backdrop time multiplier (0–3, 1 = default)
uniform vec2 u_lightDir;      // unit vector

vec3 paletteAt(int i) {
  int idx = i % u_paletteCount;
  // manual indirect index (avoid dynamic index into uniform array on some GPUs)
  vec3 c = u_palette[0];
  for (int k = 0; k < ${MAX_COLORS}; k++) {
    if (k == idx) c = u_palette[k];
  }
  return c;
}

// signed distance to axis-aligned rounded box; positive outside
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// Cyclic iridescent palette sample: wraps end to start so the rainbow closes.
vec3 irid(float t) {
  t = fract(t);
  float scaled = t * float(u_paletteCount);
  int i0 = int(floor(scaled)) % u_paletteCount;
  int i1 = (i0 + 1) % u_paletteCount;
  float f = fract(scaled);
  return mix(paletteAt(i0), paletteAt(i1), f);
}

// Hash-based value noise; deterministic, no textures.
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    s += amp * vnoise(p);
    p = rot * p * 2.02;
    amp *= 0.5;
  }
  return s;
}

vec3 backdrop(vec2 uv) {
  // Work in a stretched space for flowing streaks. bgScale tunes density.
  vec2 p = uv * vec2(3.2, 2.4) * u_bgScale;
  float t = u_time * u_bgSpeed;

  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + t * 0.08),
    fbm(p + vec2(5.2, 1.3) - t * 0.11)
  );
  vec2 r = vec2(
    fbm(p + 3.6 * q + vec2(1.7, 9.2) + t * 0.05),
    fbm(p + 3.6 * q + vec2(8.3, 2.8) - t * 0.06)
  );

  float thickness = fbm(p + 4.5 * r + t * 0.03);
  // Secondary band term shifts hue across space for rainbow bands.
  float band = fbm(p * 0.6 + r * 2.0 - t * 0.02);
  float hue = thickness * 1.8 + band * 0.9;

  vec3 irc = irid(hue);

  // Swirl intensity mask: concentrate brightness where warp magnitude is high.
  float swirl = length(r - 0.5) * 2.0;
  float bloom = pow(clamp(swirl, 0.0, 1.0), 1.4);

  // Thin-film intensity: contrast-stretched thickness.
  float intens = pow(clamp(thickness, 0.0, 1.0), 1.8);

  // Edges between iridescence patches: gradient magnitude of hue via noise deriv.
  float e = 0.008;
  float gx = fbm(p + 4.5 * r + t * 0.03 + vec2(e, 0.0)) - thickness;
  float gy = fbm(p + 4.5 * r + t * 0.03 + vec2(0.0, e)) - thickness;
  float gmag = length(vec2(gx, gy)) / e;
  float edgeHi = smoothstep(0.6, 1.6, gmag);

  vec3 dark = vec3(0.015, 0.005, 0.03);
  vec3 col = mix(dark, irc, intens * (0.35 + 0.75 * bloom));

  // Bright iridescent peaks where swirl and thickness coincide.
  col += irc * pow(intens, 3.0) * bloom * 0.9;

  // Crisp edge highlights where swirl patches meet.
  col += irid(hue + 0.15) * edgeHi * 0.6;

  // Deep black pockets where thickness is low — this is the contrast anchor.
  float dim = smoothstep(0.45, 0.15, thickness);
  col *= 1.0 - dim * 0.85;

  return col;
}

void main() {
  vec2 fragUV = gl_FragCoord.xy / u_res.xy;
  float aspect = u_res.x / u_res.y;
  vec2 pAspect = vec2(fragUV.x * aspect, fragUV.y);

  // SDF: positive outside, negative inside (raw)
  float sdfRaw = sdRoundBox(pAspect - u_slabCenter, u_slabHalf, u_slabRadius);
  // positive inside the slab (per spec)
  float dInside = -sdfRaw;

  // bevel width in aspect-space units: fraction of min dimension
  float bevelPx = u_bevelWidth; // already in aspect-space units
  float edge = 1.0 - smoothstep(0.0, bevelPx, dInside);
  edge = clamp(edge, 0.0, 1.0);

  // radial direction from slab center (for offset)
  vec2 fromCenter = pAspect - u_slabCenter;
  float flen = length(fromCenter) + 1e-6;
  vec2 radial = fromCenter / flen;

  // Edge-concentrated refraction: linear term + tight lip.
  float offsetAmt = edge * u_refraction + pow(edge, 10.0) * u_bevelDepth;

  // offset is in aspect-space; convert to UV (un-scale x by aspect).
  vec2 offsetAspect = radial * offsetAmt;
  // push refracted UV INWARD from the edge: subtract offset (sample from inside).
  vec2 sampleOffsetUV = vec2(-offsetAspect.x / aspect, -offsetAspect.y);

  // Chromatic dispersion: per-channel scaled offset, concentrated at the rim.
  float chromaMask = pow(edge, u_chromaPower);
  float chromaAmt = u_chroma * chromaMask;
  vec2 offR = sampleOffsetUV * (1.0 + chromaAmt);
  vec2 offG = sampleOffsetUV;
  vec2 offB = sampleOffsetUV * (1.0 - chromaAmt);

  vec3 bg = backdrop(fragUV);

  // If we're inside the slab (dInside > 0), do refracted sampling; else plain backdrop.
  if (dInside <= 0.0) {
    outColor = vec4(bg, 1.0);
    return;
  }

  vec3 refracted;
  refracted.r = backdrop(fragUV + offR).r;
  refracted.g = backdrop(fragUV + offG).g;
  refracted.b = backdrop(fragUV + offB).b;

  // Normal estimate via SDF gradient (in aspect-space).
  vec2 eps = vec2(0.0018, 0.0);
  float sdx = sdRoundBox(pAspect + eps.xy - u_slabCenter, u_slabHalf, u_slabRadius)
            - sdRoundBox(pAspect - eps.xy - u_slabCenter, u_slabHalf, u_slabRadius);
  float sdy = sdRoundBox(pAspect + eps.yx - u_slabCenter, u_slabHalf, u_slabRadius)
            - sdRoundBox(pAspect - eps.yx - u_slabCenter, u_slabHalf, u_slabRadius);
  // gradient of the raw SDF points outward; we want outward normal.
  vec2 gradOut = normalize(vec2(sdx, sdy) + vec2(1e-6));

  // Light + half-vector (in 2D; treat view as +Z).
  vec2 L = normalize(u_lightDir);
  // view vector implicit +Z; half-vector in 2D ~= L normalized.
  // Use N dot L where N is the 2D outward normal magnitude bent by edge.
  // At the interior N tilts toward +Z; approximate with (1-edge) as Z component.
  float nz = 1.0 - edge * 0.9;
  vec3 N = normalize(vec3(gradOut * edge, nz));
  vec3 L3 = normalize(vec3(L, 0.35));
  vec3 V3 = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L3 + V3);

  // Tighter broad term: exponent 5 (was 2) keeps the lit side bright but crisper.
  float broad = pow(max(0.0, dot(N, L3)), 5.0) * 0.32;
  float tight = pow(max(0.0, dot(N, H)), 28.0) * 1.0;

  // Rim band 4-8px around the edge.
  float band = smoothstep(-0.006, 0.0, sdfRaw) * (1.0 - smoothstep(0.0, 0.012, sdfRaw));
  // rim light: edge facing light; inner shadow: edge facing away.
  float facing = dot(gradOut, L);
  float rim = band * max(facing, 0.0);
  float innerShadow = band * max(-facing, 0.0);

  // A tiny bluish tint, well under 5% of backdrop value.
  vec3 tint = vec3(0.92, 0.96, 1.02);
  vec3 col = refracted * tint;

  // specular highlights
  col += vec3(1.0) * (broad + tight);
  // rim lip bright line
  col += vec3(1.0) * rim * 0.8;
  // opposite-side inner shadow
  col -= vec3(0.08, 0.1, 0.14) * innerShadow;

  // Very subtle edge-concentrated brightening on the lip (reads as Fresnel).
  col += vec3(0.6, 0.7, 0.85) * pow(edge, 10.0) * 0.25;

  outColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex) {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("liquid-glass-slab shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "liquid-glass-slab",
  label: "Liquid Glass · Slab",
  category: "generative",
  params: {
    palette: {
      type: "colorArray",
      default: ["#1a3a5c", "#7ab4ff", "#ff7eb6", "#ffeb70"],
      min: 2,
      max: MAX_COLORS,
      label: "Palette",
    },
    slabSize: { type: "number", default: 0.4, min: 0.2, max: 0.6, step: 0.02, label: "Slab Size" },
    refraction: { type: "number", default: 0.015, min: 0.005, max: 0.04, step: 0.001, label: "Refraction" },
    bevelDepth: { type: "number", default: 0.08, min: 0.02, max: 0.2, step: 0.005, label: "Bevel Depth" },
    chroma: { type: "number", default: 0.06, min: 0, max: 0.15, step: 0.005, label: "Chromatic Dispersion" },
    chromaPower: { type: "number", default: 1.5, min: 0.5, max: 4, step: 0.1, label: "Chroma Power" },
    speed: { type: "number", default: 1.0, min: 0.1, max: 3, step: 0.05, label: "Speed" },
    bgScale: { type: "number", default: 1.0, min: 0.3, max: 3, step: 0.05, label: "Backdrop Scale" },
    bgSpeed: { type: "number", default: 1.0, min: 0, max: 3, step: 0.05, label: "Backdrop Speed" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("liquid-glass-slab: webgl2 unavailable");

    const rng = makeRng(seed);

    // DVD bounce state (in aspect-space; x ranges 0..aspect, y ranges 0..1).
    // Initialized lazily on first frame when aspect is known; seeded from rng().
    const bounce = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      inited: false,
      seedUX: rng(),
      seedUY: rng(),
      seedVang: rng(),
    };
    // Base speed in aspect-space units per second (~10–20s diagonal traversal).
    const BASE_SPEED = 0.12;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("liquid-glass-slab link: " + gl.getProgramInfoLog(prog));
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

    const u = {
      res: gl.getUniformLocation(prog, "u_res"),
      time: gl.getUniformLocation(prog, "u_time"),
      paletteCount: gl.getUniformLocation(prog, "u_paletteCount"),
      palette: gl.getUniformLocation(prog, "u_palette"),
      slabCenter: gl.getUniformLocation(prog, "u_slabCenter"),
      slabHalf: gl.getUniformLocation(prog, "u_slabHalf"),
      slabRadius: gl.getUniformLocation(prog, "u_slabRadius"),
      refraction: gl.getUniformLocation(prog, "u_refraction"),
      bevelDepth: gl.getUniformLocation(prog, "u_bevelDepth"),
      bevelWidth: gl.getUniformLocation(prog, "u_bevelWidth"),
      chroma: gl.getUniformLocation(prog, "u_chroma"),
      chromaPower: gl.getUniformLocation(prog, "u_chromaPower"),
      bgScale: gl.getUniformLocation(prog, "u_bgScale"),
      bgSpeed: gl.getUniformLocation(prog, "u_bgSpeed"),
      lightDir: gl.getUniformLocation(prog, "u_lightDir"),
    };

    let w = canvas.width;
    let h = canvas.height;
    gl.viewport(0, 0, w, h);

    const paletteBuf = new Float32Array(MAX_COLORS * 3);

    return {
      update(dt, time) {
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        const palette = Array.isArray(params.palette) ? params.palette : [];
        const pCount = Math.max(2, Math.min(MAX_COLORS, palette.length));
        for (let i = 0; i < MAX_COLORS; i++) {
          const rgb = hexToRgb(palette[i % pCount] || "#000000");
          paletteBuf[i * 3] = rgb[0];
          paletteBuf[i * 3 + 1] = rgb[1];
          paletteBuf[i * 3 + 2] = rgb[2];
        }

        const aspect = w / h;
        const slabSize = Math.max(0.2, Math.min(0.6, params.slabSize ?? 0.4));
        // Half-size in aspect-space. Slightly wider than tall (tile feel).
        const hw = slabSize * 0.75;
        const hh = slabSize * 0.5;
        const radius = Math.min(hw, hh) * 0.35;

        // DVD bounce bounds (slab edge must stay inside canvas).
        const minX = hw;
        const maxX = aspect - hw;
        const minY = hh;
        const maxY = 1.0 - hh;
        const speedMul = Math.max(0.1, Math.min(3, params.speed ?? 1.0));

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

        let hitX = false;
        let hitY = false;
        if (bounce.x < minX) { bounce.x = minX; bounce.vx = Math.abs(bounce.vx); hitX = true; }
        else if (bounce.x > maxX) { bounce.x = maxX; bounce.vx = -Math.abs(bounce.vx); hitX = true; }
        if (bounce.y < minY) { bounce.y = minY; bounce.vy = Math.abs(bounce.vy); hitY = true; }
        else if (bounce.y > maxY) { bounce.y = maxY; bounce.vy = -Math.abs(bounce.vy); hitY = true; }

        // Corner-nudge: ~12% of bounces, rotate velocity slightly toward the
        // nearest corner. Makes true corner hits plausible without scripting.
        if ((hitX || hitY) && rng() < 0.12) {
          const nearCornerX = bounce.x < (minX + maxX) * 0.5 ? minX : maxX;
          const nearCornerY = bounce.y < (minY + maxY) * 0.5 ? minY : maxY;
          const tx = nearCornerX - bounce.x;
          const ty = nearCornerY - bounce.y;
          const tlen = Math.hypot(tx, ty) + 1e-6;
          const dirX = tx / tlen;
          const dirY = ty / tlen;
          const blend = 0.18;
          const nvx = bounce.vx * (1 - blend) + dirX * BASE_SPEED * blend;
          const nvy = bounce.vy * (1 - blend) + dirY * BASE_SPEED * blend;
          const cur = Math.hypot(bounce.vx, bounce.vy) || BASE_SPEED;
          const nn = Math.hypot(nvx, nvy) || 1;
          bounce.vx = (nvx / nn) * cur;
          bounce.vy = (nvy / nn) * cur;
        }

        const cx = bounce.x;
        const cy = bounce.y;

        // Light direction drifts slowly.
        const lAng = time * 0.08 + 0.6;
        const lx = Math.cos(lAng);
        const ly = Math.sin(lAng);

        // Bevel width: fraction of min viewport dim, in aspect-space units.
        // 0.045 (was 0.06) — narrower band reads crisper.
        const minDim = Math.min(aspect, 1.0);
        const bevelWidth = 0.045 * minDim;

        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.time, time);
        gl.uniform1i(u.paletteCount, pCount);
        gl.uniform3fv(u.palette, paletteBuf);
        gl.uniform2f(u.slabCenter, cx, cy);
        gl.uniform2f(u.slabHalf, hw, hh);
        gl.uniform1f(u.slabRadius, radius);
        gl.uniform1f(u.refraction, params.refraction ?? 0.015);
        gl.uniform1f(u.bevelDepth, params.bevelDepth ?? 0.08);
        gl.uniform1f(u.bevelWidth, bevelWidth);
        gl.uniform1f(u.chroma, params.chroma ?? 0.06);
        gl.uniform1f(u.chromaPower, params.chromaPower ?? 1.5);
        gl.uniform1f(u.bgScale, Math.max(0.3, Math.min(3, params.bgScale ?? 1.0)));
        gl.uniform1f(u.bgSpeed, Math.max(0, Math.min(3, params.bgSpeed ?? 1.0)));
        gl.uniform2f(u.lightDir, lx, ly);

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
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      },
    };
  },
};
