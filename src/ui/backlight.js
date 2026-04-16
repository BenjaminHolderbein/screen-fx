/* global getComputedStyle, clearTimeout, requestIdleCallback */

/**
 * Content backlight glow — samples the active canvas once per effect load
 * and casts a soft colored wash behind the preview area.
 *
 * Captures a single 8x8 snapshot, sets it as a CSS background-image on a
 * blurred div. No per-frame cost — the sample is taken once via a
 * one-second delayed capture after each effect swap.
 */

/**
 * @param {HTMLElement} mainEl  The <main> element that contains #preview-wrap.
 * @param {HTMLElement} _previewWrap  Reserved for future use.
 * @returns {{ capture(canvas: HTMLCanvasElement): void, dispose(): void, enable(): void, disable(): void, isEnabled(): boolean }}
 */
export function createBacklight(mainEl, _previewWrap) {
  const SIZE = 8;

  const sample = document.createElement("canvas");
  sample.width = SIZE;
  sample.height = SIZE;
  const sCtx = /** @type {CanvasRenderingContext2D} */ (
    sample.getContext("2d", { willReadFrequently: false })
  );

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
    backgroundSize: "cover",
    backgroundPosition: "center",
    borderRadius: "50%",
    transition: "background-image 0.6s ease",
  });

  if (getComputedStyle(mainEl).position === "static") {
    mainEl.style.position = "relative";
  }
  mainEl.insertBefore(glow, mainEl.firstChild);

  /** @type {number} */
  let timer = 0;
  let enabled = true;

  /** @param {HTMLCanvasElement} source */
  function capture(source) {
    clearTimeout(timer);
    if (!enabled) return;
    // Delay 1s so the effect renders a representative frame, then use
    // requestIdleCallback so the GPU sync never blocks a render frame.
    timer = window.setTimeout(() => {
      if (source.width === 0 || source.height === 0) return;
      const doCapture = () => {
        sCtx.drawImage(source, 0, 0, SIZE, SIZE);
        glow.style.backgroundImage = `url(${sample.toDataURL()})`;
      };
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(doCapture);
      } else {
        doCapture();
      }
    }, 1000);
  }

  function enable() {
    enabled = true;
    glow.style.display = "";
  }

  function disable() {
    enabled = false;
    clearTimeout(timer);
    glow.style.backgroundImage = "";
    glow.style.display = "none";
  }

  function isEnabled() {
    return enabled;
  }

  function dispose() {
    clearTimeout(timer);
    glow.remove();
  }

  return { capture, dispose, enable, disable, isEnabled };
}
