/**
 * Browser Control Router - Universal Multi-Browser Automation API
 *
 * Integrates the UniversalBrowserController to provide full control
 * over Chromium, Firefox, and WebKit browsers via REST endpoints.
 *
 * Features:
 * - Multi-browser session management (Chrome, Firefox, Safari, Mobile)
 * - Tab management (create, switch, close, list)
 * - Navigation with configurable wait strategies
 * - DOM interaction (click, type, scroll, select, hover, upload)
 * - Data extraction (CSS selectors, structured LLM-based)
 * - Screenshot capture (full page, element-level)
 * - Network interception and logging
 * - Cookie and localStorage management
 * - Agentic task execution (multi-step automation)
 * - LLM-powered autonomous navigation
 */

import { Router, Request, Response } from "express";
import {
  UniversalBrowserController,
  BrowserProfile,
  ExtractionRule,
  AgenticTask,
  AgenticStep,
} from "../agent/universalBrowserController";
import { browserEngineExtensions, BrowserEngineExtensions } from "../agent/browserEngineExtensions";

const browserController = new UniversalBrowserController();

export function createBrowserControlRouter(): Router {
  const router = Router();

  // ============================================
  // Profile Management
  // ============================================

  /** List available browser profiles */
  router.get("/profiles", (_req: Request, res: Response) => {
    const profiles = [
      { id: "chrome-desktop", name: "Chrome Desktop", browser: "chromium", viewport: "1920x1080" },
      { id: "firefox-desktop", name: "Firefox Desktop", browser: "firefox", viewport: "1920x1080" },
      { id: "safari-desktop", name: "Safari Desktop", browser: "webkit", viewport: "1440x900" },
      { id: "mobile-iphone", name: "iPhone Safari", browser: "webkit", viewport: "390x844" },
      { id: "mobile-android", name: "Android Chrome", browser: "chromium", viewport: "412x915" },
    ];
    res.json({ profiles });
  });

  // ============================================
  // Session Management
  // ============================================

  /** Create a new browser session */
  router.post("/sessions", async (req: Request, res: Response) => {
    try {
      const { profileId, customProfile } = req.body;
      const sessionId = await browserController.createSession(
        profileId || "chrome-desktop",
        customProfile
      );
      res.json({ sessionId, profileId: profileId || "chrome-desktop" });
    } catch (error: any) {
      console.error("[BrowserControl] Failed to create session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /** Close a browser session */
  router.delete("/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      await browserController.closeSession(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Tab Management
  // ============================================

  /** List all tabs in a session */
  router.get("/sessions/:sessionId/tabs", (req: Request, res: Response) => {
    try {
      const tabs = browserController.listTabs(req.params.sessionId);
      res.json({ tabs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Open a new tab */
  router.post("/sessions/:sessionId/tabs", async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      const tabId = await browserController.newTab(req.params.sessionId, url);
      res.json({ tabId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Switch to a tab */
  router.post("/sessions/:sessionId/tabs/:tabId/activate", async (req: Request, res: Response) => {
    try {
      await browserController.switchTab(req.params.sessionId, req.params.tabId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Close a tab */
  router.delete("/sessions/:sessionId/tabs/:tabId", async (req: Request, res: Response) => {
    try {
      await browserController.closeTab(req.params.sessionId, req.params.tabId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Navigation
  // ============================================

  /** Navigate to a URL */
  router.post("/sessions/:sessionId/navigate", async (req: Request, res: Response) => {
    try {
      const { url, waitUntil, timeout, tabId } = req.body;
      if (!url) {
        return res.status(400).json({ error: "url is required" });
      }
      const result = await browserController.navigate(req.params.sessionId, url, {
        waitUntil,
        timeout,
        tabId,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Go back */
  router.post("/sessions/:sessionId/back", async (req: Request, res: Response) => {
    try {
      await browserController.goBack(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Go forward */
  router.post("/sessions/:sessionId/forward", async (req: Request, res: Response) => {
    try {
      await browserController.goForward(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Reload page */
  router.post("/sessions/:sessionId/reload", async (req: Request, res: Response) => {
    try {
      await browserController.reload(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Interaction
  // ============================================

  /** Click on an element */
  router.post("/sessions/:sessionId/click", async (req: Request, res: Response) => {
    try {
      const { selector, button, clickCount, timeout, force } = req.body;
      if (!selector) {
        return res.status(400).json({ error: "selector is required" });
      }
      const result = await browserController.click(req.params.sessionId, selector, {
        button,
        clickCount,
        timeout,
        force,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Type text into an element */
  router.post("/sessions/:sessionId/type", async (req: Request, res: Response) => {
    try {
      const { selector, text, clear, delay, pressEnter } = req.body;
      if (!selector || text === undefined) {
        return res.status(400).json({ error: "selector and text are required" });
      }
      const result = await browserController.type(req.params.sessionId, selector, text, {
        clear,
        delay,
        pressEnter,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Select option(s) from a dropdown */
  router.post("/sessions/:sessionId/select", async (req: Request, res: Response) => {
    try {
      const { selector, values } = req.body;
      if (!selector || !values) {
        return res.status(400).json({ error: "selector and values are required" });
      }
      const result = await browserController.select(req.params.sessionId, selector, values);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Hover over an element */
  router.post("/sessions/:sessionId/hover", async (req: Request, res: Response) => {
    try {
      const { selector } = req.body;
      if (!selector) {
        return res.status(400).json({ error: "selector is required" });
      }
      await browserController.hover(req.params.sessionId, selector);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Scroll the page or element */
  router.post("/sessions/:sessionId/scroll", async (req: Request, res: Response) => {
    try {
      const { direction, amount, selector } = req.body;
      await browserController.scroll(req.params.sessionId, {
        direction: direction || "down",
        amount,
        selector,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Upload file(s) */
  router.post("/sessions/:sessionId/upload", async (req: Request, res: Response) => {
    try {
      const { selector, filePaths } = req.body;
      if (!selector || !filePaths) {
        return res.status(400).json({ error: "selector and filePaths are required" });
      }
      await browserController.uploadFile(
        req.params.sessionId,
        selector,
        Array.isArray(filePaths) ? filePaths : [filePaths]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Data Extraction
  // ============================================

  /** Extract data using CSS selector rules */
  router.post("/sessions/:sessionId/extract", async (req: Request, res: Response) => {
    try {
      const { rules } = req.body;
      if (!rules || !Array.isArray(rules)) {
        return res.status(400).json({ error: "rules array is required" });
      }
      const data = await browserController.extract(req.params.sessionId, rules as ExtractionRule[]);
      res.json({ data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Extract structured data using LLM */
  router.post("/sessions/:sessionId/extract-structured", async (req: Request, res: Response) => {
    try {
      const { description } = req.body;
      if (!description) {
        return res.status(400).json({ error: "description is required" });
      }
      const data = await browserController.extractStructured(req.params.sessionId, description);
      res.json({ data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Screenshot
  // ============================================

  /** Capture a screenshot */
  router.get("/sessions/:sessionId/screenshot", async (req: Request, res: Response) => {
    try {
      const fullPage = req.query.fullPage === "true";
      const selector = req.query.selector as string | undefined;
      const type = (req.query.type as "png" | "jpeg") || "png";
      const screenshot = await browserController.screenshot(req.params.sessionId, {
        fullPage,
        selector,
        type,
      });
      res.json({ screenshot: `data:image/${type};base64,${screenshot}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Network
  // ============================================

  /** Set up network request interception */
  router.post("/sessions/:sessionId/intercept", async (req: Request, res: Response) => {
    try {
      const { patterns } = req.body;
      if (!patterns || !Array.isArray(patterns)) {
        return res.status(400).json({ error: "patterns array is required" });
      }
      await browserController.interceptRequests(req.params.sessionId, patterns);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get network logs */
  router.get("/sessions/:sessionId/network", (req: Request, res: Response) => {
    try {
      const urlPattern = req.query.urlPattern as string | undefined;
      const method = req.query.method as string | undefined;
      const logs = browserController.getNetworkLogs(req.params.sessionId, {
        urlPattern,
        method,
      });
      res.json({ logs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Cookies & Storage
  // ============================================

  /** Get cookies */
  router.get("/sessions/:sessionId/cookies", async (req: Request, res: Response) => {
    try {
      const urls = req.query.urls ? (req.query.urls as string).split(",") : undefined;
      const cookies = await browserController.getCookies(req.params.sessionId, urls);
      res.json({ cookies });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Set cookies */
  router.post("/sessions/:sessionId/cookies", async (req: Request, res: Response) => {
    try {
      const { cookies } = req.body;
      if (!cookies || !Array.isArray(cookies)) {
        return res.status(400).json({ error: "cookies array is required" });
      }
      await browserController.setCookies(req.params.sessionId, cookies);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Clear cookies */
  router.delete("/sessions/:sessionId/cookies", async (req: Request, res: Response) => {
    try {
      await browserController.clearCookies(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get localStorage */
  router.get("/sessions/:sessionId/storage", async (req: Request, res: Response) => {
    try {
      const items = await browserController.getLocalStorage(req.params.sessionId);
      res.json({ items });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Set localStorage items */
  router.post("/sessions/:sessionId/storage", async (req: Request, res: Response) => {
    try {
      const { items } = req.body;
      if (!items || typeof items !== "object") {
        return res.status(400).json({ error: "items object is required" });
      }
      await browserController.setLocalStorage(req.params.sessionId, items);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Agentic Automation
  // ============================================

  /** Execute a multi-step agentic task */
  router.post("/sessions/:sessionId/task", async (req: Request, res: Response) => {
    try {
      const { task } = req.body;
      if (!task || !task.steps) {
        return res.status(400).json({ error: "task with steps is required" });
      }

      const agenticTask: AgenticTask = {
        id: task.id || crypto.randomUUID(),
        name: task.name || "Automated Task",
        steps: task.steps.map((s: any, i: number) => ({
          id: s.id || `step-${i}`,
          action: s.action,
          params: s.params || {},
          selector: s.selector,
          description: s.description || `Step ${i + 1}`,
          expectedResult: s.expectedResult,
          continueOnError: s.continueOnError,
          retries: s.retries,
        })),
        retryPolicy: task.retryPolicy || { maxRetries: 2, backoffMs: 1000 },
        timeout: task.timeout || 120000,
        variables: task.variables || {},
        onError: task.onError || "abort",
      };

      const result = await browserController.executeAgenticTask(
        req.params.sessionId,
        agenticTask
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Autonomous LLM-powered navigation toward a goal */
  router.post("/sessions/:sessionId/auto-navigate", async (req: Request, res: Response) => {
    try {
      const { goal, maxSteps } = req.body;
      if (!goal) {
        return res.status(400).json({ error: "goal is required" });
      }
      const result = await browserController.agenticNavigate(
        req.params.sessionId,
        goal,
        maxSteps || 20
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // PDF Generation
  // ============================================

  /** Generate PDF from current page */
  router.post("/sessions/:sessionId/pdf", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      const { format, landscape, printBackground, scale, margin } = req.body;
      const result = await browserEngineExtensions.generatePdf(page, {
        format, landscape, printBackground, scale, margin,
      });
      res.json({ success: true, filePath: result.path, format: format || "A4" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Accessibility
  // ============================================

  /** Get accessibility tree */
  router.get("/sessions/:sessionId/accessibility", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      const role = req.query.role as string | undefined;
      if (role) {
        const nodes = await browserEngineExtensions.getAccessibilityByRole(page, role);
        res.json({ nodes });
      } else {
        const tree = await browserEngineExtensions.getAccessibilityTree(page);
        res.json({ tree });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Performance Metrics
  // ============================================

  /** Get page performance metrics */
  router.get("/sessions/:sessionId/performance", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      const metrics = await browserEngineExtensions.getPerformanceMetrics(page);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Element Picker
  // ============================================

  /** Get element at point (for visual picker) */
  router.post("/sessions/:sessionId/element-at-point", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      const { x, y } = req.body;
      const element = await browserEngineExtensions.getElementAtPoint(page, x, y);
      res.json({ element });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Highlight elements and return screenshot */
  router.post("/sessions/:sessionId/highlight", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      const { highlights } = req.body;
      const screenshot = await browserEngineExtensions.highlightElements(page, highlights || []);
      res.json({ screenshot: `data:image/png;base64,${screenshot}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Console Capture
  // ============================================

  /** Start capturing console logs */
  router.post("/sessions/:sessionId/console/start", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      browserEngineExtensions.startConsoleCapture(req.params.sessionId, page);
      browserEngineExtensions.setupDialogHandler(req.params.sessionId, page, true);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get console entries */
  router.get("/sessions/:sessionId/console", (req: Request, res: Response) => {
    try {
      const type = req.query.type as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const entries = browserEngineExtensions.getConsoleEntries(req.params.sessionId, {
        type: type as any,
        limit,
      });
      res.json({ entries });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get dialog events */
  router.get("/sessions/:sessionId/dialogs", (req: Request, res: Response) => {
    try {
      const events = browserEngineExtensions.getDialogEvents(req.params.sessionId);
      res.json({ events });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Session Recording
  // ============================================

  /** Start recording */
  router.post("/sessions/:sessionId/recording/start", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      const { name } = req.body;
      const recordingId = browserEngineExtensions.startRecording(
        req.params.sessionId,
        name || "Recording",
        page.url(),
        "chrome-desktop"
      );
      res.json({ recordingId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Stop recording */
  router.post("/sessions/:sessionId/recording/stop", (req: Request, res: Response) => {
    try {
      const recording = browserEngineExtensions.stopRecording(req.params.sessionId);
      res.json({ recording });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** List recordings */
  router.get("/recordings", (_req: Request, res: Response) => {
    try {
      const recordings = browserEngineExtensions.listRecordings();
      res.json({ recordings });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get a recording */
  router.get("/recordings/:recordingId", (req: Request, res: Response) => {
    try {
      const recording = browserEngineExtensions.getRecording(req.params.recordingId);
      if (!recording) return res.status(404).json({ error: "Recording not found" });
      res.json({ recording });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Scraping Pipeline
  // ============================================

  /** Execute a scraping pipeline */
  router.post("/sessions/:sessionId/scrape", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      const { pipeline } = req.body;
      if (!pipeline || !pipeline.startUrl || !pipeline.steps) {
        return res.status(400).json({ error: "pipeline with startUrl and steps is required" });
      }
      const result = await browserEngineExtensions.executeScraping(page, {
        id: pipeline.id || "pipeline",
        name: pipeline.name || "Scraping Pipeline",
        startUrl: pipeline.startUrl,
        steps: pipeline.steps,
        maxPages: pipeline.maxPages || 10,
        concurrency: 1,
        delay: pipeline.delay || 500,
        variables: pipeline.variables || {},
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Network Throttling
  // ============================================

  /** Set network throttling profile */
  router.post("/sessions/:sessionId/throttle", async (req: Request, res: Response) => {
    try {
      const { preset, custom } = req.body;
      const context = browserController.getSessionContext(req.params.sessionId);

      if (custom) {
        await browserEngineExtensions.setNetworkThrottle(context, custom);
        res.json({ throttle: custom });
      } else {
        const profile = preset || "4g";
        await browserEngineExtensions.setNetworkThrottle(context, profile);
        res.json({ throttle: BrowserEngineExtensions.THROTTLE_PRESETS[profile] || profile });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Remove network throttling */
  router.delete("/sessions/:sessionId/throttle", async (req: Request, res: Response) => {
    try {
      const context = browserController.getSessionContext(req.params.sessionId);
      await browserEngineExtensions.removeNetworkThrottle(context);
      res.json({ throttle: null });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** List available throttle presets */
  router.get("/throttle-presets", (_req: Request, res: Response) => {
    res.json({ presets: BrowserEngineExtensions.THROTTLE_PRESETS });
  });

  // ============================================
  // Geolocation Spoofing
  // ============================================

  /** Set geolocation */
  router.post("/sessions/:sessionId/geolocation", async (req: Request, res: Response) => {
    try {
      const { preset, latitude, longitude, accuracy } = req.body;
      const context = browserController.getSessionContext(req.params.sessionId);

      if (preset) {
        const loc = BrowserEngineExtensions.LOCATION_PRESETS[preset];
        if (!loc) return res.status(400).json({ error: "Unknown preset", available: Object.keys(BrowserEngineExtensions.LOCATION_PRESETS) });
        await browserEngineExtensions.setGeolocation(context, loc.latitude, loc.longitude);
        res.json({ geolocation: loc });
      } else if (latitude !== undefined && longitude !== undefined) {
        await browserEngineExtensions.setGeolocation(context, latitude, longitude, accuracy);
        res.json({ geolocation: { latitude, longitude, accuracy } });
      } else {
        return res.status(400).json({ error: "Provide preset or latitude/longitude" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** List geolocation presets */
  router.get("/geolocation-presets", (_req: Request, res: Response) => {
    res.json({ presets: BrowserEngineExtensions.LOCATION_PRESETS });
  });

  // ============================================
  // Device Emulation
  // ============================================

  /** List device presets */
  router.get("/device-presets", (_req: Request, res: Response) => {
    res.json({ presets: BrowserEngineExtensions.DEVICE_PRESETS });
  });

  // ============================================
  // HAR Export
  // ============================================

  /** Start HAR capture */
  router.post("/sessions/:sessionId/har/start", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      browserEngineExtensions.startHARCapture(req.params.sessionId, page);
      res.json({ capturing: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get captured HAR data */
  router.get("/sessions/:sessionId/har", (_req: Request, res: Response) => {
    try {
      const har = browserEngineExtensions.getHAR(_req.params.sessionId);
      res.json(har);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Export HAR to file */
  router.post("/sessions/:sessionId/har/export", async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body;
      const result = await browserEngineExtensions.exportHAR(req.params.sessionId, filePath);
      res.json({ path: result.path, entries: JSON.parse(result.json).log?.entries?.length || 0 });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Clear HAR data */
  router.delete("/sessions/:sessionId/har", (req: Request, res: Response) => {
    try {
      browserEngineExtensions.clearHAR(req.params.sessionId);
      res.json({ cleared: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Smart Form Filling
  // ============================================

  /** Detect form fields on page */
  router.get("/sessions/:sessionId/form-fields", async (req: Request, res: Response) => {
    try {
      const page = browserController.getActivePage(req.params.sessionId);
      const fields = await browserEngineExtensions.detectFormFields(page);
      res.json({ fields, count: fields.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Smart fill a form */
  router.post("/sessions/:sessionId/form-fill", async (req: Request, res: Response) => {
    try {
      const { data } = req.body;
      if (!data || typeof data !== "object") {
        return res.status(400).json({ error: "data object is required" });
      }
      const page = browserController.getActivePage(req.params.sessionId);
      const result = await browserEngineExtensions.smartFormFill(page, data);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Auth Flow Automation
  // ============================================

  /** Detect and fill login form */
  router.post("/sessions/:sessionId/auth-flow", async (req: Request, res: Response) => {
    try {
      const { username, password, submitAfterFill, waitForNavigation } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "username and password are required" });
      }
      const page = browserController.getActivePage(req.params.sessionId);
      const result = await browserEngineExtensions.detectAndFillAuth(
        page,
        { username, password },
        { submitAfterFill, waitForNavigation }
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Visual Diff
  // ============================================

  /** Compare two screenshots for visual differences */
  router.post("/visual-diff", async (req: Request, res: Response) => {
    try {
      const { sessionIdA, sessionIdB, tabIdA, tabIdB } = req.body;

      const pageA = browserController.getActivePage(sessionIdA, tabIdA);
      const pageB = browserController.getActivePage(sessionIdB, tabIdB);

      const bufferA = await pageA.screenshot({ type: "png" });
      const bufferB = await pageB.screenshot({ type: "png" });

      const diff = await browserEngineExtensions.visualDiff(bufferA, bufferB);
      res.json(diff);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Parallel Execution
  // ============================================

  /** Execute same action across multiple sessions */
  router.post("/parallel/navigate", async (req: Request, res: Response) => {
    try {
      const { sessionIds, url } = req.body;
      if (!Array.isArray(sessionIds) || !url) {
        return res.status(400).json({ error: "sessionIds array and url are required" });
      }

      const pages = sessionIds.map((sid: string) => ({
        page: browserController.getActivePage(sid),
        label: sid,
      }));

      const results = await browserEngineExtensions.executeParallel(pages, async (page) => {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        return {
          url: page.url(),
          title: await page.title(),
          status: response?.status(),
        };
      });

      res.json({ results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Take screenshots across multiple sessions */
  router.post("/parallel/screenshot", async (req: Request, res: Response) => {
    try {
      const { sessionIds } = req.body;
      if (!Array.isArray(sessionIds)) {
        return res.status(400).json({ error: "sessionIds array is required" });
      }

      const pages = sessionIds.map((sid: string) => ({
        page: browserController.getActivePage(sid),
        label: sid,
      }));

      const results = await browserEngineExtensions.executeParallel(pages, async (page) => {
        const buf = await page.screenshot({ type: "png" });
        return buf.toString("base64");
      });

      res.json({ results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export { browserController };
