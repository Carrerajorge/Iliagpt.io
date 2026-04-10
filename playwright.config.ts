import { defineConfig, devices } from "playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT || "41731");
const appHost = process.env.PLAYWRIGHT_APP_HOST || "127.0.0.1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://${appHost}:${appPort}`;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 120000,
  expect: {
    timeout: 30000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: `PORT=${appPort} BASE_URL=${baseURL} npm run dev`,
        url: baseURL,
        // Reusing an arbitrary server on a common port is unsafe on macOS where
        // system services can answer on localhost:5000 and make the suite attach
        // to the wrong process. Keep it opt-in for local debugging.
        reuseExistingServer,
        timeout: 120000,
      },
});
