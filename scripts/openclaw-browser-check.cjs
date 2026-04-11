const { chromium } = require("playwright");

const IGNORED_CONSOLE_ERRORS = [
  "fonts.googleapis.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "vite-hmr",
  "localhost:5173",
  "ERR_CONNECTION_REFUSED",
  "violates the following Content Security Policy",
  "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const wsOpened = [];
  const wsClosed = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") {
      return;
    }
    const text = msg.text();
    consoleErrors.push(text);
    console.log("CONSOLE_ERROR", text);
  });

  page.on("pageerror", (err) => {
    const text = err.message || String(err);
    pageErrors.push(text);
    console.log("PAGE_ERROR", text);
  });

  page.on("websocket", (ws) => {
    const url = ws.url();
    wsOpened.push(url);
    console.log("WS_OPEN", url);
    ws.on("close", () => {
      wsClosed.push(url);
      console.log("WS_CLOSE", url);
    });
    ws.on("socketerror", (err) => {
      console.log("WS_SOCKET_ERROR", url, err);
    });
  });

  const response = await page.goto("http://127.0.0.1:41731/openclaw", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  console.log("HTTP_STATUS", response && response.status());

  await page.waitForTimeout(12000);
  console.log("CHECKPOINT", "after-wait");

  const relevantConsoleErrors = consoleErrors.filter(
    (text) => IGNORED_CONSOLE_ERRORS.some((fragment) => text.includes(fragment)) === false,
  );
  const unexpectedParseError = pageErrors.some((text) => text.includes("Unexpected token 'return'"));
  const openedGatewayWs = wsOpened.some((url) => url.includes("/openclaw-ws"));
  const closedGatewayWs = wsClosed.some((url) => url.includes("/openclaw-ws"));
  const summary = {
    wsOpened,
    wsClosed,
    relevantConsoleErrors,
    pageErrors,
    checks: {
      unexpectedParseError,
      openedGatewayWs,
      closedGatewayWs,
    },
  };

  console.log("SUMMARY", JSON.stringify(summary, null, 2));

  console.log("CHECKPOINT", "before-browser-close");
  await browser.close();
  console.log("CHECKPOINT", "after-browser-close");

  if (
    unexpectedParseError ||
    openedGatewayWs === false ||
    closedGatewayWs ||
    relevantConsoleErrors.length > 0
  ) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("BROWSER_CHECK_FATAL", error);
  process.exit(1);
});
