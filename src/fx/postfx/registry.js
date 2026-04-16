import liquidGlassSlab from "./liquid-glass-slab.js";
import { assertPostFxModule } from "./base.js";

/**
 * Sentinel "none" entry in the dropdown — selecting it clears any active
 * post-FX. Doesn't satisfy the PostFxModule contract; consumers must check
 * for id === "none" before treating it as a module.
 */
export const NONE = { id: "none", label: "None" };

export const postFx = [liquidGlassSlab].map(assertPostFxModule);

export const postFxOptions = [NONE, ...postFx];

/** @param {string} id */
export function getPostFx(id) {
  return postFx.find((p) => p.id === id);
}
