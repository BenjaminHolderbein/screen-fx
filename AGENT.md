# Worker agent brief

You are implementing a single effect for the screen-fx project. Your scope is one file: `src/fx/{{category}}/{{effect_id}}.js`.

## The effect

- **id:** `{{effect_id}}`
- **label:** `{{label}}`
- **category:** `{{category}}`
- **description:** {{description}}

## Contract

Read `src/fx/base.js`. Your module must default-export an `FxModule`:

```js
export default {
  id: "{{effect_id}}",
  label: "{{label}}",
  category: "{{category}}",
  params: { /* ParamSpec map — see base.js */ },
  init(ctx, params, seed) {
    // ctx: { canvas, width, height, dpr }
    // params: current values (mutated from the outside; read them each frame)
    // seed: integer for deterministic RNG — use makeRng(seed) from base.js
    return {
      update(dt, time) { /* render one frame. time is seeded wall-clock in seconds. */ },
      resize(w, h)    { /* reinit size-dependent state. */ },
      dispose()       { /* free GPU buffers, abort RAFs you started, etc. */ },
    };
  },
};
```

Hard requirements:

- **Deterministic under a fixed seed.** Given the same seed, the frame at `time = 2.0s` must be pixel-identical across runs. Use `makeRng(seed)` — never `Math.random()`.
- **No global side effects.** No `window.addEventListener`, no `document.body` mutations, no timers outside your own RAFs.
- **`dispose()` must fully clean up.** Tests load effects repeatedly; leaks compound.
- **Don't touch frozen files.** See `ORCHESTRATION.md` for the list.

## Tech

- three.js available via import map (`import * as THREE from "three"`).
- Raw WebGL is fine too (`canvas.getContext("webgl2")`).
- Canvas2D for simple stuff.
- GLSL goes inline as JS template strings in your effect file or a sibling `{{effect_id}}.glsl.js`.

## Acceptance

From your worktree:

```bash
npm install        # once per worktree
PORT=$((5173 + RANDOM % 100)) npm run test:fx  # use a unique port — other agents may be running
npm run check      # must pass
```

Add your effect to `src/fx/registry.js` alongside the existing entries — don't remove others. The shell now swaps the `<canvas>` element between effect switches, so 2D and WebGL effects coexist fine. The orchestrator will review the registry edit on merge. Note it in your report either way.

The smoke test no longer diffs screenshots — it only checks for console errors and non-blank output. That means **you cannot fake stability by freezing animation**; if your effect is supposed to animate, it must actually animate continuously. Visual review is done by a human with Playwright MCP or the browser.

## Report

When you finish, return:

1. Path of the file you wrote.
2. `npm run check` and `npm run test:fx` results (tail).
3. One sentence on any judgment calls you made (e.g. "used curl-noise instead of stable-fluid because the latter needs FBO ping-pong which would double my scope").
4. A screenshot if you can produce one.
