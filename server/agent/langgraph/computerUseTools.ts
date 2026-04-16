/**
 * Computer Use LangChain Tools
 *
 * LangChain-compatible tools that wrap the computerUse modules
 * for integration into the agent orchestration pipeline.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { computerUseEngine } from "../computerUse/computerUseEngine";
import { universalBrowserController } from "../computerUse/universalBrowserController";
import { perfectPptGenerator } from "../computerUse/perfectPptGenerator";
import { perfectDocumentGenerator } from "../computerUse/perfectDocumentGenerator";
import { perfectExcelGenerator } from "../computerUse/perfectExcelGenerator";
import { terminalController } from "../computerUse/terminalController";
import { visionPipeline } from "../computerUse/visionPipeline";
import { autonomousAgentBrain } from "../computerUse/autonomousAgentBrain";

// ============================================
// Browser Control Tools
// ============================================

export const computerUseSessionTool = tool(
  async (input) => {
    try {
      const { action, sessionId, mode, profileId, url, viewport } = input;

      switch (action) {
        case "create_browser": {
          const id = await computerUseEngine.createSession(mode as any || "browser", { viewport: viewport ? { width: viewport.width || 1920, height: viewport.height || 1080 } : undefined });
          return JSON.stringify({ success: true, sessionId: id, mode: mode || "browser" });
        }
        case "create_multi_browser": {
          const id = await universalBrowserController.createSession(profileId || "chrome-desktop");
          return JSON.stringify({ success: true, sessionId: id, profileId: profileId || "chrome-desktop" });
        }
        case "close": {
          if (sessionId) {
            await computerUseEngine.closeSession(sessionId);
            await universalBrowserController.closeSession(sessionId).catch(() => {});
          }
          return JSON.stringify({ success: true });
        }
        case "list_profiles": {
          return JSON.stringify({
            success: true,
            profiles: ["chrome-desktop", "firefox-desktop", "safari-desktop", "mobile-iphone", "mobile-android"],
          });
        }
        default:
          return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "computer_use_session",
    description: "Manage computer use sessions. Create browser sessions (single or multi-browser with different profiles), close sessions. Supports Chromium, Firefox, WebKit browsers and mobile profiles.",
    schema: z.object({
      action: z.enum(["create_browser", "create_multi_browser", "close", "list_profiles"]).describe("Session action"),
      sessionId: z.string().optional().describe("Session ID for close action"),
      mode: z.enum(["browser", "desktop"]).optional().describe("Session mode (browser or desktop)"),
      profileId: z.string().optional().describe("Browser profile: chrome-desktop, firefox-desktop, safari-desktop, mobile-iphone, mobile-android"),
      url: z.string().optional().describe("Initial URL to navigate to"),
      viewport: z.object({ width: z.number(), height: z.number() }).optional().describe("Viewport size"),
    }),
  }
);

export const computerUseNavigateTool = tool(
  async (input) => {
    const { sessionId, url, waitUntil, screenshot: takeScreenshot } = input;

    try {
      // Try universal browser controller first, fall back to computer use engine
      let navUrl = url;
      let navTitle = "";
      let navStatus: string | number = "navigated";
      try {
        const result = await universalBrowserController.navigate(sessionId, url, { waitUntil: waitUntil as any });
        navUrl = result.url || url;
        navTitle = result.title || "";
        navStatus = result.status ?? "navigated";
      } catch {
        const fallback = await computerUseEngine.navigateToUrl(sessionId, url);
        navUrl = url;
        navTitle = fallback.changesDetected?.find(c => c.startsWith("title:"))?.replace("title: ", "") || "";
        navStatus = fallback.success ? "navigated" : "error";
      }

      let screenshotData: string | undefined;
      if (takeScreenshot) {
        try {
          screenshotData = await universalBrowserController.screenshot(sessionId);
        } catch {
          screenshotData = await computerUseEngine.captureScreenshot(sessionId);
        }
      }

      return JSON.stringify({
        success: true,
        url: navUrl,
        title: navTitle,
        status: navStatus,
        screenshot: screenshotData ? "captured" : undefined,
        screenshotData: screenshotData ? screenshotData.slice(0, 500) + (screenshotData.length > 500 ? "...[truncated]" : "") : undefined,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "computer_use_navigate",
    description: "Navigate to a URL using the computer use browser. Supports all browsers and profiles. Optionally capture screenshot after navigation.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      url: z.string().url().describe("URL to navigate to"),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().default("domcontentloaded"),
      screenshot: z.boolean().optional().default(false).describe("Take screenshot after navigation"),
    }),
  }
);

export const computerUseInteractTool = tool(
  async (input) => {
    const { sessionId, action, selector, value, coordinates } = input;

    try {
      switch (action) {
        case "click": {
          if (coordinates) {
            const result = await computerUseEngine.mouseClick(sessionId, coordinates);
            return JSON.stringify({ success: result.success, action: "click_coordinates" });
          }
          if (selector) {
            const result = await universalBrowserController.click(sessionId, selector);
            return JSON.stringify({ success: result.success, action: "click_selector" });
          }
          return JSON.stringify({ success: false, error: "Need selector or coordinates" });
        }
        case "type": {
          if (selector) {
            const result = await universalBrowserController.type(sessionId, selector, value || "", { clear: true });
            return JSON.stringify({ success: result.success, action: "typed" });
          }
          const result = await computerUseEngine.typeText(sessionId, value || "");
          return JSON.stringify({ success: result.success, action: "typed" });
        }
        case "scroll": {
          if (selector) {
            await universalBrowserController.scroll(sessionId, { direction: "down", selector });
          } else {
            await computerUseEngine.mouseScroll(sessionId, coordinates || { x: 960, y: 540 }, { x: 0, y: 300 });
          }
          return JSON.stringify({ success: true, action: "scrolled" });
        }
        case "press_key": {
          const result = await computerUseEngine.pressKey(sessionId, value || "Enter");
          return JSON.stringify({ success: result.success, action: "key_pressed" });
        }
        case "hotkey": {
          const keys = (value || "").split("+");
          const result = await computerUseEngine.hotkey(sessionId, keys);
          return JSON.stringify({ success: result.success, action: "hotkey_pressed" });
        }
        case "select": {
          if (selector) {
            const result = await universalBrowserController.select(sessionId, selector, value || "");
            return JSON.stringify({ success: result.success, action: "selected", selected: result.selected });
          }
          return JSON.stringify({ success: false, error: "Selector required for select" });
        }
        case "hover": {
          if (selector) {
            await universalBrowserController.hover(sessionId, selector);
            return JSON.stringify({ success: true, action: "hovered" });
          }
          return JSON.stringify({ success: false, error: "Selector required for hover" });
        }
        default:
          return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "computer_use_interact",
    description: "Interact with elements on screen: click (by selector or coordinates), type text, scroll, press keyboard keys, hotkeys, select dropdowns, hover. Supports both CSS selectors and pixel coordinates.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["click", "type", "scroll", "press_key", "hotkey", "select", "hover"]).describe("Interaction type"),
      selector: z.string().optional().describe("CSS selector for the element"),
      value: z.string().optional().describe("Text to type, key to press, or option to select"),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional().describe("Screen coordinates for click/scroll"),
    }),
  }
);

export const computerUseScreenshotTool = tool(
  async (input) => {
    const { sessionId, fullPage, analyze, query } = input;

    try {
      let screenshot: string;
      try {
        screenshot = await universalBrowserController.screenshot(sessionId, { fullPage });
      } catch {
        screenshot = await computerUseEngine.captureScreenshot(sessionId, { fullPage });
      }

      let analysis: any = null;
      if (analyze) {
        analysis = await computerUseEngine.analyzeScreen(sessionId, query);
      }

      return JSON.stringify({
        success: true,
        screenshot: screenshot.slice(0, 200) + "...[truncated for display]",
        screenshotLength: screenshot.length,
        analysis: analysis ? {
          description: analysis.description,
          currentState: analysis.currentState,
          elementsFound: analysis.elements.length,
          suggestedActions: analysis.suggestedActions.slice(0, 5),
          confidence: analysis.confidence,
        } : undefined,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "computer_use_screenshot",
    description: "Capture screenshot and optionally analyze it with AI vision. Identifies all UI elements, their positions, and suggests next actions. Essential for visual verification.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      fullPage: z.boolean().optional().default(false).describe("Capture full page"),
      analyze: z.boolean().optional().default(true).describe("Analyze screenshot with AI vision"),
      query: z.string().optional().describe("Specific question about the screenshot"),
    }),
  }
);

export const computerUseExtractTool = tool(
  async (input) => {
    const { sessionId, description, rules } = input;

    try {
      if (rules) {
        const data = await universalBrowserController.extract(sessionId, rules);
        return JSON.stringify({ success: true, data });
      }

      if (description) {
        const data = await universalBrowserController.extractStructured(sessionId, description);
        return JSON.stringify({ success: true, data });
      }

      // Fallback: get page content
      const content = await computerUseEngine.getPageContent(sessionId);
      return JSON.stringify({
        success: true,
        data: {
          url: content.url,
          title: content.title,
          textLength: content.text.length,
          linksCount: content.links.length,
          inputsCount: content.inputs.length,
          buttonsCount: content.buttons.length,
          text: content.text.slice(0, 5000),
        },
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "computer_use_extract",
    description: "Extract data from the current web page. Use description for AI-powered structured extraction, or rules for CSS selector-based extraction. Can also return full page content.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      description: z.string().optional().describe("AI extraction: describe what data to extract"),
      rules: z.array(z.object({
        name: z.string(),
        selector: z.string(),
        type: z.enum(["text", "html", "attribute", "list", "table"]),
        attribute: z.string().optional(),
      })).optional().describe("Rule-based extraction: CSS selector rules"),
    }),
  }
);

export const computerUseAgenticTool = tool(
  async (input) => {
    const { sessionId, goal, maxSteps } = input;

    try {
      const result = await universalBrowserController.agenticNavigate(sessionId, goal, maxSteps);
      return JSON.stringify({
        success: result.success,
        stepsCount: result.steps.length,
        steps: result.steps,
        data: result.data,
        screenshotsCount: result.screenshots.length,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "computer_use_agentic",
    description: "Autonomous browser agent that accomplishes goals by itself. Describe what you want done and the AI will navigate, click, type, and extract data automatically. Self-correcting with LLM-powered decision making.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      goal: z.string().describe("What to accomplish (e.g., 'search for AI news on Google and extract top 5 results')"),
      maxSteps: z.number().optional().default(15).describe("Maximum steps the agent can take"),
    }),
  }
);

// ============================================
// Document Generation Tools
// ============================================

export const generatePresentationTool = tool(
  async (input) => {
    try {
      const result = await perfectPptGenerator.generate({
        topic: input.topic,
        slideCount: input.slideCount,
        template: input.template,
        style: input.style as any,
        language: input.language,
        audience: input.audience,
        purpose: input.purpose as any,
        includeCharts: input.includeCharts,
        includeSpeakerNotes: true,
        customInstructions: input.customInstructions,
      });

      return JSON.stringify({
        success: true,
        fileName: result.fileName,
        filePath: result.filePath,
        slideCount: result.slideCount,
        outline: result.outline,
        fileSize: result.metadata.fileSize,
        template: result.metadata.template,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "generate_perfect_ppt",
    description: "Generate a professional PowerPoint presentation with AI content. Supports 15 templates, charts, timelines, comparisons, and speaker notes. Returns downloadable PPTX file.",
    schema: z.object({
      topic: z.string().describe("Presentation topic"),
      slideCount: z.number().optional().default(10).describe("Number of slides (5-20)"),
      template: z.string().optional().default("corporate").describe("Template: corporate, modern_minimal, gradient_flow, tech_startup, elegant_dark, academic, pitch_deck, creative, etc."),
      style: z.string().optional().default("professional").describe("Style: professional, creative, minimal, bold, elegant, academic, tech"),
      language: z.string().optional().default("en").describe("Language code: en, es, fr, de, pt, zh, ja"),
      audience: z.string().optional().describe("Target audience"),
      purpose: z.string().optional().describe("Purpose: inform, persuade, educate, pitch, report"),
      includeCharts: z.boolean().optional().default(true),
      customInstructions: z.string().optional().describe("Additional instructions for content generation"),
    }),
  }
);

export const generateDocumentTool = tool(
  async (input) => {
    try {
      const result = await perfectDocumentGenerator.generate({
        topic: input.topic,
        type: input.type as any,
        language: input.language,
        wordCount: input.wordCount,
        sections: input.sections,
        includeTableOfContents: input.includeTableOfContents,
        includeCoverPage: input.includeCoverPage,
        includeReferences: input.includeReferences,
        referenceStyle: input.referenceStyle as any,
        author: input.author,
        customInstructions: input.customInstructions,
      });

      return JSON.stringify({
        success: true,
        fileName: result.fileName,
        filePath: result.filePath,
        wordCount: result.wordCount,
        sectionCount: result.sectionCount,
        fileSize: result.metadata.fileSize,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "generate_perfect_doc",
    description: "Generate a professional Word document with AI content. Supports reports, essays, proposals, contracts, thesis, etc. Includes cover page, TOC, tables, references.",
    schema: z.object({
      topic: z.string().describe("Document topic"),
      type: z.enum(["report", "letter", "essay", "thesis", "contract", "proposal", "memo", "manual", "article", "whitepaper"]).optional().default("report"),
      language: z.string().optional().default("en"),
      wordCount: z.number().optional().default(2000).describe("Target word count"),
      sections: z.array(z.string()).optional().describe("Required section titles"),
      includeTableOfContents: z.boolean().optional().default(true),
      includeCoverPage: z.boolean().optional().default(true),
      includeReferences: z.boolean().optional().default(false),
      referenceStyle: z.enum(["APA", "MLA", "Chicago", "IEEE"]).optional(),
      author: z.string().optional(),
      customInstructions: z.string().optional(),
    }),
  }
);

export const generateExcelTool = tool(
  async (input) => {
    try {
      const result = await perfectExcelGenerator.generate({
        topic: input.topic,
        type: input.type as any,
        description: input.description,
        language: input.language,
        columns: input.columns,
        rowCount: input.rowCount,
        includeFormulas: input.includeFormulas,
        includeConditionalFormatting: input.includeConditionalFormatting,
        includePivotSummary: input.includePivotSummary,
        customInstructions: input.customInstructions,
      });

      return JSON.stringify({
        success: true,
        fileName: result.fileName,
        filePath: result.filePath,
        sheetCount: result.sheetCount,
        totalRows: result.totalRows,
        fileSize: result.metadata.fileSize,
        hasFormulas: result.metadata.hasFormulas,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "generate_perfect_excel",
    description: "Generate a professional Excel spreadsheet with AI-generated data. Supports dashboards, financial models, budgets, trackers, invoices. Includes formulas, conditional formatting, charts.",
    schema: z.object({
      topic: z.string().describe("Spreadsheet topic/data description"),
      type: z.enum(["spreadsheet", "dashboard", "financial_model", "report", "tracker", "database", "analysis", "budget", "invoice", "schedule", "inventory"]).optional().default("spreadsheet"),
      description: z.string().optional().describe("Detailed description of what data to generate"),
      language: z.string().optional().default("en"),
      columns: z.array(z.string()).optional().describe("Required column names"),
      rowCount: z.number().optional().default(20),
      includeFormulas: z.boolean().optional().default(true),
      includeConditionalFormatting: z.boolean().optional().default(true),
      includePivotSummary: z.boolean().optional().default(true),
      customInstructions: z.string().optional(),
    }),
  }
);

// ============================================
// Terminal Control Tools
// ============================================

export const terminalExecuteTool = tool(
  async (input) => {
    const { command, cwd, timeout, sessionId: existingSessionId } = input;

    try {
      const sid = existingSessionId || terminalController.createSession(cwd);
      const result = await terminalController.executeCommand(sid, { command, timeout: timeout || 30000 });

      return JSON.stringify({
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 5000),
        stderr: result.stderr.slice(0, 2000),
        duration: result.duration,
        sessionId: sid,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_execute",
    description: "Execute a shell command on the computer. Has safety guards against dangerous operations. Returns stdout, stderr, and exit code. Supports bash, zsh, sh.",
    schema: z.object({
      command: z.string().describe("Shell command to execute"),
      cwd: z.string().optional().describe("Working directory"),
      timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
      sessionId: z.string().optional().describe("Reuse existing terminal session"),
    }),
  }
);

export const terminalSystemInfoTool = tool(
  async () => {
    try {
      const info = await terminalController.getSystemInfo();
      return JSON.stringify({
        success: true,
        os: info.os,
        cpu: { model: info.cpu.model, cores: info.cpu.cores },
        memory: {
          total: `${Math.round(info.memory.total / 1024 / 1024 / 1024)}GB`,
          used: `${Math.round(info.memory.used / 1024 / 1024 / 1024)}GB`,
          usagePercent: info.memory.usagePercent,
        },
        diskCount: info.disk.length,
        networkInterfaces: info.network.length,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_system_info",
    description: "Get system information: OS, CPU, memory, disk, network. Useful for understanding the computer's capabilities and current state.",
    schema: z.object({}),
  }
);

export const terminalFileOpTool = tool(
  async (input) => {
    const { operation, path: filePath, destination, content, pattern, recursive, sessionId: existingSessionId } = input;

    try {
      const sid = existingSessionId || terminalController.createSession();
      const result = await terminalController.fileOperation(sid, {
        type: operation as any,
        path: filePath,
        destination,
        content,
        pattern,
        recursive,
      });

      return JSON.stringify({ ...result, sessionId: sid });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_file_op",
    description: "Perform file system operations: read, write, append, delete, copy, move, mkdir, list directory, stat file, search by pattern, chmod.",
    schema: z.object({
      operation: z.enum(["read", "write", "append", "delete", "copy", "move", "mkdir", "list", "stat", "search", "chmod"]).describe("File operation type"),
      path: z.string().describe("File or directory path"),
      destination: z.string().optional().describe("Destination for copy/move"),
      content: z.string().optional().describe("Content for write/append"),
      pattern: z.string().optional().describe("Pattern for search"),
      recursive: z.boolean().optional().default(false),
      sessionId: z.string().optional(),
    }),
  }
);

// ============================================
// Vision Tools
// ============================================

export const visionAnalyzeTool = tool(
  async (input) => {
    const { sessionId, query, mode } = input;

    try {
      const screenshot = await computerUseEngine.captureScreenshot(sessionId);
      const result = await visionPipeline.analyze({
        image: screenshot,
        query: query || "Analyze this screen",
        mode: mode as any || "analyze",
      });

      return JSON.stringify({
        success: true,
        analysis: result.analysis,
        elementsFound: result.elements?.length || 0,
        text: result.text?.slice(0, 2000),
        confidence: result.confidence,
        processingTime: result.processingTime,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "vision_analyze",
    description: "Capture and analyze the current screen with AI vision. Modes: analyze (general), ocr (text extraction), detect_elements (UI elements), accessibility (WCAG analysis).",
    schema: z.object({
      sessionId: z.string().describe("Session ID for screenshot capture"),
      query: z.string().optional().describe("What to analyze or look for"),
      mode: z.enum(["analyze", "ocr", "detect_elements", "accessibility"]).optional().default("analyze"),
    }),
  }
);

// ============================================
// Exports
// ============================================

export const COMPUTER_USE_TOOLS = [
  computerUseSessionTool,
  computerUseNavigateTool,
  computerUseInteractTool,
  computerUseScreenshotTool,
  computerUseExtractTool,
  computerUseAgenticTool,
  generatePresentationTool,
  generateDocumentTool,
  generateExcelTool,
  terminalExecuteTool,
  terminalSystemInfoTool,
  terminalFileOpTool,
  visionAnalyzeTool,
];
