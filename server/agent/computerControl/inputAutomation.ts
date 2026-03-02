import { EventEmitter } from "events";
import { sessionRecorder } from "./sessionRecorder";
import { riskClassifier, type RiskLevel } from "./riskClassifier";
import { governanceModeManager } from "../governance/modeManager";

export type InputActionType =
  | "key_press"
  | "key_release"
  | "key_type"
  | "mouse_move"
  | "mouse_click"
  | "mouse_scroll"
  | "hotkey"
  | "text_paste";

export interface InputAction {
  id: string;
  type: InputActionType;
  payload: Record<string, any>;
  riskLevel: RiskLevel;
  timestamp: number;
  runId: string;
  approved: boolean;
}

export interface InputResult {
  actionId: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface AuditEntry {
  actionId: string;
  type: InputActionType;
  payload: Record<string, any>;
  riskLevel: RiskLevel;
  approved: boolean;
  result: InputResult | null;
  timestamp: number;
  runId: string;
}

const ACTION_RISK_MAP: Record<InputActionType, RiskLevel> = {
  key_press: "safe",
  key_release: "safe",
  key_type: "safe",
  mouse_move: "safe",
  mouse_click: "safe",
  mouse_scroll: "safe",
  hotkey: "safe",
  text_paste: "moderate",
};

const DANGEROUS_HOTKEYS = [
  "ctrl+alt+delete",
  "cmd+q",
  "alt+f4",
  "ctrl+shift+delete",
  "cmd+shift+q",
];

export class InputAutomation extends EventEmitter {
  private actionCounter = 0;
  private auditTrail: AuditEntry[] = [];
  private readonly maxAuditEntries = 5000;

  private generateId(): string {
    return `input_${++this.actionCounter}_${Date.now()}`;
  }

  private classifyAction(type: InputActionType, payload: Record<string, any>): RiskLevel {
    let level = ACTION_RISK_MAP[type] || "safe";

    if (type === "hotkey" && payload.keys) {
      const combo = (payload.keys as string[]).join("+").toLowerCase();
      if (DANGEROUS_HOTKEYS.some((h) => combo.includes(h))) {
        level = "dangerous";
      }
    }

    if (type === "text_paste" && payload.text) {
      const text = payload.text as string;
      if (text.length > 10000) level = "moderate";
      const classification = riskClassifier.classify(text);
      const riskOrder: Record<string, number> = { safe: 0, moderate: 1, dangerous: 2, critical: 3 };
      if (riskOrder[classification.riskLevel] > riskOrder[level]) {
        level = classification.riskLevel;
      }
    }

    return level;
  }

  private checkGovernancePermission(riskLevel: RiskLevel): { allowed: boolean; reason?: string } {
    return governanceModeManager.isActionAllowed(riskLevel, "execute");
  }

  private recordAudit(entry: AuditEntry): void {
    this.auditTrail.push(entry);
    if (this.auditTrail.length > this.maxAuditEntries) {
      this.auditTrail.shift();
    }
    this.emit("audit", entry);
  }

  private async executeAction(action: InputAction): Promise<InputResult> {
    const start = Date.now();

    const result: InputResult = {
      actionId: action.id,
      success: true,
      durationMs: Date.now() - start,
    };

    sessionRecorder.record({
      runId: action.runId,
      type: "command",
      command: `input:${action.type}`,
      input: action.payload,
      output: { success: true },
      durationMs: result.durationMs,
      riskClassification: {
        command: `input:${action.type}`,
        riskLevel: action.riskLevel,
        reasons: [`Input automation: ${action.type}`],
        requiresConfirmation: action.riskLevel === "dangerous" || action.riskLevel === "critical",
        blockedByDefault: action.riskLevel === "critical",
        timestamp: action.timestamp,
      },
    });

    return result;
  }

