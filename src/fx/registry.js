import solidColor from "./gradient/solid-color.js";
import animatedGradient from "./gradient/animated-gradient.js";
import meshGradient from "./gradient/mesh-gradient.js";
import lavaMetaballs from "./lava/metaballs.js";
import curlNoiseFluid from "./lava/curl-noise-fluid.js";
import flowField from "./particles/flow-field.js";
import starfield from "./particles/starfield.js";
import plasma from "./retro/plasma.js";
import keyLight from "./functional/key-light.js";
import liquidGlassSlab from "./generative/liquid-glass-slab.js";
import causticSea from "./generative/caustic-sea.js";
import oilSpill from "./generative/oil-spill.js";
import { assertFxModule } from "./base.js";

/**
 * Single source of truth for available effects. Agents add their effect here
 * as the final step of their task.
 */
export const effects = [
  solidColor,
  animatedGradient,
  meshGradient,
  lavaMetaballs,
  curlNoiseFluid,
  flowField,
  starfield,
  plasma,
  keyLight,
  liquidGlassSlab,
  causticSea,
  oilSpill,
].map(assertFxModule);

/** @param {string} id */
export function getEffect(id) {
  return effects.find((e) => e.id === id);
}
