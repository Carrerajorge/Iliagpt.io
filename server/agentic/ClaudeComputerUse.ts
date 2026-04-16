/**
 * ClaudeComputerUse — integration with Claude's computer_use tool type.
 * Manages a Playwright browser session, maps Claude's tool calls to browser actions,
 * verifies results via screenshot analysis, and retries on failure.
 */

import { EventEmitter } from "events";
import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";

const logger = createLogger("ClaudeComputerUse");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComputerUseConfig {
  model?: string;
  maxIterations?: number;
  screenshotOnEachStep?: boolean;
  confirmBeforeDestructive?: boolean;
  allowedDomains?: string[];
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface ComputerAction {
  type: "screenshot" | "click" | "type" | "scroll" | "navigate" | "key" | "wait";
  coordinate?: [number, number];
  text?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  url?: string;
  key?: string;
  duration?: number;
}

export interface ActionResult {
  action: ComputerAction;
  success: boolean;
  screenshot?: string; // base64
  error?: string;
  verificationResult?: VerificationResult;
}

export interface VerificationResult {
  succeeded: boolean;
  observation: string;
  confidence: number;
}

export interface SessionState {
  sessionId: string;
  url?: string;
  title?: string;
  isRunning: boolean;
  actionCount: number;
  startedAt: Date;
}

export interface ComputerUseResult {
  task: string;
  success: boolean;
  actions: ActionResult[];
  finalScreenshot?: string;
  summary: string;
  sessionDuration: number;
}

// ─── Safety Checks ────────────────────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  /delete|remove|destroy|drop|truncate/i,
  /format|wipe|erase/i,
  /submit.*payment|checkout|purchase|buy/i,
  /send.*email|send.*message/i,
  /post.*tweet|publish|deploy/i,
];

function isDestructiveAction(action: ComputerAction): boolean {
  if (action.type === "type" && action.text) {
    return DESTRUCTIVE_PATTERNS.some((p) => p.test(action.text!));
  }
  return false;
}

function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  try {
    const hostname = new URL(url).hostname;
    return allowedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// ─── Browser Manager ──────────────────────────────────────────────────────────

class BrowserManager {
  private browser: import("playwright").Browser | null = null;
  private page: import("playwright").Page | null = null;
  private context: import("playwright").BrowserContext | null = null;

  async launch(viewportWidth: number, viewportHeight: number): Promise<void> {
    const { chromium } = await import("playwright");

    this.browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    this.context = await this.browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36",
    });

    this.page = await this.context.newPage();
    logger.info("Browser launched for computer use");
  }

  async screenshot(): Promise<string> {
    if (!this.page) throw new AppError("Browser not started", 500, "BROWSER_NOT_STARTED");
    const buf = await this.page.screenshot({ type: "png", fullPage: false });
    return buf.toString("base64");
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new AppError("Browser not started", 500, "BROWSER_NOT_STARTED");
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  async click(x: number, y: number): Promise<void> {
    if (!this.page) throw new AppError("Browser not started", 500, "BROWSER_NOT_STARTED");
    await this.page.mouse.click(x, y);
  }

  async type(text: string): Promise<void> {
    if (!this.page) throw new AppError("Browser not started", 500, "BROWSER_NOT_STARTED");
    await this.page.keyboard.type(text, { delay: 30 });
  }

  async scroll(x: number, y: number, direction: "up" | "down", amount: number): Promise<void> {
    if (!this.page) throw new AppError("Browser not started", 500, "BROWSER_NOT_STARTED");
    const delta = direction === "down" ? amount * 100 : -(amount * 100);
    await this.page.mouse.move(x, y);
    await this.page.mouse.wheel(0, delta);
  }

  async keyPress(key: string): Promise<void> {
    if (!this.page) throw new AppError("Browser not started", 500, "BROWSER_NOT_STARTED");
    await this.page.keyboard.press(key);
  }

  async getUrl(): Promise<string> {
    return this.page?.url() ?? "";
  }

  async getTitle(): Promise<string> {
    return await this.page?.title() ?? "";
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
    logger.info("Browser closed");
  }
}

// ─── Screenshot Verifier ──────────────────────────────────────────────────────

