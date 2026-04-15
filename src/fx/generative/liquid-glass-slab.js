import { makeRng } from "../base.js";

const MAX_COLORS = 6;
const MAX_CARDS = 8;

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Fragment shader: edge-rich backdrop + SDF slab + edge-concentrated refraction
// + pow(edge,10) rim lip + per-channel chromatic offset + dual-scale specular
// + rim highlight / inner shadow on opposing edges.
const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_res;
uniform float u_time;
uniform int u_paletteCount;
uniform vec3 u_palette[${MAX_COLORS}];
uniform int u_cardCount;
// per-card: x=yPos, y=halfWidth, z=halfHeight, w=speed
uniform vec4 u_cardA[${MAX_CARDS}];
// per-card: x=phase, y=fillIdx, z=borderIdx, w=stripeFlag (0/1)
uniform vec4 u_cardB[${MAX_CARDS}];

uniform vec2 u_slabCenter;    // in aspect-space (x scaled by aspect)
uniform vec2 u_slabHalf;      // half-size in aspect-space
uniform float u_slabRadius;   // corner radius
uniform float u_refraction;   // 0.005–0.04
uniform float u_bevelDepth;   // 0.02–0.2
uniform float u_bevelWidth;   // in aspect-space units; fraction of min(res)
uniform float u_chroma;       // 0–0.08
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

// Gaussian color center field: wide low-frequency "wallpaper" base.
vec3 wallpaper(vec2 uv) {
  float t = u_time * 0.03;
  // four drifting centers
  vec2 c0 = vec2(0.2 + 0.15 * sin(t * 0.7), 0.3 + 0.12 * cos(t * 0.9));
  vec2 c1 = vec2(0.8 + 0.13 * cos(t * 0.6 + 1.7), 0.25 + 0.1 * sin(t * 0.8));
  vec2 c2 = vec2(0.25 + 0.14 * sin(t * 0.5 + 2.1), 0.75 + 0.11 * cos(t * 0.4));
  vec2 c3 = vec2(0.75 + 0.12 * cos(t * 0.8 + 0.7), 0.72 + 0.13 * sin(t * 0.6 + 3.1));

  float s = 0.35; // gaussian sigma
  float w0 = exp(-dot(uv - c0, uv - c0) / (s * s));
  float w1 = exp(-dot(uv - c1, uv - c1) / (s * s));
  float w2 = exp(-dot(uv - c2, uv - c2) / (s * s));
  float w3 = exp(-dot(uv - c3, uv - c3) / (s * s));
  float wsum = w0 + w1 + w2 + w3 + 1e-5;

  vec3 col = (paletteAt(0) * w0 + paletteAt(1) * w1
           + paletteAt(2) * w2 + paletteAt(3) * w3) / wsum;
  // deepen slightly for contrast against cards
  return col * 0.55;
}

// One card's contribution. Returns premultiplied rgba contribution.
// p is in UV space [0,1]^2 (y goes up).
vec4 drawCard(int i, vec2 uv) {
  vec4 A = u_cardA[0];
  vec4 B = u_cardB[0];
  // select card i via loop (uniform array dynamic indexing safety)
  for (int k = 0; k < ${MAX_CARDS}; k++) {
    if (k == i) { A = u_cardA[k]; B = u_cardB[k]; }
  }
  float yCenter = A.x;
  float hw = A.y;
  float hh = A.z;
  float speed = A.w;
  float phase = B.x;
  int fillIdx = int(B.y + 0.5);
  int borderIdx = int(B.z + 0.5);
  float stripeFlag = B.w;

  // Scroll horizontally; wrap with padding so cards cycle across the screen.
  float span = 1.0 + 2.0 * hw;
  float x = mod(phase + u_time * speed, span) - hw;

  vec2 d = uv - vec2(x, yCenter);
  vec2 q = abs(d) - vec2(hw, hh);
  float inside = max(q.x, q.y);
  if (inside > 0.004) return vec4(0.0);

  vec3 fill = paletteAt(fillIdx);
  vec3 border = paletteAt(borderIdx);

  float alpha = smoothstep(0.002, -0.002, inside);
  // thin border band
  float borderBand = smoothstep(-0.006, -0.002, inside) * (1.0 - smoothstep(-0.002, 0.002, inside));
  vec3 col = mix(fill * 0.9, border, borderBand);

  // Optional horizontal stripes (high-frequency text-like detail)
  if (stripeFlag > 0.5) {
    // use local coords relative to card left edge
    float ly = (uv.y - (yCenter - hh));
    // several stripe rows
    float stripe = step(0.35, fract(ly * 14.0));
    // mask out edges of card to keep stripes inset
    float pad = 0.012;
    float innerMask = smoothstep(-pad - 0.002, -pad, inside);
    col = mix(col, border * 0.8 + fill * 0.2, stripe * innerMask * 0.7);
  }

  return vec4(col, alpha);
}

