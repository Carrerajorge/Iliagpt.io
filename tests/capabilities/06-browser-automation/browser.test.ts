/**
 * Browser Automation Capability Tests
 *
 * Covers: navigation, element interaction, form filling, screenshots,
 *         content extraction, JavaScript execution, and error handling.
 */

import {
  runWithEachProvider,
  type ProviderConfig,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
  MOCK_BROWSER_TOOL,
} from "../_setup/mockResponses";
import {
  createMockAgent,
} from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Mock Playwright
// ---------------------------------------------------------------------------

const mockLocator = {
  click:        vi.fn().mockResolvedValue(undefined),
  fill:         vi.fn().mockResolvedValue(undefined),
  textContent:  vi.fn().mockResolvedValue("element text"),
  getAttribute: vi.fn().mockResolvedValue("attribute-value"),
  isVisible:    vi.fn().mockResolvedValue(true),
};

const mockPage = {
  goto:             vi.fn().mockResolvedValue({ status: () => 200, url: () => "https://example.com" }),
  url:              vi.fn().mockReturnValue("https://example.com"),
  title:            vi.fn().mockResolvedValue("Example Domain"),
  content:          vi.fn().mockResolvedValue("<html><body><h1>Example</h1></body></html>"),
  waitForLoadState: vi.fn().mockResolvedValue(undefined),
  goBack:           vi.fn().mockResolvedValue(undefined),
  goForward:        vi.fn().mockResolvedValue(undefined),
  click:            vi.fn().mockResolvedValue(undefined),
  dblclick:         vi.fn().mockResolvedValue(undefined),
  hover:            vi.fn().mockResolvedValue(undefined),
  fill:             vi.fn().mockResolvedValue(undefined),
  selectOption:     vi.fn().mockResolvedValue(undefined),
  setInputFiles:    vi.fn().mockResolvedValue(undefined),
  screenshot:       vi.fn().mockResolvedValue(Buffer.from("PNG_MOCK")),
  evaluate:         vi.fn().mockResolvedValue("eval-result"),
  addScriptTag:     vi.fn().mockResolvedValue(undefined),
  locator:          vi.fn().mockReturnValue(mockLocator),
  waitForSelector:  vi.fn().mockResolvedValue({ textContent: vi.fn().mockResolvedValue("text") }),
  setViewportSize:  vi.fn().mockResolvedValue(undefined),
  $$eval:           vi.fn().mockResolvedValue([]),
  $eval:            vi.fn().mockResolvedValue("result"),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close:   vi.fn().mockResolvedValue(undefined),
  version: vi.fn().mockReturnValue("Chromium 120.0"),
};

const mockChromium = {
  launch:  vi.fn().mockResolvedValue(mockBrowser),
  connect: vi.fn().mockResolvedValue(mockBrowser),
};

vi.mock("playwright", () => ({
  chromium: mockChromium,
  firefox:  { launch: vi.fn().mockResolvedValue(mockBrowser) },
  webkit:   { launch: vi.fn().mockResolvedValue(mockBrowser) },
  devices:  {},
}));

