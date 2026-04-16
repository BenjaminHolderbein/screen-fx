import { effects, getEffect } from "./fx/registry.js";
import { defaultParams } from "./fx/base.js";
import { postFxOptions, getPostFx } from "./fx/postfx/registry.js";
import { createColorPicker } from "./ui/color-picker.js";
import {
  renderPresetGrid as renderPresetGridUI,
  enableLivePreview,
  disableLivePreview,
  isLivePreviewEnabled,
} from "./ui/preset-browser.js";
import { createBacklight } from "./ui/backlight.js";

const panelLabel = /** @type {HTMLElement} */ (document.getElementById("effect-label"));
const paramsHost = /** @type {HTMLElement} */ (document.getElementById("params"));
const postfxParamsHost = /** @type {HTMLElement} */ (document.getElementById("postfx-params"));
const postfxSelect = /** @type {HTMLSelectElement} */ (document.getElementById("postfx-select"));
const presetGrid = /** @type {HTMLElement} */ (document.getElementById("preset-grid"));
const previewWrap = /** @type {HTMLElement} */ (document.getElementById("preview-wrap"));
/** @type {HTMLCanvasElement} */
let effectCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("effect-canvas"));
const postfxCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("postfx-canvas"));
const postfxGl = /** @type {WebGL2RenderingContext} */ (
  postfxCanvas.getContext("webgl2", {
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  })
);

function replaceEffectCanvas() {
  const fresh = document.createElement("canvas");
  fresh.id = "effect-canvas";
  // Preserve the visibility class state so post-FX swap behavior survives.
  if (effectCanvas.classList.contains("hidden")) fresh.classList.add("hidden");
  effectCanvas.replaceWith(fresh);
  effectCanvas = fresh;
}

const state = {
  effectId: effects[0].id,
  /** @type {Record<string, any>} */
  params: {},
  /** @type {Record<string, Record<string, any>>} */
  paramsByEffect: {},
  postFxId: "none",
  /** @type {Record<string, any>} */
  postFxParams: {},
  /** @type {Record<string, Record<string, any>>} */
  postFxParamsById: {},
  seed: 1,
  paused: false,
  /** @type {import("./fx/base.js").FxRenderer | null} */
  renderer: null,
  /** @type {import("./fx/postfx/base.js").PostFxRenderer | null} */
  postFx: null,
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
    if (parsed.params && parsed.effectId) {
      state.paramsByEffect[parsed.effectId] = parsed.params;
    }
    if (parsed.postFxId) state.postFxId = parsed.postFxId;
    if (parsed.postFxParams && parsed.postFxId) {
      state.postFxParamsById[parsed.postFxId] = parsed.postFxParams;
    }
    if (typeof parsed.seed === "number") state.seed = parsed.seed;
  } catch {
    /* ignore */
  }
}

function writeHash() {
  const payload = {
    effectId: state.effectId,
    params: state.params,
    postFxId: state.postFxId,
    postFxParams: state.postFxParams,
    seed: state.seed,
  };
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
  if (effectCanvas.width !== w || effectCanvas.height !== h) {
    effectCanvas.width = w;
    effectCanvas.height = h;
    state.renderer?.resize(w, h);
  }
  if (postfxCanvas.width !== w || postfxCanvas.height !== h) {
    postfxCanvas.width = w;
    postfxCanvas.height = h;
    state.postFx?.resize(w, h);
  }
  return { w, h, dpr };
}

