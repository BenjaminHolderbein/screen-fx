# Orchestration

How we parallelize effect development across multiple Claude agents.

## Model

- **One orchestrator** (the main Claude session) owns `main`, the shell, and the fx contract.
- **One worker agent per effect**, spawned in a **git worktree**, committing to `fx/<effect-id>`.
- The orchestrator merges each branch after it passes checks.

## Frozen surface (orchestrator-only)

Parallel agents must NOT modify:

- `src/main.js`
- `src/fx/base.js`
- `src/fx/registry.js` (the orchestrator adds the import during merge)
- `index.html`
- `package.json`, `playwright.config.js`, `jsconfig.json`, `eslint.config.js`
- `tests/smoke.spec.js`

Any change to the frozen surface is a sequential task on `main`, done before fanning out again.

## Worker scope

Each worker owns exactly one path: `src/fx/<category>/<id>.js` (plus sibling helper files under the same directory if truly needed, e.g. `src/fx/lava/metaballs.glsl.js`). Nothing else.

## Branch + worktree flow

Orchestrator spawns each agent with `isolation: "worktree"`. The SDK creates a worktree under `.worktrees/<id>/` on a fresh branch off `main`. The agent works there, commits, and the orchestrator merges.

Merge criteria (all must pass in the worktree before merge):

1. `npm run check` — types + lint clean
2. `npm run test:fx` — smoke test passes for the new effect
3. Visual spot-check via Playwright MCP or screenshot attached to the agent's report

Orchestrator merges, then updates `src/fx/registry.js` on `main` to import the new effect. Re-runs the full smoke suite on `main` before spawning the next batch.

## Agent brief template

Use `AGENT.md` verbatim as the per-worker prompt, filling in `{{effect_id}}`, `{{label}}`, `{{category}}`, and `{{description}}`.

## Parallelism budget

Start with 3 agents in parallel. Scale up only after the first batch merges cleanly. More than ~5 parallel workers is rarely worth it — cost savings plateau and review overhead grows.

## Kill switches

- A worker loops on the same failing test twice → stop it, read its output, either fix the contract (sequential work) or rewrite the brief.
- A worker edits frozen surface → reject the branch, respawn with stricter brief.
- Playwright server port conflicts across worktrees → each worktree sets `PORT` env to `5173 + <n>`.

## Deletion

This document is temporary. Delete it (and `AGENT.md`) when the effect library is large enough that the build pattern is obvious from the code.