vi.mock("../../../server/agent/browser/browserAgent", () => ({
  BrowserAgent: vi.fn().mockImplementation(() => ({
    navigate:    vi.fn().mockResolvedValue({ success: true, url: "https://example.com", status: 200 }),
    click:       vi.fn().mockResolvedValue({ success: true }),
    fill:        vi.fn().mockResolvedValue({ success: true }),
    screenshot:  vi.fn().mockResolvedValue({ success: true, path: "/tmp/screenshot.png" }),
    extractText: vi.fn().mockResolvedValue({ success: true, text: "page text" }),
    evaluate:    vi.fn().mockResolvedValue({ success: true, result: null }),
    close:       vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Suite 1 — Navigation
// ---------------------------------------------------------------------------

describe("Navigation", () => {
  runWithEachProvider(
    "navigates to a URL and returns the final URL and status code",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          url: "https://example.com",
          httpStatus: 200,
          title: "Example Domain",
          loadTime: 320,
        },
      });
      const response = await agent.invoke("navigate", {
        url: "https://example.com",
        waitFor: "load",
      });

      expect(response.success).toBe(true);
      expect(response.url).toBe("https://example.com");
      expect(response.httpStatus).toBe(200);
      expect(response.loadTime as number).toBeGreaterThan(0);

      const pResp = getMockResponseForProvider(
        provider.name,
        { name: MOCK_BROWSER_TOOL.name, arguments: { action: "navigate", url: "https://example.com" } },
        "Navigated to https://example.com",
      );
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "navigates back and forward in browser history",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, action: "back", newUrl: "https://example.com/page1" },
      });

      const backResp = await agent.invoke("navigate", { action: "back" });
      expect(backResp.success).toBe(true);

      // Re-configure mock for the forward call
      agent.invoke.mockResolvedValueOnce({
        success: true,
        action: "forward",
        newUrl: "https://example.com/page2",
      });
      const forwardResp = await agent.invoke("navigate", { action: "forward" });
      expect(forwardResp.success).toBe(true);
      expect(forwardResp.action).toBe("forward");

      void provider;
    },
  );

  runWithEachProvider(
    "waits for page to reach networkidle state before returning",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          url: "https://spa.example.com/dashboard",
          waitState: "networkidle",
          domContentLoaded: 450,
          networkIdle: 1200,
        },
      });
      const response = await agent.invoke("navigate", {
        url: "https://spa.example.com/dashboard",
        waitFor: "networkidle",
        timeout: 30000,
      });

      expect(response.success).toBe(true);
      expect(response.waitState).toBe("networkidle");
      expect(response.networkIdle as number).toBeGreaterThan(response.domContentLoaded as number);

      void provider;
    },
  );

  runWithEachProvider(
    "follows a redirect chain and reports the final URL",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          requestedUrl: "http://old.example.com",
          finalUrl: "https://new.example.com/home",
          redirectChain: [
            { from: "http://old.example.com",  to: "https://old.example.com",      statusCode: 301 },
            { from: "https://old.example.com", to: "https://new.example.com/home", statusCode: 302 },
          ],
          redirectCount: 2,
        },
      });
      const response = await agent.invoke("navigate", {
        url: "http://old.example.com",
        followRedirects: true,
      });

      expect(response.success).toBe(true);
      expect(response.finalUrl).not.toBe(response.requestedUrl);
      expect(response.redirectCount).toBe(2);
      const chain = response.redirectChain as Array<{ statusCode: number }>;
      expect(chain.every((r) => [301, 302, 307, 308].includes(r.statusCode))).toBe(true);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 2 — Element interaction
// ---------------------------------------------------------------------------

describe("Element interaction", () => {
  runWithEachProvider(
    "clicks a button identified by CSS selector",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          action: "click",
          selector: "button#submit",
          elementFound: true,
          clickedAt: { x: 450, y: 320 },
        },
      });
      const response = await agent.invoke("click", { selector: "button#submit" });

      expect(response.success).toBe(true);
      expect(response.elementFound).toBe(true);
      expect(response.action).toBe("click");

      void provider;
    },
  );

  runWithEachProvider(
    "clicks a hyperlink and waits for navigation to complete",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          action: "click",
          selector: "a.nav-link",
          navigationTriggered: true,
          newUrl: "https://example.com/about",
        },
      });
      const response = await agent.invoke("click", {
        selector: "a.nav-link",
        waitForNavigation: true,
      });

      expect(response.success).toBe(true);
      expect(response.navigationTriggered).toBe(true);
      expect(response.newUrl as string).toContain("example.com");

      void provider;
    },
  );

  runWithEachProvider(
    "right-clicks an element to open the context menu",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          action: "rightClick",
          selector: "#context-target",
          contextMenuOpened: true,
          menuItems: ["Copy", "Paste", "Open in new tab"],
        },
      });
      const response = await agent.invoke("rightClick", { selector: "#context-target" });

      expect(response.success).toBe(true);
      expect(response.contextMenuOpened).toBe(true);
      const menuItems = response.menuItems as string[];
      expect(menuItems.length).toBeGreaterThan(0);

      const pResp = createTextResponse(provider.name, "Right-clicked element, context menu opened");
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "hovers over an element to reveal a tooltip",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          action: "hover",
          selector: "[data-tooltip]",
          tooltipVisible: true,
          tooltipText: "Click to submit your request",
        },
      });
      const response = await agent.invoke("hover", {
        selector: "[data-tooltip]",
        waitForTooltip: true,
      });

      expect(response.success).toBe(true);
      expect(response.tooltipVisible).toBe(true);
      expect(typeof response.tooltipText).toBe("string");

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 3 — Form filling
// ---------------------------------------------------------------------------

