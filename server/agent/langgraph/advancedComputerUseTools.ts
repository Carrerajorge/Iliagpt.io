/**
 * Advanced Computer Use LangChain Tools
 *
 * Extends the agent's capabilities with:
 * - Process management (list, kill)
 * - Script execution (multi-language)
 * - Package management (npm, pip, apt)
 * - PDF generation from browser pages
 * - Accessibility tree analysis
 * - Session recording & replay
 * - Workflow automation
 * - Scraping pipelines
 * - Performance metrics
 * - Element picker (visual)
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { terminalController } from "../computerUse/terminalController";
import { universalBrowserController } from "../computerUse/universalBrowserController";
import { browserEngineExtensions } from "../computerUse/browserEngineExtensions";
import { workflowEngine } from "../computerUse/workflowEngine";

// ============================================
// Terminal: Process Management
// ============================================

export const terminalProcessManageTool = tool(
  async (input) => {
    try {
      switch (input.action) {
        case "list": {
          const processes = await terminalController.listProcesses(input.filter);
          return JSON.stringify({
            success: true,
            count: processes.length,
            processes: processes.slice(0, 30).map((p) => ({
              pid: p.pid,
              name: p.name,
              cpu: p.cpu,
              memory: p.memory,
              status: p.status,
            })),
          });
        }
        case "kill": {
          if (!input.pid) return JSON.stringify({ success: false, error: "PID required" });
          const killed = await terminalController.killProcess(input.pid, input.signal || "SIGTERM");
          return JSON.stringify({ success: killed, pid: input.pid, signal: input.signal || "SIGTERM" });
        }
        case "ports": {
          const ports = await terminalController.listPorts();
          return JSON.stringify({ success: true, ports });
        }
        default:
          return JSON.stringify({ success: false, error: `Unknown action: ${input.action}` });
      }
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_process_manage",
    description: "Manage system processes: list running processes with CPU/memory usage, kill processes by PID, list listening network ports.",
    schema: z.object({
      action: z.enum(["list", "kill", "ports"]).describe("Action: list processes, kill a process, or list ports"),
      filter: z.string().optional().describe("Filter processes by name (for list action)"),
      pid: z.number().optional().describe("Process ID to kill"),
      signal: z.string().optional().default("SIGTERM").describe("Signal: SIGTERM, SIGKILL, SIGHUP"),
    }),
  }
);

// ============================================
// Terminal: Script Execution
// ============================================

export const terminalScriptExecuteTool = tool(
  async (input) => {
    try {
      const sid = input.sessionId || terminalController.createSession(input.cwd);
      const result = await terminalController.executeScript(sid, input.language, input.code, {
        timeout: input.timeout || 60000,
        args: input.args,
      });

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
    name: "terminal_script_execute",
    description: "Execute a code script in any supported language: Python, JavaScript, TypeScript, Bash, Ruby, Go, PHP. Writes a temp file and runs it with the appropriate interpreter.",
    schema: z.object({
      language: z.enum(["python", "javascript", "typescript", "bash", "ruby", "go", "php"]).describe("Programming language"),
      code: z.string().describe("Source code to execute"),
      args: z.array(z.string()).optional().describe("Command-line arguments"),
      timeout: z.number().optional().default(60000).describe("Timeout in milliseconds"),
      cwd: z.string().optional().describe("Working directory"),
      sessionId: z.string().optional().describe("Reuse existing session"),
    }),
  }
);

// ============================================
// Terminal: Package Management
// ============================================

export const terminalPackageManageTool = tool(
  async (input) => {
    try {
      const sid = input.sessionId || terminalController.createSession();
      const result = await terminalController.installPackage(sid, input.manager, input.packages);

      return JSON.stringify({
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 3000),
        stderr: result.stderr.slice(0, 1000),
        duration: result.duration,
        sessionId: sid,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_package_manage",
    description: "Install packages using npm, pip, or apt. Specify the package manager and list of packages to install.",
    schema: z.object({
      manager: z.enum(["npm", "pip", "apt"]).describe("Package manager"),
      packages: z.array(z.string()).describe("Package names to install"),
      sessionId: z.string().optional(),
    }),
  }
);

// ============================================
// Browser: PDF Generation
// ============================================

export const browserPdfGenerateTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);
      const { path: filePath } = await browserEngineExtensions.generatePdf(page, {
        format: input.format as any,
        landscape: input.landscape,
        printBackground: input.printBackground,
        scale: input.scale,
      });

      return JSON.stringify({
        success: true,
        filePath,
        format: input.format || "A4",
        landscape: input.landscape || false,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_pdf_generate",
    description: "Generate a PDF from the current browser page. Supports A4, Letter, Legal, A3, Tabloid formats with landscape mode, background printing, and custom scale.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      format: z.enum(["A4", "Letter", "Legal", "A3", "Tabloid"]).optional().default("A4"),
      landscape: z.boolean().optional().default(false),
      printBackground: z.boolean().optional().default(true),
      scale: z.number().optional().default(1).describe("Scale factor (0.1 to 2.0)"),
    }),
  }
);

// ============================================
// Browser: Accessibility
// ============================================

export const browserAccessibilityTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);

      if (input.role) {
        const nodes = await browserEngineExtensions.getAccessibilityByRole(page, input.role);
        return JSON.stringify({
          success: true,
          role: input.role,
          count: nodes.length,
          nodes: nodes.slice(0, 20).map((n) => ({
            name: n.name,
            value: n.value,
            disabled: n.disabled,
          })),
        });
      }

      const tree = await browserEngineExtensions.getAccessibilityTree(page);
      // Flatten to summary
      const flatNodes: any[] = [];
      function flatten(node: any, depth: number) {
        if (depth > 3) return;
        flatNodes.push({
          role: node.role,
          name: node.name?.slice(0, 100),
          depth,
        });
        if (node.children) {
          for (const child of node.children) flatten(child, depth + 1);
        }
      }
      flatten(tree, 0);

      return JSON.stringify({
        success: true,
        totalNodes: flatNodes.length,
        tree: flatNodes.slice(0, 50),
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_accessibility",
    description: "Get the accessibility tree or find elements by ARIA role. Useful for understanding page structure, finding interactive elements, and checking accessibility compliance.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      role: z.string().optional().describe("Filter by role: button, link, heading, textbox, checkbox, radio, etc."),
    }),
  }
);

// ============================================
// Browser: Performance Metrics
// ============================================

export const browserPerformanceTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);
      const metrics = await browserEngineExtensions.getPerformanceMetrics(page);

      return JSON.stringify({
        success: true,
        metrics: {
          loadTime: `${Math.round(metrics.loadTime)}ms`,
          domContentLoaded: `${Math.round(metrics.domContentLoaded)}ms`,
          firstPaint: `${Math.round(metrics.firstPaint)}ms`,
          firstContentfulPaint: `${Math.round(metrics.firstContentfulPaint)}ms`,
          largestContentfulPaint: `${Math.round(metrics.largestContentfulPaint)}ms`,
          cumulativeLayoutShift: metrics.cumulativeLayoutShift.toFixed(3),
          domNodes: metrics.domNodes,
          resources: metrics.resourceCount,
          transferSize: `${Math.round(metrics.transferSize / 1024)}KB`,
          jsHeapSize: `${Math.round(metrics.jsHeapSize / 1024 / 1024)}MB`,
        },
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_performance",
    description: "Get web performance metrics: load time, FCP, LCP, CLS, DOM nodes, resource count, JS heap size. Useful for performance auditing and optimization.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
    }),
  }
);

// ============================================
// Browser: Element Picker
// ============================================

export const browserElementPickerTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);

      if (input.action === "highlight") {
        const screenshot = await browserEngineExtensions.highlightElements(page, input.highlights || []);
        return JSON.stringify({
          success: true,
          screenshot: screenshot.slice(0, 200) + "...[truncated]",
          screenshotLength: screenshot.length,
          highlightCount: input.highlights?.length || 0,
        });
      }

      if (input.action === "pick" && input.x !== undefined && input.y !== undefined) {
        const element = await browserEngineExtensions.getElementAtPoint(page, input.x, input.y);
        return JSON.stringify({
          success: true,
          element: element || null,
        });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_element_picker",
    description: "Interact with page elements visually. 'pick' identifies the element at given coordinates (x,y) and returns its CSS selector. 'highlight' draws colored borders around specified elements and returns a screenshot.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["pick", "highlight"]).describe("pick: identify element at coordinates; highlight: draw borders on elements"),
      x: z.number().optional().describe("X coordinate for pick"),
      y: z.number().optional().describe("Y coordinate for pick"),
      highlights: z.array(z.object({
        selector: z.string(),
        label: z.string().optional(),
        color: z.string().optional(),
      })).optional().describe("Elements to highlight"),
    }),
  }
);

// ============================================
// Browser: Console Capture
// ============================================

export const browserConsoleTool = tool(
  async (input) => {
    try {
      if (input.action === "start") {
        const page = universalBrowserController.getActivePage(input.sessionId);
        browserEngineExtensions.startConsoleCapture(input.sessionId, page);
        return JSON.stringify({ success: true, message: "Console capture started" });
      }

      if (input.action === "get") {
        const entries = browserEngineExtensions.getConsoleEntries(input.sessionId, {
          type: input.filter as any,
          limit: input.limit || 50,
        });
        return JSON.stringify({
          success: true,
          count: entries.length,
          entries: entries.map((e) => ({
            type: e.type,
            text: e.text.slice(0, 500),
            timestamp: e.timestamp,
          })),
        });
      }

      if (input.action === "clear") {
        browserEngineExtensions.clearConsoleEntries(input.sessionId);
        return JSON.stringify({ success: true, message: "Console cleared" });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_console",
    description: "Capture and inspect browser console output (logs, errors, warnings). Start capture, then retrieve entries filtered by type.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["start", "get", "clear"]).describe("start: begin capture; get: retrieve logs; clear: reset"),
      filter: z.enum(["log", "error", "warning", "info"]).optional().describe("Filter by console type"),
      limit: z.number().optional().default(50).describe("Max entries to return"),
    }),
  }
);

// ============================================
// Browser: Session Recording
// ============================================

export const browserRecordingTool = tool(
  async (input) => {
    try {
      switch (input.action) {
        case "start": {
          const page = universalBrowserController.getActivePage(input.sessionId);
          const recordingId = browserEngineExtensions.startRecording(
            input.sessionId,
            input.name || "Recording",
            page.url(),
            "chrome-desktop"
          );
          return JSON.stringify({ success: true, recordingId });
        }
        case "stop": {
          const recording = browserEngineExtensions.stopRecording(input.sessionId);
          return JSON.stringify({
            success: true,
            recording: recording ? {
              id: recording.id,
              name: recording.name,
              actionCount: recording.actions.length,
              duration: recording.duration,
            } : null,
          });
        }
        case "list": {
          const recordings = browserEngineExtensions.listRecordings();
          return JSON.stringify({
            success: true,
            recordings: recordings.map((r) => ({
              id: r.id,
              name: r.name,
              actionCount: r.actions.length,
              duration: r.duration,
              createdAt: r.createdAt,
            })),
          });
        }
        case "get": {
          const recording = browserEngineExtensions.getRecording(input.recordingId || "");
          return JSON.stringify({
            success: !!recording,
            recording: recording || null,
          });
        }
        default:
          return JSON.stringify({ success: false, error: `Unknown action: ${input.action}` });
      }
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_recording",
    description: "Record and replay browser sessions. Start recording all browser actions, stop to save, list saved recordings, or get a specific recording's actions.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["start", "stop", "list", "get"]).describe("Recording action"),
      name: z.string().optional().describe("Recording name (for start)"),
      recordingId: z.string().optional().describe("Recording ID (for get)"),
    }),
  }
);

// ============================================
// Workflow: Execute
// ============================================

export const workflowExecuteTool = tool(
  async (input) => {
    try {
      if (input.action === "execute") {
        const execution = await workflowEngine.executeWorkflow(
          input.workflow as any,
          input.variables
        );
        return JSON.stringify({
          success: execution.status === "completed",
          executionId: execution.id,
          status: execution.status,
          stepsCompleted: execution.completedSteps,
          totalSteps: execution.totalSteps,
          duration: execution.endTime ? execution.endTime - execution.startTime : 0,
          variables: Object.keys(execution.variables),
          error: execution.error,
        });
      }

      if (input.action === "status") {
        const execution = workflowEngine.getExecution(input.executionId || "");
        return JSON.stringify({
          success: !!execution,
          execution: execution ? {
            id: execution.id,
            status: execution.status,
            progress: execution.progress,
            completedSteps: execution.completedSteps,
            totalSteps: execution.totalSteps,
          } : null,
        });
      }

      if (input.action === "cancel") {
        const cancelled = workflowEngine.cancelExecution(input.executionId || "");
        return JSON.stringify({ success: cancelled });
      }

      if (input.action === "list") {
        const executions = workflowEngine.listExecutions();
        return JSON.stringify({
          success: true,
          executions: executions.map((e) => ({
            id: e.id,
            name: e.workflowName,
            status: e.status,
            progress: e.progress,
          })),
        });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "workflow_execute",
    description: "Execute automated workflows with sequential/parallel steps, conditions, loops, and variable passing. Chain browser + terminal actions together. Supports retry policies and error handling.",
    schema: z.object({
      action: z.enum(["execute", "status", "cancel", "list"]).describe("Workflow action"),
      workflow: z.any().optional().describe("Workflow definition with name, steps array, and variables"),
      variables: z.record(z.any()).optional().describe("Input variables for the workflow"),
      executionId: z.string().optional().describe("Execution ID for status/cancel"),
    }),
  }
);

// ============================================
// Scraping Pipeline
// ============================================

export const scrapingPipelineTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);
      const result = await browserEngineExtensions.executeScraping(page, {
        id: input.pipelineId || "pipeline",
        name: input.name || "Scraping Pipeline",
        startUrl: input.startUrl,
        steps: input.steps,
        maxPages: input.maxPages || 10,
        concurrency: 1,
        delay: input.delay || 500,
        variables: input.variables || {},
      });

      return JSON.stringify({
        success: result.errors.length === 0,
        pagesScraped: result.pagesScraped,
        dataCount: result.data.length,
        data: result.data.slice(0, 20),
        errors: result.errors,
        duration: result.duration,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "scraping_pipeline",
    description: "Execute a multi-page scraping pipeline. Navigate pages, extract data with CSS selectors, paginate through results, and collect structured data. Supports conditions and variable interpolation.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      startUrl: z.string().describe("Starting URL"),
      name: z.string().optional(),
      pipelineId: z.string().optional(),
      steps: z.array(z.object({
        action: z.enum(["navigate", "click", "paginate", "extract", "wait", "condition"]),
        selector: z.string().optional(),
        url: z.string().optional(),
        extractionRules: z.array(z.object({
          name: z.string(),
          selector: z.string(),
          type: z.enum(["text", "html", "attribute", "list"]),
          attribute: z.string().optional(),
        })).optional(),
        waitMs: z.number().optional(),
        paginationSelector: z.string().optional(),
        maxPages: z.number().optional(),
      })).describe("Pipeline steps"),
      maxPages: z.number().optional().default(10),
      delay: z.number().optional().default(500),
      variables: z.record(z.any()).optional(),
    }),
  }
);

// ============================================
// Browser: Network Throttling
// ============================================

export const browserNetworkThrottleTool = tool(
  async (input) => {
    try {
      const context = universalBrowserController.getSessionContext(input.sessionId);

      if (input.action === "set") {
        await browserEngineExtensions.setNetworkThrottle(context, input.preset || "4g");
        return JSON.stringify({
          success: true,
          preset: input.preset,
          message: `Network throttled to ${input.preset}`,
        });
      }

      if (input.action === "remove") {
        await browserEngineExtensions.removeNetworkThrottle(context);
        return JSON.stringify({ success: true, message: "Throttling removed" });
      }

      if (input.action === "list-presets") {
        const { BrowserEngineExtensions } = await import("../computerUse/browserEngineExtensions");
        return JSON.stringify({
          success: true,
          presets: Object.entries(BrowserEngineExtensions.THROTTLE_PRESETS).map(([id, p]) => ({
            id,
            name: p.name,
            downloadKbps: p.downloadKbps,
            uploadKbps: p.uploadKbps,
            latencyMs: p.latencyMs,
          })),
        });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_network_throttle",
    description: "Control network speed in browser sessions. Simulate 3G, 4G, WiFi, dial-up, or offline. Useful for testing app performance under poor network conditions.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["set", "remove", "list-presets"]).describe("Throttle action"),
      preset: z.enum(["3g", "3g-slow", "4g", "wifi", "dial-up", "offline"]).optional().describe("Network preset"),
    }),
  }
);

// ============================================
// Browser: Geolocation Spoofing
// ============================================

export const browserGeolocationTool = tool(
  async (input) => {
    try {
      const context = universalBrowserController.getSessionContext(input.sessionId);

      if (input.action === "set") {
        if (input.preset) {
          const { BrowserEngineExtensions } = await import("../computerUse/browserEngineExtensions");
          const loc = BrowserEngineExtensions.LOCATION_PRESETS[input.preset];
          if (!loc) return JSON.stringify({ success: false, error: "Unknown preset" });
          await browserEngineExtensions.setGeolocation(context, loc.latitude, loc.longitude);
          return JSON.stringify({ success: true, location: loc });
        }
        if (input.latitude !== undefined && input.longitude !== undefined) {
          await browserEngineExtensions.setGeolocation(context, input.latitude, input.longitude);
          return JSON.stringify({ success: true, location: { latitude: input.latitude, longitude: input.longitude } });
        }
        return JSON.stringify({ success: false, error: "Provide preset or coordinates" });
      }

      if (input.action === "list-presets") {
        const { BrowserEngineExtensions } = await import("../computerUse/browserEngineExtensions");
        return JSON.stringify({
          success: true,
          presets: Object.entries(BrowserEngineExtensions.LOCATION_PRESETS).map(([id, l]) => ({
            id,
            ...l,
          })),
        });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_geolocation",
    description: "Spoof browser geolocation to test location-dependent features. Use presets (new-york, london, tokyo, etc.) or custom coordinates.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["set", "list-presets"]).describe("Geolocation action"),
      preset: z.string().optional().describe("Location preset name"),
      latitude: z.number().optional().describe("Custom latitude"),
      longitude: z.number().optional().describe("Custom longitude"),
    }),
  }
);

// ============================================
// Browser: HAR Export
// ============================================

export const browserHarTool = tool(
  async (input) => {
    try {
      if (input.action === "start") {
        const page = universalBrowserController.getActivePage(input.sessionId);
        browserEngineExtensions.startHARCapture(input.sessionId, page);
        return JSON.stringify({ success: true, message: "HAR capture started" });
      }

      if (input.action === "get") {
        const har = browserEngineExtensions.getHAR(input.sessionId);
        return JSON.stringify({
          success: true,
          entries: har.entries.length,
          sample: har.entries.slice(-10).map((e) => ({
            method: e.request.method,
            url: e.request.url.slice(0, 100),
            status: e.response.status,
            time: e.time,
          })),
        });
      }

      if (input.action === "export") {
        const result = await browserEngineExtensions.exportHAR(input.sessionId);
        return JSON.stringify({ success: true, path: result.path });
      }

      if (input.action === "clear") {
        browserEngineExtensions.clearHAR(input.sessionId);
        return JSON.stringify({ success: true, message: "HAR cleared" });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_har",
    description: "Capture and export HTTP Archive (HAR) files. Start capturing all network requests/responses, retrieve captured data, or export to a .har file for analysis.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["start", "get", "export", "clear"]).describe("HAR action"),
    }),
  }
);

// ============================================
// Browser: Smart Form Fill
// ============================================

export const browserFormFillTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);

      if (input.action === "detect") {
        const fields = await browserEngineExtensions.detectFormFields(page);
        return JSON.stringify({
          success: true,
          fields: fields.map((f) => ({
            selector: f.selector,
            type: f.type,
            name: f.name,
            label: f.label,
            placeholder: f.placeholder,
            required: f.required,
          })),
        });
      }

      if (input.action === "fill") {
        if (!input.data) return JSON.stringify({ success: false, error: "data is required" });
        const result = await browserEngineExtensions.smartFormFill(page, input.data);
        return JSON.stringify({ success: true, ...result });
      }

      if (input.action === "auth") {
        if (!input.username || !input.password) {
          return JSON.stringify({ success: false, error: "username and password required" });
        }
        const result = await browserEngineExtensions.detectAndFillAuth(
          page,
          { username: input.username, password: input.password },
          { submitAfterFill: true, waitForNavigation: true }
        );
        return JSON.stringify({ success: true, ...result });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_form_fill",
    description: "Intelligently detect and fill forms. Auto-matches data keys to form fields by name/label/placeholder. Can also detect and auto-fill login forms with credentials.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["detect", "fill", "auth"]).describe("detect: find form fields; fill: smart-fill a form; auth: auto-fill login"),
      data: z.record(z.string()).optional().describe("Key-value pairs to fill (keys matched to fields automatically)"),
      username: z.string().optional().describe("Username/email for auth flow"),
      password: z.string().optional().describe("Password for auth flow"),
    }),
  }
);

// ============================================
// Terminal: Environment Management
// ============================================

export const terminalEnvManageTool = tool(
  async (input) => {
    try {
      switch (input.action) {
        case "get": {
          const result = await terminalController.executeCommand("default", {
            command: "env",
            timeout: 5000,
            shell: "bash",
            stream: false,
          });
          const envVars: Record<string, string> = {};
          if (result.stdout) {
            for (const line of result.stdout.split("\n")) {
              const eqIdx = line.indexOf("=");
              if (eqIdx > 0) {
                const key = line.slice(0, eqIdx);
                if (input.filter ? key.toLowerCase().includes(input.filter.toLowerCase()) : true) {
                  envVars[key] = line.slice(eqIdx + 1);
                }
              }
            }
          }
          return JSON.stringify({ success: true, count: Object.keys(envVars).length, env: envVars });
        }
        case "set": {
          if (!input.variables) return JSON.stringify({ success: false, error: "variables required" });
          const exports = Object.entries(input.variables)
            .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
            .join(" && ");
          const result = await terminalController.executeCommand("default", {
            command: exports,
            timeout: 5000,
            shell: "bash",
            stream: false,
          });
          return JSON.stringify({ success: result.success, set: Object.keys(input.variables).length });
        }
        case "load-dotfile": {
          if (!input.dotfilePath) return JSON.stringify({ success: false, error: "dotfilePath required" });
          const cmd = input.dotfilePath.endsWith(".env")
            ? `set -a && source ${JSON.stringify(input.dotfilePath)} && set +a && echo "OK"`
            : `source ${JSON.stringify(input.dotfilePath)} && echo "OK"`;
          const result = await terminalController.executeCommand("default", {
            command: cmd,
            timeout: 10000,
            shell: "bash",
            stream: false,
          });
          return JSON.stringify({
            success: result.stdout?.includes("OK") || false,
            path: input.dotfilePath,
          });
        }
        default:
          return JSON.stringify({ success: false, error: "Invalid action" });
      }
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_env_manage",
    description: "Manage terminal environment variables. Get current env vars (optionally filtered), set new ones, or load from .env/.bashrc files.",
    schema: z.object({
      action: z.enum(["get", "set", "load-dotfile"]).describe("Environment action"),
      filter: z.string().optional().describe("Filter env vars by name substring"),
      variables: z.record(z.string()).optional().describe("Variables to set"),
      dotfilePath: z.string().optional().describe("Path to .env or shell config file"),
    }),
  }
);

// ============================================
// Exports
// ============================================

export const ADVANCED_COMPUTER_USE_TOOLS = [
  terminalProcessManageTool,
  terminalScriptExecuteTool,
  terminalPackageManageTool,
  browserPdfGenerateTool,
  browserAccessibilityTool,
  browserPerformanceTool,
  browserElementPickerTool,
  browserConsoleTool,
  browserRecordingTool,
  workflowExecuteTool,
  scrapingPipelineTool,
  browserNetworkThrottleTool,
  browserGeolocationTool,
  browserHarTool,
  browserFormFillTool,
  terminalEnvManageTool,
];
