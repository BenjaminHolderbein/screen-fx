/**
 * Effect contract. Every effect module in src/fx/<category>/<id>.js must
 * default-export an object of this shape.
 *
 * @typedef {Object} ParamSpec
 * @property {"number"|"color"|"bool"|"enum"} type
 * @property {any} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string[]} [options]
 * @property {string} [label]
 *
 * @typedef {Object} FxContext
 * @property {HTMLCanvasElement} canvas
 * @property {number} width
 * @property {number} height
 * @property {number} dpr
 *
 * @typedef {Object} FxRenderer
 * @property {(dt: number, time: number) => void} update  // dt in seconds, time = seeded wall-clock
 * @property {(w: number, h: number) => void} resize
 * @property {() => void} dispose
 *
 * @typedef {Object} FxModule
 * @property {string} id                          // kebab-case, unique: "lava-metaballs"
 * @property {string} label                       // human: "Lava Lamp"
 * @property {string} category                    // "gradient" | "lava" | "particles" | "retro" | "generative"
 * @property {Record<string, ParamSpec>} params
 * @property {(ctx: FxContext, params: Record<string, any>, seed: number) => FxRenderer} init
 */

/**
 * Validates that an object conforms to the FxModule contract. Throws on the
 * first violation. Called by the shell when loading an effect; tests should
 * call it too.
 * @param {any} mod
 * @returns {FxModule}
 */
export function assertFxModule(mod) {
  if (!mod || typeof mod !== "object") throw new Error("fx: not an object");
  for (const key of ["id", "label", "category", "params", "init"]) {
    if (!(key in mod)) throw new Error(`fx: missing "${key}"`);
  }
  if (typeof mod.id !== "string" || !/^[a-z0-9-]+$/.test(mod.id)) {
    throw new Error(`fx: bad id "${mod.id}" (must be kebab-case)`);
  }
  if (typeof mod.init !== "function") throw new Error("fx: init must be a function");
  if (typeof mod.params !== "object") throw new Error("fx: params must be an object");
  return mod;
}

/**
 * Deterministic RNG (mulberry32). Every effect receives a seed; when tests
 * run, they pin the seed so renders are reproducible.
 * @param {number} seed
 */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pulls defaults out of a params schema.
 * @param {Record<string, ParamSpec>} schema
 */
export function defaultParams(schema) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, spec] of Object.entries(schema)) out[k] = spec.default;
  return out;
}
