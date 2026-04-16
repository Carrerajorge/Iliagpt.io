/**
 * Python Sandbox Executor
 * 
 * Features:
 * - Isolated Python execution environment
 * - Resource limits (CPU, memory, time)
 * - Network restrictions
 * - Secure file I/O sandboxing
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import os from "os";

export interface SandboxConfig {
  maxExecutionTime: number;    // milliseconds
  maxMemoryMB: number;         // megabytes
  maxOutputSize: number;       // bytes
  allowNetwork: boolean;
  allowFileWrite: boolean;
  pythonPath: string;
  tempDir: string;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  executionTime: number;
  timedOut: boolean;
  memoryExceeded: boolean;
  error?: string;
}

const DEFAULT_CONFIG: SandboxConfig = {
  maxExecutionTime: 30000,     // 30 seconds
  maxMemoryMB: 256,            // 256 MB
  maxOutputSize: 1024 * 1024,  // 1 MB
  allowNetwork: false,
  allowFileWrite: false,
  pythonPath: "python3",
  tempDir: os.tmpdir(),
};

// Dangerous modules and functions to block
// Note: network-related modules become allowed when config.allowNetwork=true
const BASE_BLOCKED_MODULES = [
  "os",
  "subprocess",
  "sys",
  "shutil",
  "pickle",
  "ctypes",
  "multiprocessing",
  "__builtins__.__import__",
] as const;

const NETWORK_MODULES = ["socket", "urllib", "requests", "http", "ftplib", "smtplib"] as const;

function getBlockedModules(config: SandboxConfig): string[] {
  return config.allowNetwork ? [...BASE_BLOCKED_MODULES] : [...BASE_BLOCKED_MODULES, ...NETWORK_MODULES];
}

const BLOCKED_FUNCTIONS = [
  "exec",
  "eval",
  "compile",
  "open",
  "__import__",
  "getattr",
  "setattr",
  "delattr",
  "globals",
  "locals",
  "vars",
];

// Create sandbox wrapper script
function createSandboxWrapper(userCode: string, config: SandboxConfig): string {
  const blockedModulesStr = getBlockedModules(config).map(m => `"${m}"`).join(", ");
  const blockedFunctionsStr = BLOCKED_FUNCTIONS.map(f => `"${f}"`).join(", ");

  return `
import sys
import signal
import resource

# Set resource limits
def set_limits():
    # Memory limit
    memory_bytes = ${config.maxMemoryMB} * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    
    # CPU time limit (slightly more than wall time)
    cpu_seconds = ${Math.ceil(config.maxExecutionTime / 1000)} + 5
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    
    # Disable core dumps
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    
    # Limit file descriptors
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

try:
    set_limits()
except Exception as e:
    print(f"Warning: Could not set resource limits: {e}", file=sys.stderr)

# Block dangerous imports
blocked_modules = [${blockedModulesStr}]
blocked_functions = [${blockedFunctionsStr}]

original_import = __builtins__.__import__

def safe_import(name, *args, **kwargs):
    if any(name.startswith(blocked) for blocked in blocked_modules):
        raise ImportError(f"Module '{name}' is not allowed in sandbox")
    return original_import(name, *args, **kwargs)

__builtins__.__import__ = safe_import

# Remove dangerous builtins
for func in blocked_functions:
    if hasattr(__builtins__, func):
        try:
            delattr(__builtins__, func)
        except:
            pass

# Timeout handler
def timeout_handler(signum, frame):
    raise TimeoutError("Execution timed out")

signal.signal(signal.SIGALRM, timeout_handler)
signal.alarm(${Math.ceil(config.maxExecutionTime / 1000)})

# Redirect to capture output
import io
from contextlib import redirect_stdout, redirect_stderr

stdout_capture = io.StringIO()
stderr_capture = io.StringIO()

try:
    with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
        # === USER CODE START ===
${userCode.split("\n").map(line => "        " + line).join("\n")}
        # === USER CODE END ===
    
    # Print captured output
    print(stdout_capture.getvalue(), end="")
    print(stderr_capture.getvalue(), end="", file=sys.stderr)
    
except TimeoutError as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(124)
except MemoryError:
    print("Error: Memory limit exceeded", file=sys.stderr)
    sys.exit(137)
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1)
finally:
    signal.alarm(0)
`;
}

// Execute Python code in sandbox
export async function executePython(
  code: string,
  options: Partial<SandboxConfig> = {}
): Promise<ExecutionResult> {
  const config = { ...DEFAULT_CONFIG, ...options };
  const startTime = Date.now();

  // Create temporary file for script
  const scriptId = crypto.randomBytes(8).toString("hex");
  const scriptPath = path.join(config.tempDir, `sandbox_${scriptId}.py`);

  try {
    // Create sandbox wrapper
    const wrappedCode = createSandboxWrapper(code, config);
    await fs.writeFile(scriptPath, wrappedCode, "utf-8");

    return new Promise<ExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let memoryExceeded = false;

      const pythonProcess: ChildProcess = spawn(config.pythonPath, [scriptPath], {
        cwd: config.tempDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          PYTHONDONTWRITEBYTECODE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Timeout handler
      const timeout = setTimeout(() => {
        timedOut = true;
        pythonProcess.kill("SIGKILL");
      }, config.maxExecutionTime);

      // Capture stdout
      pythonProcess.stdout?.on("data", (data: Buffer) => {
        if (stdout.length < config.maxOutputSize) {
          stdout += data.toString().slice(0, config.maxOutputSize - stdout.length);
        }
      });

      // Capture stderr
      pythonProcess.stderr?.on("data", (data: Buffer) => {
        if (stderr.length < config.maxOutputSize) {
          stderr += data.toString().slice(0, config.maxOutputSize - stderr.length);
        }
      });

      // Handle completion
      pythonProcess.on("close", async (exitCode) => {
        clearTimeout(timeout);
        const executionTime = Date.now() - startTime;

        // Check for memory exceeded (exit code 137 = OOM killed)
        if (exitCode === 137) {
          memoryExceeded = true;
        }

        // Clean up temp file
        try {
          await fs.unlink(scriptPath);
        } catch {
          // Ignore cleanup errors
        }

        resolve({
          success: exitCode === 0 && !timedOut && !memoryExceeded,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
          executionTime,
          timedOut,
          memoryExceeded,
          error: timedOut
            ? "Execution timed out"
            : memoryExceeded
              ? "Memory limit exceeded"
              : undefined,
        });
      });

      // Handle spawn errors
      pythonProcess.on("error", async (error) => {
        clearTimeout(timeout);

        try {
          await fs.unlink(scriptPath);
        } catch {
          // Ignore cleanup errors
        }

        resolve({
          success: false,
          stdout: "",
          stderr: error.message,
          exitCode: null,
          executionTime: Date.now() - startTime,
          timedOut: false,
          memoryExceeded: false,
          error: error.message,
        });
      });
    });
  } catch (error) {
    // Clean up on error
    try {
      await fs.unlink(scriptPath);
    } catch {
      // Ignore
    }

    return {
      success: false,
      stdout: "",
      stderr: (error as Error).message,
      exitCode: null,
      executionTime: Date.now() - startTime,
      timedOut: false,
      memoryExceeded: false,
      error: (error as Error).message,
    };
  }
}

// Validate code before execution
export function validateCode(code: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for blocked imports
  for (const module of BLOCKED_MODULES) {
    const importRegex = new RegExp(`import\\s+${module}|from\\s+${module}`, "g");
    if (importRegex.test(code)) {
      issues.push(`Blocked module: ${module}`);
    }
  }

  // Check for blocked functions
  for (const func of BLOCKED_FUNCTIONS) {
    const funcRegex = new RegExp(`\\b${func}\\s*\\(`, "g");
    if (funcRegex.test(code)) {
      issues.push(`Blocked function: ${func}()`);
    }
  }

  // Check for file operations
  if (/open\s*\(|with\s+open/.test(code)) {
    issues.push("File operations are restricted");
  }

  // Check for network operations
  if (/socket|urllib|requests|http\.client/.test(code)) {
    issues.push("Network operations are restricted");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// Execute with pre-validation
export async function safeExecutePython(
  code: string,
  options: Partial<SandboxConfig> = {}
): Promise<ExecutionResult> {
  const validation = validateCode(code);

  if (!validation.valid) {
    return {
      success: false,
      stdout: "",
      stderr: `Code validation failed:\n${validation.issues.join("\n")}`,
      exitCode: null,
      executionTime: 0,
      timedOut: false,
      memoryExceeded: false,
      error: "Code validation failed",
    };
  }

  return executePython(code, options);
}

// Get Python version
export async function getPythonVersion(
  pythonPath = "python3"
): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(pythonPath, ["--version"]);
    let version = "";

    proc.stdout?.on("data", (data: Buffer) => {
      version += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      version += data.toString();
    });

    proc.on("close", (code) => {
      resolve(code === 0 ? version.trim() : null);
    });

    proc.on("error", () => {
      resolve(null);
    });
  });
}

// Wrapper to match expected interface from analysisOrchestrator
export async function executePythonCode(params: {
  code: string;
  filePath: string;
  sheetName: string;
  timeoutMs: number;
}) {
  const result = await executePython(params.code, {
    maxExecutionTime: params.timeoutMs,
    // Enable file write/network if needed, but keeping default secure for now
  });

  let output: any = {};
  if (result.success) {
    try {
      // Try to find the JSON output block if mixed with logs
      const stdout = result.stdout;
      // Heuristic: check if stdout acts like JSON or look for specific markers if implemented
      // For now assume stdout IS the JSON output
      output = JSON.parse(stdout);
    } catch (e) {
      // If not JSON, strictly speaking it might be just logs or failure in output generation
      console.warn("[executePythonCode] Failed to parse output as JSON", e);
      // Fallback: treat stdout as logs
      output = { logs: [result.stdout, result.stderr].filter(Boolean) };
    }
  } else {
    output = { logs: [result.stdout, result.stderr].filter(Boolean) };
  }

  return {
    success: result.success,
    error: result.error || (result.exitCode !== 0 ? result.stderr : undefined),
    executionTimeMs: result.executionTime,
    output
  };
}

export async function initializeSandbox() {
  try {
    await fs.mkdir(DEFAULT_CONFIG.tempDir, { recursive: true });
  } catch {
    // ignore
  }
}

export default {
  executePython,
  safeExecutePython,
  validateCode,
  getPythonVersion,
  executePythonCode,
  initializeSandbox,
  DEFAULT_CONFIG,
};
