# screen-fx

A single-page visual playground — generative gradients, lava lamps, starfields, liquid glass, and more, with layerable post-FX (bloom, film grain, vignette).

## Try it

Download [`screen-fx.html`](screen-fx.html) and double-click. No server, no install, no internet — it's one self-contained HTML file (~95 KB).

Works in any modern browser with WebGL2 (Chrome, Firefox, Safari, Edge from the last few years).

## Controls

- **F** — fullscreen
- **Esc** — exit fullscreen
- **← / →** — cycle effects
- **Space** — pause
- **R** — randomize seed
- **S** — screenshot

## Effects

11 effects across 6 categories: gradients, lava, particles, retro, generative, functional. Each has its own tweakable params (colors, speeds, counts) — all state round-trips through the URL hash, so you can bookmark or share a look.

Post-FX layer on top: bloom, film grain, vignette, and a liquid-glass slab compositor.

## Development

No build step for dev — just serve the repo and open it.

```bash
npm install
npm run dev        # serves on localhost:5174
npm run check      # tsc + eslint
npm run test:fx    # Playwright smoke test
npm run build      # produces screen-fx.html at the repo root
```

### Adding an effect

See [`AGENT.md`](AGENT.md) for the effect contract. Briefly: drop a file at `src/fx/<category>/<id>.js` that default-exports an `FxModule`, then register it in `src/fx/registry.js`.

### Architecture

- Effects live in `src/fx/<category>/<id>.js`, registered in `src/fx/registry.js`
- Post-FX lives in `src/fx/postfx/<id>.js`, registered in `src/fx/postfx/registry.js`
- Two stacked canvases: `#effect-canvas` (swapped per effect) and `#postfx-canvas` (stable WebGL2, reads the effect canvas as a texture)
- UI bits (color picker, preset browser, backlight) live in `src/ui/`

### Dev hooks

The browser console exposes `window.__screenFx` with:
- `loadEffect(id)`, `loadPostFx(id)`, `setSeed(n)`, `setParam(k, v)`
- `perfStats.reset()` / `.getStats()` — frame-time stats, 33ms hitch threshold
- `backlight.enable()` / `.disable()` / `.isEnabled()`
- `presetPreview.enable()` / `.disable()` / `.isEnabled()` (off by default)

## License

MIT — see [`LICENSE`](LICENSE).
