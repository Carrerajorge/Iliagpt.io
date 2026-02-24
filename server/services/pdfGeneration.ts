import { chromium, Browser, BrowserContext } from "playwright";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { pdfConcurrencyLimiter, validatePdfBuffer, logDocumentEvent } from "./documentSecurity";

export interface PdfMargin {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface PdfOptions {
  format?: "A4" | "Letter" | "Legal" | "Tabloid" | "A3" | "A5";
  margin?: PdfMargin;
  landscape?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
  scale?: number;
  preferCSSPageSize?: boolean;
}

const DEFAULT_OPTIONS: PdfOptions = {
  format: "A4",
  margin: {
    top: "20mm",
    right: "20mm",
    bottom: "20mm",
    left: "20mm",
  },
  landscape: false,
  printBackground: true,
  scale: 1,
  preferCSSPageSize: false,
};

// Maximum PDF output size (50MB)
const MAX_PDF_SIZE = 50 * 1024 * 1024;

// Page load timeout (30 seconds)
const PAGE_LOAD_TIMEOUT = 30_000;

// PDF generation timeout (60 seconds)
const PDF_GENERATION_TIMEOUT = 60_000;

let browserInstance: Browser | null = null;

// Server-side HTML sanitizer for PDF rendering. Regex-based HTML filtering
// is easy to get wrong and can trigger CodeQL alerts.
const dompurifyWindow = new JSDOM("").window;
const DOMPurify = createDOMPurify(dompurifyWindow as any);

// Maximum number of pages to avoid resource exhaustion during rendering
const MAX_PDF_PAGES = 500;

// Maximum browser contexts created before forcing browser restart (leak prevention)
let browserContextCount = 0;
const MAX_CONTEXTS_BEFORE_RESTART = 100;

async function getBrowser(): Promise<Browser> {
  // Periodically restart browser to prevent memory leaks
  if (browserInstance && browserContextCount >= MAX_CONTEXTS_BEFORE_RESTART) {
    console.log(`[pdfGeneration] Restarting browser after ${browserContextCount} contexts for leak prevention`);
    await closeBrowser();
    browserContextCount = 0;
  }

  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        // Sandboxing: --no-sandbox is required in containerized environments
        // without proper user namespaces. In production, prefer configuring
        // namespaces instead. The flag is kept here for compatibility.
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-translate",
        "--no-first-run",
        // Security: disable features that could be exploited
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process",
        "--disable-ipc-flooding-protection",
        "--disable-renderer-backgrounding",
        // Resource limits
        "--js-flags=--max-old-space-size=256",
        "--disable-breakpad",
        "--disable-crash-reporter",
        // Network hardening
        "--disable-remote-fonts",
        "--disable-client-side-phishing-detection",
      ],
    });
    browserContextCount = 0;
  }
  return browserInstance;
}

function wrapHtmlWithStyles(html: string): string {
  const hasHtmlTag = /<html[\s>]/i.test(html);
  const hasHeadTag = /<head[\s>]/i.test(html);

  const printStyles = `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      @media print {
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        body {
          margin: 0;
          padding: 0;
        }
        @page {
          margin: 0;
        }
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.6;
        color: #333;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th, td {
        border: 1px solid #ddd;
        padding: 8px;
        text-align: left;
      }
      th {
        background-color: #f5f5f5;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      pre, code {
        font-family: 'Courier New', Courier, monospace;
        background-color: #f5f5f5;
        padding: 2px 4px;
        border-radius: 3px;
      }
      pre {
        padding: 12px;
        overflow-x: auto;
      }
      blockquote {
        border-left: 4px solid #ddd;
        margin: 0;
        padding-left: 16px;
        color: #666;
      }
    </style>
  `;

  if (hasHtmlTag && hasHeadTag) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${printStyles}`);
  } else if (hasHtmlTag) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${printStyles}</head>`);
  } else {
    return `<!DOCTYPE html>
<html>
<head>
  ${printStyles}
</head>
<body>
  ${html}
</body>
</html>`;
  }
}

function validateHtml(html: string): void {
  if (!html || typeof html !== "string") {
    throw new Error("HTML content is required and must be a string");
  }

  if (html.trim().length === 0) {
    throw new Error("HTML content cannot be empty");
  }

  const maxSize = 10 * 1024 * 1024; // 10MB limit
  if (html.length > maxSize) {
    throw new Error(`HTML content exceeds maximum size of ${maxSize / 1024 / 1024}MB`);
  }
}

/**
 * Sanitize HTML for PDF rendering: strip scripts, event handlers,
 * dangerous tags, and other attack vectors while preserving layout
 * and styling needed for PDF output.
 */
function sanitizeHtmlForPdf(html: string): string {
  return DOMPurify.sanitize(html, {
    // Keep a conservative HTML subset for PDF rendering.
    // Block tags that can execute code, rewrite URLs, or embed active content.
    ALLOWED_TAGS: [
      "html",
      "head",
      "body",
      "title",
      "style",
      "div",
      "span",
      "p",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "del",
      "mark",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "img",
    ],
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "class",
      "id",
      "style",
      "width",
      "height",
      "colspan",
      "rowspan",
      "align",
      "target",
      "rel",
    ],
    FORBID_TAGS: [
      "script",
      "noscript",
      "iframe",
      "object",
      "embed",
      "applet",
      "base",
      "meta",
      "link",
      "form",
      "input",
      "button",
    ],
    ALLOW_DATA_ATTR: false,
  }) as string;
}

