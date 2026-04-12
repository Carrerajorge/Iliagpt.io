/**
 * Capability tests — Platform availability (capability 18)
 *
 * Tests cover macOS/Windows platform detection, mobile task dispatch,
 * file size limits, and concurrent user isolation.
 * All platform-specific and I/O operations are mocked or simulated
 * in-process without real filesystem or network calls.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "os";
import { assertHasShape, createTempDir, cleanupTempDir } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface PlatformInfo {
  os: "macos" | "windows" | "linux" | "unknown";
  arch: string;
  version: string;
  isDesktopApp: boolean;
  nativeFileAccess: boolean;
  menuBarIntegration: boolean;
}

interface MobileDispatchRequest {
  taskId: string;
  userId: string;
  fromDevice: "mobile" | "web" | "desktop";
  task: string;
  priority: "normal" | "high";
  callbackUrl?: string;
  sentAt: number;
}

interface DispatchResult {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed";
  assignedTo: "desktop" | "server";
  result?: unknown;
  error?: string;
  completedAt?: number;
}

interface FileSizeValidation {
  allowed: boolean;
  reason?: string;
  suggestedAction?: string;
}

interface ConcurrentSession {
  sessionId: string;
  userId: string;
  startedAt: number;
  lastActiveAt: number;
  isolatedState: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Platform detection utilities
// ---------------------------------------------------------------------------

function detectPlatform(overridePlatform?: NodeJS.Platform): PlatformInfo {
  const platform = overridePlatform ?? process.platform;

  switch (platform) {
    case "darwin":
      return {
        os: "macos",
        arch: process.arch,
        version: process.version,
        isDesktopApp: Boolean(process.env["ELECTRON_RUN_AS_NODE"] ?? process.env["IS_ELECTRON"]),
        nativeFileAccess: true,
        menuBarIntegration: true,
      };
    case "win32":
      return {
        os: "windows",
        arch: process.arch,
        version: process.version,
        isDesktopApp: Boolean(process.env["ELECTRON_RUN_AS_NODE"] ?? process.env["IS_ELECTRON"]),
        nativeFileAccess: true,
        menuBarIntegration: false,
      };
    case "linux":
      return {
        os: "linux",
        arch: process.arch,
        version: process.version,
        isDesktopApp: false,
        nativeFileAccess: true,
        menuBarIntegration: false,
      };
    default:
      return {
        os: "unknown",
        arch: process.arch,
        version: process.version,
        isDesktopApp: false,
        nativeFileAccess: false,
        menuBarIntegration: false,
      };
  }
}

function normalisePath(filePath: string, platform: "macos" | "windows" | "linux"): string {
  if (platform === "windows") {
    return filePath.replace(/\//g, "\\");
  }
  return filePath.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// File size validation
// ---------------------------------------------------------------------------

const FILE_SIZE_LIMITS = {
  maxAllowedBytes: 100 * 1024 * 1024,     // 100 MB
  streamingThresholdBytes: 10 * 1024 * 1024, // 10 MB → stream instead of buffer
  hardLimitBytes: 1024 * 1024 * 1024,     // 1 GB → absolute reject
};

function validateFileSize(sizeBytes: number): FileSizeValidation {
  if (sizeBytes > FILE_SIZE_LIMITS.hardLimitBytes) {
    return {
      allowed: false,
      reason: `File size ${(sizeBytes / (1024 ** 3)).toFixed(2)} GB exceeds the 1 GB hard limit`,
      suggestedAction: "Split the file into smaller chunks before uploading",
    };
  }

  if (sizeBytes > FILE_SIZE_LIMITS.maxAllowedBytes) {
    return {
      allowed: false,
      reason: `File size ${(sizeBytes / (1024 ** 2)).toFixed(0)} MB exceeds the 100 MB upload limit`,
      suggestedAction: "Compress the file or use the streaming API endpoint",
    };
  }

  return { allowed: true };
}

function shouldStreamFile(sizeBytes: number): boolean {
  return sizeBytes >= FILE_SIZE_LIMITS.streamingThresholdBytes;
}

// ---------------------------------------------------------------------------
// Session isolation
// ---------------------------------------------------------------------------

class SessionManager {
  private sessions = new Map<string, ConcurrentSession>();

  createSession(userId: string): ConcurrentSession {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session: ConcurrentSession = {
      sessionId,
      userId,
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      isolatedState: {},
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): ConcurrentSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  updateState(sessionId: string, key: string, value: unknown): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.isolatedState[key] = value;
    session.lastActiveAt = Date.now();
    return true;
  }

  getState(sessionId: string, key: string): unknown {
    return this.sessions.get(sessionId)?.isolatedState[key] ?? undefined;
  }

  getActiveSessions(): ConcurrentSession[] {
    return [...this.sessions.values()];
  }

  terminateSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Mobile dispatch
// ---------------------------------------------------------------------------

class TaskDispatcher {
  private queue: MobileDispatchRequest[] = [];
  private results = new Map<string, DispatchResult>();

  dispatch(request: MobileDispatchRequest): DispatchResult {
    this.queue.push(request);

    const result: DispatchResult = {
      taskId: request.taskId,
      status: "queued",
      assignedTo: "server",
    };

    this.results.set(request.taskId, result);
    return result;
  }

  complete(taskId: string, result: unknown): boolean {
    const existing = this.results.get(taskId);
    if (!existing) return false;

    existing.status = "completed";
    existing.result = result;
    existing.completedAt = Date.now();
    return true;
  }

  fail(taskId: string, error: string): boolean {
    const existing = this.results.get(taskId);
    if (!existing) return false;

    existing.status = "failed";
    existing.error = error;
    existing.completedAt = Date.now();
    return true;
  }

  getResult(taskId: string): DispatchResult | null {
    return this.results.get(taskId) ?? null;
  }

  getQueueLength(): number {
    return this.queue.filter((r) => {
      const result = this.results.get(r.taskId);
      return result?.status === "queued";
    }).length;
  }
}

// ---------------------------------------------------------------------------
// macOS availability
// ---------------------------------------------------------------------------

describe("macOS availability", () => {
  it("detects macOS platform and reports correct capabilities", () => {
    const info = detectPlatform("darwin");

    expect(info.os).toBe("macos");
    expect(info.nativeFileAccess).toBe(true);
    expect(info.menuBarIntegration).toBe(true);
    assertHasShape(info, {
      os: "string",
      arch: "string",
      version: "string",
      isDesktopApp: "boolean",
      nativeFileAccess: "boolean",
      menuBarIntegration: "boolean",
    });
  });

  it("detects desktop app mode when ELECTRON env variable is set", () => {
    const originalEnv = process.env["IS_ELECTRON"];
    process.env["IS_ELECTRON"] = "true";

    const info = detectPlatform("darwin");
    expect(info.isDesktopApp).toBe(true);

    if (originalEnv === undefined) {
      delete process.env["IS_ELECTRON"];
    } else {
      process.env["IS_ELECTRON"] = originalEnv;
    }
  });

  it("confirms menu bar integration is available on macOS only", () => {
    const macos = detectPlatform("darwin");
    const windows = detectPlatform("win32");
    const linux = detectPlatform("linux");

    expect(macos.menuBarIntegration).toBe(true);
    expect(windows.menuBarIntegration).toBe(false);
    expect(linux.menuBarIntegration).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Windows availability
// ---------------------------------------------------------------------------

describe("Windows availability", () => {
  it("detects Windows platform and reports correct capabilities", () => {
    const info = detectPlatform("win32");

    expect(info.os).toBe("windows");
    expect(info.nativeFileAccess).toBe(true);
    expect(info.menuBarIntegration).toBe(false);
  });

  it("normalises Windows paths with backslashes", () => {
    const posixPath = "/Users/alice/Documents/report.xlsx";
    const windowsPath = normalisePath(posixPath, "windows");

    expect(windowsPath).toContain("\\");
    expect(windowsPath).not.toContain("/");
  });

  it("handles Windows-style paths with drive letters", () => {
    function isWindowsAbsolutePath(p: string): boolean {
      return /^[A-Za-z]:[\\\/]/.test(p);
    }

    expect(isWindowsAbsolutePath("C:\\Users\\Alice\\file.txt")).toBe(true);
    expect(isWindowsAbsolutePath("D:/Projects/app")).toBe(true);
    expect(isWindowsAbsolutePath("/usr/local/bin")).toBe(false);
    expect(isWindowsAbsolutePath("relative/path")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mobile dispatch
// ---------------------------------------------------------------------------

describe("Mobile dispatch", () => {
  let dispatcher: TaskDispatcher;

  beforeEach(() => {
    dispatcher = new TaskDispatcher();
  });

  it("dispatches a task from mobile to be handled by the server", () => {
    const request: MobileDispatchRequest = {
      taskId: "task_mob_001",
      userId: "user_001",
      fromDevice: "mobile",
      task: "Generate Q2 sales report and email to alice@company.com",
      priority: "normal",
      callbackUrl: "https://app.example.com/webhook/tasks",
      sentAt: Date.now(),
    };

    const result = dispatcher.dispatch(request);

    assertHasShape(result, {
      taskId: "string",
      status: "string",
      assignedTo: "string",
    });
    expect(result.status).toBe("queued");
    expect(result.taskId).toBe("task_mob_001");
  });

  it("marks a dispatched task as completed and stores the result", () => {
    const request: MobileDispatchRequest = {
      taskId: "task_mob_002",
      userId: "user_002",
      fromDevice: "mobile",
      task: "Summarise the last 10 support tickets",
      priority: "high",
      sentAt: Date.now(),
    };

    dispatcher.dispatch(request);
    const completed = dispatcher.complete("task_mob_002", { summary: "10 tickets summarised", topIssue: "Login errors" });

    expect(completed).toBe(true);

    const result = dispatcher.getResult("task_mob_002");
    expect(result?.status).toBe("completed");
    expect(result?.completedAt).toBeDefined();
    expect((result?.result as Record<string, unknown>)?.topIssue).toBe("Login errors");
  });

  it("returns null for a result lookup on unknown task IDs", () => {
    const result = dispatcher.getResult("nonexistent_task");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File size limits
// ---------------------------------------------------------------------------

describe("File size limits", () => {
  it("allows a 100 MB file (boundary condition)", () => {
    const exactly100MB = 100 * 1024 * 1024;
    const result = validateFileSize(exactly100MB);
    expect(result.allowed).toBe(true);
  });

  it("rejects a 1 GB file with a clear error message and suggested action", () => {
    const oneGB = 1024 * 1024 * 1024;
    const result = validateFileSize(oneGB);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason?.length).toBeGreaterThan(0);
    expect(result.suggestedAction).toBeDefined();
  });

  it("rejects a file larger than 100 MB but smaller than 1 GB with appropriate message", () => {
    const fiveHundredMB = 500 * 1024 * 1024;
    const result = validateFileSize(fiveHundredMB);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("100 MB");
  });

  it("recommends streaming for files above the streaming threshold", () => {
    const smallFile = 5 * 1024 * 1024;    // 5 MB
    const largeFile = 50 * 1024 * 1024;   // 50 MB

    expect(shouldStreamFile(smallFile)).toBe(false);
    expect(shouldStreamFile(largeFile)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Concurrent users
// ---------------------------------------------------------------------------

describe("Concurrent users", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it("creates isolated sessions for multiple simultaneous users", () => {
    const s1 = manager.createSession("user_001");
    const s2 = manager.createSession("user_002");
    const s3 = manager.createSession("user_003");

    expect(s1.sessionId).not.toBe(s2.sessionId);
    expect(s2.sessionId).not.toBe(s3.sessionId);
    expect(manager.getActiveSessions()).toHaveLength(3);
  });

  it("isolates state between sessions — writes do not leak", () => {
    const s1 = manager.createSession("user_001");
    const s2 = manager.createSession("user_002");

    manager.updateState(s1.sessionId, "currentFile", "/docs/user1_report.pdf");
    manager.updateState(s2.sessionId, "currentFile", "/docs/user2_analysis.xlsx");

    expect(manager.getState(s1.sessionId, "currentFile")).toBe("/docs/user1_report.pdf");
    expect(manager.getState(s2.sessionId, "currentFile")).toBe("/docs/user2_analysis.xlsx");

    // Verify no cross-contamination
    manager.updateState(s1.sessionId, "secret", "session1_data");
    expect(manager.getState(s2.sessionId, "secret")).toBeUndefined();
  });

  it("handles concurrent session creation without ID collisions", () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      manager.createSession(`user_${i}`),
    );

    const ids = new Set(sessions.map((s) => s.sessionId));
    expect(ids.size).toBe(50); // all unique
  });
});
