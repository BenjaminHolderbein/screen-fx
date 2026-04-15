import { makeRng } from "../base.js";

const MAX_TILES = 6;
const MAX_COLORS = 6;

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_res;
uniform float u_time;
uniform int u_tileCount;
uniform int u_paletteCount;
uniform vec3 u_palette[${MAX_COLORS}];
uniform vec4 u_tileSeed[${MAX_TILES}];
uniform float u_thickness;
uniform float u_morph;
uniform float u_highlight;

vec3 paletteSample(float t) {
  float n = float(u_paletteCount);
  float x = fract(t) * n;
  int i0 = int(floor(x)) % u_paletteCount;
  int i1 = (i0 + 1) % u_paletteCount;
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(u_palette[i0], u_palette[i1], f);
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash2(i), f);
  float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.5 + 0.5;
}

vec3 backdrop(vec2 uv) {
  float t = u_time * 0.05;
  float n1 = vnoise(uv * 1.6 + vec2(t, -t * 0.7));
  float n2 = vnoise(uv * 2.8 - vec2(t * 0.6, t));
  float n3 = vnoise(uv * 0.9 + vec2(-t * 0.3, t * 0.4));
  vec3 a = paletteSample(n1 + t * 0.15);
  vec3 b = paletteSample(n2 * 1.3 + 0.37 + t * 0.1);
  vec3 c = paletteSample(n3 * 0.8 + 0.71);
  vec3 col = mix(a, b, smoothstep(0.2, 0.8, n2));
  col = mix(col, c, smoothstep(0.3, 0.9, n3 * n1));
  float bands = 0.5 + 0.5 * sin(uv.x * 3.2 + uv.y * 2.1 + t * 2.0);
  col *= 0.85 + 0.25 * bands;
  return col;
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdCapsule(vec2 p, vec2 b, float r) {
  float w = max(b.x - b.y, 0.0);
  vec2 q = p;
  q.x -= clamp(q.x, -w, w);
  return length(q) - (b.y + r * 0.0);
}

struct Tile {
  vec2 center;
  vec2 hsize;
  float radius;
  float rot;
  float lightAng;
  float tintIdx;
};

Tile makeTile(int i, float aspect) {
  vec4 s = u_tileSeed[i];
  float t = u_time;
  float phaseX = s.x * 6.2831853;
  float phaseY = s.y * 6.2831853;
  float fx = 0.12 + s.z * 0.18;
  float fy = 0.09 + s.w * 0.16;
  float cx = 0.5 + sin(t * fx + phaseX) * (0.28 + s.z * 0.1);
  float cy = 0.5 + cos(t * fy + phaseY) * (0.24 + s.w * 0.1);
  float baseW = 0.18 + s.z * 0.17;
  float baseH = 0.11 + s.w * 0.11;
  float breathe = 1.0 + 0.06 * sin(t * 0.4 + phaseX);
  Tile tile;
  tile.center = vec2(cx * aspect, cy);
  tile.hsize = vec2(baseW, baseH) * breathe;
  tile.radius = min(tile.hsize.x, tile.hsize.y) * (0.55 + 0.4 * u_morph * (0.5 + 0.5 * sin(t * 0.25 + phaseY)));
  tile.rot = (s.x - 0.5) * 0.6 + sin(t * 0.08 + phaseX) * 0.15;
  tile.lightAng = t * 0.12 + s.y * 6.2831853;
  tile.tintIdx = s.x;
  return tile;
}

float tileSDF(Tile tile, vec2 p, out vec2 local) {
  float ca = cos(tile.rot);
  float sa = sin(tile.rot);
  vec2 q = p - tile.center;
  q = mat2(ca, -sa, sa, ca) * q;
  local = q;
  float rb = sdRoundBox(q, tile.hsize, tile.radius);
  float cap = sdCapsule(q, tile.hsize, 0.0);
  float m = smoothstep(0.0, 1.0, u_morph);
  return mix(rb, cap, m * 0.75);
}

vec2 gradSDF(Tile tile, vec2 p) {
  vec2 eps = vec2(0.0015, 0.0);
  vec2 l;
  float dx = tileSDF(tile, p + eps.xy, l) - tileSDF(tile, p - eps.xy, l);
  float dy = tileSDF(tile, p + eps.yx, l) - tileSDF(tile, p - eps.yx, l);
  return normalize(vec2(dx, dy) + 1e-6);
}

void main() {
  vec2 fragUV = gl_FragCoord.xy / u_res.xy;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(fragUV.x * aspect, fragUV.y);

  vec3 bg = backdrop(vec2(fragUV.x, fragUV.y) * 1.2);

  vec3 col = bg;
  float topZ = -1.0;
  int topTile = -1;
  float topSDF = 0.0;

  for (int i = 0; i < ${MAX_TILES}; i++) {
    if (i >= u_tileCount) break;
    Tile tile = makeTile(i, aspect);
    vec2 local;
    float d = tileSDF(tile, p, local);
    if (d < 0.0) {
      float z = float(i);
      if (z > topZ) { topZ = z; topTile = i; topSDF = d; }
    }
  }

  if (topTile >= 0) {
    Tile tile = makeTile(topTile, aspect);
    vec2 local;
    float d = tileSDF(tile, p, local);
    float rimProx = 1.0 - smoothstep(0.0, max(tile.hsize.x, tile.hsize.y), -d);
    vec2 g = gradSDF(tile, p);

    float bendBase = 0.06 * u_thickness;
    float bend = bendBase * (0.3 + 0.7 * rimProx);
    vec2 pinch = -local * 0.08 * u_thickness * (1.0 - rimProx * 0.6);
    vec2 refractUV = fragUV + (-g * bend + pinch) / vec2(aspect, 1.0);

    float chroma = 0.012 * u_thickness * (0.2 + rimProx);
    vec3 refracted;
    refracted.r = backdrop(vec2((refractUV.x - g.x * chroma) * 1.2, refractUV.y * 1.2)).r;
    refracted.g = backdrop(vec2(refractUV.x * 1.2, refractUV.y * 1.2)).g;
    refracted.b = backdrop(vec2((refractUV.x + g.x * chroma) * 1.2, (refractUV.y + g.y * chroma) * 1.2)).b;

    vec3 tint = paletteSample(tile.tintIdx);
    refracted = mix(refracted, refracted * (0.7 + 0.6 * tint), 0.18);

    vec2 lightDir = vec2(cos(tile.lightAng), sin(tile.lightAng));
    float rimBand = smoothstep(-0.006, 0.0, d) * (1.0 - smoothstep(0.0, 0.012, d));
    float rimLight = rimBand * max(dot(g, lightDir), 0.0);
    float rimLightSoft = rimBand * pow(max(dot(g, lightDir), 0.0), 3.0);

    float shadowBand = smoothstep(-0.04, -0.005, d) * (1.0 - smoothstep(-0.005, 0.0, d));
    float shadowSide = max(-dot(g, lightDir), 0.0);
    float innerShadow = shadowBand * shadowSide * u_thickness;

    col = refracted;
    col += vec3(1.0) * rimLightSoft * (0.9 * u_highlight);
    col += vec3(1.0) * rimLight * (0.35 * u_highlight);
    col -= vec3(0.15, 0.12, 0.18) * innerShadow;

    float outerShadow = 0.0;
    for (int j = 0; j < ${MAX_TILES}; j++) {
      if (j >= u_tileCount) break;
      if (j == topTile) continue;
      Tile tj = makeTile(j, aspect);
      vec2 lj;
      float dj = tileSDF(tj, p, lj);
      if (dj > 0.0) {
        outerShadow += exp(-dj * 28.0) * step(float(j), float(topTile));
      }
    }
    col *= 1.0 - min(outerShadow * 0.35 * u_thickness, 0.5);
  } else {
    float outerShadow = 0.0;
    for (int i = 0; i < ${MAX_TILES}; i++) {
      if (i >= u_tileCount) break;
      Tile tile = makeTile(i, aspect);
      vec2 local;
      float d = tileSDF(tile, p, local);
      if (d > 0.0) outerShadow += exp(-d * 30.0);
    }
    col *= 1.0 - min(outerShadow * 0.55 * u_thickness, 0.6);
  }

  col = pow(max(col, 0.0), vec3(0.95));
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
    throw new Error("liquid-glass-lenses shader: " + log);
  }
  return sh;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "liquid-glass-lenses",
  label: "Liquid Glass · Lenses",
  category: "generative",
  params: {
    palette: {
      type: "colorArray",
      default: ["#ff7eb6", "#7afcff", "#ffeb70", "#b388ff"],
      min: 2,
      max: MAX_COLORS,
      label: "Palette",
    },
    tileCount: { type: "number", default: 4, min: 2, max: MAX_TILES, step: 1, label: "Lens Count" },
    thickness: { type: "number", default: 0.6, min: 0.2, max: 1.5, step: 0.05, label: "Thickness" },
    drift: { type: "number", default: 0.5, min: 0, max: 2, step: 0.05, label: "Drift Speed" },
    morph: { type: "number", default: 0.4, min: 0, max: 1, step: 0.05, label: "Shape Morph" },
    highlightIntensity: { type: "number", default: 0.8, min: 0, max: 1.5, step: 0.05, label: "Highlight" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("liquid-glass-lenses: webgl2 unavailable");

    const rng = makeRng(seed);
    const tileSeed = new Float32Array(MAX_TILES * 4);
    for (let i = 0; i < MAX_TILES; i++) {
      tileSeed[i * 4 + 0] = rng();
      tileSeed[i * 4 + 1] = rng();
      tileSeed[i * 4 + 2] = rng();
      tileSeed[i * 4 + 3] = rng();
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("liquid-glass-lenses link: " + gl.getProgramInfoLog(prog));
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
      tileCount: gl.getUniformLocation(prog, "u_tileCount"),
      paletteCount: gl.getUniformLocation(prog, "u_paletteCount"),
      palette: gl.getUniformLocation(prog, "u_palette"),
      tileSeed: gl.getUniformLocation(prog, "u_tileSeed"),
      thickness: gl.getUniformLocation(prog, "u_thickness"),
      morph: gl.getUniformLocation(prog, "u_morph"),
      highlight: gl.getUniformLocation(prog, "u_highlight"),
    };

    let w = canvas.width;
    let h = canvas.height;
    gl.viewport(0, 0, w, h);

    const paletteBuf = new Float32Array(MAX_COLORS * 3);
    let driftTime = 0;
    let lastTime = 0;

    return {
      update(_dt, time) {
        const dt = Math.max(0, Math.min(0.1, time - lastTime));
        lastTime = time;
        driftTime += dt * (params.drift ?? 0.5);

        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        const palette = Array.isArray(params.palette) ? params.palette : [];
        const pCount = Math.max(2, Math.min(MAX_COLORS, palette.length));
        for (let i = 0; i < pCount; i++) {
          const rgb = hexToRgb(palette[i]);
          paletteBuf[i * 3] = rgb[0];
          paletteBuf[i * 3 + 1] = rgb[1];
          paletteBuf[i * 3 + 2] = rgb[2];
        }

        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.time, driftTime);
        gl.uniform1i(u.tileCount, Math.max(2, Math.min(MAX_TILES, Math.round(params.tileCount ?? 4))));
        gl.uniform1i(u.paletteCount, pCount);
        gl.uniform3fv(u.palette, paletteBuf);
        gl.uniform4fv(u.tileSeed, tileSeed);
        gl.uniform1f(u.thickness, params.thickness ?? 0.6);
        gl.uniform1f(u.morph, params.morph ?? 0.4);
        gl.uniform1f(u.highlight, params.highlightIntensity ?? 0.8);

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
