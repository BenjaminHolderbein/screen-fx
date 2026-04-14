import solidColor from "./gradient/solid-color.js";
import animatedGradient from "./gradient/animated-gradient.js";
import lavaMetaballs from "./lava/metaballs.js";
import { assertFxModule } from "./base.js";

/**
 * Single source of truth for available effects. Agents add their effect here
 * as the final step of their task.
 */
export const effects = [solidColor, animatedGradient, lavaMetaballs].map(assertFxModule);

/** @param {string} id */
export function getEffect(id) {
  return effects.find((e) => e.id === id);
}
