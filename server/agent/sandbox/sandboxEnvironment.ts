import * as path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  EnvironmentConfig,
  EnvironmentStatus,
  ExecutionResult,
  FileOperationResult,
  OperationLog,
  ToolInfo,
  ISandboxService,
} from "./types";
import { SecurityGuard } from "./securityGuard";
import { CommandExecutor } from "./commandExecutor";
import { FileManager } from "./fileManager";
import { StateManager } from "./stateManager";

const execFileAsync = promisify(execFile);

export class SandboxEnvironment implements ISandboxService {
  private config: EnvironmentConfig;
  private workspace: string;
  private stateDir: string;
  private tempDir: string;

  private security: SecurityGuard | null = null;
  private executor: CommandExecutor | null = null;
  private files: FileManager | null = null;
  private state: StateManager | null = null;

  private initialized: boolean = false;
  private startTime: Date | null = null;
  private toolsCache: Map<string, ToolInfo> = new Map();

  constructor(config?: Partial<EnvironmentConfig>) {
    const defaultConfig: EnvironmentConfig = {
      workspaceRoot: path.join(process.cwd(), "sandbox_workspace"),
      stateDirectory: ".state",
      tempDirectory: ".tmp",
      enableSecurity: true,
      defaultTimeout: 30000,
      maxTimeout: 300000,
      maxFileSize: 100 * 1024 * 1024,
      autoSave: true,
      saveInterval: 60000,
      maxHistory: 10000,
      requiredTools: ["python3", "pip3", "node", "npm", "git", "curl", "wget"],
    };

    this.config = { ...defaultConfig, ...config };
    this.workspace = path.resolve(this.config.workspaceRoot!);
    this.stateDir = path.join(this.workspace, this.config.stateDirectory);
    this.tempDir = path.join(this.workspace, this.config.tempDirectory);
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      this.startTime = new Date();
      await this.createDirectoryStructure();

      this.security = new SecurityGuard(this.workspace);

      this.executor = new CommandExecutor(
        {
          defaultTimeout: this.config.defaultTimeout,
          maxTimeout: this.config.maxTimeout,
          workingDirectory: this.workspace,
          enableSecurity: this.config.enableSecurity,
        },
        this.security
      );

      this.files = new FileManager(this.workspace, this.security, this.config.maxFileSize);

      this.state = new StateManager({
        stateDirectory: this.stateDir,
        autoSave: this.config.autoSave,
        saveInterval: this.config.saveInterval,
        maxHistoryEntries: this.config.maxHistory,
      });
      await this.state.initialize();

      await this.checkTools();
      await this.setupEnvironment();

      this.initialized = true;
      console.log(`[SandboxEnvironment] Initialized at ${this.workspace}`);
      return true;
    } catch (error) {
      console.error("[SandboxEnvironment] Error initializing:", error);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.executor) {
      await this.executor.cancelAll();
    }
    if (this.state) {
      await this.state.shutdown();
    }
    this.initialized = false;
    console.log("[SandboxEnvironment] Shutdown complete");
  }

  private async createDirectoryStructure(): Promise<void> {
    const directories = [
      this.workspace,
      this.stateDir,
      this.tempDir,
      path.join(this.workspace, "projects"),
      path.join(this.workspace, "downloads"),
      path.join(this.workspace, "scripts"),
      path.join(this.workspace, "data"),
    ];

    for (const dir of directories) {
      await fsp.mkdir(dir, { recursive: true });
    }
  }

  private async checkTools(): Promise<void> {
    for (const tool of this.config.requiredTools) {
      const info = await this.getToolInfo(tool);
      this.toolsCache.set(tool, info);
    }
  }

  private async getToolInfo(tool: string): Promise<ToolInfo> {
    const versionCommands: Record<string, string[]> = {
      python3: ["python3", "--version"],
      pip3: ["pip3", "--version"],
      node: ["node", "--version"],
      npm: ["npm", "--version"],
      git: ["git", "--version"],
      curl: ["curl", "--version"],
      wget: ["wget", "--version"],
    };

    // Only allow known tool names to prevent injection
    if (!/^[a-zA-Z0-9_-]+$/.test(tool)) {
      return { name: tool, version: "N/A", path: "", available: false };
    }

    try {
      const { stdout: whichOutput } = await execFileAsync("which", [tool]);
      const toolPath = whichOutput.trim();

      if (!toolPath) {
        return { name: tool, version: "N/A", path: "", available: false };
      }

      let version = "unknown";
      const cmd = versionCommands[tool] || [tool, "--version"];

      try {
        const { stdout } = await execFileAsync(cmd[0], cmd.slice(1));
        version = stdout.trim().split("\n")[0];
      } catch {
      }

      return { name: tool, version, path: toolPath, available: true };
    } catch {
      return { name: tool, version: "N/A", path: "", available: false };
    }
  }

  private async setupEnvironment(): Promise<void> {
    process.env.SANDBOX_ROOT = this.workspace;
    process.env.SANDBOX_TEMP = this.tempDir;
    process.env.PYTHONPATH = this.workspace;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("SandboxEnvironment no está inicializado. Llama a initialize() primero.");
    }
  }

  async execute(
    command: string,
    options: { timeout?: number; workingDir?: string; env?: Record<string, string> } = {}
  ): Promise<ExecutionResult> {
    this.ensureInitialized();

    const startTime = Date.now();
    const result = await this.executor!.execute(command, options);
    const duration = Date.now() - startTime;

    await this.state!.logOperation(
      "shell",
      "execute",
      { command },
      result.stdout.substring(0, 200) || result.errorMessage,
      duration,
      result.status === "completed" && result.returnCode === 0
    );

    return result;
  }

  async executeScript(
    scriptContent: string,
    interpreter: string = "bash",
    timeout?: number
  ): Promise<ExecutionResult> {
    this.ensureInitialized();
    return this.executor!.executeScript(scriptContent, interpreter, timeout);
  }

  async executePython(code: string, timeout?: number): Promise<ExecutionResult> {
    return this.executeScript(code, "python3", timeout);
  }

  async executeNode(code: string, timeout?: number): Promise<ExecutionResult> {
    return this.executeScript(code, "node", timeout);
  }

  async readFile(filePath: string, encoding: string = "utf-8"): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.read(filePath, encoding as BufferEncoding);
  }

  async writeFile(
    filePath: string,
    content: string,
    options: { createDirs?: boolean } = {}
  ): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.write(filePath, content, { createDirs: options.createDirs ?? true });
  }

  async deleteFile(filePath: string, options: { recursive?: boolean } = {}): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.delete(filePath, options.recursive ?? false);
  }

  async listFiles(filePath: string = ".", pattern: string = "*"): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.listDir(filePath, pattern);
  }

  async fileExists(filePath: string): Promise<boolean> {
    this.ensureInitialized();
    const result = await this.files!.exists(filePath);
    return result.success && result.data?.exists === true;
  }

  async copyFile(src: string, dst: string): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.copy(src, dst);
  }

  async moveFile(src: string, dst: string): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.move(src, dst);
  }

  async mkdir(dirPath: string): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.mkdir(dirPath);
  }

  async readJson<T = unknown>(filePath: string): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.readJson<T>(filePath);
  }

  async writeJson(filePath: string, data: unknown): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.writeJson(filePath, data);
  }

  async searchFiles(
    pattern: string,
    dirPath: string = ".",
    contentSearch?: string
  ): Promise<FileOperationResult> {
    this.ensureInitialized();
    return this.files!.search(pattern, dirPath, contentSearch);
  }

  private static readonly PACKAGE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]*$/;
  private static readonly VERSION_PATTERN = /^[a-zA-Z0-9._-]+$/;

  private validatePackageName(name: string): boolean {
    if (!name || name.length > 100) return false;
    return SandboxEnvironment.PACKAGE_NAME_PATTERN.test(name);
  }

  private validateVersion(version: string): boolean {
    if (!version || version.length > 50) return false;
    return SandboxEnvironment.VERSION_PATTERN.test(version);
  }

  private getSafeEnv(): Record<string, string> {
    return {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: process.env.HOME || "/tmp",
      TMPDIR: this.tempDir,
      LANG: "en_US.UTF-8",
    };
  }

  async installPipPackage(packageName: string, version?: string): Promise<ExecutionResult> {
    this.ensureInitialized();
    
    const pkgSpec = packageName + (version ? `==${version}` : "");
    const commandDesc = `pip3 install ${pkgSpec}`;
    
    if (!this.validatePackageName(packageName)) {
      return {
        command: commandDesc,
        status: "blocked",
        returnCode: 1,
        stdout: "",
        stderr: "",
        executionTime: 0,
        errorMessage: `Invalid package name: ${packageName}. Only alphanumeric, dots, hyphens, and underscores allowed.`,
      };
    }
    
    if (version && !this.validateVersion(version)) {
      return {
        command: commandDesc,
        status: "blocked",
        returnCode: 1,
        stdout: "",
        stderr: "",
        executionTime: 0,
        errorMessage: `Invalid version format: ${version}`,
      };
    }

    const args = ["install", pkgSpec, "--break-system-packages", "-q"];
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await execFileAsync("pip3", args, {
        cwd: this.workspace,
        env: this.getSafeEnv(),
        timeout: 120000,
      });
      
      const duration = Date.now() - startTime;
      await this.state!.registerPackage(packageName, version || "latest", "pip");
      
      return {
        command: commandDesc,
        status: "completed",
        returnCode: 0,
        stdout: stdout || "",
        stderr: stderr || "",
        executionTime: duration,
        errorMessage: "",
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const execError = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean; message?: string };
      
      return {
        command: commandDesc,
        status: execError.killed ? "timeout" : "failed",
        returnCode: typeof execError.code === "number" ? execError.code : 1,
        stdout: execError.stdout || "",
        stderr: execError.stderr || "",
        executionTime: duration,
        errorMessage: execError.message || "Package installation failed",
      };
    }
  }

  async installNpmPackage(packageName: string, version?: string, global: boolean = false): Promise<ExecutionResult> {
    this.ensureInitialized();
    
    const pkgSpec = packageName + (version ? `@${version}` : "");
    const commandDesc = `npm install ${global ? "-g " : ""}${pkgSpec}`;
    
    if (!this.validatePackageName(packageName)) {
      return {
        command: commandDesc,
        status: "blocked",
        returnCode: 1,
        stdout: "",
        stderr: "",
        executionTime: 0,
        errorMessage: `Invalid package name: ${packageName}. Only alphanumeric, dots, hyphens, and underscores allowed.`,
      };
    }
    
    if (version && !this.validateVersion(version)) {
      return {
        command: commandDesc,
        status: "blocked",
        returnCode: 1,
        stdout: "",
        stderr: "",
        executionTime: 0,
        errorMessage: `Invalid version format: ${version}`,
      };
    }

    const args = ["install", ...(global ? ["-g"] : []), pkgSpec];
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await execFileAsync("npm", args, {
        cwd: this.workspace,
        env: this.getSafeEnv(),
        timeout: 120000,
      });
      
      const duration = Date.now() - startTime;
      await this.state!.registerPackage(packageName, version || "latest", "npm");
      
      return {
        command: commandDesc,
        status: "completed",
        returnCode: 0,
        stdout: stdout || "",
        stderr: stderr || "",
        executionTime: duration,
        errorMessage: "",
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const execError = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean; message?: string };
      
      return {
        command: commandDesc,
        status: execError.killed ? "timeout" : "failed",
        returnCode: typeof execError.code === "number" ? execError.code : 1,
        stdout: execError.stdout || "",
        stderr: execError.stderr || "",
        executionTime: duration,
        errorMessage: execError.message || "Package installation failed",
      };
    }
  }

  async getInstalledPackages(): Promise<Record<string, unknown>> {
    this.ensureInitialized();
    return this.state!.getInstalledPackages();
  }

  async getStatus(): Promise<EnvironmentStatus> {
    const uptime = this.startTime ? (Date.now() - this.startTime.getTime()) / 1000 : 0;

    let diskUsage: Record<string, unknown> = {};
    if (this.initialized && this.files) {
      try {
        const result = await this.files.getDiskUsage(".");
        if (result.success) {
          diskUsage = result.data as Record<string, unknown>;
        }
      } catch {
      }
    }

    const toolsAvailable: Record<string, ToolInfo> = {};
    for (const [name, info] of this.toolsCache.entries()) {
      toolsAvailable[name] = info;
    }

    return {
      isInitialized: this.initialized,
      isHealthy: await this.checkHealth(),
      workspacePath: this.workspace,
      sessionId: this.state?.getStats().currentSession as string | null,
      uptimeSeconds: uptime,
      toolsAvailable,
      diskUsage,
      activeProcesses: this.executor?.getActiveProcessCount() ?? 0,
    };
  }

  private async checkHealth(): Promise<boolean> {
    const checks = [
      this.initialized,
      fs.existsSync(this.workspace),
      this.security !== null,
      this.executor !== null,
      this.files !== null,
      this.state !== null,
    ];
    return checks.every(Boolean);
  }

  async getHistory(limit: number = 50): Promise<OperationLog[]> {
    this.ensureInitialized();
    return this.state!.getHistory(limit);
  }

  async cleanTemp(): Promise<void> {
    this.ensureInitialized();
    const entries = await fsp.readdir(this.tempDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(this.tempDir, entry.name);
      try {
        if (entry.isFile()) {
          await fsp.unlink(fullPath);
        } else if (entry.isDirectory()) {
          await fsp.rm(fullPath, { recursive: true, force: true });
        }
      } catch {
      }
    }
  }

  getWorkspacePath(...parts: string[]): string {
    return path.join(this.workspace, ...parts);
  }

  getSecurityGuard(): SecurityGuard | null {
    return this.security;
  }

  getFileManager(): FileManager | null {
    return this.files;
  }

  getCommandExecutor(): CommandExecutor | null {
    return this.executor;
  }

  getStateManager(): StateManager | null {
    return this.state;
  }
}

export async function createSandbox(config?: Partial<EnvironmentConfig>): Promise<SandboxEnvironment> {
  const sandbox = new SandboxEnvironment(config);
  await sandbox.initialize();
  return sandbox;
}

export async function quickExecute(command: string): Promise<ExecutionResult> {
  const sandbox = await createSandbox();
  try {
    return await sandbox.execute(command);
  } finally {
    await sandbox.shutdown();
  }
}
