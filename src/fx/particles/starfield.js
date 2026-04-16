import { makeRng } from "../base.js";

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const Z_FAR = 1.0;
const Z_NEAR = 0.01;
const FOCAL = 0.8;

/** @type {import("../base.js").FxModule} */
export default {
  id: "starfield",
  label: "Starfield",
  category: "particles",
  params: {
    count: { type: "number", default: 1500, min: 200, max: 5000, step: 50, label: "Stars" },
    speed: { type: "number", default: 1.0, min: 0, max: 10, step: 0.05, label: "Speed" },
    starSize: { type: "number", default: 1.2, min: 0.5, max: 3, step: 0.1, label: "Star Size" },
    trail: { type: "number", default: 0.3, min: 0, max: 1, step: 0.01, label: "Trail Length" },
    color: { type: "color", default: "#ffffff", label: "Star Color" },
    background: { type: "color", default: "#000014", label: "Background" },
  },
  init(ctx, params, seed) {
    const { canvas } = ctx;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("starfield: 2d context unavailable");

    const rng = makeRng(seed);
    const CAP = 5000;
    const xs = new Float32Array(CAP);
    const ys = new Float32Array(CAP);
    const zs = new Float32Array(CAP);
    let currentCount = 0;
    let width = canvas.width, height = canvas.height;

    function spawn(i) {
      xs[i] = (rng() * 2 - 1);
      ys[i] = (rng() * 2 - 1);
      zs[i] = Z_NEAR + rng() * (Z_FAR - Z_NEAR);
    }

    function seedAll(n) {
      for (let i = 0; i < n; i++) spawn(i);
      currentCount = n;
    }
    seedAll(Math.min(CAP, Math.max(1, Math.floor(params.count))));

    const bg0 = hexToRgb(params.background);
    g.fillStyle = `rgb(${bg0[0]},${bg0[1]},${bg0[2]})`;
    g.fillRect(0, 0, width, height);

    return {
      update(dt) {
        const desired = Math.min(CAP, Math.max(1, Math.floor(params.count)));
        if (desired !== currentCount) {
          if (desired > currentCount) {
            for (let i = currentCount; i < desired; i++) spawn(i);
          }
          currentCount = desired;
        }

        const step = Math.min(dt, 0.05);
        const speed = params.speed;
        const trail = params.trail;
        const size = params.starSize;
        const w = width, h = height;
        const cx = w * 0.5, cy = h * 0.5;
        const scale = Math.min(w, h) * FOCAL;

        const bg = hexToRgb(params.background);
        g.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
        g.fillRect(0, 0, w, h);

        const col = hexToRgb(params.color);
        const dz = speed * 0.25 * step;
        const streakK = trail * speed * 0.6;

        for (let i = 0; i < currentCount; i++) {
          const prevZ = zs[i];
          let z = prevZ - dz;
          if (z <= Z_NEAR) {
            xs[i] = (rng() * 2 - 1);
            ys[i] = (rng() * 2 - 1);
            zs[i] = Z_FAR;
            continue;
          }
          zs[i] = z;

          const k = scale / z;
          const px = cx + xs[i] * k;
          const py = cy + ys[i] * k;

          const kPrev = scale / prevZ;
          const ppx = cx + xs[i] * kPrev;
          const ppy = cy + ys[i] * kPrev;

          let dx = (ppx - px) * streakK * 8;
          let dy = (ppy - py) * streakK * 8;
          // Clamp streak length to avoid flashing lines when stars are very close
          const streakLen = Math.hypot(dx, dy);
          const maxStreak = Math.min(w, h) * 0.15;
          if (streakLen > maxStreak) {
            const sc = maxStreak / streakLen;
            dx *= sc;
            dy *= sc;
          }
          const sx = ppx + dx;
          const sy = ppy + dy;

          const depth = 1 - (z - Z_NEAR) / (Z_FAR - Z_NEAR);
          const alpha = 0.25 + depth * 0.75;
          const radius = size * (0.4 + depth * 1.2);

          if (streakK > 0.002) {
            g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
            g.lineWidth = radius;
            g.lineCap = "round";
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(px, py);
            g.stroke();
          } else {
            g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
            g.beginPath();
            g.arc(px, py, radius, 0, Math.PI * 2);
            g.fill();
          }
        }
      },
      resize(w, h) {
        width = w;
        height = h;
        const c = hexToRgb(params.background);
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        g.fillRect(0, 0, w, h);
      },
      dispose() {},
    };
  },
};
