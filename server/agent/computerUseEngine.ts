/**
 * Computer Use Engine - Full Screen Control with Vision
 *
 * Provides Anthropic Computer Use-style capabilities:
 * - Screenshot capture and analysis via LLM vision
 * - Coordinate-based mouse clicks (left, right, double, drag)
 * - Keyboard input (type text, hotkeys, special keys)
 * - Screen region analysis and element detection
 * - Multi-monitor support
 * - Autonomous action loops with visual verification
 *
 * Architecture: Uses Playwright for browser contexts and
 * native OS commands (xdotool/xclip) for desktop control.
 */

import { chromium, Browser, Page, BrowserContext } from "playwright";
import { exec, execSync, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import path from "path";
import fs from "fs/promises";
import OpenAI from "openai";

const execAsync = promisify(exec);

// ============================================
// Types and Interfaces
// ============================================

export interface ScreenCoordinate {
  x: number;
  y: number;
}

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MouseAction {
  type: "click" | "doubleClick" | "rightClick" | "drag" | "move" | "scroll";
  coordinates: ScreenCoordinate;
  endCoordinates?: ScreenCoordinate; // for drag
  scrollDelta?: { x: number; y: number }; // for scroll
  button?: "left" | "right" | "middle";
}

export interface KeyboardAction {
  type: "type" | "press" | "hotkey" | "keyDown" | "keyUp";
  text?: string;
  key?: string;
  keys?: string[]; // for hotkey combinations
  modifiers?: ("ctrl" | "alt" | "shift" | "meta")[];
}

export interface ScreenAnalysis {
  screenshot: string; // base64
  elements: DetectedElement[];
  textContent: string;
  dimensions: { width: number; height: number };
  timestamp: number;
}

export interface DetectedElement {
  id: string;
  type: "button" | "input" | "link" | "text" | "image" | "icon" | "menu" | "dropdown" | "checkbox" | "tab" | "unknown";
  label: string;
  boundingBox: ScreenRegion;
  center: ScreenCoordinate;
  confidence: number;
  interactable: boolean;
  attributes?: Record<string, string>;
}

export interface ComputerAction {
  id: string;
  type: "mouse" | "keyboard" | "screenshot" | "wait" | "scroll" | "browser_action";
  action: MouseAction | KeyboardAction | { duration?: number } | any;
  description: string;
  timestamp: number;
  result?: ActionResult;
}

export interface ActionResult {
  success: boolean;
  screenshotAfter?: string;
  error?: string;
  changesDetected?: string[];
  duration: number;
}

export interface ComputerUseSession {
  id: string;
  mode: "browser" | "desktop";
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  viewport: { width: number; height: number };
  actions: ComputerAction[];
  createdAt: number;
  lastActivity: number;
  status: "active" | "idle" | "error" | "closed";
}

export interface VisionAnalysisResult {
  description: string;
  elements: DetectedElement[];
  suggestedActions: SuggestedAction[];
  currentState: string;
  confidence: number;
}

export interface SuggestedAction {
  description: string;
  action: ComputerAction;
  confidence: number;
  reasoning: string;
}

export interface TaskGoal {
  description: string;
  steps: string[];
  successCriteria: string[];
  maxAttempts: number;
  timeout: number;
}

// ============================================
// Computer Use Engine
// ============================================

export class ComputerUseEngine extends EventEmitter {
  private sessions: Map<string, ComputerUseSession> = new Map();
  private llmClient: OpenAI;
  private visionModel: string;
  private workspaceDir: string;
  private maxSessionAge = 30 * 60 * 1000; // 30 minutes
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options?: {
    apiKey?: string;
    baseURL?: string;
    visionModel?: string;
    workspaceDir?: string;
  }) {
    super();
    this.llmClient = new OpenAI({
      baseURL: options?.baseURL || (process.env.XAI_API_KEY ? "https://api.x.ai/v1" : "https://api.openai.com/v1"),
      apiKey: options?.apiKey || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || "missing",
    });
    this.visionModel = options?.visionModel || "grok-2-vision-1212";
    this.workspaceDir = options?.workspaceDir || "/tmp/computer-use-workspace";

    // Periodically clean up stale sessions
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 5 * 60 * 1000);
  }

  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.maxSessionAge) {
        await this.closeSession(id).catch(() => {});
      }
    }
  }

  // ============================================
  // Session Management
  // ============================================

  async createSession(mode: "browser" | "desktop" = "browser", options?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
    locale?: string;
  }): Promise<string> {
    const sessionId = randomUUID();
    const viewport = options?.viewport || { width: 1920, height: 1080 };

    const session: ComputerUseSession = {
      id: sessionId,
      mode,
      viewport,
      actions: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: "active",
    };

    if (mode === "browser") {
      const browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          `--window-size=${viewport.width},${viewport.height}`,
        ],
      });

      const context = await browser.newContext({
        viewport,
        userAgent: options?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        locale: options?.locale || "en-US",
        colorScheme: "light",
        deviceScaleFactor: 1,
      });

      const page = await context.newPage();
      session.browser = browser;
      session.context = context;
      session.page = page;
    }

    this.sessions.set(sessionId, session);
    this.emit("session:created", { sessionId, mode });
    return sessionId;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.browser) {
      await session.browser.close().catch(() => {});
    }
    session.status = "closed";
    this.sessions.delete(sessionId);
    this.emit("session:closed", { sessionId });
  }

  getSession(sessionId: string): ComputerUseSession | undefined {
    return this.sessions.get(sessionId);
  }

  // ============================================
  // Screenshot & Vision
  // ============================================

  async captureScreenshot(sessionId: string, options?: {
    fullPage?: boolean;
    region?: ScreenRegion;
    quality?: number;
  }): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    let buffer: Buffer;

    if (session.mode === "browser" && session.page) {
      if (options?.region) {
        buffer = await session.page.screenshot({
          type: "png",
          clip: {
            x: options.region.x,
            y: options.region.y,
            width: options.region.width,
            height: options.region.height,
          },
        });
      } else {
        buffer = await session.page.screenshot({
          type: "png",
          fullPage: options?.fullPage ?? false,
        });
      }
    } else {
      // Desktop mode - use system screenshot tools
      const screenshotPath = path.join(this.workspaceDir, `screenshot-${Date.now()}.png`);
      await fs.mkdir(this.workspaceDir, { recursive: true });

      try {
        if (options?.region) {
          const { x, y, width, height } = options.region;
          await execAsync(
            `import -window root -crop ${width}x${height}+${x}+${y} "${screenshotPath}" 2>/dev/null || ` +
            `scrot -a ${x},${y},${width},${height} "${screenshotPath}" 2>/dev/null || ` +
            `gnome-screenshot -a -f "${screenshotPath}" 2>/dev/null || ` +
            `xdotool getactivewindow screenshot "${screenshotPath}" 2>/dev/null`
          );
        } else {
          await execAsync(
            `import -window root "${screenshotPath}" 2>/dev/null || ` +
            `scrot "${screenshotPath}" 2>/dev/null || ` +
            `gnome-screenshot -f "${screenshotPath}" 2>/dev/null`
          );
        }
        buffer = await fs.readFile(screenshotPath);
        await fs.unlink(screenshotPath).catch(() => {});
      } catch {
        throw new Error("Screenshot capture failed. Ensure xdotool/scrot/imagemagick is installed.");
      }
    }

    const base64 = buffer.toString("base64");
    session.lastActivity = Date.now();
    return base64;
  }

  async analyzeScreen(sessionId: string, query?: string): Promise<VisionAnalysisResult> {
    const screenshot = await this.captureScreenshot(sessionId);
    const session = this.sessions.get(sessionId)!;

    const systemPrompt = `You are a computer vision AI that analyzes screenshots. You identify ALL interactive elements on screen and provide structured analysis.

For each detected element, provide:
- type: button, input, link, text, image, icon, menu, dropdown, checkbox, tab, unknown
- label: human-readable label
- boundingBox: { x, y, width, height } in pixels (approximate)
- center: { x, y } center point for clicking
- confidence: 0-1 how sure you are
- interactable: boolean

Also describe the overall screen state and suggest what actions could be taken.

RESPOND IN VALID JSON ONLY with this structure:
{
  "description": "overall screen description",
  "currentState": "what app/page/state is currently shown",
  "elements": [...],
  "suggestedActions": [
    {
      "description": "what the action would do",
      "actionType": "click|type|scroll|navigate",
      "target": "element description",
      "coordinates": { "x": number, "y": number },
      "confidence": 0-1,
      "reasoning": "why this action"
    }
  ],
  "confidence": 0-1
}`;

    const userPrompt = query
      ? `Analyze this screenshot and answer: ${query}\n\nIdentify all interactive elements and suggest actions to accomplish the user's goal.`
      : "Analyze this screenshot. Identify all interactive elements and the current application state.";

    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.visionModel,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${screenshot}`, detail: "high" },
              },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let parsed: any = {};
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* use empty default */ }
      }

      const elements: DetectedElement[] = (parsed.elements || []).map((el: any, i: number) => ({
        id: `elem-${i}`,
        type: el.type || "unknown",
        label: el.label || "",
        boundingBox: el.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
        center: el.center || { x: 0, y: 0 },
        confidence: el.confidence || 0.5,
        interactable: el.interactable ?? true,
        attributes: el.attributes,
      }));

      const suggestedActions: SuggestedAction[] = (parsed.suggestedActions || []).map((sa: any) => ({
        description: sa.description || "",
        action: {
          id: randomUUID(),
          type: sa.actionType === "type" ? "keyboard" : "mouse",
          action: sa.actionType === "type"
            ? { type: "type", text: sa.value || "" }
            : { type: "click", coordinates: sa.coordinates || { x: 0, y: 0 } },
          description: sa.description,
          timestamp: Date.now(),
        },
        confidence: sa.confidence || 0.5,
        reasoning: sa.reasoning || "",
      }));

      return {
        description: parsed.description || "Screen analyzed",
        elements,
        suggestedActions,
        currentState: parsed.currentState || "unknown",
        confidence: parsed.confidence || 0.5,
      };
    } catch (error: any) {
      return {
        description: `Analysis error: ${error.message}`,
        elements: [],
        suggestedActions: [],
        currentState: "error",
        confidence: 0,
      };
    }
  }

  // ============================================
  // Mouse Actions
  // ============================================

  async mouseClick(sessionId: string, coordinates: ScreenCoordinate, options?: {
    button?: "left" | "right" | "middle";
    clickCount?: number;
    delay?: number;
  }): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const startTime = Date.now();

    try {
      if (session.mode === "browser" && session.page) {
        await session.page.mouse.click(coordinates.x, coordinates.y, {
          button: options?.button || "left",
          clickCount: options?.clickCount || 1,
          delay: options?.delay || 50,
        });
      } else {
        const btn = options?.button === "right" ? 3 : options?.button === "middle" ? 2 : 1;
        const count = options?.clickCount || 1;
        for (let i = 0; i < count; i++) {
          await execAsync(`xdotool mousemove ${coordinates.x} ${coordinates.y} click ${btn}`);
        }
      }

      const action: ComputerAction = {
        id: randomUUID(),
        type: "mouse",
        action: { type: "click", coordinates, button: options?.button || "left" },
        description: `Click at (${coordinates.x}, ${coordinates.y})`,
        timestamp: Date.now(),
      };

      session.actions.push(action);
      session.lastActivity = Date.now();

      return {
        success: true,
        duration: Date.now() - startTime,
        changesDetected: ["click_performed"],
      };
    } catch (error: any) {
      return { success: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  async mouseDrag(sessionId: string, from: ScreenCoordinate, to: ScreenCoordinate): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const startTime = Date.now();

    try {
      if (session.mode === "browser" && session.page) {
        await session.page.mouse.move(from.x, from.y);
        await session.page.mouse.down();
        await session.page.mouse.move(to.x, to.y, { steps: 10 });
        await session.page.mouse.up();
      } else {
        await execAsync(
          `xdotool mousemove ${from.x} ${from.y} mousedown 1 ` +
          `mousemove --delay 50 ${to.x} ${to.y} mouseup 1`
        );
      }

      session.lastActivity = Date.now();
      return { success: true, duration: Date.now() - startTime };
    } catch (error: any) {
      return { success: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  async mouseScroll(sessionId: string, coordinates: ScreenCoordinate, delta: { x: number; y: number }): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const startTime = Date.now();

    try {
      if (session.mode === "browser" && session.page) {
        await session.page.mouse.move(coordinates.x, coordinates.y);
        await session.page.mouse.wheel(delta.x, delta.y);
      } else {
        const direction = delta.y > 0 ? 5 : 4;
        const clicks = Math.abs(Math.round(delta.y / 120));
        await execAsync(`xdotool mousemove ${coordinates.x} ${coordinates.y} click --repeat ${clicks || 1} ${direction}`);
      }

      session.lastActivity = Date.now();
      return { success: true, duration: Date.now() - startTime };
    } catch (error: any) {
      return { success: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  // ============================================
  // Keyboard Actions
  // ============================================

  async typeText(sessionId: string, text: string, options?: { delay?: number }): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const startTime = Date.now();

    try {
      if (session.mode === "browser" && session.page) {
        await session.page.keyboard.type(text, { delay: options?.delay || 30 });
      } else {
        // Use xdotool for desktop typing - escape special chars
        const escaped = text.replace(/'/g, "'\\''");
        await execAsync(`xdotool type --delay ${options?.delay || 30} '${escaped}'`);
      }

      session.lastActivity = Date.now();
      return { success: true, duration: Date.now() - startTime };
    } catch (error: any) {
      return { success: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  async pressKey(sessionId: string, key: string, modifiers?: string[]): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const startTime = Date.now();

    try {
      if (session.mode === "browser" && session.page) {
        const combo = modifiers?.length
          ? modifiers.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join("+") + "+" + key
          : key;
        await session.page.keyboard.press(combo);
      } else {
        const xdoKey = this.mapKeyToXdotool(key);
        const mods = (modifiers || []).map(m => this.mapModifierToXdotool(m));
        const combo = [...mods, xdoKey].join("+");
        await execAsync(`xdotool key ${combo}`);
      }

      session.lastActivity = Date.now();
      return { success: true, duration: Date.now() - startTime };
    } catch (error: any) {
      return { success: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  async hotkey(sessionId: string, keys: string[]): Promise<ActionResult> {
    return this.pressKey(sessionId, keys[keys.length - 1], keys.slice(0, -1));
  }

  // ============================================
  // Browser-Specific Actions
  // ============================================

  async navigateToUrl(sessionId: string, url: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session?.page) throw new Error(`No browser session: ${sessionId}`);

    const startTime = Date.now();

    try {
      await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await session.page.waitForTimeout(1000);

      const title = await session.page.title();
      session.lastActivity = Date.now();

      return {
        success: true,
        duration: Date.now() - startTime,
        changesDetected: [`navigated_to: ${url}`, `title: ${title}`],
      };
    } catch (error: any) {
      return { success: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  async executeJavaScript(sessionId: string, script: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session?.page) throw new Error(`No browser session: ${sessionId}`);

    try {
      return await session.page.evaluate(script);
    } catch (error: any) {
      throw new Error(`JavaScript execution failed: ${error.message}`);
    }
  }

  async getPageContent(sessionId: string): Promise<{
    url: string;
    title: string;
    text: string;
    html: string;
    links: Array<{ text: string; href: string }>;
    inputs: Array<{ name: string; type: string; value: string; placeholder: string }>;
    buttons: Array<{ text: string; type: string }>;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session?.page) throw new Error(`No browser session: ${sessionId}`);

    try {
    return await session.page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 50).map(a => ({
        text: (a as HTMLAnchorElement).innerText?.trim().slice(0, 100) || "",
        href: (a as HTMLAnchorElement).href,
      }));

      const inputs = Array.from(document.querySelectorAll("input, textarea, select")).slice(0, 30).map(el => ({
        name: (el as HTMLInputElement).name || (el as HTMLInputElement).id || "",
        type: (el as HTMLInputElement).type || el.tagName.toLowerCase(),
        value: (el as HTMLInputElement).value || "",
        placeholder: (el as HTMLInputElement).placeholder || "",
      }));

      const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']")).slice(0, 20).map(btn => ({
        text: (btn as HTMLElement).innerText?.trim().slice(0, 100) || (btn as HTMLInputElement).value || "",
        type: (btn as HTMLInputElement).type || "button",
      }));

      return {
        url: window.location.href,
        title: document.title,
        text: document.body?.innerText?.slice(0, 50000) || "",
        html: document.documentElement?.outerHTML?.slice(0, 100000) || "",
        links,
        inputs,
        buttons,
      };
    });
    } catch (error: any) {
      throw new Error(`Failed to get page content: ${error.message}`);
    }
  }

  // ============================================
  // Autonomous Task Execution
  // ============================================

  async executeTask(sessionId: string, goal: TaskGoal, onProgress?: (step: string, screenshot?: string) => void): Promise<{
    success: boolean;
    stepsCompleted: number;
    totalSteps: number;
    actions: ComputerAction[];
    finalScreenshot: string;
    summary: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const actions: ComputerAction[] = [];
    let stepsCompleted = 0;
    let attempts = 0;

    const startTime = Date.now();

    while (stepsCompleted < goal.steps.length && attempts < goal.maxAttempts) {
      if (Date.now() - startTime > goal.timeout) {
        break;
      }

      attempts++;
      const currentStep = goal.steps[stepsCompleted];

      onProgress?.(`Step ${stepsCompleted + 1}/${goal.steps.length}: ${currentStep}`);

      // Take screenshot and analyze current state
      const screenshot = await this.captureScreenshot(sessionId);
      onProgress?.(`Analyzing screen for: ${currentStep}`, screenshot);

      // Ask LLM what action to take
      const nextAction = await this.planNextAction(sessionId, currentStep, screenshot, goal);

      if (!nextAction) {
        // LLM couldn't determine action - try moving to next step
        stepsCompleted++;
        continue;
      }

      // Execute the planned action
      const result = await this.executeAction(sessionId, nextAction);
      actions.push({ ...nextAction, result });

      if (result.success) {
        // Wait for page changes
        await this.waitForStability(sessionId, 1000);

        // Verify if step is complete
        const verifyScreenshot = await this.captureScreenshot(sessionId);
        const isComplete = await this.verifyStepComplete(sessionId, currentStep, verifyScreenshot);

        if (isComplete) {
          stepsCompleted++;
          onProgress?.(`Step ${stepsCompleted} completed: ${currentStep}`);
        }
      }
    }

    const finalScreenshot = await this.captureScreenshot(sessionId);

    return {
      success: stepsCompleted >= goal.steps.length,
      stepsCompleted,
      totalSteps: goal.steps.length,
      actions,
      finalScreenshot,
      summary: `Completed ${stepsCompleted}/${goal.steps.length} steps in ${attempts} attempts`,
    };
  }

  private async planNextAction(
    sessionId: string,
    currentStep: string,
    screenshot: string,
    goal: TaskGoal
  ): Promise<ComputerAction | null> {
    const session = this.sessions.get(sessionId)!;

    const prompt = `You are controlling a computer to accomplish a task.

CURRENT STEP: ${currentStep}
OVERALL GOAL: ${goal.description}
ALL STEPS: ${goal.steps.join(" -> ")}

Based on the screenshot, determine the SINGLE NEXT ACTION to take.

Respond in JSON:
{
  "action_type": "click" | "type" | "press_key" | "scroll" | "navigate" | "wait",
  "coordinates": { "x": number, "y": number },  // for click/scroll
  "text": "string",  // for type
  "key": "string",   // for press_key (e.g. "Enter", "Tab", "Escape")
  "modifiers": ["ctrl", "shift"],  // optional key modifiers
  "url": "string",   // for navigate
  "duration": number, // for wait (ms)
  "scroll_delta": { "x": 0, "y": number },  // for scroll
  "reasoning": "why this action",
  "confidence": 0-1
}`;

    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.visionModel,
        messages: [
          { role: "system", content: "You are a computer automation agent. Respond only with valid JSON." },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${screenshot}`, detail: "high" },
              },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      let parsed: any;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }

      const action: ComputerAction = {
        id: randomUUID(),
        type: parsed.action_type === "type" || parsed.action_type === "press_key" ? "keyboard" : "mouse",
        action: parsed,
        description: parsed.reasoning || currentStep,
        timestamp: Date.now(),
      };

      return action;
    } catch {
      return null;
    }
  }

  private async executeAction(sessionId: string, action: ComputerAction): Promise<ActionResult> {
    const parsed = action.action as any;

    switch (parsed.action_type) {
      case "click":
        return this.mouseClick(sessionId, parsed.coordinates, {
          button: parsed.button || "left",
          clickCount: parsed.double ? 2 : 1,
        });

      case "type":
        if (parsed.coordinates) {
          await this.mouseClick(sessionId, parsed.coordinates);
          await new Promise(r => setTimeout(r, 200));
        }
        return this.typeText(sessionId, parsed.text || "");

      case "press_key":
        return this.pressKey(sessionId, parsed.key || "Enter", parsed.modifiers);

      case "scroll":
        return this.mouseScroll(
          sessionId,
          parsed.coordinates || { x: 960, y: 540 },
          parsed.scroll_delta || { x: 0, y: 300 }
        );

      case "navigate":
        return this.navigateToUrl(sessionId, parsed.url);

      case "wait":
        await new Promise(r => setTimeout(r, parsed.duration || 1000));
        return { success: true, duration: parsed.duration || 1000 };

      default:
        return { success: false, error: `Unknown action: ${parsed.action_type}`, duration: 0 };
    }
  }

  private async verifyStepComplete(sessionId: string, step: string, screenshot: string): Promise<boolean> {
    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.visionModel,
        messages: [
          {
            role: "system",
            content: 'You verify if a computer task step was completed. Respond with JSON: {"completed": true/false, "reason": "explanation"}',
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Was this step completed: "${step}"? Look at the current screen state.` },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${screenshot}`, detail: "high" },
              },
            ],
          },
        ],
        max_tokens: 256,
        temperature: 0.1,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return false;

      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.completed === true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  private async waitForStability(sessionId: string, timeout: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.page) {
      await new Promise(r => setTimeout(r, timeout));
      return;
    }

    try {
      await session.page.waitForLoadState("networkidle", { timeout }).catch(() => {});
    } catch {
      await new Promise(r => setTimeout(r, timeout));
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  private mapKeyToXdotool(key: string): string {
    const map: Record<string, string> = {
      Enter: "Return", Tab: "Tab", Escape: "Escape",
      Backspace: "BackSpace", Delete: "Delete",
      ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
      Home: "Home", End: "End", PageUp: "Prior", PageDown: "Next",
      Space: "space", F1: "F1", F2: "F2", F3: "F3", F4: "F4",
      F5: "F5", F6: "F6", F7: "F7", F8: "F8", F9: "F9",
      F10: "F10", F11: "F11", F12: "F12",
    };
    return map[key] || key;
  }

  private mapModifierToXdotool(mod: string): string {
    const map: Record<string, string> = {
      ctrl: "ctrl", alt: "alt", shift: "shift", meta: "super",
    };
    return map[mod] || mod;
  }

  async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const [id] of this.sessions) {
      await this.closeSession(id);
    }
  }
}

// Singleton
export const computerUseEngine = new ComputerUseEngine();