function renderColorArrayParam(host, values, key, spec) {
  const min = spec.min ?? 2;
  const max = spec.max ?? 8;
  const wrap = document.createElement("div");
  wrap.className = "space-y-1";
  const header = document.createElement("div");
  header.className = "flex items-center justify-between text-sm text-neutral-300";
  const label = document.createElement("span");
  label.textContent = spec.label ?? key;
  header.appendChild(label);
  const addBtn = document.createElement("button");
  addBtn.textContent = "+";
  addBtn.className = "w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-xs leading-none";
  header.appendChild(addBtn);
  wrap.appendChild(header);

  const chips = document.createElement("div");
  chips.className = "flex flex-wrap gap-1.5";
  wrap.appendChild(chips);

  const redraw = () => {
    chips.innerHTML = "";
    const arr = /** @type {string[]} */ (values[key]);
    arr.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "flex items-center gap-1";
      const picker = createColorPicker({
        value: c,
        onChange: (v) => {
          arr[i] = v;
          writeHash();
          backlight.update(state.params);
        },
        onApplyHarmony: (colors) => {
          // Replace palette colors, keeping the current palette length
          const len = /** @type {string[]} */ (values[key]).length;
          const clamped = colors.slice(0, len);
          while (clamped.length < len) clamped.push(clamped[clamped.length - 1] ?? "#ffffff");
          values[key] = clamped;
          writeHash();
          backlight.update(state.params);
          redraw();
        },
      });
      row.appendChild(picker.element);
      if (arr.length > min) {
        const rm = document.createElement("button");
        rm.textContent = "×";
        rm.className = "w-5 h-5 rounded bg-white/5 hover:bg-red-500/40 text-xs leading-none text-neutral-400";
        rm.addEventListener("click", () => {
          arr.splice(i, 1);
          writeHash();
          backlight.update(state.params);
          redraw();
        });
        row.appendChild(rm);
      }
      chips.appendChild(row);
    });
    addBtn.disabled = arr.length >= max;
    addBtn.className = addBtn.disabled
      ? "w-6 h-6 rounded bg-white/5 text-xs leading-none text-neutral-600 cursor-not-allowed"
      : "w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-xs leading-none";
  };
  addBtn.addEventListener("click", () => {
    const arr = /** @type {string[]} */ (values[key]);
    if (arr.length >= max) return;
    arr.push(arr[arr.length - 1] ?? "#ffffff");
    writeHash();
    backlight.update(state.params);
    redraw();
  });
  redraw();
  host.appendChild(wrap);
}

function renderParamsInto(host, schema, values) {
  host.innerHTML = "";
  for (const [key, spec] of Object.entries(schema)) {
    const row = document.createElement("label");
    row.className = "flex items-center justify-between gap-3 text-sm";
    const name = document.createElement("span");
    name.textContent = spec.label ?? key;
    name.className = "text-neutral-300";
    row.appendChild(name);

    if (spec.type === "color") {
      const colorRow = document.createElement("div");
      colorRow.className = row.className;
      colorRow.appendChild(name);
      const picker = createColorPicker({
        value: values[key],
        onChange: (v) => { values[key] = v; writeHash(); backlight.update(state.params); },
      });
      colorRow.appendChild(picker.element);
      host.appendChild(colorRow);
      continue;
    }
    if (spec.type === "colorArray") {
      renderColorArrayParam(host, values, key, spec);
      continue;
    }
    /** @type {HTMLInputElement | HTMLSelectElement} */
    let input;
    if (spec.type === "bool") {
      input = document.createElement("input");
      /** @type {HTMLInputElement} */ (input).type = "checkbox";
      /** @type {HTMLInputElement} */ (input).checked = Boolean(values[key]);
    } else if (spec.type === "enum") {
      input = document.createElement("select");
      for (const opt of spec.options ?? []) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      }
      /** @type {HTMLSelectElement} */ (input).value = String(values[key]);
    } else {
      input = document.createElement("input");
      /** @type {HTMLInputElement} */ (input).type = "number";
      /** @type {HTMLInputElement} */ (input).value = String(values[key]);
      if (spec.min !== undefined) /** @type {HTMLInputElement} */ (input).min = String(spec.min);
      if (spec.max !== undefined) /** @type {HTMLInputElement} */ (input).max = String(spec.max);
      if (spec.step !== undefined) /** @type {HTMLInputElement} */ (input).step = String(spec.step);
    }
    input.className = "bg-black/40 border border-white/10 rounded px-2 py-1 text-sm w-40";
    input.addEventListener("input", () => {
      const el = /** @type {HTMLInputElement} */ (input);
      if (spec.type === "bool") values[key] = el.checked;
      else if (spec.type === "number") values[key] = Number(el.value);
      else values[key] = el.value;
      writeHash();
    });
    row.appendChild(input);
    host.appendChild(row);
  }
}

function renderPresetGrid() {
  renderPresetGridUI(presetGrid, effects, {
    onSelect: (id) => loadEffect(id),
    onDoubleClick: (id) => { loadEffect(id); enterFullscreen(); },
  });
}

function loadEffect(id) {
  const fx = getEffect(id);
  if (!fx) return;
  if (state.params && state.effectId) {
    state.paramsByEffect[state.effectId] = state.params;
  }
  state.renderer?.dispose();
  replaceEffectCanvas();
  state.effectId = id;
  state.params = { ...defaultParams(fx.params), ...(state.paramsByEffect[id] ?? {}) };
  panelLabel.textContent = fx.label;
  renderParamsInto(paramsHost, fx.params, state.params);
  const { w, h, dpr } = sizeCanvas();
  state.renderer = fx.init({ canvas: effectCanvas, width: w, height: h, dpr }, state.params, state.seed);
  writeHash();
  backlight.update(state.params);
}

