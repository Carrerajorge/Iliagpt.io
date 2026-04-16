/**
 * safeSpawn.ts - Secure process spawning without shell injection
 * 
 * This module centralizes ALL process execution with:
 * - Prohibition of shell=true
 * - Allowlist of permitted programs
 * - Argument validation
 * - No dynamic program selection
 */

import { spawn, SpawnOptionsWithoutStdio, ChildProcess } from "node:child_process";
import { promisify } from "node:util";

// =========================
// CONFIG (LOCKDOWN)
// =========================

const ALLOWED_PROGRAMS = {
  PYTHON: "python3",
  PYTHON3: "python3",
  NODE: "node",
  NPM: "npm",
  BASH: "/bin/bash",
  SH: "/bin/sh",
} as const;

type ProgramKey = keyof typeof ALLOWED_PROGRAMS;

// Dangerous patterns in arguments
const DANGEROUS_PATTERNS = [
  /[;&|`$]/,     // Shell metacharacters
  /\$\(/,        // Command substitution
  /[\n\r]/,      // Newlines
  /\x00/,        // Null bytes
];

// =========================
// VALIDATION
// =========================

function validateArgs(args: string[]): void {
  for (const arg of args) {
    if (typeof arg !== "string") {
      throw new Error(`Argument must be string, got ${typeof arg}`);
    }
    if (arg.trim() === "") {
      throw new Error("Blocked empty argument");
    }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(arg)) {
        throw new Error(`Blocked dangerous characters in argument: ${JSON.stringify(arg)}`);
      }
    }
  }
}

function isProgramAllowed(programKey: string): programKey is ProgramKey {
  return programKey in ALLOWED_PROGRAMS;
}

// =========================
// SAFE SPAWN FUNCTIONS
// =========================

export interface SafeSpawnOptions {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  success: boolean;
  error?: string;
}

/**
 * Spawns a process safely without shell injection risks.
 * @param programKey - Key from ALLOWED_PROGRAMS enum
 * @param args - Arguments to pass to the program
 * @param options - Optional spawn options
 */
export function safeSpawn(
  programKey: ProgramKey,
  args: string[],
  options?: SafeSpawnOptions
): ChildProcess {
  if (!isProgramAllowed(programKey)) {
    throw new Error(`Blocked program key: ${programKey}. Allowed: ${Object.keys(ALLOWED_PROGRAMS).join(", ")}`);
  }

  validateArgs(args);

  const program = ALLOWED_PROGRAMS[programKey];
  
  const spawnOptions: SpawnOptionsWithoutStdio = {
    shell: false,
    stdio: "pipe",
    windowsHide: true,
    cwd: options?.cwd,
    env: options?.env,
  };

  return spawn(program, args, spawnOptions);
}

/**
 * Executes a command and returns a promise with the result.
 * @param programKey - Key from ALLOWED_PROGRAMS enum
 * @param args - Arguments to pass to the program
 * @param options - Optional execution options
 */
export async function safeExec(
  programKey: ProgramKey,
  args: string[],
  options?: SafeSpawnOptions
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    try {
      const child = safeSpawn(programKey, args, options);
      
      let stdout = "";
      let stderr = "";
      let timeoutId: NodeJS.Timeout | undefined;

      if (options?.timeout) {
        timeoutId = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            exitCode: -1,
            stdout,
            stderr,
            success: false,
            error: `Command timed out after ${options.timeout}ms`,
          });
        }, options.timeout);
      }

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          exitCode: -1,
          stdout,
          stderr,
          success: false,
          error: err.message,
        });
      });

      child.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          success: code === 0,
        });
      });
    } catch (err) {
      resolve({
        exitCode: -1,
        stdout: "",
        stderr: "",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

// =========================
// SAFE COMMAND CATALOG
// =========================

/**
 * Run a Python script safely.
 */
export async function runPythonScript(
  scriptPath: string,
  args: string[] = [],
  options?: SafeSpawnOptions
): Promise<ExecutionResult> {
  // Validate script path
  if (!scriptPath.endsWith(".py")) {
    throw new Error(`Only .py scripts allowed: ${scriptPath}`);
  }
  return safeExec("PYTHON3", [scriptPath, ...args], options);
}

/**
 * Run a Node.js script safely.
 */
export async function runNodeScript(
  scriptPath: string,
  args: string[] = [],
  options?: SafeSpawnOptions
): Promise<ExecutionResult> {
  // Validate script path
  if (!scriptPath.endsWith(".js") && !scriptPath.endsWith(".mjs")) {
    throw new Error(`Only .js/.mjs scripts allowed: ${scriptPath}`);
  }
  return safeExec("NODE", [scriptPath, ...args], options);
}

/**
 * Run npm command safely.
 */
export async function runNpm(
  command: "install" | "run" | "test" | "build",
  args: string[] = [],
  options?: SafeSpawnOptions
): Promise<ExecutionResult> {
  return safeExec("NPM", [command, ...args], options);
}

// Export types and constants for consumers
export { ALLOWED_PROGRAMS, ProgramKey };
