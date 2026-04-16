const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function normalizeHex(input) {
  let s = String(input || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s.split("").map((c) => c + c).join("");
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return "#" + s.toLowerCase();
  return null;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const to = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return "#" + to(r) + to(g) + to(b);
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function hsvToHex(h, s, v) {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

function wrapHue(offset, base) {
  return ((base + offset) % 360 + 360) % 360;
}

// Shared recent colors — persists across all picker instances in the session.
const MAX_RECENT = 8;
/** @type {string[]} */
const recentColors = [];
/** @type {Set<() => void>} */
const recentListeners = new Set();

function pushRecent(hex) {
  const idx = recentColors.indexOf(hex);
  if (idx !== -1) recentColors.splice(idx, 1);
  recentColors.unshift(hex);
  if (recentColors.length > MAX_RECENT) recentColors.length = MAX_RECENT;
  for (const fn of recentListeners) fn();
}

/**
 * @param {{ value: string, onChange?: (hex: string) => void, onApplyHarmony?: (colors: string[]) => void }} opts
 */
export function createColorPicker({ value, onChange, onApplyHarmony }) {
  const initial = normalizeHex(value) ?? "#ffffff";
  let hex = initial;
  let { h, s, v } = rgbToHsv(...Object.values(hexToRgb(initial)));

  const root = document.createElement("div");
  root.className = "relative inline-block";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className =
    "w-40 h-7 rounded border border-white/10 bg-black/40 flex items-center gap-2 px-1.5";
  const swatch = document.createElement("span");
  swatch.className = "block w-5 h-5 rounded border border-white/15";
  swatch.style.background = hex;
  swatch.style.boxShadow = `0 0 8px ${hex}`;
  const hexLabel = document.createElement("span");
  hexLabel.className = "text-xs text-neutral-300 font-mono";
  hexLabel.textContent = hex;
  trigger.appendChild(swatch);
  trigger.appendChild(hexLabel);
  root.appendChild(trigger);

  // Popover — fixed position, opens to the right of the trigger
  const pop = document.createElement("div");
  pop.className =
    "fixed z-[100] w-56 p-3 rounded-lg bg-black/55 backdrop-blur-md border border-white/10 shadow-xl opacity-0 scale-95 pointer-events-none transition-all duration-150";
  pop.style.userSelect = "none";
  pop.style.transformOrigin = "left top";

  // SV square — taller (h-40)
  const sv = document.createElement("div");
  sv.className = "relative w-full h-40 rounded overflow-hidden border border-white/10 cursor-crosshair";
  const svCursor = document.createElement("div");
  svCursor.className = "absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow pointer-events-none";
  sv.appendChild(svCursor);
  pop.appendChild(sv);

  // Hue slider
  const hue = document.createElement("div");
  hue.className = "relative w-full h-3 rounded mt-3 cursor-pointer border border-white/10";
  hue.style.background =
    "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)";
  const hueCursor = document.createElement("div");
  hueCursor.className = "absolute top-1/2 w-2 h-4 -ml-1 -mt-2 rounded-sm border-2 border-white shadow pointer-events-none";
  hue.appendChild(hueCursor);
  pop.appendChild(hue);

  // Hex input row (with optional eye dropper)
  const hexRow = document.createElement("div");
  hexRow.className = "mt-3 flex items-center gap-1";

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.spellcheck = false;
  hexInput.className =
    "flex-1 min-w-0 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs font-mono text-neutral-200 focus:outline-none focus:border-white/30";
  hexInput.value = hex;
  hexRow.appendChild(hexInput);

  // Eye dropper button (Chromium only)
  /** @type {HTMLButtonElement | null} */
  let dropperBtn = null;
  if (/** @type {any} */ (window).EyeDropper) {
    dropperBtn = document.createElement("button");
    dropperBtn.type = "button";
    dropperBtn.className =
      "w-7 h-7 flex items-center justify-center rounded border border-white/10 bg-black/40 text-neutral-300 hover:text-white hover:border-white/25 text-sm leading-none";
    dropperBtn.textContent = "\u{1F4A7}";
    dropperBtn.title = "Pick color from screen";
    dropperBtn.addEventListener("click", async () => {
      try {
        const dropper = new (/** @type {any} */ (window).EyeDropper)();
        const result = await dropper.open();
        setValue(result.sRGBHex);
        emit();
      } catch {
        // user cancelled or API error — ignore
      }
    });
    hexRow.appendChild(dropperBtn);
  }

  pop.appendChild(hexRow);

  // Harmony palette
  const harmonyOffsets = [180, 30, -30, 120, 240];
  const harmonyWrap = document.createElement("div");
  harmonyWrap.className = "mt-2";
  const harmonyLabel = document.createElement("span");
  harmonyLabel.className = "block text-[10px] text-neutral-500 mb-1";
  harmonyLabel.textContent = "Harmony";
  harmonyWrap.appendChild(harmonyLabel);

  const harmonyRow = document.createElement("div");
  harmonyRow.className = "flex items-center gap-1.5";

  /** @type {HTMLSpanElement[]} */
  const harmonyDots = harmonyOffsets.map((offset) => {
    const dot = document.createElement("span");
    dot.className =
      "block w-4 h-4 rounded-full border border-white/15 cursor-pointer hover:scale-125 transition-transform";
    dot.addEventListener("click", () => {
      const newH = wrapHue(offset, h);
      h = newH;
      render();
      emit();
    });
    harmonyRow.appendChild(dot);
    return dot;
  });

  harmonyWrap.appendChild(harmonyRow);

  // "Apply to palette" button — only shown when picker is inside a colorArray
  if (onApplyHarmony) {
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className =
      "mt-1.5 w-full text-[10px] text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 rounded px-2 py-0.5 transition-colors";
    applyBtn.textContent = "Apply harmony to palette";
    applyBtn.addEventListener("click", () => {
      const colors = harmonyOffsets.map((offset) => {
        const hh = wrapHue(offset, h);
        return hsvToHex(hh, s, v);
      });
      // Include the current color as the first entry
      onApplyHarmony([hex, ...colors]);
    });
    harmonyWrap.appendChild(applyBtn);
  }

  pop.appendChild(harmonyWrap);

  // Recent colors strip — shared across all picker instances
  const recentWrap = document.createElement("div");
  recentWrap.className = "mt-2";
  const recentLabel = document.createElement("span");
  recentLabel.className = "block text-[10px] text-neutral-500 mb-1";
  recentLabel.textContent = "Recent";
  recentWrap.appendChild(recentLabel);
  const recentRow = document.createElement("div");
  recentRow.className = "flex items-center gap-1.5";
  recentWrap.appendChild(recentRow);

  function renderRecent() {
    recentRow.innerHTML = "";
    if (recentColors.length === 0) {
      recentWrap.style.display = "none";
      return;
    }
    recentWrap.style.display = "";
    for (const c of recentColors) {
      const dot = document.createElement("span");
      dot.className =
        "block w-4 h-4 rounded-full border border-white/15 cursor-pointer hover:scale-125 transition-transform";
      dot.style.background = c;
      dot.addEventListener("click", () => {
        setValue(c);
        emit();
      });
      recentRow.appendChild(dot);
    }
  }
  renderRecent();
  recentListeners.add(renderRecent);

  pop.appendChild(recentWrap);

  document.body.appendChild(pop);

  function paintSv() {
    const hueHex = hsvToHex(h, 1, 1);
    sv.style.background =
      `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`;
  }

  function syncCursors() {
    const rect = { w: sv.clientWidth || 208, hgt: sv.clientHeight || 160 };
    svCursor.style.left = `${s * rect.w}px`;
    svCursor.style.top = `${(1 - v) * rect.hgt}px`;
    const hw = hue.clientWidth || 208;
    hueCursor.style.left = `${(h / 360) * hw}px`;
  }

  function updateHarmony() {
    harmonyOffsets.forEach((offset, i) => {
      const hh = wrapHue(offset, h);
      const col = hsvToHex(hh, s, v);
      harmonyDots[i].style.background = col;
    });
  }

  function render(updateInput = true) {
    hex = hsvToHex(h, s, v);
    swatch.style.background = hex;
    swatch.style.boxShadow = `0 0 8px ${hex}`;
    hexLabel.textContent = hex;
    if (updateInput) hexInput.value = hex;
    paintSv();
    syncCursors();
    updateHarmony();
  }

  function emit() {
    pushRecent(hex);
    onChange?.(hex);
  }

  function handleSv(e, rect) {
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const y = clamp(e.clientY - rect.top, 0, rect.height);
    s = x / rect.width;
    v = 1 - y / rect.height;
    render();
    emit();
  }

  sv.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const rect = sv.getBoundingClientRect();
    sv.setPointerCapture(e.pointerId);
    handleSv(e, rect);
    const move = (ev) => handleSv(ev, rect);
    const up = () => {
      sv.releasePointerCapture(e.pointerId);
      sv.removeEventListener("pointermove", move);
      sv.removeEventListener("pointerup", up);
    };
    sv.addEventListener("pointermove", move);
    sv.addEventListener("pointerup", up);
  });

  function handleHue(e, rect) {
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    h = (x / rect.width) * 360;
    render();
    emit();
  }

  hue.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const rect = hue.getBoundingClientRect();
    hue.setPointerCapture(e.pointerId);
    handleHue(e, rect);
    const move = (ev) => handleHue(ev, rect);
    const up = () => {
      hue.releasePointerCapture(e.pointerId);
      hue.removeEventListener("pointermove", move);
      hue.removeEventListener("pointerup", up);
    };
    hue.addEventListener("pointermove", move);
    hue.addEventListener("pointerup", up);
  });

  function commitHex() {
    const n = normalizeHex(hexInput.value);
    if (!n) {
      hexInput.value = hex;
      return;
    }
    setValue(n);
    emit();
  }

  hexInput.addEventListener("blur", commitHex);
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitHex();
      hexInput.blur();
    }
  });

  let isOpen = false;

  function positionPop() {
    const r = trigger.getBoundingClientRect();
    const popW = 240; // w-56 ≈ 224px + padding
    const popH = 320;
    let left = r.right + 8;
    let top = r.top;
    // If it would overflow right, flip to left side
    if (left + popW > window.innerWidth) left = r.left - popW - 8;
    // Clamp vertically
    if (top + popH > window.innerHeight) top = window.innerHeight - popH - 8;
    if (top < 8) top = 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    positionPop();
    pop.classList.remove("opacity-0", "scale-95", "pointer-events-none");
    pop.classList.add("opacity-100", "scale-100", "pointer-events-auto");
    requestAnimationFrame(syncCursors);
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onKey);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    pop.classList.remove("opacity-100", "scale-100", "pointer-events-auto");
    pop.classList.add("opacity-0", "scale-95", "pointer-events-none");
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("keydown", onKey);
  }

  function onDocDown(e) {
    if (!root.contains(e.target) && !pop.contains(e.target)) close();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    if (!isOpen) open();
    else close();
  });

  function setValue(next) {
    const n = normalizeHex(next);
    if (!n) return;
    hex = n;
    const rgb = hexToRgb(n);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    if (hsv.s > 0) h = hsv.h;
    s = hsv.s;
    v = hsv.v;
    render();
  }

  render();

  return { element: root, setValue };
}
