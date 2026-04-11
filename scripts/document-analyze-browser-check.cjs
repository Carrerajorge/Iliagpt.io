const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:41731";
const DEFAULT_FIXTURE = process.env.DOCUMENT_ANALYZE_FIXTURE || path.join(process.cwd(), "artifacts", "1775856519337_ventas.xlsx");
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

function parseSse(raw) {
  return String(raw || "")
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const eventMatch = block.match(/^event:\s*(.+)$/m);
      const dataMatch = block.match(/^data:\s*(.+)$/m);
      if (!eventMatch || !dataMatch) {
        return null;
      }
      try {
        return {
          event: eventMatch[1].trim(),
          data: JSON.parse(dataMatch[1]),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function main() {
  if (!fs.existsSync(DEFAULT_FIXTURE)) {
    throw new Error(`Fixture not found: ${DEFAULT_FIXTURE}`);
  }

  const fileName = path.basename(DEFAULT_FIXTURE);
  const base64 = fs.readFileSync(DEFAULT_FIXTURE).toString("base64");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      consoleErrors.push(text);
      console.log("CONSOLE_ERROR", text);
    }
  });

  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    pageErrors.push(text);
    console.log("PAGE_ERROR", text);
  });

  const response = await page.goto(DEFAULT_BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  console.log("HTTP_STATUS", response && response.status());

  const rawSse = await page.evaluate(
    async ({ baseUrl, fileName, base64 }) => {
      const response = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Anonymous-User-Id": "browser-check-user",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Dame un resumen ejecutivo" }],
          conversationId: "browser-check-analyze",
          attachments: [
            {
              id: "browser-check-file",
              fileId: "browser-check-file",
              type: "document",
              name: fileName,
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              content: base64,
            },
          ],
        }),
      });

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(`Missing readable body: ${response.status}`);
      }

      const decoder = new TextDecoder();
      let raw = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }

      return raw;
    },
    { baseUrl: DEFAULT_BASE_URL, fileName, base64 },
  );

  const events = parseSse(rawSse);
  const eventNames = events.map((entry) => entry.event);
  const errorEvent = events.find((entry) => entry.event === "error");
  const doneEvent = events.find((entry) => entry.event === "done");

  console.log("EVENTS", JSON.stringify(eventNames));
  console.log("DONE", JSON.stringify(doneEvent && doneEvent.data, null, 2));

  await browser.close();

  const relevantConsoleErrors = consoleErrors.filter(
    (text) => IGNORED_CONSOLE_ERRORS.some((fragment) => text.includes(fragment)) === false,
  );

  if (pageErrors.length > 0 || relevantConsoleErrors.length > 0) {
    throw new Error(`Browser errors detected: ${JSON.stringify({ pageErrors, consoleErrors: relevantConsoleErrors })}`);
  }

  if (errorEvent) {
    throw new Error(`Analyze SSE emitted error: ${JSON.stringify(errorEvent.data)}`);
  }

  if (!doneEvent || typeof doneEvent.data?.answer_text !== "string" || !doneEvent.data.answer_text.trim()) {
    throw new Error(`Analyze SSE did not complete with answer_text: ${JSON.stringify(doneEvent && doneEvent.data)}`);
  }

  if (/No se recibi[oó] respuesta del servidor/i.test(doneEvent.data.answer_text)) {
    throw new Error(`Analyze SSE still returned empty-stream failure: ${doneEvent.data.answer_text}`);
  }
}

main().catch((error) => {
  console.error("DOCUMENT_ANALYZE_BROWSER_CHECK_FATAL", error);
  process.exit(1);
});