vec3 backdrop(vec2 uv) {
  vec3 col = wallpaper(uv);
  // cards, painted in order (later cards on top).
  for (int i = 0; i < ${MAX_CARDS}; i++) {
    if (i >= u_cardCount) break;
    vec4 c = drawCard(i, uv);
    col = mix(col, c.rgb, c.a);
  }
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

  // Chromatic dispersion: per-channel scaled offset.
  vec2 offR = sampleOffsetUV * (1.0 + u_chroma);
  vec2 offG = sampleOffsetUV;
  vec2 offB = sampleOffsetUV * (1.0 - u_chroma);

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

  float broad = pow(max(0.0, dot(N, L3)), 2.0) * 0.25;
  float tight = pow(max(0.0, dot(N, H)), 20.0) * 1.0;

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
    chroma: { type: "number", default: 0.03, min: 0, max: 0.08, step: 0.005, label: "Chromatic Dispersion" },
    cardCount: { type: "number", default: 5, min: 3, max: MAX_CARDS, step: 1, label: "Backdrop Cards" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("liquid-glass-slab: webgl2 unavailable");

    const rng = makeRng(seed);

    // Slab ambient-path params.
    const slabPhaseX = rng() * Math.PI * 2;
    const slabPhaseY = rng() * Math.PI * 2;
    const slabFreqX = 0.07 + rng() * 0.05;
    const slabFreqY = 0.05 + rng() * 0.05;

    // Card data (yPos, hw, hh, speed, phase, fillIdx, borderIdx, stripeFlag).
    const cardA = new Float32Array(MAX_CARDS * 4);
    const cardB = new Float32Array(MAX_CARDS * 4);
    for (let i = 0; i < MAX_CARDS; i++) {
      const y = 0.1 + rng() * 0.8;
      const hw = 0.08 + rng() * 0.18;
      const hh = 0.05 + rng() * 0.12;
      // Different speeds per row for parallax. Half go right, half left.
      const dir = rng() < 0.5 ? 1 : -1;
      const speed = dir * (0.01 + rng() * 0.04);
      const phase = rng();
      const fillIdx = Math.floor(rng() * MAX_COLORS);
      const borderIdx = (fillIdx + 1 + Math.floor(rng() * (MAX_COLORS - 1))) % MAX_COLORS;
      const stripeFlag = rng() < 0.35 ? 1 : 0;

      cardA[i * 4 + 0] = y;
      cardA[i * 4 + 1] = hw;
      cardA[i * 4 + 2] = hh;
      cardA[i * 4 + 3] = speed;
      cardB[i * 4 + 0] = phase;
      cardB[i * 4 + 1] = fillIdx;
      cardB[i * 4 + 2] = borderIdx;
      cardB[i * 4 + 3] = stripeFlag;
    }

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
      cardCount: gl.getUniformLocation(prog, "u_cardCount"),
      cardA: gl.getUniformLocation(prog, "u_cardA"),
      cardB: gl.getUniformLocation(prog, "u_cardB"),
      slabCenter: gl.getUniformLocation(prog, "u_slabCenter"),
      slabHalf: gl.getUniformLocation(prog, "u_slabHalf"),
      slabRadius: gl.getUniformLocation(prog, "u_slabRadius"),
      refraction: gl.getUniformLocation(prog, "u_refraction"),
      bevelDepth: gl.getUniformLocation(prog, "u_bevelDepth"),
      bevelWidth: gl.getUniformLocation(prog, "u_bevelWidth"),
      chroma: gl.getUniformLocation(prog, "u_chroma"),
      lightDir: gl.getUniformLocation(prog, "u_lightDir"),
    };

    let w = canvas.width;
    let h = canvas.height;
    gl.viewport(0, 0, w, h);

    const paletteBuf = new Float32Array(MAX_COLORS * 3);

    return {
      update(_dt, time) {
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

        // Ambient drift path.
        const cx = aspect * 0.5 + Math.sin(time * slabFreqX + slabPhaseX) * (aspect * 0.18);
        const cy = 0.5 + Math.cos(time * slabFreqY + slabPhaseY) * 0.15;

        // Light direction drifts slowly.
        const lAng = time * 0.08 + 0.6;
        const lx = Math.cos(lAng);
        const ly = Math.sin(lAng);

        // Bevel width: fraction of min viewport dim, in aspect-space units.
        // Scale ~ 0.04 of min dim gave good visibility in testing.
        const minDim = Math.min(aspect, 1.0);
        const bevelWidth = 0.06 * minDim;

        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.time, time);
        gl.uniform1i(u.paletteCount, pCount);
        gl.uniform3fv(u.palette, paletteBuf);
        gl.uniform1i(
          u.cardCount,
          Math.max(3, Math.min(MAX_CARDS, Math.round(params.cardCount ?? 5))),
        );
        gl.uniform4fv(u.cardA, cardA);
        gl.uniform4fv(u.cardB, cardB);
        gl.uniform2f(u.slabCenter, cx, cy);
        gl.uniform2f(u.slabHalf, hw, hh);
        gl.uniform1f(u.slabRadius, radius);
        gl.uniform1f(u.refraction, params.refraction ?? 0.015);
        gl.uniform1f(u.bevelDepth, params.bevelDepth ?? 0.08);
        gl.uniform1f(u.bevelWidth, bevelWidth);
        gl.uniform1f(u.chroma, params.chroma ?? 0.03);
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
