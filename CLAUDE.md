# screen-fx — Project Instructions

## What this is

Single-page, zero-install visual playground. Open `index.html`, pick a vibe, fullscreen it. See `PLAN.md` for the full product vision.

## Architecture

- **One HTML file, no build step.** ES modules via import map + CDN (Tailwind, three.js). Dev server: `npm run dev` (port 5174).
- **macOS Sequoia xattr fix:** `npm install` triggers a `postinstall` hook that strips `com.apple.provenance` xattrs from `node_modules` — without this, `serve`/`eslint`/`playwright` binaries fail with "Interrupted system call."
- **Effects** live in `src/fx/<category>/<name>.js`, each exporting an `FxModule` (see `src/fx/base.js` for the contract). Registered in `src/fx/registry.js`.
- **Post-FX** live in `src/fx/postfx/<name>.js`, each exporting a `PostFxModule` (see `src/fx/postfx/base.js`). Registered separately in `src/fx/postfx/registry.js`. Post-FX composites the effect canvas via `texImage2D(canvas)` onto a stable `#postfx-canvas`.
- **Two stacked canvases** in `#preview-wrap`: `#effect-canvas` (replaceable on every effect swap — the 2D/WebGL coexistence trick) + `#postfx-canvas` (stable, single WebGL2 context for the app lifetime). One is hidden when the other is active.
- **Params:** `number`, `color`, `bool`, `enum`, `colorArray` types. Shell renders UI automatically from the params schema. Per-effect params are isolated (no cross-bleed between effects).
- **URL hash** encodes full state (effectId, params, postFxId, postFxParams, seed) for sharing.
- **Custom color picker** at `src/ui/color-picker.js` — frosted-glass popover with SV square + hue slider + hex input. Replaces native `<input type="color">`.

## Parallel agent workflow

See `ORCHESTRATION.md` and `AGENT.md` for the full protocol. Summary:

- **Frozen surface** (orchestrator-only): `src/main.js`, `src/fx/base.js`, `src/fx/postfx/base.js`, `index.html`, `package.json`, `tests/`, config files. Agents must not modify these.
- **`src/fx/registry.js` and `src/fx/postfx/registry.js`** are editable by agents (additive only — never remove existing entries).
- Each agent runs in an **isolated git worktree** (`isolation: "worktree"` on Agent calls). Agents commit to their worktree branch; the orchestrator cherry-picks or copies files into main.
- **Per-worktree ports:** agents should use `PORT=$((5174 + RANDOM % 100)) npm run test:fx` to avoid port collisions.
- Agents check their work with `npm run check` (tsc + eslint) and `npm run test:fx` (Playwright smoke). Visual verification via Playwright MCP screenshots.
- **Stale-branch risk:** if you push to main between spawning and completing agents, their branches diverge. Mitigate by batching — hold main stable while a batch runs, merge all at once.

## Smoke test

`npm run test:fx` runs Playwright headless Chromium:
- Iterates all registered effects, loads each with seed=42, waits 2s, asserts no console errors + non-blank render.
- Iterates all registered post-FX, loads each over `oil-spill` as source, asserts same.
- No screenshot diffing (too brittle for animated effects). Visual review is human + Playwright MCP.

## Priority Forge

Task tracker MCP at `http://127.0.0.1:3456`. Project registered as `screen-fx`. Use REST fallback if MCP session expires:
```bash
curl -s http://127.0.0.1:3456/tasks | head  # list
curl -s -X POST http://127.0.0.1:3456/tasks -H "Content-Type: application/json" -d '{"task":"...","priority":"P1","project":"screen-fx","effort":"medium"}'
curl -s -X PUT http://127.0.0.1:3456/tasks/TASK-ID -H "Content-Type: application/json" -d '{"status":"in_progress"}'
curl -s -X POST http://127.0.0.1:3456/tasks/TASK-ID/complete -H "Content-Type: application/json" -d '{"outcome":"completed"}'
```

## Current state (as of 2026-04-15)

**11 effects:** solid-color, animated-gradient, mesh-gradient, metaballs (with organic shape variance), curl-noise-fluid, flow-field (curl-noise + respawn fix), starfield, plasma, key-light, caustic-sea, oil-spill.

**1 post-FX:** liquid-glass-slab (DVD-bounce glass tile with bevel-lip refraction, chromatic dispersion, dual-scale specular — refracts whatever effect is running).

**Pending work (check Priority Forge for current backlog):**
- Post-FX: bloom, film grain, vignette (3 parallel agents, architecture supports it now)
- Mandelbrot zoom (spec ready, agent picks precision approach)
- Preset browser with live thumbnails (IndexedDB-cached + hover-to-animate)
- Save/named presets, screenshot + WebM recording
- Color picker visual upgrade (blocked on user direction)
- Kaleidoscope, randomize button

## Key learnings for future agents

- **Canvas context stickiness:** a canvas can only hold one context type (2D or WebGL). The shell recreates the effect canvas on every swap via `replaceEffectCanvas()`. Post-FX canvas is stable (single WebGL2 for life).
- **Liquid Glass recipe:** the proven formula is edge-concentrated refraction via `offset = edge * refraction + pow(edge, 10) * bevelDepth`, per-channel chromatic offset of the same displacement vector, dual-scale specular (broad + tight), rim highlight + inner shadow. Requires edge-rich backdrop content to read as glass rather than "wavy gradient." Beer-Lambert absorption and caustic bands read as water, not glass.
- **Flow-field convergence:** raw noise-as-angle flows pool into attractors. Fix: curl-of-noise (divergence-free) + per-particle lifespan with respawn.
- **Oil-spill backdrop:** domain-warped FBM iridescence. Good high-contrast source for refraction-based post-FX.
