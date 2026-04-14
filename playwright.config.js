import { defineConfig, devices } from "@playwright/test";

// Per-worktree port to avoid collisions when multiple agents run tests in
// parallel. Override with PORT env var; default 5173. Each worktree should
// set its own PORT.
const port = Number(process.env.PORT || 5173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `npx serve -l ${port} .`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
