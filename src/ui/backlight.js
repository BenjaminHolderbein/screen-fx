/* global getComputedStyle */

/**
 * Content backlight glow — derives a conic-gradient from the active effect's
 * params (palette/color/background). No canvas sampling, so there's no
 * GPU→CPU readback stall on effect load.
 *
 * The glow div sits behind the preview with heavy blur + low opacity. CSS
 * transitions the background so it crossfades smoothly between effects.
 */

const FALLBACK_STOPS = ["#1a1a2e", "#16213e", "#0f3460"];
const HEX = /^#[0-9a-f]{3,8}$/i;

/** @param {Record<string, any>} params */
export function paramsToStops(params) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const push = (v) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (!HEX.test(s) || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  if (params && Array.isArray(params.palette)) {
    for (const c of params.palette) push(c);
  }
  if (params) {
    // prefer canonical trio for ordering, then sweep everything else
    push(params.color);
    push(params.accent);
    push(params.background);
    for (const v of Object.values(params)) {
      if (Array.isArray(v)) v.forEach(push);
      else push(v);
    }
  }

  if (out.length === 0) return FALLBACK_STOPS.slice();
  return out;
}

/** @param {string[]} stops */
export function toConicGradient(stops) {
  const n = stops.length;
  const parts = stops.map((c, i) => {
    const deg = Math.round((i / n) * 360);
    return `${c} ${deg}deg`;
  });
  parts.push(`${stops[0]} 360deg`);
  return `conic-gradient(from 0deg at 50% 50%, ${parts.join(", ")})`;
}

/**
 * @param {HTMLElement} mainEl  The <main> element that contains #preview-wrap.
 * @param {HTMLElement} _previewWrap  Reserved for future use.
 * @returns {{ update(params: Record<string, any>): void, dispose(): void, enable(): void, disable(): void, isEnabled(): boolean }}
 */
export function createBacklight(mainEl, _previewWrap) {
  const glow = document.createElement("div");
  glow.setAttribute("aria-hidden", "true");
  Object.assign(glow.style, {
    position: "absolute",
    inset: "-60px",
    zIndex: "-1",
    width: "calc(100% + 120px)",
    height: "calc(100% + 120px)",
    filter: "blur(80px)",
    opacity: "0.4",
    pointerEvents: "none",
    borderRadius: "50%",
    transition: "background 0.6s ease",
  });

  if (getComputedStyle(mainEl).position === "static") {
    mainEl.style.position = "relative";
  }
  mainEl.insertBefore(glow, mainEl.firstChild);

  let enabled = true;

  /** @param {Record<string, any>} params */
  function update(params) {
    if (!enabled) return;
    const stops = paramsToStops(params || {});
    glow.style.background = stops.length === 1 ? stops[0] : toConicGradient(stops);
  }

  function enable() {
    enabled = true;
    glow.style.display = "";
  }

  function disable() {
    enabled = false;
    glow.style.display = "none";
  }

  function isEnabled() {
    return enabled;
  }

  function dispose() {
    glow.remove();
  }

  return { update, dispose, enable, disable, isEnabled };
}