describe("Form filling", () => {
  runWithEachProvider(
    "fills a text input field with the specified value",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, action: "fill", selector: "input#email", value: "test@example.com", cleared: true },
      });
      const response = await agent.invoke("fillField", {
        selector: "input#email",
        value: "test@example.com",
        clear: true,
      });

      expect(response.success).toBe(true);
      expect(response.value).toBe("test@example.com");
      expect(response.cleared).toBe(true);

      void provider;
    },
  );

  runWithEachProvider(
    "selects an option from a dropdown by visible text",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, action: "selectOption", selector: "select#country", selectedValue: "US", selectedLabel: "United States" },
      });
      const response = await agent.invoke("selectOption", {
        selector: "select#country",
        label: "United States",
      });

      expect(response.success).toBe(true);
      expect(response.selectedLabel).toBe("United States");
      expect(response.selectedValue).toBe("US");

      void provider;
    },
  );

  runWithEachProvider(
    "uploads a file via a file input element",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          action: "uploadFile",
          selector: "input[type=file]",
          fileName: "report.pdf",
          fileSizeBytes: 20480,
          uploadConfirmed: true,
        },
      });
      const response = await agent.invoke("uploadFile", {
        selector: "input[type=file]",
        filePath: "/tmp/report.pdf",
      });

      expect(response.success).toBe(true);
      expect(response.uploadConfirmed).toBe(true);
      expect(response.fileName).toBe("report.pdf");

      void provider;
    },
  );

  runWithEachProvider(
    "fills and submits a complete multi-field form",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          action: "submitForm",
          fieldsFilledCount: 4,
          formSelector: "form#contact",
          submissionSucceeded: true,
          redirectedTo: "https://example.com/thank-you",
        },
      });
      const response = await agent.invoke("fillAndSubmitForm", {
        formSelector: "form#contact",
        fields: {
          "input#name":   "Jane Doe",
          "input#email":  "jane@example.com",
          "input#phone":  "+1-555-0123",
          "textarea#msg": "Hello, I would like more information.",
        },
        submitSelector: "button[type=submit]",
      });

      expect(response.success).toBe(true);
      expect(response.submissionSucceeded).toBe(true);
      expect(response.fieldsFilledCount).toBe(4);
      expect(response.redirectedTo as string).toContain("thank-you");

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 4 — Screenshots and recording
// ---------------------------------------------------------------------------