function loadPostFx(id) {
  // Persist current post-FX params before swapping.
  if (state.postFxParams && state.postFxId && state.postFxId !== "none") {
    state.postFxParamsById[state.postFxId] = state.postFxParams;
  }
  state.postFx?.dispose();
  state.postFx = null;
  state.postFxId = id;

  if (id === "none") {
    state.postFxParams = {};
    postfxParamsHost.innerHTML = "";
    postfxCanvas.classList.add("hidden");
    effectCanvas.classList.remove("hidden");
    if (postfxSelect.value !== id) postfxSelect.value = id;
    writeHash();
    backlight.update(state.params);
    return;
  }

  const mod = getPostFx(id);
  if (!mod) {
    state.postFxId = "none";
    return;
  }
  state.postFxParams = { ...defaultParams(mod.params), ...(state.postFxParamsById[id] ?? {}) };
  renderParamsInto(postfxParamsHost, mod.params, state.postFxParams);
  const { w, h, dpr } = sizeCanvas();
  state.postFx = mod.init(
    { canvas: postfxCanvas, gl: postfxGl, width: w, height: h, dpr },
    state.postFxParams,
    state.seed,
  );
  effectCanvas.classList.add("hidden");
  postfxCanvas.classList.remove("hidden");
  if (postfxSelect.value !== id) postfxSelect.value = id;
  writeHash();
  backlight.update(state.params);
}

function renderPostFxSelect() {
  postfxSelect.innerHTML = "";
  for (const opt of postFxOptions) {
    const o = document.createElement("option");
    o.value = opt.id;
    o.textContent = opt.label;
    postfxSelect.appendChild(o);
  }
  postfxSelect.value = state.postFxId;
  postfxSelect.addEventListener("change", () => loadPostFx(postfxSelect.value));
}

const perf = {
  frameCount: 0,
  sumMs: 0,
  maxFrameMs: 0,
  hitchCount: 0,
  /** @type {number[]} */
  hitchFrames: [],
};
const HITCH_THRESHOLD_MS = 33;
const HITCH_FRAMES_CAP = 100;

function loop(tMs) {
  state.raf = requestAnimationFrame(loop);
  if (state.paused || document.hidden) {
    state.lastT = tMs;
    return;
  }
  const dt = state.lastT ? (tMs - state.lastT) / 1000 : 0;
  state.lastT = tMs;
  state.time += dt;
  if (dt > 0) {
    const frameMs = dt * 1000;
    perf.frameCount++;
    perf.sumMs += frameMs;
    if (frameMs > perf.maxFrameMs) perf.maxFrameMs = frameMs;
    if (frameMs > HITCH_THRESHOLD_MS) {
      perf.hitchCount++;
      perf.hitchFrames.push(frameMs);
      if (perf.hitchFrames.length > HITCH_FRAMES_CAP) perf.hitchFrames.shift();
    }
  }
  state.renderer?.update(dt, state.time);
  state.postFx?.apply(effectCanvas, dt, state.time);
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
    const target = state.postFx ? postfxCanvas : effectCanvas;
    target.toBlob((b) => {
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
renderPostFxSelect();
const backlight = createBacklight(
  /** @type {HTMLElement} */ (previewWrap.parentElement),
  previewWrap,
);
loadEffect(state.effectId);
loadPostFx(state.postFxId);
state.raf = requestAnimationFrame(loop);

// Test hooks
// @ts-ignore
window.__screenFx = {
  state,
  effects,
  postFxOptions,
  loadEffect,
  loadPostFx,
  setSeed(s) { state.seed = s; loadEffect(state.effectId); },
  setParam(k, v) { state.params[k] = v; writeHash(); },
  setPostFxParam(k, v) { state.postFxParams[k] = v; writeHash(); },
  backlight: {
    enable: () => backlight.enable(),
    disable: () => backlight.disable(),
    isEnabled: () => backlight.isEnabled(),
  },
  presetPreview: {
    enable: enableLivePreview,
    disable: disableLivePreview,
    isEnabled: isLivePreviewEnabled,
  },
  perfStats: {
    reset() {
      perf.frameCount = 0;
      perf.sumMs = 0;
      perf.maxFrameMs = 0;
      perf.hitchCount = 0;
      perf.hitchFrames.length = 0;
    },
    getStats() {
      return {
        frameCount: perf.frameCount,
        avgFrameMs: perf.frameCount ? perf.sumMs / perf.frameCount : 0,
        maxFrameMs: perf.maxFrameMs,
        hitchCount: perf.hitchCount,
        hitchFrames: perf.hitchFrames.slice(),
      };
    },
  },
};
