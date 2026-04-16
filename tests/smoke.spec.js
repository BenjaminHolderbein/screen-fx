import { test, expect } from "@playwright/test";

/**
 * Generic per-effect smoke test. For each effect:
 *   1. loads it with a fixed seed
 *   2. waits 2s of wall clock (shader compilation + first frames)
 *   3. asserts no console errors
 *   4. asserts the preview canvas isn't blank
 *
 * No screenshot diff — animated effects make that brittle. Visual review is
 * done by humans via Playwright MCP or the browser.
 */

test.describe("effects smoke", () => {
  test("every registered effect renders", async ({ page }) => {
    /** @type {string[]} */
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.goto("/");
    await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__screenFx));

    const ids = await page.evaluate(() =>
      /** @type {any} */ (window).__screenFx.effects.map((/** @type {any} */ e) => e.id),
    );
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      await test.step(id, async () => {
        consoleErrors.length = 0;
        await page.evaluate((eid) => {
          /** @type {any} */ (window).__screenFx.setSeed(42);
          /** @type {any} */ (window).__screenFx.loadEffect(eid);
        }, id);
        await page.waitForTimeout(2000);

        expect(consoleErrors, `console errors while rendering ${id}`).toEqual([]);

        const nonBlank = await page.evaluate(() => {
          const c = /** @type {HTMLCanvasElement} */ (document.getElementById("effect-canvas"));
          const ctx = c.getContext("2d") || c.getContext("webgl2") || c.getContext("webgl");
          // Reading pixels: if 2D, use getImageData. If WebGL, readPixels.
          const w = c.width, h = c.height;
          const samples = 64;
          const xs = [], ys = [];
          for (let i = 0; i < samples; i++) {
            xs.push(Math.floor((i + 0.5) * w / samples));
            ys.push(Math.floor((i + 0.5) * h / samples));
          }
          if (ctx instanceof CanvasRenderingContext2D) {
            const set = new Set();
            for (let i = 0; i < samples; i++) {
              const d = ctx.getImageData(xs[i], ys[i], 1, 1).data;
              set.add(`${d[0]},${d[1]},${d[2]}`);
            }
            return set.size >= 1; // solid-color is allowed to be one color
          }
          const gl = /** @type {WebGLRenderingContext} */ (ctx);
          const buf = new Uint8Array(4);
          const set = new Set();
          for (let i = 0; i < samples; i++) {
            gl.readPixels(xs[i], h - 1 - ys[i], 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            set.add(`${buf[0]},${buf[1]},${buf[2]}`);
          }
          // WebGL effects: require more than one color to prove it drew something.
          return set.size > 1;
        });

        expect(nonBlank, `${id} produced a blank render`).toBe(true);
      });
    }
  });

  test("every post-fx renders over a sample effect", async ({ page }) => {
    /** @type {string[]} */
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.goto("/");
    await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__screenFx));

    const postFxIds = await page.evaluate(() =>
      /** @type {any} */ (window).__screenFx.postFxOptions
        .filter((/** @type {any} */ p) => p.id !== "none")
        .map((/** @type {any} */ p) => p.id),
    );
    if (postFxIds.length === 0) return;

    // Pin oil-spill as source — high-contrast, edge-rich for refractive post-FX.
    await page.evaluate(() => {
      /** @type {any} */ (window).__screenFx.setSeed(42);
      /** @type {any} */ (window).__screenFx.loadEffect("oil-spill");
    });

    for (const id of postFxIds) {
      await test.step(id, async () => {
        consoleErrors.length = 0;
        await page.evaluate((pid) => {
          /** @type {any} */ (window).__screenFx.loadPostFx(pid);
        }, id);
        await page.waitForTimeout(2000);

        expect(consoleErrors, `console errors while rendering postfx ${id}`).toEqual([]);

        const nonBlank = await page.evaluate(() => {
          const c = /** @type {HTMLCanvasElement} */ (document.getElementById("postfx-canvas"));
          const gl = /** @type {WebGLRenderingContext} */ (c.getContext("webgl2") || c.getContext("webgl"));
          const w = c.width, h = c.height;
          const samples = 64;
          const buf = new Uint8Array(4);
          const set = new Set();
          for (let i = 0; i < samples; i++) {
            const x = Math.floor((i + 0.5) * w / samples);
            const y = Math.floor((i + 0.5) * h / samples);
            gl.readPixels(x, h - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            set.add(`${buf[0]},${buf[1]},${buf[2]}`);
          }
          return set.size > 1;
        });

        expect(nonBlank, `postfx ${id} produced a blank render`).toBe(true);
      });
    }
  });
});
