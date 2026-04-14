# screen-fx — The Ultimate Screen Prettifier

A single-page, zero-install visual playground. Open the HTML, pick a vibe, fullscreen it, enjoy. Think: lava lamp, mood lighting, ambient backdrop for video calls, chill-out mode, party mode.

## Guiding principles

- **One HTML file, no build step.** Drop it on any machine, double-click, it runs.
- **Two modes, cleanly separated.** Browse/tweak in a windowed UI with a resizable preview tile; enter fullscreen to enjoy. No overlay panels in fullscreen.
- **GPU where it counts.** WebGL fragment shaders for anything continuous; Canvas2D only for simple stuff.
- **Every effect is a preset.** Knobs are optional; a newcomer should get something beautiful in zero clicks.
- **Shareable state.** The full config lives in the URL hash so you can send a friend your exact lava lamp.
- **Performance budget.** Must stay smooth on a laptop on battery. Pause render loop when tab is hidden.

## Tech stack

- **three.js** for scene-graph, post-processing, particles, 3D. Comes with EffectComposer + bloom out of the box.
- **Raw GLSL fragment shaders** rendered on a fullscreen quad for pure 2D effects (gradients, fluids, plasmas).
- **Tailwind via CDN** (`cdn.tailwindcss.com`) for layout and the frosted-glass aesthetic — no build step.
- **Vanilla DOM** for the UI (panel, preview tile, preset grid). No React. Revisit Preact+htm only if the UI grows past a few screens.
- **lil-gui** or a custom panel for controls (matching the frosted-glass look from screen-color.html).
- **Web Audio API** for mic/system-audio reactive modes.
- **localStorage** for saved presets, **URL hash** for shareable state.
- No bundler. ES modules via `<script type="module">` and an import map pointing at a CDN (esm.sh / unpkg).

## UI model

- **Windowed by default.** The page is a real document: controls panel, preset grid, and a **preview tile** that holds the live canvas (starts ~40% viewport, corner-draggable to resize).
- **Preview tile is the permanent home.** Most time is spent here tweaking. Fullscreen is the "ship it" mode, not the default.
- **Preset grid = small preview tiles.** Same primitive at thumbnail size — each tile is a live mini-canvas. Click promotes a tile to the big preview; double-click takes it fullscreen.
- **Click = fullscreen, double-click = exit.** Exiting fullscreen returns to the full windowed UI (no overlay hybrid).
- **Keyboard works in both modes.** F toggles fullscreen, Esc exits, arrows cycle presets, Space pauses, R randomizes, S screenshots — even when the UI is hidden.
- **Cursor auto-hides** after 2s of no movement in fullscreen.
- **Resize contract.** Every effect module must implement `resize(w, h)` cleanly — shaders, particle counts, and fluid grids all need to re-initialize correctly as the preview tile resizes or goes fullscreen.
- **Live-thumbnail budget.** Cap running canvases (~6–8 visible), pause offscreen ones, or round-robin render to a shared offscreen canvas at ~10fps. Decide before building the grid.

## Effect modes (the fun part)

### Color / gradient
- **Solid color** (the existing screen-color app, ported in)
- **Animated gradient** — smooth noise-driven interpolation between N colors. Think Stripe homepage.
- **Mesh gradient** — Apple-style blurred color blobs that drift.
- **Conic / radial sweeps** that slowly rotate.
- **Palette generator** — pull from Coolors-style harmonies (complementary, triadic, analogous) so it always looks tasteful.

### Lava lamp / fluid
- **Metaballs** — classic blobs merging and splitting (SDF shader).
- **Curl-noise fluid** — smoke/ink swirling across the screen.
- **Stable fluid sim** (Jos Stam / Pavel Dobryakov style) — drag your cursor through it.
- **Reaction-diffusion** (Gray-Scott) — organic zebra/coral/slime patterns that evolve.

### Particles
- **Starfield** with warp-speed mode.
- **Fireflies** — slow drifting points of light with bloom.
- **Confetti / snow / rain / petals** with physics.
- **Flow field** — 10k particles following a Perlin noise vector field (Tyler Hobbs vibes).
- **Attractors** — Lorenz, Clifford, De Jong strange attractors.

### Geometric / generative
- **Tunnel / wormhole** — classic shader demo.
- **Kaleidoscope** — tileable procedural patterns with symmetry.
- **Truchet tiles** that slowly rotate/shift.
- **Voronoi cells** with animated seed points.
- **Ray-marched SDFs** — floating shapes, infinite corridors.

### Retro / vibes
- **Plasma** (demoscene classic).
- **VHS / CRT** overlay — scanlines, chromatic aberration, noise, color bleed.
- **Synthwave grid** — perspective floor + sun + mountains.
- **80s starfield + neon text**.
- **Glitch mode** — datamosh, pixel sort, slicing.
- **ASCII / dither** post-processing over any of the above.

## Cross-cutting features

- **Randomize** — dice button that picks random params for the current mode.
- **Save / name your own presets.**
- **URL hash sharing** — copy link, recipient opens the exact state.
- **Screenshot** and **record to WebM** (MediaRecorder on the canvas).
- **Multi-monitor hint** — detect screen.width oddities, suggest spanning.
- **Dark-first UI** — frosted-glass controls panel.
- **Reduced motion** respect — honor `prefers-reduced-motion` by default.

## Architecture sketch

```
screen-fx/
  index.html            single entry, import map + module script
  src/
    main.js             app shell, routing, UI
    ui/
      panel.js          controls panel (reused frosted-glass style)
      presets.js        preset browser
    fx/
      base.js           common FX interface: init(ctx), update(dt), resize(w,h), params schema
      gradient/
      lava/
      particles/
      retro/
    shaders/            .glsl files inlined as strings
    share/              URL-hash serialize/deserialize
    record/             screenshot + WebM recorder
  presets/              JSON preset definitions
```

Each effect module exports the same shape:

```js
export default {
  id: 'lava-metaballs',
  label: 'Lava Lamp',
  category: 'lava',
  params: { /* schema for auto-generated controls */ },
  init(ctx, params) { /* return a renderer */ },
}
```

## Build-order proposal

1. **Shell**: windowed layout with resizable preview tile, frosted-glass panel, preset list, click-to-fullscreen / double-click-to-exit, keyboard shortcuts, URL-hash plumbing.
2. **Port screen-color.html** in as the simplest effect.
3. **Mesh gradient** + **animated gradient** — quick wins, look great.
4. **Metaballs / lava lamp** — the headline feature.
5. **Flow-field particles**.
6. **Post-FX chain**: bloom, grain, vignette, chromatic aberration — applies to any effect.
7. **Screenshot + record + share-link**.
8. **Preset browser with live thumbnails**.
9. Keep adding effects forever.