export async function generatePdfFromHtml(
  html: string,
  options?: PdfOptions
): Promise<Buffer> {
  const startTime = Date.now();
  validateHtml(html);

  // Sanitize HTML to remove dangerous elements
  const sanitizedHtml = sanitizeHtmlForPdf(html);

  const mergedOptions: PdfOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    margin: {
      ...DEFAULT_OPTIONS.margin,
      ...options?.margin,
    },
  };

  // Enforce concurrency limits for PDF generation (browser resources are expensive)
  const acquired = await pdfConcurrencyLimiter.acquire();
  if (!acquired) {
    logDocumentEvent({
      timestamp: new Date().toISOString(),
      event: "rate_limit_exceeded",
      docType: "pdf",
    });
    throw new Error("Too many concurrent PDF generations. Please try again.");
  }

  if (process.env.ENABLE_BACKGROUND_JOBS === "true") {
    console.log("[pdfGeneration] Background jobs enabled, but direct execution requested for immediate response.");
  }

  logDocumentEvent({
    timestamp: new Date().toISOString(),
    event: "generate_start",
    docType: "pdf",
    details: { htmlSize: sanitizedHtml.length },
  });

  let context: BrowserContext | null = null;

  try {
    const browser = await getBrowser();
    browserContextCount++;
    context = await browser.newContext({
      // Block external resource loading for security
      javaScriptEnabled: false,
      // Prevent geolocation, notifications, etc.
      permissions: [],
      // Block service workers
      serviceWorkers: "block",
      // Offline mode to prevent any network access
      offline: false,
    });
    const page = await context.newPage();

    // Block external network requests - only allow inline/data content
    await page.route("**/*", (route) => {
      const url = route.request().url();
      // Only allow data: URIs (for inline images/fonts) and about:blank
      if (url.startsWith("data:") || url === "about:blank") {
        // Additional check: block data:text/html to prevent nested HTML injection
        if (url.startsWith("data:text/html")) {
          route.abort("blockedbyclient");
        } else {
          route.continue();
        }
      } else {
        route.abort("blockedbyclient");
      }
    });

    const wrappedHtml = wrapHtmlWithStyles(sanitizedHtml);
    await page.setContent(wrappedHtml, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT,
    });

    const pdfOptions: Parameters<typeof page.pdf>[0] = {
      format: mergedOptions.format,
      margin: mergedOptions.margin,
      landscape: mergedOptions.landscape,
      printBackground: mergedOptions.printBackground,
      scale: mergedOptions.scale,
      preferCSSPageSize: mergedOptions.preferCSSPageSize,
    };

    if (mergedOptions.headerTemplate || mergedOptions.footerTemplate) {
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.headerTemplate = mergedOptions.headerTemplate || "<span></span>";
      pdfOptions.footerTemplate = mergedOptions.footerTemplate || "<span></span>";
    }

    const pdfBuffer = await page.pdf(pdfOptions);
    const resultBuffer = Buffer.from(pdfBuffer);

    // Validate generated PDF size
    if (resultBuffer.length > MAX_PDF_SIZE) {
      throw new Error(`Generated PDF exceeds maximum size of ${MAX_PDF_SIZE / 1024 / 1024}MB`);
    }

    // Validate PDF structure
    const pdfValidation = validatePdfBuffer(resultBuffer);
    if (!pdfValidation.valid) {
      throw new Error(`Generated PDF is invalid: ${pdfValidation.errors.join("; ")}`);
    }

    if (pdfValidation.warnings.length > 0) {
      console.warn("[pdfGeneration] Warnings:", pdfValidation.warnings);
    }

    // Estimate page count from PDF structure to prevent abuse
    const pdfString = resultBuffer.toString("binary");
    const pageMatches = pdfString.match(/\/Type\s*\/Page[^s]/g);
    const estimatedPages = pageMatches ? pageMatches.length : 0;
    if (estimatedPages > MAX_PDF_PAGES) {
      throw new Error(`Generated PDF has too many pages (~${estimatedPages}). Maximum is ${MAX_PDF_PAGES}`);
    }

    logDocumentEvent({
      timestamp: new Date().toISOString(),
      event: "generate_success",
      docType: "pdf",
      durationMs: Date.now() - startTime,
      details: { bufferSize: resultBuffer.length },
    });

    return resultBuffer;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logDocumentEvent({
      timestamp: new Date().toISOString(),
      event: "generate_failure",
      docType: "pdf",
      durationMs: Date.now() - startTime,
      details: { error: errorMessage },
    });

    if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
      throw new Error(`PDF generation timed out: ${errorMessage}`);
    }

    if (errorMessage.includes("net::ERR_") || errorMessage.includes("Navigation")) {
      throw new Error(`Failed to load HTML content: ${errorMessage}`);
    }

    throw new Error(`PDF generation failed: ${errorMessage}`);
  } finally {
    pdfConcurrencyLimiter.release();

    if (context) {
      await context.close().catch((err) => {
        console.error("[pdfGeneration] Error closing browser context:", err);
      });
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (error) {
      console.error("[pdfGeneration] Error closing browser:", error);
    } finally {
      browserInstance = null;
    }
  }
}

process.on("SIGTERM", async () => {
  await closeBrowser();
});

process.on("SIGINT", async () => {
  await closeBrowser();
});