  async keyPress(runId: string, key: string, modifiers: string[] = []): Promise<InputResult> {
    const payload = { key, modifiers };
    const riskLevel = this.classifyAction("key_press", payload);
    const permission = this.checkGovernancePermission(riskLevel);

    const action: InputAction = {
      id: this.generateId(),
      type: "key_press",
      payload,
      riskLevel,
      timestamp: Date.now(),
      runId,
      approved: permission.allowed,
    };

    const audit: AuditEntry = {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      riskLevel: action.riskLevel,
      approved: action.approved,
      result: null,
      timestamp: action.timestamp,
      runId,
    };

    if (!permission.allowed) {
      const result: InputResult = { actionId: action.id, success: false, durationMs: 0, error: permission.reason };
      audit.result = result;
      this.recordAudit(audit);
      return result;
    }

    const result = await this.executeAction(action);
    audit.result = result;
    this.recordAudit(audit);
    this.emit("action", action);
    return result;
  }

  async keyRelease(runId: string, key: string): Promise<InputResult> {
    const payload = { key };
    const riskLevel = this.classifyAction("key_release", payload);
    const permission = this.checkGovernancePermission(riskLevel);

    const action: InputAction = {
      id: this.generateId(),
      type: "key_release",
      payload,
      riskLevel,
      timestamp: Date.now(),
      runId,
      approved: permission.allowed,
    };

    const audit: AuditEntry = {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      riskLevel: action.riskLevel,
      approved: action.approved,
      result: null,
      timestamp: action.timestamp,
      runId,
    };

    if (!permission.allowed) {
      const result: InputResult = { actionId: action.id, success: false, durationMs: 0, error: permission.reason };
      audit.result = result;
      this.recordAudit(audit);
      return result;
    }

    const result = await this.executeAction(action);
    audit.result = result;
    this.recordAudit(audit);
    this.emit("action", action);
    return result;
  }

  async typeText(runId: string, text: string, delayMs: number = 50): Promise<InputResult> {
    const payload = { text, delayMs };
    const riskLevel = this.classifyAction("key_type", payload);
    const permission = this.checkGovernancePermission(riskLevel);

    const action: InputAction = {
      id: this.generateId(),
      type: "key_type",
      payload,
      riskLevel,
      timestamp: Date.now(),
      runId,
      approved: permission.allowed,
    };

    const audit: AuditEntry = {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      riskLevel: action.riskLevel,
      approved: action.approved,
      result: null,
      timestamp: action.timestamp,
      runId,
    };

    if (!permission.allowed) {
      const result: InputResult = { actionId: action.id, success: false, durationMs: 0, error: permission.reason };
      audit.result = result;
      this.recordAudit(audit);
      return result;
    }

    const result = await this.executeAction(action);
    audit.result = result;
    this.recordAudit(audit);
    this.emit("action", action);
    return result;
  }

  async mouseMove(runId: string, x: number, y: number): Promise<InputResult> {
    const payload = { x, y };
    const riskLevel = this.classifyAction("mouse_move", payload);
    const permission = this.checkGovernancePermission(riskLevel);

    const action: InputAction = {
      id: this.generateId(),
      type: "mouse_move",
      payload,
      riskLevel,
      timestamp: Date.now(),
      runId,
      approved: permission.allowed,
    };

    const audit: AuditEntry = {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      riskLevel: action.riskLevel,
      approved: action.approved,
      result: null,
      timestamp: action.timestamp,
      runId,
    };

    if (!permission.allowed) {
      const result: InputResult = { actionId: action.id, success: false, durationMs: 0, error: permission.reason };
      audit.result = result;
      this.recordAudit(audit);
      return result;
    }

    const result = await this.executeAction(action);
    audit.result = result;
    this.recordAudit(audit);
    this.emit("action", action);
    return result;
  }

  async mouseClick(runId: string, x: number, y: number, button: "left" | "right" | "middle" = "left", clicks: number = 1): Promise<InputResult> {
    const payload = { x, y, button, clicks };
    const riskLevel = this.classifyAction("mouse_click", payload);
    const permission = this.checkGovernancePermission(riskLevel);

    const action: InputAction = {
      id: this.generateId(),
      type: "mouse_click",
      payload,
      riskLevel,
      timestamp: Date.now(),
      runId,
      approved: permission.allowed,
    };

    const audit: AuditEntry = {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      riskLevel: action.riskLevel,
      approved: action.approved,
      result: null,
      timestamp: action.timestamp,
      runId,
    };

    if (!permission.allowed) {
      const result: InputResult = { actionId: action.id, success: false, durationMs: 0, error: permission.reason };
      audit.result = result;
      this.recordAudit(audit);
      return result;
    }

    const result = await this.executeAction(action);
    audit.result = result;
    this.recordAudit(audit);
    this.emit("action", action);
    return result;
  }

