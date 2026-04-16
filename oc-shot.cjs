const { chromium } = require("playwright-core");
const EXE = "/Users/luis/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  
  try {
    await page.goto("http://localhost:5050/openclaw-ui/chat?session=main", { waitUntil: "commit", timeout: 10000 });
  } catch(e) {}
  
  // Wait for dashboard OR login-gate to be visible
  try {
    await page.waitForSelector("body", { state: "visible", timeout: 5000 });
  } catch(e) { console.log("no body:", e.message); }
  
  await new Promise(r => setTimeout(r, 5000));
  
  // Use CDP screenshot directly
  try {
    const client = await page.context().newCDPSession(page);
    const { data } = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    require("fs").writeFileSync("/tmp/oc-cdp.png", Buffer.from(data, "base64"));
    console.log("CDP_SCREENSHOT_OK");
  } catch(e) { console.log("CDP_ERR:", e.message); }
  
  await browser.close();
})().catch(e => console.error("FATAL:", e.message));
