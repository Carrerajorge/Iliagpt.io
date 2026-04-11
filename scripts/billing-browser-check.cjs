const path = require("path");

const dotenv = require("dotenv");
const { chromium, request } = require("playwright");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const DEFAULT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:41731";
const IGNORED_CONSOLE_ERRORS = [
  "fonts.googleapis.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "vite-hmr",
  "localhost:5173",
  "ERR_CONNECTION_REFUSED",
  "violates the following Content Security Policy",
  "Failed to load resource: the server responded with a status of 404",
  "Failed to load resource: the server responded with a status of 401",
  "Failed to load resource: the server responded with a status of 403",
];

async function main() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error("Missing ADMIN_EMAIL or ADMIN_PASSWORD in .env.local");
  }

  const api = await request.newContext({
    baseURL: DEFAULT_BASE_URL,
    extraHTTPHeaders: { "content-type": "application/json" },
  });

  const loginResponse = await api.post("/api/auth/admin-login", {
    data: {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    },
  });
  const loginBody = await loginResponse.text();
  console.log("LOGIN_STATUS", loginResponse.status());
  console.log("LOGIN_BODY", loginBody);

  if (!loginResponse.ok()) {
    throw new Error(`Admin login failed: ${loginResponse.status()} ${loginBody}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: DEFAULT_BASE_URL,
    storageState: await api.storageState(),
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    consoleErrors.push(text);
    console.log("CONSOLE_ERROR", text);
  });

  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    pageErrors.push(text);
    console.log("PAGE_ERROR", text);
  });

  const billingResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/billing/status"),
    { timeout: 20000 },
  );

  const navResponse = await page.goto(`${DEFAULT_BASE_URL}/billing`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  console.log("PAGE_STATUS", navResponse && navResponse.status());

  const billingResponse = await billingResponsePromise;
  const billingPayload = await billingResponse.text();
  console.log("BILLING_STATUS", billingResponse.status());
  console.log("BILLING_BODY", billingPayload);

  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const hasHeader = await page.getByRole("heading", { name: "Facturación" }).first().isVisible();
  const hasErrorBanner = await page.getByText("No se pudo cargar la facturación").first().isVisible().catch(() => false);
  const failedStatusVisible = await page.getByText(/Failed to get billing status/i).first().isVisible().catch(() => false);

  const relevantConsoleErrors = consoleErrors.filter(
    (text) => IGNORED_CONSOLE_ERRORS.some((fragment) => text.includes(fragment)) === false,
  );

  const summary = {
    hasHeader,
    hasErrorBanner,
    failedStatusVisible,
    relevantConsoleErrors,
    pageErrors,
  };
  console.log("SUMMARY", JSON.stringify(summary, null, 2));

  await browser.close();
  await api.dispose();

  if (!hasHeader || hasErrorBanner || failedStatusVisible || billingResponse.status() !== 200) {
    throw new Error(`Billing page did not render correctly: ${JSON.stringify(summary)}`);
  }

  if (relevantConsoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`Unexpected browser errors: ${JSON.stringify(summary)}`);
  }
}

main().catch((error) => {
  console.error("BILLING_BROWSER_CHECK_FATAL", error);
  process.exit(1);
});