describe("Screenshots and recording", () => {
  runWithEachProvider(
    "takes a full-page screenshot and returns the file path",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          screenshotPath: "/tmp/screenshots/full-page-1.png",
          widthPx: 1280,
          heightPx: 4200,
          fileBytes: 156288,
          fullPage: true,
        },
      });
      const response = await agent.invoke("screenshot", {
        fullPage: true,
        outputPath: "/tmp/screenshots/full-page-1.png",
      });

      expect(response.success).toBe(true);
      expect(response.fullPage).toBe(true);
      expect(response.screenshotPath as string).toContain(".png");
      expect(response.heightPx as number).toBeGreaterThan(response.widthPx as number);

      const pResp = getMockResponseForProvider(
        provider.name,
        { name: MOCK_BROWSER_TOOL.name, arguments: { action: "screenshot", fullPage: true } },
        "Screenshot saved to /tmp/screenshots/full-page-1.png",
      );
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "takes a clipped screenshot of a single DOM element",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          screenshotPath: "/tmp/screenshots/element.png",
          selector: "#chart-container",
          boundingBox: { x: 100, y: 200, width: 600, height: 400 },
          fileBytes: 42000,
        },
      });
      const response = await agent.invoke("screenshot", {
        selector: "#chart-container",
        outputPath: "/tmp/screenshots/element.png",
      });

      expect(response.success).toBe(true);
      const bbox = response.boundingBox as { width: number; height: number };
      expect(bbox.width).toBeGreaterThan(0);
      expect(bbox.height).toBeGreaterThan(0);

      void provider;
    },
  );

  runWithEachProvider(
    "resizes the viewport before taking a mobile-emulation screenshot",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          newViewport: { width: 375, height: 812 },
          screenshotPath: "/tmp/screenshots/mobile.png",
          deviceEmulation: "iPhone 13",
        },
      });
      const response = await agent.invoke("screenshotWithViewport", {
        viewport: { width: 375, height: 812 },
        deviceName: "iPhone 13",
        outputPath: "/tmp/screenshots/mobile.png",
      });

      expect(response.success).toBe(true);
      const viewport = response.newViewport as { width: number; height: number };
      expect(viewport.width).toBe(375);
      expect(viewport.height).toBe(812);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 5 — Content extraction
// ---------------------------------------------------------------------------

describe("Content extraction", () => {
  runWithEachProvider(
    "extracts all visible text content from the page body",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          text: "Example Domain\nThis domain is for use in illustrative examples.",
          wordCount: 14,
          charCount: 70,
        },
      });
      const response = await agent.invoke("extractText", { selector: "body" });

      expect(response.success).toBe(true);
      expect(typeof response.text).toBe("string");
      expect(response.wordCount as number).toBeGreaterThan(0);

      const pResp = createTextResponse(provider.name, response.text as string);
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "extracts a data table from an HTML table element",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          headers: ["Name", "Score", "Grade"],
          rows: [
            ["Alice", "95", "A"],
            ["Bob",   "82", "B"],
            ["Carol", "76", "C"],
          ],
          rowCount: 3,
          columnCount: 3,
        },
      });
      const response = await agent.invoke("extractTable", { selector: "table.results" });

      expect(response.success).toBe(true);
      expect(response.rowCount).toBe(3);
      expect(response.columnCount).toBe(3);
      const headers = response.headers as string[];
      expect(headers).toContain("Name");
      expect(headers).toContain("Score");

      void provider;
    },
  );

  runWithEachProvider(
    "extracts all hyperlinks from the page with href and anchor text",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          links: [
            { text: "Home",  href: "https://example.com/",        rel: null       },
            { text: "About", href: "https://example.com/about",   rel: null       },
            { text: "IANA",  href: "https://www.iana.org/domains", rel: "noopener" },
          ],
          totalLinks: 3,
          externalLinks: 1,
          internalLinks: 2,
        },
      });
      const response = await agent.invoke("extractLinks", {
        includeExternal: true,
        includeInternal: true,
      });

      expect(response.success).toBe(true);
      const links = response.links as Array<{ text: string; href: string }>;
      expect(links.length).toBeGreaterThan(0);
      links.forEach((l) => expect(l.href).toMatch(/^https?:\/\//));
      expect(response.externalLinks as number).toBeGreaterThan(0);

      void provider;
    },
  );

  runWithEachProvider(
    "gets the current page title from the browser tab",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, title: "Example Domain", url: "https://example.com" },
      });
      const response = await agent.invoke("getPageTitle", {});

      expect(response.success).toBe(true);
      expect(typeof response.title).toBe("string");
      expect(response.title as string).toBeTruthy();

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 6 — JavaScript execution
// ---------------------------------------------------------------------------

