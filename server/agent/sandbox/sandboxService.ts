import * as path from "path";
import { SandboxEnvironment, EnvironmentConfig, ExecutionResult, FileOperationResult, EnvironmentStatus, OperationLog } from "./index";

interface SandboxSession {
  sandbox: SandboxEnvironment;
  runId: string;
  createdAt: Date;
  lastActive: Date;
}

export class SandboxService {
  private static instance: SandboxService | null = null;
  private sessions: Map<string, SandboxSession> = new Map();
  private globalSandbox: SandboxEnvironment | null = null;
  private defaultConfig: Partial<EnvironmentConfig>;

  private constructor(config?: Partial<EnvironmentConfig>) {
    this.defaultConfig = {
      enableSecurity: true,
      defaultTimeout: 30000,
      maxTimeout: 300000,
      maxFileSize: 100 * 1024 * 1024,
      autoSave: true,
      ...config,
    };
  }

  static getInstance(config?: Partial<EnvironmentConfig>): SandboxService {
    if (!SandboxService.instance) {
      SandboxService.instance = new SandboxService(config);
    }
    return SandboxService.instance;
  }

  async initialize(): Promise<boolean> {
    if (!this.globalSandbox) {
      this.globalSandbox = new SandboxEnvironment({
        ...this.defaultConfig,
        workspaceRoot: path.join(process.cwd(), "sandbox_workspace"),
      });
      return this.globalSandbox.initialize();
    }
    return true;
  }

  async shutdown(): Promise<void> {
    for (const [runId, session] of this.sessions.entries()) {
      await session.sandbox.shutdown();
      this.sessions.delete(runId);
    }

    if (this.globalSandbox) {
      await this.globalSandbox.shutdown();
      this.globalSandbox = null;
    }

    SandboxService.instance = null;
  }

  async getSessionSandbox(runId: string): Promise<SandboxEnvironment> {
    let session = this.sessions.get(runId);
    if (!session) {
      const sandbox = new SandboxEnvironment({
        ...this.defaultConfig,
        workspaceRoot: path.join(process.cwd(), "sandbox_workspace", "runs", runId),
      });
      await sandbox.initialize();
      session = {
        sandbox,
        runId,
        createdAt: new Date(),
        lastActive: new Date(),
      };
      this.sessions.set(runId, session);
    }
    session.lastActive = new Date();
    return session.sandbox;
  }

  async closeSession(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (session) {
      await session.sandbox.shutdown();
      this.sessions.delete(runId);
    }
  }

  async execute(
    command: string,
    options: {
      runId?: string;
      timeout?: number;
      workingDir?: string;
      env?: Record<string, string>;
    } = {}
  ): Promise<ExecutionResult> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.execute(command, {
      timeout: options.timeout,
      workingDir: options.workingDir,
      env: options.env,
    });
  }

  async executeScript(
    scriptContent: string,
    options: {
      runId?: string;
      interpreter?: string;
      timeout?: number;
    } = {}
  ): Promise<ExecutionResult> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.executeScript(scriptContent, options.interpreter ?? "bash", options.timeout);
  }

  async executePython(
    code: string,
    options: { runId?: string; timeout?: number } = {}
  ): Promise<ExecutionResult> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.executePython(code, options.timeout);
  }

  async executeNode(
    code: string,
    options: { runId?: string; timeout?: number } = {}
  ): Promise<ExecutionResult> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.executeNode(code, options.timeout);
  }

  async readFile(
    filePath: string,
    options: { runId?: string; encoding?: string } = {}
  ): Promise<FileOperationResult> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.readFile(filePath, options.encoding);
  }

  async writeFile(
    filePath: string,
    content: string,
    options: { runId?: string; createDirs?: boolean } = {}
  ): Promise<FileOperationResult> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.writeFile(filePath, content, { createDirs: options.createDirs ?? true });
  }

  async deleteFile(
    filePath: string,
    options: { runId?: string; recursive?: boolean } = {}
  ): Promise<FileOperationResult> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.deleteFile(filePath, { recursive: options.recursive ?? false });
  }

  async listFiles(
    filePath: string = ".",
    options: { runId?: string; pattern?: string } = {}
  ): Promise<FileOperationResult> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.listFiles(filePath, options.pattern ?? "*");
  }

  async fileExists(filePath: string, runId?: string): Promise<boolean> {
    const sandbox = runId
      ? await this.getSessionSandbox(runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.fileExists(filePath);
  }

  async getStatus(runId?: string): Promise<EnvironmentStatus> {
    const sandbox = runId
      ? await this.getSessionSandbox(runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.getStatus();
  }

  async getHistory(options: { runId?: string; limit?: number } = {}): Promise<OperationLog[]> {
    const sandbox = options.runId
      ? await this.getSessionSandbox(options.runId)
      : this.globalSandbox ?? (await this.getGlobalSandbox());

    return sandbox.getHistory(options.limit ?? 50);
  }

  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  private async getGlobalSandbox(): Promise<SandboxEnvironment> {
    if (!this.globalSandbox) {
      await this.initialize();
    }
    return this.globalSandbox!;
  }

  async cleanupOldSessions(maxAgeMs: number = 3600000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [runId, session] of this.sessions.entries()) {
      if (now - session.lastActive.getTime() > maxAgeMs) {
        await this.closeSession(runId);
        cleaned++;
      }
    }

    return cleaned;
  }

  // Helper methods for router compatibility
  async createSession(): Promise<string> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.getSessionSandbox(sessionId);
    return sessionId;
  }

  getSession(sessionId: string): SandboxEnvironment | null {
    const session = this.sessions.get(sessionId);
    return session?.sandbox || null;
  }

  async destroySession(sessionId: string): Promise<boolean> {
    if (this.sessions.has(sessionId)) {
      await this.closeSession(sessionId);
      return true;
    }
    return false;
  }
}

export const sandboxService = SandboxService.getInstance();
