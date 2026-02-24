import { spawn, execFile, ChildProcess, SpawnOptions } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { ExecutionResult, ExecutionStatus, ExecutorConfig, ExecutorStats, SecurityAnalysis } from "./types";
import { SecurityGuard } from "./securityGuard";

interface ActiveProcess {
  process: ChildProcess;
  startTime: number;
}

export class CommandExecutor {
  private config: ExecutorConfig;
  private security: SecurityGuard;
  private history: ExecutionResult[] = [];
  private maxHistory: number = 1000;
  private activeProcesses: Map<string, ActiveProcess> = new Map();
  private workingDir: string;

  constructor(config?: Partial<ExecutorConfig>, securityGuard?: SecurityGuard) {
    this.config = {
      defaultTimeout: config?.defaultTimeout ?? 30000,
      maxTimeout: config?.maxTimeout ?? 300000,
      maxOutputSize: config?.maxOutputSize ?? 10 * 1024 * 1024,
      shell: config?.shell ?? "/bin/bash",
      workingDirectory: config?.workingDirectory,
      environment: config?.environment ?? {},
      captureOutput: config?.captureOutput ?? true,
      enableSecurity: config?.enableSecurity ?? true,
    };

    this.security = securityGuard ?? new SecurityGuard();
    this.workingDir = this.config.workingDirectory ?? this.security.getSandboxRoot();

    if (!fs.existsSync(this.workingDir)) {
      fs.mkdirSync(this.workingDir, { recursive: true });
    }
  }

  async execute(
    command: string,
    options: {
      timeout?: number;
      workingDir?: string;
      env?: Record<string, string>;
      stdinInput?: string;
    } = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeout = Math.min(options.timeout ?? this.config.defaultTimeout, this.config.maxTimeout);

    let securityResult: SecurityAnalysis | undefined;
    if (this.config.enableSecurity) {
      securityResult = this.security.analyzeCommand(command);
      if (!securityResult.isSafe || securityResult.action === "log_and_block" || securityResult.action === "block") {
        return this.createBlockedResult(command, securityResult, startTime);
      }
    }

    const execEnv = { ...process.env, ...this.config.environment, ...options.env };
    const workPath = options.workingDir ?? this.workingDir;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const parsed = this.parseCommand(command);
      if (!parsed) {
        resolve({
          command,
          status: "failed",
          returnCode: 1,
          stdout: "",
          stderr: "Failed to parse command",
          executionTime: Date.now() - startTime,
          errorMessage: "Could not parse command",
          securityAnalysis: securityResult,
        });
        return;
      }

      const childProcess = execFile(parsed.cmd, parsed.args, {
        cwd: workPath,
        env: execEnv,
        maxBuffer: this.config.maxOutputSize,
        timeout: 0,
      });
      const processId = `${childProcess.pid}_${Date.now()}`;
      this.activeProcesses.set(processId, { process: childProcess, startTime });

      const timeoutId = setTimeout(() => {
        killed = true;
        childProcess.kill("SIGKILL");
      }, timeout);

      if (options.stdinInput && childProcess.stdin) {
        childProcess.stdin.write(options.stdinInput);
        childProcess.stdin.end();
      }

      if (childProcess.stdout) {
        childProcess.stdout.on("data", (data) => {
          const chunk = data.toString();
          if (stdout.length + chunk.length <= this.config.maxOutputSize) {
            stdout += chunk;
          }
        });
      }

      if (childProcess.stderr) {
        childProcess.stderr.on("data", (data) => {
          const chunk = data.toString();
          if (stderr.length + chunk.length <= this.config.maxOutputSize) {
            stderr += chunk;
          }
        });
      }

      childProcess.on("close", (code, signal) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(processId);

        let status: ExecutionStatus;
        let errorMessage = "";

        if (killed) {
          status = "timeout";
          errorMessage = `Comando excedió el timeout de ${timeout}ms`;
        } else if (signal) {
          status = "cancelled";
          errorMessage = `Proceso terminado por señal: ${signal}`;
        } else if (code === 0) {
          status = "completed";
        } else {
          status = "failed";
          errorMessage = stderr || `Código de salida: ${code}`;
        }

        const result: ExecutionResult = {
          command,
          status,
          returnCode: code,
          stdout,
          stderr,
          executionTime: Date.now() - startTime,
          errorMessage,
          securityAnalysis: securityResult,
        };

        this.addToHistory(result);
        resolve(result);
      });

