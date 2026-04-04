import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "../lib/logger";
import { env } from "../config/env";

// Type alias to avoid importing all playwright types at the top level
type PlaywrightPage = any;
type PlaywrightBrowser = any;

export interface ComputerUseTask {
  instruction: string;
  startUrl?: string;
  maxSteps?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  screenshotOnEachStep?: boolean;
  onStep?: (step: ComputerUseStep) => void;
}

export interface ComputerUseStep {
  stepNumber: number;
  action: ComputerAction;
  screenshotBefore?: string;
  screenshotAfter?: string;
  reasoning: string;
  result?: string;
}

export type ComputerAction =
  | { type: "screenshot" }
  | { type: "click"; coordinate: [number, number] }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; coordinate: [number, number]; direction: "up" | "down"; amount: number }
  | { type: "navigate"; url: string }
  | { type: "done"; result: string };

export interface ComputerUseResult {
  success: boolean;
  result?: string;
  steps: ComputerUseStep[];
  screenshotFinal?: string;
  error?: string;
  totalSteps: number;
  processingTimeMs: number;
}

interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

const BLOCKED_DOMAINS_DEFAULT = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "internal.",
  ".local",
  "admin.",
  "vpn.",
  "10.",
  "192.168.",
  "172.16.",
];

const DISPLAY_WIDTH = 1280;
const DISPLAY_HEIGHT = 800;
const DEFAULT_MAX_STEPS = 20;

class ClaudeComputerUse {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async executeTask(task: ComputerUseTask): Promise<ComputerUseResult> {
    const startTime = Date.now();
    const maxSteps = task.maxSteps ?? DEFAULT_MAX_STEPS;
    const steps: ComputerUseStep[] = [];

    Logger.info("[ClaudeComputerUse] Starting task", {
      instruction: task.instruction.slice(0, 120),
      maxSteps,
      startUrl: task.startUrl,
    });

    // Dynamic import to avoid startup overhead
    const { chromium } = await import("playwright");
    let browser: PlaywrightBrowser | null = null;

