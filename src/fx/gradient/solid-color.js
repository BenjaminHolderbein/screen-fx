/**
 * Reference effect. Simple, no shaders, no RAF-dependent animation — exists
 * to prove the contract and give the test harness a known-good target.
 */

/** @type {import("../base.js").FxModule} */
export default {
  id: "solid-color",
  label: "Solid Color",
  category: "gradient",
  params: {
    color: { type: "color", default: "#7c3aed", label: "Color" },
  },
  init(ctx, params, _seed) {
    const { canvas } = ctx;
    const gl2d = canvas.getContext("2d");
    if (!gl2d) throw new Error("solid-color: 2d context unavailable");
    let current = params.color;

    const paint = () => {
      gl2d.fillStyle = current;
      gl2d.fillRect(0, 0, canvas.width, canvas.height);
    };
    paint();

    return {
      update(_dt, _time) {
        if (current !== params.color) {
          current = params.color;
          paint();
        }
      },
      resize(_w, _h) {
        paint();
      },
      dispose() {},
    };
  },
};
