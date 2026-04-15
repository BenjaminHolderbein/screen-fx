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

function vnoise(x, y, seed) {
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

function noise3(x, y, z, seed) {
  const z0 = Math.floor(z);
  const zf = z - z0;
  const w = smooth(zf);
  const a = vnoise(x, y, seed ^ (z0 * 15485863));
  const b = vnoise(x, y, seed ^ ((z0 + 1) * 15485863));
  return a + (b - a) * w;
}

function makeSprite(rgb) {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return c;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.8)`);
  grd.addColorStop(0.3, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.2)`);
  grd.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/** @type {import("../base.js").FxModule} */
export default {
  id: "curl-noise-fluid",
  label: "Curl Noise Fluid",
  category: "lava",
  params: {
    intensity: { type: "number", default: 0.8, min: 0.1, max: 2, step: 0.05, label: "Intensity" },
    scale: { type: "number", default: 1.5, min: 0.5, max: 4, step: 0.05, label: "Noise Scale" },
    speed: { type: "number", default: 0.8, min: 0, max: 3, step: 0.05, label: "Speed" },
    diffusion: { type: "number", default: 0.4, min: 0, max: 1, step: 0.01, label: "Diffusion" },
    dyeColor: { type: "color", default: "#ff5599", label: "Dye Color" },
    background: { type: "color", default: "#0a0018", label: "Background" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("curl-noise-fluid: 2d context unavailable");

    const rng = makeRng(seed);
    const nSeed = Math.floor(rng() * 1e9);
    const ox = rng() * 1000;
    const oy = rng() * 1000;

    const COUNT = 600;
    const px = new Float32Array(COUNT);
    const py = new Float32Array(COUNT);
    const pLife = new Float32Array(COUNT);
    const pMax = new Float32Array(COUNT);
    const pSize = new Float32Array(COUNT);

    let width = canvas.width, height = canvas.height;
    let lastDye = params.dyeColor;
    let sprite = makeSprite(hexToRgb(lastDye));

    function respawn(i) {
      const cx = width * (0.25 + rng() * 0.5);
      const cy = height * (0.3 + rng() * 0.4);
      const r = Math.min(width, height) * 0.18 * Math.sqrt(rng());
      const a = rng() * Math.PI * 2;
      px[i] = cx + Math.cos(a) * r;
      py[i] = cy + Math.sin(a) * r;
      pLife[i] = 0;
      pMax[i] = 3 + rng() * 4;
      pSize[i] = 20 + rng() * 60;
    }

    for (let i = 0; i < COUNT; i++) {
      respawn(i);
      pLife[i] = rng() * pMax[i];
    }

    const bg0 = hexToRgb(params.background);
    g.fillStyle = `rgb(${bg0[0]},${bg0[1]},${bg0[2]})`;
    g.fillRect(0, 0, width, height);

    function curl(x, y, t, s) {
      const e = 1.0;
      const nx = x * s * 0.003 + ox;
      const ny = y * s * 0.003 + oy;
      const n1 = noise3(nx, ny + e * 0.003, t, nSeed);
      const n2 = noise3(nx, ny - e * 0.003, t, nSeed);
      const n3 = noise3(nx + e * 0.003, ny, t, nSeed);
      const n4 = noise3(nx - e * 0.003, ny, t, nSeed);
      return [(n1 - n2) / (2 * e), -(n3 - n4) / (2 * e)];
    }

    return {
      update(dt, time) {
        const step = Math.min(dt, 0.05);
        const bg = hexToRgb(params.background);
        const diff = params.diffusion;
        const fade = 0.02 + diff * 0.22;
        g.globalCompositeOperation = "source-over";
        g.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${fade})`;
        g.fillRect(0, 0, width, height);

        if (params.dyeColor !== lastDye) {
          lastDye = params.dyeColor;
          sprite = makeSprite(hexToRgb(lastDye));
        }

        const s = params.scale;
        const spd = params.speed;
        const t = time * 0.3;
        const vel = 90 * spd;

        for (let i = 0; i < COUNT; i++) {
          const [vx, vy] = curl(px[i], py[i], t, s);
          const mag = Math.hypot(vx, vy) + 1e-6;
          px[i] += (vx / mag) * vel * step;
          py[i] += (vy / mag) * vel * step;
          pLife[i] += step;
          if (pLife[i] > pMax[i] || px[i] < -80 || px[i] > width + 80 || py[i] < -80 || py[i] > height + 80) {
            respawn(i);
          }
        }

        g.globalCompositeOperation = "lighter";
        const alpha = 0.02 + 0.06 * params.intensity;
        g.globalAlpha = alpha;
        const diffScale = 1 + diff * 1.5;
        for (let i = 0; i < COUNT; i++) {
          const age = pLife[i] / pMax[i];
          const envelope = Math.sin(age * Math.PI);
          const sz = pSize[i] * diffScale * (0.6 + envelope * 0.8);
          g.drawImage(sprite, px[i] - sz / 2, py[i] - sz / 2, sz, sz);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      },
      resize(w, h) {
        width = w;
        height = h;
        for (let i = 0; i < COUNT; i++) respawn(i);
        const c = hexToRgb(params.background);
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        g.fillRect(0, 0, w, h);
      },
      dispose() {},
    };
  },
};
