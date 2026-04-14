import { effects, getEffect } from "./fx/registry.js";
import { defaultParams } from "./fx/base.js";

const panelLabel = /** @type {HTMLElement} */ (document.getElementById("effect-label"));
const paramsHost = /** @type {HTMLElement} */ (document.getElementById("params"));
const presetGrid = /** @type {HTMLElement} */ (document.getElementById("preset-grid"));
const previewWrap = /** @type {HTMLElement} */ (document.getElementById("preview-wrap"));
/** @type {HTMLCanvasElement} */
let canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("preview-canvas"));

function replaceCanvas() {
  const fresh = document.createElement("canvas");
  fresh.id = "preview-canvas";
  canvas.replaceWith(fresh);
  canvas = fresh;
}

const state = {
  effectId: effects[0].id,
  /** @type {Record<string, any>} */
  params: {},
  seed: 1,
  paused: false,
  /** @type {import("./fx/base.js").FxRenderer | null} */
  renderer: null,
  /** @type {number | null} */
  raf: null,
  lastT: 0,
  time: 0,
};

function parseHash() {
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return;
  try {
    const parsed = JSON.parse(decodeURIComponent(h));
    if (parsed.effectId) state.effectId = parsed.effectId;
    if (parsed.params) state.params = parsed.params;
    if (typeof parsed.seed === "number") state.seed = parsed.seed;
  } catch {
    /* ignore */
  }
}

function writeHash() {
  const payload = { effectId: state.effectId, params: state.params, seed: state.seed };
  const next = "#" + encodeURIComponent(JSON.stringify(payload));
  if (next !== window.location.hash) {
    history.replaceState(null, "", next);
  }
}

function sizeCanvas() {
  const rect = previewWrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    state.renderer?.resize(w, h);
  }
  return { w, h, dpr };
}

function renderParamsUi(fx) {
  paramsHost.innerHTML = "";
  for (const [key, spec] of Object.entries(fx.params)) {
    const row = document.createElement("label");
    row.className = "flex items-center justify-between gap-3 text-sm";
    const name = document.createElement("span");
    name.textContent = spec.label ?? key;
    name.className = "text-neutral-300";
    row.appendChild(name);

    /** @type {HTMLInputElement | HTMLSelectElement} */
    let input;
    if (spec.type === "color") {
      input = document.createElement("input");
      /** @type {HTMLInputElement} */ (input).type = "color";
      /** @type {HTMLInputElement} */ (input).value = state.params[key];
    } else if (spec.type === "bool") {
      input = document.createElement("input");
      /** @type {HTMLInputElement} */ (input).type = "checkbox";
      /** @type {HTMLInputElement} */ (input).checked = Boolean(state.params[key]);
    } else if (spec.type === "enum") {
      input = document.createElement("select");
      for (const opt of spec.options ?? []) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      }
      /** @type {HTMLSelectElement} */ (input).value = String(state.params[key]);
    } else {
      input = document.createElement("input");
      /** @type {HTMLInputElement} */ (input).type = "number";
      /** @type {HTMLInputElement} */ (input).value = String(state.params[key]);
      if (spec.min !== undefined) /** @type {HTMLInputElement} */ (input).min = String(spec.min);
      if (spec.max !== undefined) /** @type {HTMLInputElement} */ (input).max = String(spec.max);
      if (spec.step !== undefined) /** @type {HTMLInputElement} */ (input).step = String(spec.step);
    }
    input.className = "bg-black/40 border border-white/10 rounded px-2 py-1 text-sm w-40";
    input.addEventListener("input", () => {
      const el = /** @type {HTMLInputElement} */ (input);
      if (spec.type === "bool") state.params[key] = el.checked;
      else if (spec.type === "number") state.params[key] = Number(el.value);
      else state.params[key] = el.value;
      writeHash();
    });
    row.appendChild(input);
    paramsHost.appendChild(row);
  }
}

function renderPresetGrid() {
  presetGrid.innerHTML = "";
  for (const fx of effects) {
    const tile = document.createElement("button");
    tile.className =
      "preset-tile rounded-lg border border-white/10 bg-black/40 hover:border-white/30 text-xs text-left p-2 flex flex-col justify-end";
    tile.textContent = fx.label;
    tile.dataset.effectId = fx.id;
    tile.addEventListener("click", () => loadEffect(fx.id));
    tile.addEventListener("dblclick", () => {
      loadEffect(fx.id);
      enterFullscreen();
    });
    presetGrid.appendChild(tile);
  }
}

function loadEffect(id) {
  const fx = getEffect(id);
  if (!fx) return;
  state.renderer?.dispose();
  replaceCanvas();
  state.effectId = id;
  state.params = { ...defaultParams(fx.params), ...state.params };
  panelLabel.textContent = fx.label;
  renderParamsUi(fx);
  const { w, h, dpr } = sizeCanvas();
  state.renderer = fx.init({ canvas, width: w, height: h, dpr }, state.params, state.seed);
  writeHash();
}

function loop(tMs) {
  state.raf = requestAnimationFrame(loop);
  if (state.paused || document.hidden) {
    state.lastT = tMs;
    return;
  }
  const dt = state.lastT ? (tMs - state.lastT) / 1000 : 0;
  state.lastT = tMs;
  state.time += dt;
  state.renderer?.update(dt, state.time);
}

function enterFullscreen() {
  previewWrap.classList.add("fs");
  sizeCanvas();
  if (document.fullscreenElement !== previewWrap) {
    previewWrap.requestFullscreen?.().catch(() => {});
  }
}

function exitFullscreen() {
  previewWrap.classList.remove("fs", "cursor-hidden");
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  sizeCanvas();
}

function toggleFullscreen() {
  if (previewWrap.classList.contains("fs")) exitFullscreen();
  else enterFullscreen();
}

// Input
previewWrap.addEventListener("click", (e) => {
  if (e.detail === 2) return;
  if (!previewWrap.classList.contains("fs")) enterFullscreen();
});
previewWrap.addEventListener("dblclick", () => {
  if (previewWrap.classList.contains("fs")) exitFullscreen();
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) previewWrap.classList.remove("fs", "cursor-hidden");
});

window.addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") toggleFullscreen();
  else if (e.key === "Escape") exitFullscreen();
  else if (e.key === " ") { e.preventDefault(); state.paused = !state.paused; }
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const i = effects.findIndex((f) => f.id === state.effectId);
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + effects.length) % effects.length;
    state.params = {};
    loadEffect(effects[next].id);
  } else if (e.key === "r" || e.key === "R") {
    state.seed = Math.floor(Math.random() * 1e9);
    loadEffect(state.effectId);
  } else if (e.key === "s" || e.key === "S") {
    canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${state.effectId}.png`;
      a.click();
    });
  }
});

let cursorTimer = 0;
previewWrap.addEventListener("mousemove", () => {
  previewWrap.classList.remove("cursor-hidden");
  window.clearTimeout(cursorTimer);
  if (previewWrap.classList.contains("fs")) {
    cursorTimer = window.setTimeout(() => previewWrap.classList.add("cursor-hidden"), 2000);
  }
});

const ro = new ResizeObserver(() => sizeCanvas());
ro.observe(previewWrap);

// Boot
parseHash();
renderPresetGrid();
loadEffect(state.effectId);
state.raf = requestAnimationFrame(loop);

// Test hooks
// @ts-ignore
window.__screenFx = {
  state,
  effects,
  loadEffect,
  setSeed(s) { state.seed = s; loadEffect(state.effectId); },
  setParam(k, v) { state.params[k] = v; writeHash(); },
};
