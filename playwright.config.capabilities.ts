/**
 * Playwright config for Turn J — real browser tests against the
 * cognitive capability catalog served by bert-smoke-server.
 *
 * Usage:
 *   npx playwright test --config=playwright.config.capabilities.ts
 *
 * This is a DEDICATED config (not the main playwright.config.ts)
 * because:
 *   1. It boots a different webServer (bert-smoke-server on
 *      port 5174 instead of the full dev server).
 *   2. It only runs the cognitive capability spec.
 *   3. It needs a longer action timeout because xlsx/docx/pptx
 *      generation can take 1-3 s in the browser test thread.
 */

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.COGNITIVE_E2E_PORT || "5174");
const baseURL = `http://127.0.0.1:${port}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /cognitive-(capabilities|domain-runtime-matrix)\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `BERT_SMOKE_PORT=${port} npx tsx scripts/bert-smoke-server.ts`,
    url: `${baseURL}/api/cognitive/adapters`,
    timeout: 60_000,
    reuseExistingServer,
    stdout: "pipe",
    stderr: "pipe",
  },
});
