import { spawn } from "child_process"; import { Logger } from "../../lib/logger"; import type { PackageManagerId } from "./capabilityProbe";

export interface ExecSpec {
  /** Binary executed without a shell (spawn). */
  bin: string;
  /** Arguments to pass to the binary. */
  args: string[];
  /** Human-readable command (for display only). */
  display: string;
  /** Whether execution requires elevated privileges. */
  requiresSudo?: boolean;
}

export interface ExecuteOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  env?: Record<string, string | undefined>;
}

export interface ExecuteResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function truncateBytes(input: Buffer, maxBytes: number): string {
  if (input.length <= maxBytes) return input.toString("utf8");
  return input.subarray(0, maxBytes).toString("utf8") + `\n[truncated ${input.length - maxBytes} bytes]`;
}

/**
 * Execute an already-built ExecSpec.
 *
 * SECURITY:
 * - Does NOT use a shell.
 * - Caller must build `bin/args` from trusted templates (never user-provided raw strings).
 */
export async function executeCommand(spec: ExecSpec, options: ExecuteOptions): Promise<ExecuteResult> {
  const start = Date.now();

  return await new Promise<ExecuteResult>((resolve) => {
    let settled = false;
    const finish = (r: ExecuteResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child;
    try {
      child = spawn(spec.bin, spec.args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...(options.env ?? {}),
        },
      });
    } catch (e: any) {
      return finish({
        ok: false,
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: `Failed to spawn ${spec.bin}: ${e?.message || String(e)}`,
        durationMs: Date.now() - start,
      });
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let stdoutBytes = 0;
    let stderrBytes = 0;

    const killTimer = setTimeout(() => {
      Logger.warn("[PackageExecutor] Timeout, killing process", { display: spec.display, timeoutMs: options.timeoutMs });
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes < options.maxOutputBytes) {
        stdoutChunks.push(chunk);
      }
      stdoutBytes += chunk.length;
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes < options.maxOutputBytes) {
        stderrChunks.push(chunk);
      }
      stderrBytes += chunk.length;
    });

    // Critical hardening: spawn failures (ENOENT, EACCES) arrive here.
    child.on("error", (err: any) => {
      clearTimeout(killTimer);
      finish({
        ok: false,
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: `Failed to spawn ${spec.bin}: ${err?.message || String(err)}`,
        durationMs: Date.now() - start,
      });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(killTimer);
      const durationMs = Date.now() - start;

      const stdoutBuf = Buffer.concat(stdoutChunks);
      const stderrBuf = Buffer.concat(stderrChunks);

      const stdout = truncateBytes(stdoutBuf, options.maxOutputBytes);
      const stderr = truncateBytes(stderrBuf, options.maxOutputBytes);

      finish({
        ok: exitCode === 0,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs,
      });
    });
  });
}
/**
 * Some managers may require interactive sudo. In Phase 2 we do not attempt to prompt.
 */
export function requiresNonInteractiveSudo(managerId: PackageManagerId): boolean {
  return ["apt", "dnf", "yum", "apk", "pacman", "port"].includes(managerId);
}