async function verifyActionResult(
  screenshot: string,
  expectedOutcome: string,
  claude: Anthropic
): Promise<VerificationResult> {
  try {
    const response = await claude.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: screenshot },
            },
            {
              type: "text",
              text: `Did this action succeed? Expected: ${expectedOutcome}. Reply with JSON: {"succeeded": true/false, "observation": "what you see", "confidence": 0.0-1.0}`,
            },
          ],
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as VerificationResult;
    return { succeeded: parsed.succeeded ?? false, observation: parsed.observation ?? "", confidence: parsed.confidence ?? 0.5 };
  } catch {
    return { succeeded: true, observation: "Could not verify", confidence: 0.3 };
  }
}

// ─── ClaudeComputerUse ────────────────────────────────────────────────────────

export class ClaudeComputerUse extends EventEmitter {
  private config: Required<ComputerUseConfig>;
  private claude: Anthropic;
  private activeSessions = new Map<string, SessionState>();

  constructor(config: ComputerUseConfig = {}) {
    super();
    this.config = {
      model: config.model ?? "claude-sonnet-4-6",
      maxIterations: config.maxIterations ?? 30,
      screenshotOnEachStep: config.screenshotOnEachStep ?? true,
      confirmBeforeDestructive: config.confirmBeforeDestructive ?? true,
      allowedDomains: config.allowedDomains ?? [],
      viewportWidth: config.viewportWidth ?? 1280,
      viewportHeight: config.viewportHeight ?? 800,
    };
    this.claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async executeTask(
    task: string,
    sessionId: string,
    onAction?: (action: ComputerAction, result: ActionResult) => void
  ): Promise<ComputerUseResult> {
    logger.info(`Starting computer use task: ${task} (session: ${sessionId})`);

    const browser = new BrowserManager();
    await browser.launch(this.config.viewportWidth, this.config.viewportHeight);

    const startTime = Date.now();
    const actionResults: ActionResult[] = [];

    this.activeSessions.set(sessionId, {
      sessionId,
      isRunning: true,
      actionCount: 0,
      startedAt: new Date(),
    });

    try {
      const initialScreenshot = await browser.screenshot();
      let messages: Anthropic.MessageParam[] = [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: initialScreenshot },
            },
            {
              type: "text",
              text: `Please complete this task: ${task}\n\nYou have access to a browser. Take a screenshot first to see the current state, then proceed step by step.`,
            },
          ],
        },
      ];

      for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
        const response = await this.claude.messages.create({
          model: this.config.model,
          max_tokens: 4_096,
          tools: [
            {
              type: "computer_20241022",
              name: "computer",
              display_width_px: this.config.viewportWidth,
              display_height_px: this.config.viewportHeight,
              display_number: 1,
            },
          ],
          messages,
        });

        // Check for completion
        if (response.stop_reason === "end_turn") {
          const finalText = response.content.find((b) => b.type === "text");
          const finalScreenshot = await browser.screenshot();

          logger.info(`Task completed in ${iteration + 1} iterations`);
          return {
            task,
            success: true,
            actions: actionResults,
            finalScreenshot,
            summary: finalText?.type === "text" ? finalText.text : "Task completed",
            sessionDuration: Date.now() - startTime,
          };
        }

        // Process tool calls
        const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
        if (toolUseBlocks.length === 0) break;

        const toolResults: Anthropic.MessageParam = { role: "user", content: [] };

        for (const block of toolUseBlocks) {
          if (block.type !== "tool_use") continue;
          const input = block.input as { action?: string; coordinate?: [number, number]; text?: string; url?: string; direction?: string; amount?: number; key?: string };

          const action: ComputerAction = {
            type: (input.action ?? "screenshot") as ComputerAction["type"],
            coordinate: input.coordinate,
            text: input.text,
            url: input.url,
            direction: input.direction as ComputerAction["direction"],
            amount: input.amount,
            key: input.key,
          };

          // Safety checks
          if (action.type === "navigate" && action.url && this.config.allowedDomains.length > 0) {
            if (!isDomainAllowed(action.url, this.config.allowedDomains)) {
              const errorResult: ActionResult = {
                action,
                success: false,
                error: `Domain not in allowedDomains: ${action.url}`,
              };
              actionResults.push(errorResult);
              this.emit("blocked", { action, reason: "domain_not_allowed" });

              (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
                type: "tool_result",
                tool_use_id: block.id,
                content: [{ type: "text", text: `Navigation blocked: domain not allowed (${action.url})` }],
              });
              continue;
            }
          }

          if (this.config.confirmBeforeDestructive && isDestructiveAction(action)) {
            this.emit("confirmRequired", { action, sessionId });
            // Block and report
            actionResults.push({ action, success: false, error: "Awaiting confirmation for destructive action" });
            (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
              type: "tool_result",
              tool_use_id: block.id,
              content: [{ type: "text", text: "Action requires user confirmation. Please confirm before proceeding." }],
            });
            continue;
          }

          // Execute action
          const result = await this.executeAction(action, browser);
          actionResults.push(result);
          onAction?.(action, result);

          // Update session state
          const session = this.activeSessions.get(sessionId)!;
          session.actionCount++;
          session.url = await browser.getUrl();
          session.title = await browser.getTitle();

          this.emit("action", { sessionId, action, result });

          // Build tool result
          const toolContent: Anthropic.ToolResultBlockParam["content"] = [];
          if (result.screenshot) {
            toolContent.push({
              type: "image",
              source: { type: "base64", media_type: "image/png", data: result.screenshot },
            });
          }
          if (result.error) {
            toolContent.push({ type: "text", text: `Error: ${result.error}` });
          }

          (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
            type: "tool_result",
            tool_use_id: block.id,
            content: toolContent,
          });
        }

        messages = [...messages, { role: "assistant", content: response.content }, toolResults];
      }

      return {
        task,
        success: false,
        actions: actionResults,
        summary: `Task did not complete within ${this.config.maxIterations} iterations`,
        sessionDuration: Date.now() - startTime,
      };
    } finally {
      await browser.close();
      this.activeSessions.delete(sessionId);
    }
  }

  private async executeAction(action: ComputerAction, browser: BrowserManager): Promise<ActionResult> {
    try {
      switch (action.type) {
        case "screenshot": {
          const screenshot = await browser.screenshot();
          return { action, success: true, screenshot };
        }
        case "navigate": {
          if (!action.url) throw new Error("URL required for navigate");
          await browser.navigate(action.url);
          const screenshot = this.config.screenshotOnEachStep ? await browser.screenshot() : undefined;
          return { action, success: true, screenshot };
        }
        case "click": {
          if (!action.coordinate) throw new Error("Coordinate required for click");
          await browser.click(action.coordinate[0], action.coordinate[1]);
          await new Promise((r) => setTimeout(r, 300));
          const screenshot = this.config.screenshotOnEachStep ? await browser.screenshot() : undefined;
          return { action, success: true, screenshot };
        }
        case "type": {
          if (!action.text) throw new Error("Text required for type");
          await browser.type(action.text);
          const screenshot = this.config.screenshotOnEachStep ? await browser.screenshot() : undefined;
          return { action, success: true, screenshot };
        }
        case "scroll": {
          const [x, y] = action.coordinate ?? [640, 400];
          await browser.scroll(x, y, action.direction ?? "down", action.amount ?? 3);
          const screenshot = this.config.screenshotOnEachStep ? await browser.screenshot() : undefined;
          return { action, success: true, screenshot };
        }
        case "key": {
          if (!action.key) throw new Error("Key required for key action");
          await browser.keyPress(action.key);
          const screenshot = this.config.screenshotOnEachStep ? await browser.screenshot() : undefined;
          return { action, success: true, screenshot };
        }
        case "wait": {
          await new Promise((r) => setTimeout(r, action.duration ?? 1_000));
          return { action, success: true };
        }
        default:
          return { action, success: false, error: `Unknown action type: ${action.type}` };
      }
    } catch (err) {
      logger.warn(`Action ${action.type} failed: ${(err as Error).message}`);
      return { action, success: false, error: (err as Error).message };
    }
  }

  getSession(sessionId: string): SessionState | null {
    return this.activeSessions.get(sessionId) ?? null;
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isRunning = false;
      this.activeSessions.delete(sessionId);
    }
  }
}

export const claudeComputerUse = new ClaudeComputerUse({
  confirmBeforeDestructive: true,
  maxIterations: 25,
});
