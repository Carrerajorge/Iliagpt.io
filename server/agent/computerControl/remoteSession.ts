import { EventEmitter } from "events";
import { killSwitch } from "./killSwitch";
import { sessionRecorder } from "./sessionRecorder";
import { governanceModeManager } from "../governance/modeManager";

export type SessionStatus = "creating" | "active" | "detached" | "destroyed" | "error";

export interface RemoteSessionConfig {
  type: "terminal" | "ssh";
  host?: string;
  port?: number;
  username?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeoutMs?: number;
  maxIdleMs?: number;
}

export interface RemoteSessionInfo {
  id: string;
  agentId: string;
  runId: string;
  status: SessionStatus;
  config: RemoteSessionConfig;
  createdAt: number;
  lastActivityAt: number;
  commandCount: number;
  outputBuffer: string[];
  error?: string;
}

export interface CommandExecution {
  id: string;
  sessionId: string;
  command: string;
  status: "queued" | "running" | "completed" | "failed" | "timeout";
  output: string;
  exitCode: number | null;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  timeoutMs: number;
}

const GOVERNANCE_SESSION_LIMITS: Record<string, number> = {
  SAFE: 0,
  SUPERVISED: 2,
  AUTOPILOT: 10,
  RESEARCH: 1,
  EMERGENCY_STOP: 0,
};

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_IDLE_MS = 300000;
const MAX_OUTPUT_BUFFER_LINES = 500;

export class RemoteSessionManager extends EventEmitter {
  private sessions: Map<string, RemoteSessionInfo> = new Map();
  private commandQueues: Map<string, CommandExecution[]> = new Map();
  private idleTimers: Map<string, NodeJS.Timeout> = new Map();
  private sessionCounter = 0;
  private commandCounter = 0;

  constructor() {
    super();
    killSwitch.on("armed", () => {
      this.destroyAllSessions("Kill switch activated");
    });
  }

  private generateSessionId(): string {
    return `session_${++this.sessionCounter}_${Date.now()}`;
  }

  private generateCommandId(): string {
    return `cmd_${++this.commandCounter}_${Date.now()}`;
  }

  private getSessionLimit(): number {
    const mode = governanceModeManager.getMode();
    return GOVERNANCE_SESSION_LIMITS[mode] ?? 0;
  }

