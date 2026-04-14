import { makeRng } from "../base.js";

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hash2(ix, iy, seed) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + seed * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const xf = x - x0, yf = y - y0;
  const u = smooth(xf), v = smooth(yf);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "flow-field",
  label: "Flow Field",
  category: "particles",
  params: {
    count: { type: "number", default: 10000, min: 500, max: 20000, step: 500, label: "Particles" },
    trail: { type: "number", default: 0.04, min: 0.005, max: 0.2, step: 0.005, label: "Trail Fade" },
    noiseScale: { type: "number", default: 0.0025, min: 0.0005, max: 0.01, step: 0.0005, label: "Noise Scale" },
    speed: { type: "number", default: 60, min: 5, max: 200, step: 5, label: "Speed" },
    fg: { type: "color", default: "#f5e8c7", label: "Foreground" },
    bg: { type: "color", default: "#0b0a14", label: "Background" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("flow-field: 2d context unavailable");

    const rng = makeRng(seed);
    const noiseSeed = Math.floor(rng() * 1e9);
    const noiseOffsetX = rng() * 1000;
    const noiseOffsetY = rng() * 1000;

    const CAP = 20000;
    const positions = new Float32Array(CAP * 2);
    let currentCount = 0;
    let width = canvas.width, height = canvas.height;

    function seedParticles(n) {
      for (let i = 0; i < n; i++) {
        positions[i * 2] = rng() * width;
        positions[i * 2 + 1] = rng() * height;
      }
      currentCount = n;
    }
    seedParticles(Math.min(CAP, Math.max(1, Math.floor(params.count))));

    const bg0 = hexToRgb(params.bg);
    g.fillStyle = `rgb(${bg0[0]},${bg0[1]},${bg0[2]})`;
    g.fillRect(0, 0, width, height);

    return {
      update(dt, time) {
        const desired = Math.min(CAP, Math.max(1, Math.floor(params.count)));
        if (desired !== currentCount) seedParticles(desired);

        const scale = params.noiseScale;
        const speed = params.speed;
        const step = Math.min(dt, 0.05);
        const tz = time * 0.15;
        const nSeed = noiseSeed;
        const ox = noiseOffsetX, oy = noiseOffsetY;
        const w = width, h = height;

        for (let i = 0; i < currentCount; i++) {
          const ix = i * 2;
          let x = positions[ix];
          let y = positions[ix + 1];
          const angle = valueNoise(x * scale + ox + tz, y * scale + oy, nSeed) * Math.PI * 4.0;
          x += Math.cos(angle) * speed * step;
          y += Math.sin(angle) * speed * step;
          if (x < 0) x += w; else if (x >= w) x -= w;
          if (y < 0) y += h; else if (y >= h) y -= h;
          positions[ix] = x;
          positions[ix + 1] = y;
        }

        const bg = hexToRgb(params.bg);
        g.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${params.trail})`;
        g.fillRect(0, 0, w, h);

        const fg = hexToRgb(params.fg);
        g.fillStyle = `rgb(${fg[0]},${fg[1]},${fg[2]})`;
        for (let i = 0; i < currentCount; i++) {
          const ix = i * 2;
          g.fillRect(positions[ix] | 0, positions[ix + 1] | 0, 1, 1);
        }
      },
      resize(w, h) {
        width = w;
        height = h;
        seedParticles(currentCount);
        const c = hexToRgb(params.bg);
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        g.fillRect(0, 0, w, h);
      },
      dispose() {},
    };
  },
};
