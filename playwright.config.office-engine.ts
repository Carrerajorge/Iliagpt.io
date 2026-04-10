/**
 * Playwright config dedicated to the Office Engine demo e2e test.
 *
 * Differs from the default playwright.config.ts in three ways:
 *   - baseURL points at :5050 (where the Office Engine + SPA live)
 *   - no `webServer` block (we expect the dev server to be already running)
 *   - smaller test surface — only e2e/office-engine-demo.spec.ts
 *
 * Run with: `npx playwright test --config=playwright.config.office-engine.ts`
 */

import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /office-engine-demo\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-office-engine", open: "never" }]],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.OFFICE_ENGINE_BASE_URL ?? "http://localhost:5050",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // No `webServer` — the test assumes a dev server is already running on
  // OFFICE_ENGINE_BASE_URL (default :5050).
});
