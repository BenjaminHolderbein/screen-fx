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
npm run check      # must pass
npm run test:fx    # smoke test must pass for your effect
```

Temporarily add your effect to `src/fx/registry.js` ONLY in your local worktree so the smoke test picks it up. The orchestrator will redo this properly on merge — don't commit that edit. If you do commit it, note it clearly in your report so the merge can be clean.

## Report

When you finish, return:

1. Path of the file you wrote.
2. `npm run check` and `npm run test:fx` results (tail).
3. One sentence on any judgment calls you made (e.g. "used curl-noise instead of stable-fluid because the latter needs FBO ping-pong which would double my scope").
4. A screenshot if you can produce one.