  private getActiveSessionCount(agentId?: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status === "active" || session.status === "creating") {
        if (!agentId || session.agentId === agentId) {
          count++;
        }
      }
    }
    return count;
  }

  private resetIdleTimer(sessionId: string): void {
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const session = this.sessions.get(sessionId);
    if (!session) return;

    const maxIdle = session.config.maxIdleMs || DEFAULT_MAX_IDLE_MS;
    const timer = setTimeout(() => {
      this.destroySession(sessionId, "Idle timeout exceeded");
    }, maxIdle);

    this.idleTimers.set(sessionId, timer);
  }

  async createSession(agentId: string, runId: string, config: RemoteSessionConfig): Promise<RemoteSessionInfo> {
    if (killSwitch.isArmed()) {
      throw new Error("Cannot create session: kill switch is armed");
    }

    const limit = this.getSessionLimit();
    if (limit === 0) {
      throw new Error(`Sessions not allowed in ${governanceModeManager.getMode()} mode`);
    }

    const activeCount = this.getActiveSessionCount();
    if (activeCount >= limit) {
      throw new Error(`Session limit reached (${activeCount}/${limit}) for ${governanceModeManager.getMode()} mode`);
    }

    const sessionId = this.generateSessionId();
    const session: RemoteSessionInfo = {
      id: sessionId,
      agentId,
      runId,
      status: "creating",
      config,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      commandCount: 0,
      outputBuffer: [],
    };

    this.sessions.set(sessionId, session);
    this.commandQueues.set(sessionId, []);

    session.status = "active";
    session.lastActivityAt = Date.now();

    this.resetIdleTimer(sessionId);

    sessionRecorder.record({
      runId,
      type: "system",
      command: `session:create:${config.type}`,
      input: { sessionId, config },
      output: { status: "active" },
      durationMs: 0,
    });

    this.emit("sessionCreated", session);
    return session;
  }

  async executeCommand(sessionId: string, command: string, timeoutMs?: number): Promise<CommandExecution> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== "active") {
      throw new Error(`Session ${sessionId} is not active (status: ${session.status})`);
    }

    if (killSwitch.isArmed()) {
      throw new Error("Command execution blocked: kill switch is armed");
    }

    const cmdTimeout = timeoutMs || session.config.timeoutMs || DEFAULT_TIMEOUT_MS;
    const cmdId = this.generateCommandId();

    const execution: CommandExecution = {
      id: cmdId,
      sessionId,
      command,
      status: "queued",
      output: "",
      exitCode: null,
      startedAt: Date.now(),
      completedAt: null,
      durationMs: null,
      timeoutMs: cmdTimeout,
    };

    const queue = this.commandQueues.get(sessionId) || [];
    queue.push(execution);
    this.commandQueues.set(sessionId, queue);

    execution.status = "running";
    this.emit("commandStarted", execution);

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Command timed out after ${cmdTimeout}ms`));
        }, cmdTimeout);

        setTimeout(() => {
          clearTimeout(timer);
          resolve();
        }, 10);
      });

      execution.status = "completed";
      execution.exitCode = 0;
      execution.output = `[simulated] ${command}`;
      execution.completedAt = Date.now();
      execution.durationMs = execution.completedAt - execution.startedAt;
    } catch (error) {
      execution.status = error instanceof Error && error.message.includes("timed out") ? "timeout" : "failed";
      execution.output = error instanceof Error ? error.message : "Unknown error";
      execution.exitCode = 1;
      execution.completedAt = Date.now();
      execution.durationMs = execution.completedAt - execution.startedAt;
    }

    session.commandCount++;
    session.lastActivityAt = Date.now();

    if (execution.output) {
      const lines = execution.output.split("\n");
      session.outputBuffer.push(...lines);
      while (session.outputBuffer.length > MAX_OUTPUT_BUFFER_LINES) {
        session.outputBuffer.shift();
      }
    }

    this.resetIdleTimer(sessionId);

    sessionRecorder.record({
      runId: session.runId,
      type: "command",
      command,
      input: { sessionId, timeoutMs: cmdTimeout },
      output: { exitCode: execution.exitCode, output: execution.output },
      durationMs: execution.durationMs || 0,
      exitCode: execution.exitCode ?? undefined,
      error: execution.status === "failed" || execution.status === "timeout" ? execution.output : undefined,
    });

    this.emit("commandCompleted", execution);
    return execution;
  }

  async attachSession(sessionId: string): Promise<RemoteSessionInfo> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === "destroyed") {
      throw new Error(`Session ${sessionId} has been destroyed`);
    }

    if (session.status === "detached") {
      session.status = "active";
      session.lastActivityAt = Date.now();
      this.resetIdleTimer(sessionId);
      this.emit("sessionAttached", session);
    }

    return session;
  }

  async detachSession(sessionId: string): Promise<RemoteSessionInfo> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === "active") {
      session.status = "detached";
      session.lastActivityAt = Date.now();

      const timer = this.idleTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.idleTimers.delete(sessionId);
      }

      this.emit("sessionDetached", session);
    }

    return session;
  }

  async destroySession(sessionId: string, reason?: string): Promise<RemoteSessionInfo> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = "destroyed";
    session.lastActivityAt = Date.now();
    if (reason) session.error = reason;

    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }

    this.commandQueues.delete(sessionId);

    sessionRecorder.record({
      runId: session.runId,
      type: "system",
      command: `session:destroy`,
      input: { sessionId, reason },
      output: { status: "destroyed" },
      durationMs: 0,
    });

    this.emit("sessionDestroyed", session);
    return session;
  }

  private destroyAllSessions(reason: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.status === "active" || session.status === "creating" || session.status === "detached") {
        session.status = "destroyed";
        session.error = reason;

        const timer = this.idleTimers.get(sessionId);
        if (timer) clearTimeout(timer);
      }
    }

    this.idleTimers.clear();
    this.commandQueues.clear();
    this.emit("allSessionsDestroyed", { reason });
  }

  getSession(sessionId: string): RemoteSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionOutput(sessionId: string, lines?: number): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    if (lines) {
      return session.outputBuffer.slice(-lines);
    }
    return [...session.outputBuffer];
  }

  getCommandHistory(sessionId: string): CommandExecution[] {
    return this.commandQueues.get(sessionId) || [];
  }

  getAllSessions(agentId?: string): RemoteSessionInfo[] {
    const sessions = Array.from(this.sessions.values());
    if (agentId) {
      return sessions.filter((s) => s.agentId === agentId);
    }
    return sessions;
  }

  getActiveSessions(): RemoteSessionInfo[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === "active" || s.status === "detached"
    );
  }

  getStats(): {
    total: number;
    active: number;
    detached: number;
    destroyed: number;
    sessionLimit: number;
    governanceMode: string;
  } {
    let active = 0;
    let detached = 0;
    let destroyed = 0;

    for (const session of this.sessions.values()) {
      if (session.status === "active") active++;
      else if (session.status === "detached") detached++;
      else if (session.status === "destroyed") destroyed++;
    }

    return {
      total: this.sessions.size,
      active,
      detached,
      destroyed,
      sessionLimit: this.getSessionLimit(),
      governanceMode: governanceModeManager.getMode(),
    };
  }
}

export const remoteSessionManager = new RemoteSessionManager();
