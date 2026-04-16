# screen-fx

Single-page visual playground. No build step. See `PLAN.md` for vision, `ORCHESTRATION.md` + `AGENT.md` for parallel-agent workflow.

## Commands

- `npm run dev` — serve on port 5174
- `npm run check` — tsc + eslint
- `npm run test:fx` — Playwright smoke test (all effects + post-FX)
- macOS: `postinstall` strips provenance xattrs from node_modules (required for binaries to work on Sequoia)

## Architecture

- Effects in `src/fx/<category>/<name>.js` → registered in `src/fx/registry.js`
- Post-FX in `src/fx/postfx/<name>.js` → registered in `src/fx/postfx/registry.js`
- Two stacked canvases: `#effect-canvas` (replaced on each effect swap) + `#postfx-canvas` (stable WebGL2, reads effect canvas via `texImage2D`)
- Frozen surface (orchestrator-only): `src/main.js`, `src/fx/base.js`, `src/fx/postfx/base.js`, `index.html`, `package.json`, tests

## Key learnings

- Canvas can only hold one context type — shell recreates it on swap via `replaceEffectCanvas()`
- Liquid Glass recipe: `offset = edge * refraction + pow(edge, 10) * bevelDepth`, per-channel chromatic, dual-scale specular. Needs edge-rich backdrop to read as glass.
- Flow-field: use curl-of-noise (divergence-free) + particle respawn to prevent attractor pooling
- Parallel agents: use `PORT=$((5174 + RANDOM % 100))` to avoid port collisions. Hold main stable during a batch.

## Task tracking

Priority Forge at `http://127.0.0.1:3456`, project `screen-fx`. Use REST if MCP disconnects.