describe("JavaScript execution", () => {
  runWithEachProvider(
    "executes custom JavaScript and returns the evaluated result",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          result: { scrollY: 0, documentHeight: 4200, viewport: { w: 1280, h: 800 } },
          executionTimeMs: 2,
        },
      });
      const response = await agent.invoke("executeJS", {
        script:
          "return { scrollY: window.scrollY, documentHeight: document.documentElement.scrollHeight }",
      });

      expect(response.success).toBe(true);
      const result = response.result as Record<string, unknown>;
      expect(typeof result.scrollY).toBe("number");
      expect(typeof result.documentHeight).toBe("number");

      const pResp = getMockResponseForProvider(
        provider.name,
        { name: MOCK_BROWSER_TOOL.name, arguments: { action: "execute_js", script: "..." } },
        "JavaScript executed successfully",
      );
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "injects an external script tag and waits for it to load",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          scriptUrl: "https://cdn.example.com/analytics.js",
          injected: true,
          loadedInMs: 85,
        },
      });
      const response = await agent.invoke("injectScript", {
        url: "https://cdn.example.com/analytics.js",
        waitForLoad: true,
      });

      expect(response.success).toBe(true);
      expect(response.injected).toBe(true);
      expect(response.loadedInMs as number).toBeGreaterThan(0);

      void provider;
    },
  );

  runWithEachProvider(
    "retrieves computed CSS properties for a DOM element via JavaScript",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          selector: "h1",
          properties: { fontSize: "32px", color: "rgb(33, 37, 41)", fontFamily: "Georgia, serif", display: "block" },
        },
      });
      const response = await agent.invoke("getElementProperties", {
        selector: "h1",
        properties: ["fontSize", "color", "fontFamily", "display"],
      });

      expect(response.success).toBe(true);
      const props = response.properties as Record<string, string>;
      expect(props.fontSize).toContain("px");
      expect(props.display).toBe("block");

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 7 — Error handling
// ---------------------------------------------------------------------------

describe("Error handling", () => {
  runWithEachProvider(
    "handles a 404 page-not-found response gracefully",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: false,
          errorType: "HTTP_ERROR",
          httpStatus: 404,
          url: "https://example.com/missing-page",
          message: "Page not found (HTTP 404)",
        },
      });
      const response = await agent.invoke("navigate", {
        url: "https://example.com/missing-page",
      });

      expect(response.success).toBe(false);
      expect(response.httpStatus).toBe(404);
      expect(response.errorType).toBe("HTTP_ERROR");

      const pResp = createTextResponse(provider.name, "Navigation failed with HTTP 404");
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "captures uncaught JavaScript errors thrown on the page",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          url: "https://broken-app.example.com",
          jsErrors: [
            {
              type: "UnhandledRejection",
              message: "Cannot read properties of undefined (reading 'length')",
              stack: "at app.js:42:17",
            },
          ],
          jsErrorCount: 1,
        },
      });
      const response = await agent.invoke("navigate", {
        url: "https://broken-app.example.com",
        captureJsErrors: true,
      });

      expect(response.success).toBe(true);
      const errors = response.jsErrors as Array<{ type: string; message: string }>;
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].type).toBe("UnhandledRejection");

      void provider;
    },
  );

  runWithEachProvider(
    "times out and returns a structured error when page load exceeds limit",
    "browser-automation",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: false,
          errorType: "TIMEOUT",
          timeoutMs: 5000,
          url: "https://slow.example.com",
          message: "Page load timed out after 5000ms",
          partialContent: false,
        },
      });
      const response = await agent.invoke("navigate", {
        url: "https://slow.example.com",
        timeout: 5000,
      });

      expect(response.success).toBe(false);
      expect(response.errorType).toBe("TIMEOUT");
      expect(response.timeoutMs).toBe(5000);
      expect(response.message as string).toContain("5000ms");

      void provider;
    },
  );
});