    try {
      browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      const context = await browser.newContext({
        viewport: { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();

      if (task.startUrl) {
        const safeCheck = this.isSafeUrl(task.startUrl, task);
        if (!safeCheck) {
          throw new Error(`Blocked unsafe start URL: ${task.startUrl}`);
        }
        Logger.info("[ClaudeComputerUse] Navigating to start URL", { url: task.startUrl });
        await page.goto(task.startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      }

      let finalResult: string | undefined;

      for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber++) {
        Logger.debug("[ClaudeComputerUse] Executing step", { stepNumber, maxSteps });

        const screenshotBefore = await this.takeScreenshot(page);

        const action = await this.askClaude(screenshotBefore, task.instruction, steps);

        const safetyResult = this.checkSafety(action, task);
        if (!safetyResult.safe) {
          Logger.warn("[ClaudeComputerUse] Unsafe action blocked", { reason: safetyResult.reason, action });
          const step: ComputerUseStep = {
            stepNumber,
            action,
            screenshotBefore: task.screenshotOnEachStep ? screenshotBefore : undefined,
            reasoning: `Blocked: ${safetyResult.reason}`,
            result: "Action blocked by safety rules",
          };
          steps.push(step);
          task.onStep?.(step);
          break;
        }

        if (action.type === "done") {
          finalResult = action.result;
          const step: ComputerUseStep = {
            stepNumber,
            action,
            screenshotBefore: task.screenshotOnEachStep ? screenshotBefore : undefined,
            reasoning: "Task completed",
            result: action.result,
          };
          steps.push(step);
          task.onStep?.(step);
          Logger.info("[ClaudeComputerUse] Task completed by Claude", { result: action.result.slice(0, 200) });
          break;
        }

        await this.executeAction(page, action);

        // Small wait after action for page to settle
        await page.waitForTimeout(500).catch(() => {});

        const screenshotAfter = task.screenshotOnEachStep ? await this.takeScreenshot(page) : undefined;

        const step: ComputerUseStep = {
          stepNumber,
          action,
          screenshotBefore: task.screenshotOnEachStep ? screenshotBefore : undefined,
          screenshotAfter,
          reasoning: `Step ${stepNumber}: executed ${action.type}`,
        };
        steps.push(step);
        task.onStep?.(step);

        if (stepNumber === maxSteps) {
          Logger.warn("[ClaudeComputerUse] Max steps reached", { maxSteps });
        }
      }

      const screenshotFinal = await this.takeScreenshot(page);
      await browser.close();
      browser = null;

      const processingTimeMs = Date.now() - startTime;
      Logger.info("[ClaudeComputerUse] Task finished", {
        totalSteps: steps.length,
        processingTimeMs,
        success: true,
      });

      return {
        success: true,
        result: finalResult,
        steps,
        screenshotFinal,
        totalSteps: steps.length,
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error("[ClaudeComputerUse] Task failed", error);

      return {
        success: false,
        error: errorMessage,
        steps,
        totalSteps: steps.length,
        processingTimeMs,
      };
    } finally {
      if (browser) {
        await browser.close().catch((e: unknown) => Logger.error("[ClaudeComputerUse] Error closing browser", e));
      }
    }
  }

  async takeScreenshot(page: PlaywrightPage): Promise<string> {
    try {
      const buffer: Buffer = await page.screenshot({ type: "png", fullPage: false });
      return buffer.toString("base64");
    } catch (error) {
      Logger.error("[ClaudeComputerUse] Screenshot failed", error);
      // Return 1x1 transparent PNG as fallback
      return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    }
  }

  async executeAction(page: PlaywrightPage, action: ComputerAction): Promise<void> {
    try {
      switch (action.type) {
        case "screenshot":
          // No-op, screenshots are taken at the start of each loop iteration
          break;

        case "click": {
          const [x, y] = action.coordinate;
          await page.mouse.click(x, y);
          Logger.debug("[ClaudeComputerUse] Clicked", { x, y });
          break;
        }

        case "type":
          await page.keyboard.type(action.text, { delay: 30 });
          Logger.debug("[ClaudeComputerUse] Typed text", { length: action.text.length });
          break;

        case "key":
          await page.keyboard.press(action.key);
          Logger.debug("[ClaudeComputerUse] Key pressed", { key: action.key });
          break;

        case "scroll": {
          const [sx, sy] = action.coordinate;
          const deltaY = action.direction === "down" ? action.amount * 100 : -action.amount * 100;
          await page.mouse.move(sx, sy);
          await page.mouse.wheel(0, deltaY);
          Logger.debug("[ClaudeComputerUse] Scrolled", { x: sx, y: sy, direction: action.direction, amount: action.amount });
          break;
        }

        case "navigate": {
          if (!this.isSafeUrl(action.url, {})) {
            throw new Error(`Blocked navigation to unsafe URL: ${action.url}`);
          }
          await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30000 });
          Logger.debug("[ClaudeComputerUse] Navigated", { url: action.url });
          break;
        }

        case "done":
          // Handled in the main loop
          break;

        default:
          Logger.warn("[ClaudeComputerUse] Unknown action type", { action });
      }
    } catch (error) {
      Logger.error("[ClaudeComputerUse] Action execution failed", { action, error });
      throw error;
    }
  }

  async askClaude(screenshotBase64: string, instruction: string, history: ComputerUseStep[]): Promise<ComputerAction> {
    const historyContext =
      history.length > 0
        ? `\n\nPrevious steps taken:\n${history
            .map((s) => `Step ${s.stepNumber}: ${s.action.type}${s.result ? ` -> ${s.result}` : ""}`)
            .join("\n")}`
        : "";

    const systemPrompt = `You are a computer use agent. Analyze the screenshot and determine the next action to complete the task.
When the task is fully complete, use the done action with the result.
Available actions: screenshot, click (with coordinates), type (text), key (keyboard key), scroll (with direction/amount), navigate (URL), done (with result).
Only navigate to safe, public URLs. Never access admin panels, internal systems, or download files.`;

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        system: systemPrompt,
        tools: [
          {
            type: "computer_20241022" as const,
            name: "computer",
            display_width_px: DISPLAY_WIDTH,
            display_height_px: DISPLAY_HEIGHT,
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: screenshotBase64,
                },
              },
              {
                type: "text",
                text: `Task: ${instruction}${historyContext}\n\nWhat is the next action to take?`,
              },
            ],
          },
        ],
      });

      // Extract tool use from response
      for (const block of response.content) {
        if (block.type === "tool_use" && block.name === "computer") {
          const input = block.input as Record<string, any>;
          return this.parseClaudeAction(input);
        }
      }

      // If no tool use, check for text response indicating completion
      for (const block of response.content) {
        if (block.type === "text") {
          const text = block.text.toLowerCase();
          if (text.includes("complete") || text.includes("done") || text.includes("finished")) {
            return { type: "done", result: block.text };
          }
        }
      }

      // Default: take a screenshot to re-assess
      return { type: "screenshot" };
    } catch (error) {
      Logger.error("[ClaudeComputerUse] Claude API call failed", error);
      return { type: "done", result: `Error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private parseClaudeAction(input: Record<string, any>): ComputerAction {
    const action = input.action as string;

    switch (action) {
      case "screenshot":
        return { type: "screenshot" };

      case "left_click":
      case "right_click":
      case "double_click":
      case "click":
        return { type: "click", coordinate: input.coordinate as [number, number] };

      case "type":
        return { type: "type", text: input.text as string };

      case "key":
        return { type: "key", key: input.key as string };

      case "scroll":
        return {
          type: "scroll",
          coordinate: input.coordinate as [number, number],
          direction: (input.direction as "up" | "down") || "down",
          amount: (input.amount as number) || 3,
        };

      case "navigate":
        return { type: "navigate", url: input.url as string };

      default:
        Logger.warn("[ClaudeComputerUse] Unknown Claude action, defaulting to screenshot", { action });
        return { type: "screenshot" };
    }
  }

  private checkSafety(action: ComputerAction, task: ComputerUseTask): SafetyCheckResult {
    if (action.type === "navigate") {
      if (!this.isSafeUrl(action.url, task)) {
        return { safe: false, reason: `Navigation to blocked URL: ${action.url}` };
      }
    }

    if (action.type === "type") {
      const lowerText = action.text.toLowerCase();
      const dangerousPatterns = ["rm -rf", "sudo ", "format c:", "del /f /s /q"];
      for (const pattern of dangerousPatterns) {
        if (lowerText.includes(pattern)) {
          return { safe: false, reason: "Potentially dangerous text input blocked" };
        }
      }
    }

    return { safe: true };
  }

  private isSafeUrl(url: string, task: Pick<ComputerUseTask, "allowedDomains" | "blockedDomains">): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check against default blocked domains
    for (const blocked of BLOCKED_DOMAINS_DEFAULT) {
      if (hostname.includes(blocked) || hostname.startsWith(blocked)) {
        Logger.debug("[ClaudeComputerUse] URL blocked by default rules", { url, rule: blocked });
        return false;
      }
    }

    // Check custom blocked domains
    if (task.blockedDomains) {
      for (const blocked of task.blockedDomains) {
        if (hostname.includes(blocked.toLowerCase())) {
          Logger.debug("[ClaudeComputerUse] URL blocked by custom rules", { url, rule: blocked });
          return false;
        }
      }
    }

    // Check allowed domains whitelist
    if (task.allowedDomains && task.allowedDomains.length > 0) {
      const allowed = task.allowedDomains.some(
        (d) => hostname.includes(d.toLowerCase()) || hostname.endsWith(d.toLowerCase())
      );
      if (!allowed) {
        Logger.debug("[ClaudeComputerUse] URL not in allowed domains", { url, allowedDomains: task.allowedDomains });
        return false;
      }
    }

    // Only allow http/https
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    return true;
  }

  async capturePageContent(page: PlaywrightPage): Promise<string> {
    try {
      const text: string = await page.evaluate(() => document.body.innerText);
      return text.slice(0, 10000); // Limit to 10k chars
      // Note: page.evaluate() is a Playwright API for running functions in browser context,
      // not the JavaScript global eval() function
    } catch (error) {
      Logger.error("[ClaudeComputerUse] Failed to capture page content", error);
      return "";
    }
  }
}

export const claudeComputerUse = new ClaudeComputerUse();
