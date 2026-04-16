/**
 * Post-FX module contract. A post-FX consumes the previous render stage
 * (initially the effect canvas) as a texture and composites a new image
 * onto the shared post-FX canvas.
 *
 * @typedef {Object} PostFxContext
 * @property {HTMLCanvasElement} canvas       // the stable #postfx-canvas
 * @property {WebGL2RenderingContext} gl      // shared, owned by main.js
 * @property {number} width
 * @property {number} height
 * @property {number} dpr
 *
 * @typedef {Object} PostFxRenderer
 * @property {(srcCanvas: HTMLCanvasElement, dt: number, time: number) => void} apply
 * @property {(w: number, h: number) => void} resize
 * @property {() => void} dispose
 *
 * @typedef {Object} PostFxModule
 * @property {string} id
 * @property {string} label
 * @property {Record<string, import("../base.js").ParamSpec>} params
 * @property {(ctx: PostFxContext, params: Record<string, any>, seed: number) => PostFxRenderer} init
 */

export function assertPostFxModule(mod) {
  if (!mod || typeof mod !== "object") throw new Error("postfx: not an object");
  for (const key of ["id", "label", "params", "init"]) {
    if (!(key in mod)) throw new Error(`postfx: missing "${key}"`);
  }
  if (typeof mod.id !== "string" || !/^[a-z0-9-]+$/.test(mod.id)) {
    throw new Error(`postfx: bad id "${mod.id}"`);
  }
  return mod;
}