  async mouseScroll(runId: string, x: number, y: number, deltaX: number = 0, deltaY: number = 0): Promise<InputResult> {
    const payload = { x, y, deltaX, deltaY };
    const riskLevel = this.classifyAction("mouse_scroll", payload);
    const permission = this.checkGovernancePermission(riskLevel);

    const action: InputAction = {
      id: this.generateId(),
      type: "mouse_scroll",
      payload,
      riskLevel,
      timestamp: Date.now(),
      runId,
      approved: permission.allowed,
    };

    const audit: AuditEntry = {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      riskLevel: action.riskLevel,
      approved: action.approved,
      result: null,
      timestamp: action.timestamp,
      runId,
    };

    if (!permission.allowed) {
      const result: InputResult = { actionId: action.id, success: false, durationMs: 0, error: permission.reason };
      audit.result = result;
      this.recordAudit(audit);
      return result;
    }

    const result = await this.executeAction(action);
    audit.result = result;
    this.recordAudit(audit);
    this.emit("action", action);
    return result;
  }

  async hotkey(runId: string, keys: string[]): Promise<InputResult> {
    const payload = { keys };
    const riskLevel = this.classifyAction("hotkey", payload);
    const permission = this.checkGovernancePermission(riskLevel);

    const action: InputAction = {
      id: this.generateId(),
      type: "hotkey",
      payload,
      riskLevel,
      timestamp: Date.now(),
      runId,
      approved: permission.allowed,
    };

    const audit: AuditEntry = {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      riskLevel: action.riskLevel,
      approved: action.approved,
      result: null,
      timestamp: action.timestamp,
      runId,
    };

    if (!permission.allowed) {
      const result: InputResult = { actionId: action.id, success: false, durationMs: 0, error: permission.reason };
      audit.result = result;
      this.recordAudit(audit);
      return result;
    }

    const result = await this.executeAction(action);
    audit.result = result;
    this.recordAudit(audit);
    this.emit("action", action);
    return result;
  }

  async pasteText(runId: string, text: string): Promise<InputResult> {
    const payload = { text };
    const riskLevel = this.classifyAction("text_paste", payload);
    const permission = this.checkGovernancePermission(riskLevel);

    const action: InputAction = {
      id: this.generateId(),
      type: "text_paste",
      payload,
      riskLevel,
      timestamp: Date.now(),
      runId,
      approved: permission.allowed,
    };

    const audit: AuditEntry = {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      riskLevel: action.riskLevel,
      approved: action.approved,
      result: null,
      timestamp: action.timestamp,
      runId,
    };

    if (!permission.allowed) {
      const result: InputResult = { actionId: action.id, success: false, durationMs: 0, error: permission.reason };
      audit.result = result;
      this.recordAudit(audit);
      return result;
    }

    const result = await this.executeAction(action);
    audit.result = result;
    this.recordAudit(audit);
    this.emit("action", action);
    return result;
  }

  getAuditTrail(runId?: string, limit: number = 100): AuditEntry[] {
    let entries = this.auditTrail;
    if (runId) {
      entries = entries.filter((e) => e.runId === runId);
    }
    return entries.slice(-limit);
  }

  getAuditStats(): {
    total: number;
    byType: Record<string, number>;
    byRisk: Record<string, number>;
    approved: number;
    denied: number;
  } {
    const stats = {
      total: this.auditTrail.length,
      byType: {} as Record<string, number>,
      byRisk: {} as Record<string, number>,
      approved: 0,
      denied: 0,
    };

    for (const entry of this.auditTrail) {
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
      stats.byRisk[entry.riskLevel] = (stats.byRisk[entry.riskLevel] || 0) + 1;
      if (entry.approved) stats.approved++;
      else stats.denied++;
    }

    return stats;
  }

  clearAuditTrail(): void {
    this.auditTrail = [];
  }
}

export const inputAutomation = new InputAutomation();