      childProcess.on("error", (error) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(processId);

        const result: ExecutionResult = {
          command,
          status: "failed",
          returnCode: null,
          stdout,
          stderr,
          executionTime: Date.now() - startTime,
          errorMessage: error.message,
          securityAnalysis: securityResult,
        };

        this.addToHistory(result);
        resolve(result);
      });
    });
  }

  private static readonly ALLOWED_INTERPRETERS: Record<string, string> = {
    bash: "/bin/bash",
    sh: "/bin/sh",
    python: "python3",
    python3: "python3",
    node: "node",
  };

  async executeScript(
    scriptContent: string,
    interpreter: string = "bash",
    timeout?: number
  ): Promise<ExecutionResult> {
    const extMap: Record<string, string> = {
      bash: ".sh",
      sh: ".sh",
      python: ".py",
      python3: ".py",
      node: ".js",
    };

    const interpreterKey = interpreter.toLowerCase().trim();
    if (!(interpreterKey in CommandExecutor.ALLOWED_INTERPRETERS)) {
      return {
        command: `${interpreter} [script]`,
        status: "blocked",
        returnCode: 1,
        stdout: "",
        stderr: "",
        executionTime: 0,
        errorMessage: `Interpreter not allowed: ${interpreter}. Allowed: ${Object.keys(CommandExecutor.ALLOWED_INTERPRETERS).join(", ")}`,
      };
    }

    // Security Check for Code Content
    if (this.config.enableSecurity) {
      let language: "python" | "javascript" | undefined;
      if (interpreterKey.includes("python")) language = "python";
      if (interpreterKey === "node") language = "javascript";

      if (language) {
        const check = this.security.analyzeCode(scriptContent, language);
        if (!check.isSafe) {
          const analysis: SecurityAnalysis = {
            command: "[script content]",
            isSafe: false,
            threatLevel: "high",
            action: "block",
            matchedRules: [check.reason || "Dangerous pattern matched"],
            warnings: [],
            sanitizedCommand: "[blocked]",
          };

          return {
            command: `${interpreter} [script]`,
            status: "blocked",
            returnCode: 1,
            stdout: "",
            stderr: "",
            executionTime: 0,
            errorMessage: `Security Block: ${check.reason}`,
            securityAnalysis: analysis,
          };
        }
      }
    }

    const interpreterPath = CommandExecutor.ALLOWED_INTERPRETERS[interpreterKey];
    const ext = extMap[interpreterKey] ?? ".txt";

    const tempDir = this.workingDir;
    const scriptPath = path.join(tempDir, `script_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);

    const startTime = Date.now();

    try {
      fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let killed = false;
        const effectiveTimeout = Math.min(timeout ?? this.config.defaultTimeout, this.config.maxTimeout);

        const childProcess = execFile(interpreterPath, [scriptPath], {
          cwd: this.workingDir,
          env: { ...process.env, ...this.config.environment },
          maxBuffer: this.config.maxOutputSize,
        });

        const timeoutId = setTimeout(() => {
          killed = true;
          childProcess.kill("SIGKILL");
        }, effectiveTimeout);

        if (childProcess.stdout) {
          childProcess.stdout.on("data", (data) => {
            stdout += data.toString();
          });
        }

        if (childProcess.stderr) {
          childProcess.stderr.on("data", (data) => {
            stderr += data.toString();
          });
        }

        childProcess.on("close", (code) => {
          clearTimeout(timeoutId);
          this.cleanupScript(scriptPath);

          let status: ExecutionStatus;
          let errorMessage = "";

          if (killed) {
            status = "timeout";
            errorMessage = `Script exceeded timeout of ${effectiveTimeout}ms`;
          } else if (code === 0) {
            status = "completed";
          } else {
            status = "failed";
            errorMessage = stderr || `Exit code: ${code}`;
          }

          const result: ExecutionResult = {
            command: `${interpreterPath} ${path.basename(scriptPath)}`,
            status,
            returnCode: code,
            stdout,
            stderr,
            executionTime: Date.now() - startTime,
            errorMessage,
          };

          this.addToHistory(result);
          resolve(result);
        });

        childProcess.on("error", (error) => {
          clearTimeout(timeoutId);
          this.cleanupScript(scriptPath);

          const result: ExecutionResult = {
            command: `${interpreterPath} [script]`,
            status: "failed",
            returnCode: null,
            stdout,
            stderr,
            executionTime: Date.now() - startTime,
            errorMessage: error.message,
          };

          this.addToHistory(result);
          resolve(result);
        });
      });
    } catch (error) {
      this.cleanupScript(scriptPath);
      return {
        command: `${interpreterPath} [script]`,
        status: "failed",
        returnCode: null,
        stdout: "",
        stderr: "",
        executionTime: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private cleanupScript(scriptPath: string): void {
    try {
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
    } catch {
    }
  }

  async executeMultiple(
    commands: string[],
    stopOnError: boolean = true
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    for (const cmd of commands) {
      const result = await this.execute(cmd);
      results.push(result);
      if (stopOnError && result.status !== "completed") {
        break;
      }
    }
    return results;
  }

  async cancelAll(): Promise<void> {
    for (const [processId, { process }] of this.activeProcesses.entries()) {
      try {
        process.kill("SIGKILL");
      } catch {
      }
      this.activeProcesses.delete(processId);
    }
  }

  private createBlockedResult(
    command: string,
    securityResult: SecurityAnalysis,
    startTime: number
  ): ExecutionResult {
    const result: ExecutionResult = {
      command,
      status: "blocked",
      returnCode: null,
      stdout: "",
      stderr: "",
      executionTime: Date.now() - startTime,
      errorMessage: `Comando bloqueado por seguridad: ${securityResult.warnings.join(", ")}`,
      securityAnalysis: securityResult,
    };
    this.addToHistory(result);
    return result;
  }

  private addToHistory(result: ExecutionResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  getHistory(limit: number = 50): ExecutionResult[] {
    return this.history.slice(-limit);
  }

  getStats(): ExecutorStats {
    const total = this.history.length;
    if (total === 0) {
      return {
        totalExecutions: 0,
        successful: 0,
        successRate: 0,
        avgExecutionTime: 0,
        activeProcesses: this.activeProcesses.size,
      };
    }

    const successful = this.history.filter((r) => r.status === "completed" && r.returnCode === 0).length;
    const totalTime = this.history.reduce((sum, r) => sum + r.executionTime, 0);

    return {
      totalExecutions: total,
      successful,
      successRate: (successful / total) * 100,
      avgExecutionTime: totalTime / total,
      activeProcesses: this.activeProcesses.size,
    };
  }

  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  getWorkingDirectory(): string {
    return this.workingDir;
  }

  private parseCommand(commandStr: string): { cmd: string; args: string[] } | null {
    const trimmed = commandStr.trim();
    if (!trimmed) return null;

    const parts: string[] = [];
    let current = "";
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === " " || char === "\t") {
        if (current) {
          parts.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    if (parts.length === 0) return null;

    return { cmd: parts[0], args: parts.slice(1) };
  }
}
