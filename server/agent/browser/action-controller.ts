import { browserSessionManager } from "./session-manager";
import { ActionResult, PageState, SessionEventCallback } from "./types";

export type ActionType = "navigate" | "click" | "type" | "scroll" | "wait" | "screenshot" | "getState" | "evaluate" | "download";

export interface ActionCommand {
  type: ActionType;
  params: Record<string, any>;
}

export interface ActionControllerConfig {
  maxActionsPerSession?: number;
  actionTimeout?: number;
  screenshotOnEveryAction?: boolean;
}

const DEFAULT_CONFIG: ActionControllerConfig = {
  maxActionsPerSession: 100,
  actionTimeout: 30000,
  screenshotOnEveryAction: true
};

class ActionController {
  private config: ActionControllerConfig;
  private actionCounts: Map<string, number> = new Map();

  constructor(config: Partial<ActionControllerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async executeAction(sessionId: string, command: ActionCommand): Promise<ActionResult> {
    const count = (this.actionCounts.get(sessionId) || 0) + 1;
    
    if (count > this.config.maxActionsPerSession!) {
      return {
        success: false,
        action: { type: command.type, params: command.params, timestamp: new Date() },
        error: `Maximum actions (${this.config.maxActionsPerSession}) exceeded for session`,
        duration: 0
      };
    }
    
    this.actionCounts.set(sessionId, count);

    switch (command.type) {
      case "navigate":
        return browserSessionManager.navigate(sessionId, command.params.url);
      
      case "click":
        return browserSessionManager.click(sessionId, command.params.selector);
      
      case "type":
        return browserSessionManager.type(
          sessionId, 
          command.params.selector, 
          command.params.text
        );
      
      case "scroll":
        return browserSessionManager.scroll(
          sessionId,
          command.params.direction || "down",
          command.params.amount || 300
        );
      
      case "wait":
        return browserSessionManager.wait(sessionId, command.params.ms || 1000);
      
      case "evaluate":
        return browserSessionManager.evaluate(sessionId, command.params.script);
      
      case "screenshot":
        const screenshot = await browserSessionManager.getScreenshot(sessionId);
        return {
          success: !!screenshot,
          action: { type: "screenshot", params: {}, timestamp: new Date() },
          screenshot: screenshot || undefined,
          duration: 0
        };
      
      case "getState":
        const state = await browserSessionManager.getPageState(sessionId);
        return {
          success: !!state,
          action: { type: "getState", params: {}, timestamp: new Date() },
          data: state,
          duration: 0
        };
      
      default:
        return {
          success: false,
          action: { type: command.type, params: command.params, timestamp: new Date() },
          error: `Unknown action type: ${command.type}`,
          duration: 0
        };
    }
  }

  async executeSequence(
    sessionId: string, 
    commands: ActionCommand[],
    onAction?: (index: number, result: ActionResult) => void
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (let i = 0; i < commands.length; i++) {
      const result = await this.executeAction(sessionId, commands[i]);
      results.push(result);
      
      if (onAction) {
        onAction(i, result);
      }

      if (!result.success) {
        break;
      }
    }

    return results;
  }

  resetActionCount(sessionId: string): void {
    this.actionCounts.delete(sessionId);
  }

  getActionCount(sessionId: string): number {
    return this.actionCounts.get(sessionId) || 0;
  }
}

export const actionController = new ActionController();
