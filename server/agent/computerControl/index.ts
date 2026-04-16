import { EventEmitter } from "events";
import { riskClassifier, type RiskClassification, type RiskLevel } from "./riskClassifier";
import { killSwitch, type KillEvent, type KillSwitchState } from "./killSwitch";
import { sessionRecorder, type SessionEntry, type SessionSummary } from "./sessionRecorder";

export interface CommandExecutionRequest {
  command: string;
  runId: string;
  userId?: string;
  type?: SessionEntry["type"];
  input?: any;
}

export interface CommandExecutionResult {
  allowed: boolean;
  classification: RiskClassification;
  blocked: boolean;
  blockReason?: string;
  sessionEntry?: SessionEntry;
}

export class ComputerControlPlane extends EventEmitter {
  constructor() {
    super();
    this.wireEvents();
  }

  private wireEvents(): void {
    riskClassifier.on("classified", (classification: RiskClassification) => {
      this.emit("risk:classified", classification);
    });

    killSwitch.on("armed", (event: KillEvent) => {
      this.emit("killswitch:armed", event);
    });

    killSwitch.on("disarmed", (event: KillEvent) => {
      this.emit("killswitch:disarmed", event);
    });

    killSwitch.on("kill", (event: KillEvent) => {
      this.emit("killswitch:kill", event);
    });

    sessionRecorder.on("recorded", (entry: SessionEntry) => {
      this.emit("session:recorded", entry);
    });
  }

  evaluateCommand(request: CommandExecutionRequest): CommandExecutionResult {
    const classification = riskClassifier.classify(request.command);

    if (killSwitch.isArmed()) {
      const entry = sessionRecorder.record({
        runId: request.runId,
        type: request.type || "command",
        command: request.command,
        input: request.input || null,
        output: null,
        durationMs: 0,
        riskClassification: classification,
        userId: request.userId,
        error: "Blocked by kill switch",
      });

      return {
        allowed: false,
        classification,
        blocked: true,
        blockReason: `Kill switch is armed: ${killSwitch.getState().reason}`,
        sessionEntry: entry,
      };
    }

    if (classification.blockedByDefault) {
      const entry = sessionRecorder.record({
        runId: request.runId,
        type: request.type || "command",
        command: request.command,
        input: request.input || null,
        output: null,
        durationMs: 0,
        riskClassification: classification,
        userId: request.userId,
        error: `Blocked: ${classification.reasons.join(", ")}`,
      });

      return {
        allowed: false,
        classification,
        blocked: true,
        blockReason: `Critical risk command blocked: ${classification.reasons.join(", ")}`,
        sessionEntry: entry,
      };
    }

    return {
      allowed: !classification.requiresConfirmation,
      classification,
      blocked: false,
    };
  }

  recordExecution(
    request: CommandExecutionRequest,
    output: any,
    durationMs: number,
    exitCode?: number,
    error?: string
  ): SessionEntry {
    const classification = riskClassifier.classify(request.command);

    return sessionRecorder.record({
      runId: request.runId,
      type: request.type || "command",
      command: request.command,
      input: request.input || null,
      output,
      durationMs,
      riskClassification: classification,
      userId: request.userId,
      exitCode,
      error,
    });
  }

  armKillSwitch(userId: string, reason: string): KillEvent {
    return killSwitch.arm(userId, reason);
  }

  disarmKillSwitch(userId: string, reason: string): KillEvent {
    return killSwitch.disarm(userId, reason);
  }

  getKillSwitchState(): KillSwitchState {
    return killSwitch.getState();
  }

  registerRun(runId: string): AbortController {
    return killSwitch.registerRun(runId);
  }

  unregisterRun(runId: string): void {
    killSwitch.unregisterRun(runId);
  }

  getSessionHistory(runId: string): SessionEntry[] {
    return sessionRecorder.getSession(runId);
  }

  getSessionSummary(runId: string): SessionSummary | null {
    return sessionRecorder.getSummary(runId);
  }

  classifyCommand(command: string): RiskClassification {
    return riskClassifier.classify(command);
  }

  addCustomRule(pattern: RegExp, level: RiskLevel, reason: string): void {
    riskClassifier.addRule(pattern, level, reason);
  }

  getActiveRunIds(): string[] {
    return killSwitch.getActiveRunIds();
  }

  getActiveRunCount(): number {
    return killSwitch.getActiveRunCount();
  }
}

export const computerControlPlane = new ComputerControlPlane();

export { riskClassifier } from "./riskClassifier";
export { killSwitch } from "./killSwitch";
export { sessionRecorder } from "./sessionRecorder";
export type { RiskLevel, RiskClassification } from "./riskClassifier";
export type { KillEvent, KillSwitchState } from "./killSwitch";
export type { SessionEntry, SessionSummary } from "./sessionRecorder";
