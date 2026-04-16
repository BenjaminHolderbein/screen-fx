/**
 * Preset browser with cached thumbnails and hover-to-animate.
 *
 * Replaces the plain text-button grid with thumbnail tiles stored in IndexedDB.
 * On first load, each effect is rendered offscreen for ~1 second and captured.
 * On hover, a live mini-canvas replaces the static thumbnail.
 */

import { defaultParams } from "../fx/base.js";

// ---------------------------------------------------------------------------
// IndexedDB thumbnail cache
// ---------------------------------------------------------------------------

/** @returns {Promise<IDBDatabase>} */
function openThumbDB() {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open("screen-fx-thumbs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("thumbs");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} key
 * @returns {Promise<string | undefined>}
 */
function getThumb(db, key) {
  return new Promise((resolve) => {
    const tx = db.transaction("thumbs", "readonly");
    const req = tx.objectStore("thumbs").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} key
 * @param {string} dataUrl
 */
function putThumb(db, key, dataUrl) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("thumbs", "readwrite");
    const req = tx.objectStore("thumbs").put(dataUrl, key);
    req.onsuccess = () => resolve(undefined);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Thumbnail generation
// ---------------------------------------------------------------------------

const THUMB_W = 256;
const THUMB_H = 160;
const THUMB_FRAMES = 60;
const THUMB_SEED = 42;

/**
 * Render an effect offscreen for ~1 second and capture a PNG data URL.
 * @param {import("../fx/base.js").FxModule} fx
 * @returns {Promise<string>}
 */
function generateThumb(fx) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
      const params = defaultParams(fx.params);
      const renderer = fx.init(
        { canvas, width: THUMB_W, height: THUMB_H, dpr: 1 },
        params,
        THUMB_SEED,
      );
      const dt = 1 / 60;
      let time = 0;
      for (let i = 0; i < THUMB_FRAMES; i++) {
        time += dt;
        renderer.update(dt, time);
      }
      // Capture synchronously before the browser composites (important for WebGL).
      const dataUrl = canvas.toDataURL("image/png");
      renderer.dispose();
      resolve(dataUrl);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Hover-to-animate
// ---------------------------------------------------------------------------

/** @type {{ canvas: HTMLCanvasElement; renderer: import("../fx/base.js").FxRenderer; raf: number; tile: HTMLElement } | null} */
let livePreview = null;

let livePreviewEnabled = false;

export function enableLivePreview() {
  livePreviewEnabled = true;
}

export function disableLivePreview() {
  livePreviewEnabled = false;
  stopLivePreview();
}

export function isLivePreviewEnabled() {
  return livePreviewEnabled;
}

/**
 * @param {HTMLElement} tile
 * @param {import("../fx/base.js").FxModule} fx
 */
function startLivePreview(tile, fx) {
  stopLivePreview();

  const canvas = document.createElement("canvas");
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;border-radius:inherit;";

  const params = defaultParams(fx.params);
  /** @type {import("../fx/base.js").FxRenderer} */
  let renderer;
  try {
    renderer = fx.init(
      { canvas, width: THUMB_W, height: THUMB_H, dpr: 1 },
      params,
      THUMB_SEED,
    );
  } catch {
    return; // effect can't init at this size — skip live preview
  }

  tile.appendChild(canvas);

  let lastT = 0;
  let time = 0;
  /** @type {number} */
  let raf;

  function frame(tMs) {
    raf = requestAnimationFrame(frame);
    const dt = lastT ? (tMs - lastT) / 1000 : 0;
    lastT = tMs;
    time += dt;
    renderer.update(dt, time);
  }

  raf = requestAnimationFrame(frame);
  livePreview = { canvas, renderer, raf, tile };
}

function stopLivePreview() {
  if (!livePreview) return;
  cancelAnimationFrame(livePreview.raf);
  livePreview.renderer.dispose();
  livePreview.canvas.remove();
  livePreview = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the preset grid with thumbnail tiles.
 *
 * @param {HTMLElement} container  - the #preset-grid element
 * @param {import("../fx/base.js").FxModule[]} effects
 * @param {{ onSelect: (id: string) => void, onDoubleClick: (id: string) => void }} callbacks
 */
export async function renderPresetGrid(container, effects, { onSelect, onDoubleClick }) {
  container.innerHTML = "";

  /** @type {Map<string, HTMLElement>} */
  const tileMap = new Map();

  // 1. Immediately render tiles with labels (no thumbnails yet).
  for (const fx of effects) {
    const tile = document.createElement("button");
    tile.className =
      "preset-tile rounded-lg border border-white/10 bg-black/40 hover:border-white/30 text-xs text-left overflow-hidden";
    tile.style.cssText = "position:relative;aspect-ratio:16/10;background-size:cover;background-position:center;padding:0;";
    tile.dataset.effectId = fx.id;

    // Label overlay
    const label = document.createElement("span");
    label.textContent = fx.label;
    label.style.cssText =
      "position:absolute;bottom:0;left:0;right:0;padding:6px 8px;font-size:11px;color:#fff;" +
      "background:linear-gradient(transparent,rgba(0,0,0,0.7));pointer-events:none;z-index:1;";
    tile.appendChild(label);

    tile.addEventListener("click", () => onSelect(fx.id));
    tile.addEventListener("dblclick", () => onDoubleClick(fx.id));

    // Hover-to-animate
    tile.addEventListener("mouseenter", () => {
      if (!livePreviewEnabled) return;
      startLivePreview(tile, fx);
    });
    tile.addEventListener("mouseleave", () => stopLivePreview());

    container.appendChild(tile);
    tileMap.set(fx.id, tile);
  }

  // 2. Load / generate thumbnails in the background.
  /** @type {IDBDatabase | null} */
  let db = null;
  try {
    db = await openThumbDB();
  } catch {
    // IndexedDB unavailable — tiles will stay label-only, which is fine.
    return;
  }

  for (const fx of effects) {
    const tile = tileMap.get(fx.id);
    if (!tile) continue;
    const cacheKey = `thumb-${fx.id}`;

    try {
      let dataUrl = await getThumb(db, cacheKey);
      if (!dataUrl) {
        dataUrl = await generateThumb(fx);
        await putThumb(db, cacheKey, dataUrl).catch(() => {});
      }
      tile.style.backgroundImage = `url(${dataUrl})`;
    } catch {
      // Generation failed for this effect — leave label-only.
    }

    // Yield to the browser between effects so the UI stays responsive.
    await new Promise((r) => window.setTimeout(r, 0));
  }
}
