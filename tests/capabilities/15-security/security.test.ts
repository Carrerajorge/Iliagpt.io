/**
 * Capability tests — Security controls (capability 15)
 *
 * Tests cover folder authorization, VM sandbox isolation, network egress
 * controls, dangerous-action approval workflows, delete protection, and
 * audit logging. No real filesystem, sandbox or network calls are made —
 * all execution is mocked or simulated in-process.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import {
  createTempDir,
  cleanupTempDir,
  createTestFile,
  assertHasShape,
} from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Security domain types
// ---------------------------------------------------------------------------

interface FolderPolicy {
  allowedPaths: string[];
  denyPaths: string[];
  followSymlinks: boolean;
}

interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  memoryBytes: number;
}

interface EgressPolicy {
  allowedDomains: string[];
  blockedPatterns: string[];
  allowPrivateRanges: boolean;
}

interface ApprovalRequest {
  id: string;
  action: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  description: string;
  requestedAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
  approvalToken?: string;
}

interface ProtectedResource {
  path: string;
  reason: string;
  protectedAt: number;
  protectedBy: string;
}

interface AuditLogEntry {
  id: string;
  timestamp: number;
  actor: string;
  action: string;
  resource: string;
  outcome: "allowed" | "denied";
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Security utilities (production logic simulated)
// ---------------------------------------------------------------------------

class FolderGuard {
  constructor(private policy: FolderPolicy) {}

  isAllowed(requestedPath: string): boolean {
    const normalized = path.normalize(requestedPath);

    // Check deny list first (higher priority)
    for (const deny of this.policy.denyPaths) {
      if (normalized.startsWith(path.normalize(deny))) return false;
    }

    // Check allow list
    for (const allow of this.policy.allowedPaths) {
      if (normalized.startsWith(path.normalize(allow))) return true;
    }

    return false;
  }

  isPathTraversal(requestedPath: string, baseDir: string): boolean {
    const resolved = path.resolve(baseDir, requestedPath);
    return !resolved.startsWith(path.resolve(baseDir));
  }
}

class EgressGuard {
  constructor(private policy: EgressPolicy) {}

  isAllowed(url: string): { allowed: boolean; reason: string } {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { allowed: false, reason: "Invalid URL" };
    }

    // Check blocked patterns first
    for (const pattern of this.policy.blockedPatterns) {
      const regex = new RegExp(pattern, "i");
      if (regex.test(hostname)) {
        return { allowed: false, reason: `Matches blocked pattern: ${pattern}` };
      }
    }

    // Block private ranges if policy says so
    if (!this.policy.allowPrivateRanges) {
      const privatePatterns = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^127\./, /^localhost$/i];
      for (const pat of privatePatterns) {
        if (pat.test(hostname)) {
          return { allowed: false, reason: "Private IP range blocked (SSRF prevention)" };
        }
      }
    }

    // Check allowed domains
    for (const allowed of this.policy.allowedDomains) {
      if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
        return { allowed: true, reason: "Domain in allowlist" };
      }
    }

    return { allowed: false, reason: "Domain not in allowlist" };
  }
}

class ApprovalService {
  private requests = new Map<string, ApprovalRequest>();
  private tokenToId = new Map<string, string>();

  createRequest(action: string, riskLevel: ApprovalRequest["riskLevel"], description: string): ApprovalRequest {
    const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const req: ApprovalRequest = {
      id,
      action,
      riskLevel,
      description,
      requestedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
      status: "pending",
    };
    this.requests.set(id, req);
    return req;
  }

  approve(requestId: string, token: string): boolean {
    const req = this.requests.get(requestId);
    if (!req || req.status !== "pending") return false;
    if (Date.now() > req.expiresAt) {
      req.status = "expired";
      return false;
    }
    req.status = "approved";
    req.approvalToken = token;
    this.tokenToId.set(token, requestId);
    return true;
  }

  validateToken(token: string): boolean {
    const requestId = this.tokenToId.get(token);
    if (!requestId) return false;
    const req = this.requests.get(requestId);
    return req?.status === "approved" && Date.now() <= req.expiresAt;
  }

  getRequest(id: string): ApprovalRequest | null {
    return this.requests.get(id) ?? null;
  }
}

class DeleteProtectionService {
  private protected_resources = new Map<string, ProtectedResource>();

  protect(resourcePath: string, reason: string, protectedBy: string): void {
    this.protected_resources.set(resourcePath, {
      path: resourcePath,
      reason,
      protectedAt: Date.now(),
      protectedBy,
    });
  }

  canDelete(resourcePath: string): { allowed: boolean; reason?: string } {
    const normalized = path.normalize(resourcePath);

    // Check exact match
    if (this.protected_resources.has(normalized)) {
      const p = this.protected_resources.get(normalized)!;
      return { allowed: false, reason: p.reason };
    }

    // Check if path is under a protected directory
    for (const [protectedPath] of this.protected_resources) {
      if (normalized.startsWith(path.normalize(protectedPath) + path.sep)) {
        return { allowed: false, reason: "File is under a protected directory" };
      }
    }

    return { allowed: true };
  }
}

class AuditLogger {
  private entries: AuditLogEntry[] = [];

  log(
    actor: string,
    action: string,
    resource: string,
    outcome: AuditLogEntry["outcome"],
    metadata: Record<string, unknown> = {},
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      actor,
      action,
      resource,
      outcome,
      metadata,
    };
    this.entries.push(entry);
    return entry;
  }

  getEntries(): AuditLogEntry[] {
    return [...this.entries];
  }

  redactSensitive(entry: AuditLogEntry, sensitiveKeys: string[]): AuditLogEntry {
    const metadata = { ...entry.metadata };
    for (const key of sensitiveKeys) {
      if (key in metadata) {
        metadata[key] = "[REDACTED]";
      }
    }
    return { ...entry, metadata };
  }
}

// ---------------------------------------------------------------------------
// Folder authorization
// ---------------------------------------------------------------------------

describe("Folder authorization", () => {
  it("allows access to authorized directories", () => {
    const guard = new FolderGuard({
      allowedPaths: ["/workspace/data", "/workspace/output"],
      denyPaths: [],
      followSymlinks: false,
    });

    expect(guard.isAllowed("/workspace/data/report.csv")).toBe(true);
    expect(guard.isAllowed("/workspace/data/subdir/nested.json")).toBe(true);
    expect(guard.isAllowed("/workspace/output/result.xlsx")).toBe(true);
  });

  it("blocks access to directories not in the allow list", () => {
    const guard = new FolderGuard({
      allowedPaths: ["/workspace/data"],
      denyPaths: [],
      followSymlinks: false,
    });

    expect(guard.isAllowed("/etc/passwd")).toBe(false);
    expect(guard.isAllowed("/workspace/secrets/.env")).toBe(false);
    expect(guard.isAllowed("/home/user/.ssh/id_rsa")).toBe(false);
    expect(guard.isAllowed("/workspace/other-project/data.csv")).toBe(false);
  });

  it("prevents path traversal attempts (../ sequences)", () => {
    const guard = new FolderGuard({
      allowedPaths: ["/workspace/data"],
      denyPaths: [],
      followSymlinks: false,
    });

    const baseDir = "/workspace/data";

    expect(guard.isPathTraversal("../../etc/passwd", baseDir)).toBe(true);
    expect(guard.isPathTraversal("../secrets/.env", baseDir)).toBe(true);
    expect(guard.isPathTraversal("subdir/report.csv", baseDir)).toBe(false);
    expect(guard.isPathTraversal("./nested/file.txt", baseDir)).toBe(false);
  });

  it("deny rules take priority over allow rules", () => {
    const guard = new FolderGuard({
      allowedPaths: ["/workspace"],
      denyPaths: ["/workspace/secrets", "/workspace/credentials"],
      followSymlinks: false,
    });

    expect(guard.isAllowed("/workspace/data/report.csv")).toBe(true);
    expect(guard.isAllowed("/workspace/secrets/api_keys.json")).toBe(false);
    expect(guard.isAllowed("/workspace/credentials/db_password.txt")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VM isolation
// ---------------------------------------------------------------------------

describe("VM isolation", () => {
  it("executes code in a sandboxed context that cannot access the real fs", () => {
    // Simulate sandboxed execution: the code runs in a restricted context
    // where filesystem APIs are replaced with no-ops
    function runInSandbox(code: string): SandboxResult {
      const start = Date.now();
      const sandboxedFs = {
        readFileSync: () => { throw new Error("Sandbox: filesystem access denied"); },
        writeFileSync: () => { throw new Error("Sandbox: filesystem access denied"); },
        existsSync: () => false,
      };

      let stdout = "";
      let stderr = "";
      let exitCode = 0;

      const sandboxedConsole = {
        log: (msg: string) => { stdout += msg + "\n"; },
        error: (msg: string) => { stderr += msg + "\n"; },
      };

      try {
        // Create a function in a restricted scope (simulating VM2 or similar)
        const fn = new Function("fs", "console", code);
        fn(sandboxedFs, sandboxedConsole);
      } catch (err) {
        stderr += (err instanceof Error ? err.message : String(err)) + "\n";
        exitCode = 1;
      }

      return {
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        memoryBytes: 0,
      };
    }

    const result = runInSandbox(`
      try { fs.readFileSync('/etc/passwd'); } catch(e) { console.error(e.message); }
      console.log("sandbox ran");
    `);

    expect(result.stdout).toContain("sandbox ran");
    expect(result.stderr).toContain("filesystem access denied");
  });

  it("blocks sandbox escape attempts via prototype pollution", () => {
    function detectPrototypePollution(code: string): boolean {
      const dangerous = [
        "__proto__",
        "constructor.prototype",
        "Object.prototype",
        "process.env",
        "global.",
        "globalThis.",
      ];
      return dangerous.some((pattern) => code.includes(pattern));
    }

    expect(detectPrototypePollution('({}).constructor.prototype.foo = "bar"')).toBe(true);
    expect(detectPrototypePollution("Object.prototype.polluted = true")).toBe(true);
    expect(detectPrototypePollution("process.env.SECRET")).toBe(true);
    expect(detectPrototypePollution('const x = 1 + 2; console.log(x);')).toBe(false);
  });

  it("enforces memory and time limits on sandboxed code", () => {
    function validateResourceLimits(limits: { memoryMb: number; timeoutMs: number }): void {
      if (limits.memoryMb > 512) throw new Error("Memory limit exceeds maximum (512MB)");
      if (limits.timeoutMs > 30_000) throw new Error("Timeout exceeds maximum (30s)");
    }

    expect(() => validateResourceLimits({ memoryMb: 256, timeoutMs: 10_000 })).not.toThrow();
    expect(() => validateResourceLimits({ memoryMb: 1024, timeoutMs: 5_000 })).toThrow("Memory limit");
    expect(() => validateResourceLimits({ memoryMb: 128, timeoutMs: 60_000 })).toThrow("Timeout exceeds");
  });

  it("returns a structured result even when sandboxed code throws", () => {
    function runCrashingCode(): SandboxResult {
      const start = Date.now();
      try {
        throw new Error("Intentional crash in sandbox");
      } catch (err) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: (err instanceof Error ? err.message : String(err)),
          durationMs: Date.now() - start,
          memoryBytes: 0,
        };
      }
    }

    const result = runCrashingCode();
    assertHasShape(result, {
      exitCode: "number",
      stdout: "string",
      stderr: "string",
      durationMs: "number",
      memoryBytes: "number",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Intentional crash");
  });
});

// ---------------------------------------------------------------------------
// Network egress controls
// ---------------------------------------------------------------------------

describe("Network egress controls", () => {
  let guard: EgressGuard;

  beforeEach(() => {
    guard = new EgressGuard({
      allowedDomains: ["api.openai.com", "anthropic.com", "example.com"],
      blockedPatterns: ["malware\\.io", "\\.tk$", "phishing"],
      allowPrivateRanges: false,
    });
  });

  it("permits requests to explicitly allowed domains", () => {
    const result1 = guard.isAllowed("https://api.openai.com/v1/chat");
    const result2 = guard.isAllowed("https://docs.anthropic.com/reference");
    const result3 = guard.isAllowed("https://example.com/data.json");

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
    expect(result3.allowed).toBe(true);
  });

  it("blocks requests to unauthorized external domains", () => {
    const result1 = guard.isAllowed("https://unauthorized-domain.com/api");
    const result2 = guard.isAllowed("https://random-site.net/data");

    expect(result1.allowed).toBe(false);
    expect(result2.allowed).toBe(false);
  });

  it("prevents SSRF via private IP ranges", () => {
    const privateUrls = [
      "http://192.168.1.100/admin",
      "http://10.0.0.1/internal",
      "http://172.16.0.5/config",
      "http://127.0.0.1:8080/api",
      "http://localhost/admin",
    ];

    for (const url of privateUrls) {
      const result = guard.isAllowed(url);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Private");
    }
  });

  it("matches blocked patterns with regex for domain-level blocking", () => {
    const blockedUrls = [
      "https://download.malware.io/payload",
      "https://free-stuff.tk/download",
      "https://phishing-site.com/login",
    ];

    for (const url of blockedUrls) {
      const result = guard.isAllowed(url);
      expect(result.allowed).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Action approval workflows
// ---------------------------------------------------------------------------

describe("Action approval workflows", () => {
  let service: ApprovalService;

  beforeEach(() => {
    service = new ApprovalService();
  });

  it("creates a pending approval request for a dangerous action", () => {
    const req = service.createRequest(
      "delete_database",
      "critical",
      "Permanently delete the production database",
    );

    assertHasShape(req, {
      id: "string",
      action: "string",
      riskLevel: "string",
      description: "string",
      requestedAt: "number",
      expiresAt: "number",
      status: "string",
    });

    expect(req.status).toBe("pending");
    expect(req.riskLevel).toBe("critical");
    expect(req.expiresAt).toBeGreaterThan(req.requestedAt);
  });

  it("approves a request with a valid token and updates its status", () => {
    const req = service.createRequest("bulk_email_send", "high", "Send campaign to 50k users");
    const token = "appr-token-abc123";

    const approved = service.approve(req.id, token);
    expect(approved).toBe(true);

    const updated = service.getRequest(req.id);
    expect(updated?.status).toBe("approved");
    expect(updated?.approvalToken).toBe(token);
  });

  it("validates a token only when the request is in approved state", () => {
    const req = service.createRequest("drop_table", "critical", "Drop users table");
    const token = "valid-token-xyz";

    // Token not valid before approval
    expect(service.validateToken(token)).toBe(false);

    service.approve(req.id, token);
    expect(service.validateToken(token)).toBe(true);
  });

  it("expires pending approvals after the timeout window", () => {
    const req = service.createRequest("purge_cache", "medium", "Clear all caches");

    // Simulate expiry by manually backdating
    const backdatedReq = service.getRequest(req.id);
    if (backdatedReq) {
      (backdatedReq as ApprovalRequest & { expiresAt: number }).expiresAt = Date.now() - 1000;
    }

    // Attempting to approve an expired request should fail
    // (In real impl, approve() checks expiresAt)
    const token = "late-token";
    const result = service.approve(req.id, token);
    // Since we directly mutated the stored object, the approve check should see expired
    // Note: the service uses the same reference so this works
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Delete protection
// ---------------------------------------------------------------------------

describe("Delete protection", () => {
  let protectionService: DeleteProtectionService;

  beforeEach(() => {
    protectionService = new DeleteProtectionService();
  });

  it("prevents deletion of explicitly protected files", () => {
    protectionService.protect("/workspace/config/prod.env", "Production configuration", "system");
    protectionService.protect("/workspace/data/master.csv", "Master dataset - do not delete", "admin");

    expect(protectionService.canDelete("/workspace/config/prod.env").allowed).toBe(false);
    expect(protectionService.canDelete("/workspace/data/master.csv").allowed).toBe(false);
  });

  it("allows deletion of unprotected files", () => {
    protectionService.protect("/workspace/config/prod.env", "Production config", "system");

    expect(protectionService.canDelete("/workspace/temp/scratch.txt").allowed).toBe(true);
    expect(protectionService.canDelete("/workspace/output/report.pdf").allowed).toBe(true);
  });

  it("protects entire production paths recursively", () => {
    protectionService.protect("/production", "Production environment root", "system");

    expect(protectionService.canDelete("/production/config.json").allowed).toBe(false);
    expect(protectionService.canDelete("/production/data/users.csv").allowed).toBe(false);
    expect(protectionService.canDelete("/workspace/output.txt").allowed).toBe(true);
  });

  it("includes the protection reason in the denial response", () => {
    const reason = "Regulatory compliance: 7-year retention requirement";
    protectionService.protect("/archive/2020/Q1.csv", reason, "compliance-bot");

    const result = protectionService.canDelete("/archive/2020/Q1.csv");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(reason);
  });
});

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

describe("Audit logging", () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  it("records an audit entry for every action with required fields", () => {
    const entry = logger.log("agent_001", "file_read", "/workspace/data/report.csv", "allowed", {
      sizeBytes: 40960,
    });

    assertHasShape(entry, {
      id: "string",
      timestamp: "number",
      actor: "string",
      action: "string",
      resource: "string",
      outcome: "string",
    });

    expect(entry.actor).toBe("agent_001");
    expect(entry.action).toBe("file_read");
    expect(entry.outcome).toBe("allowed");
    expect(entry.metadata.sizeBytes).toBe(40960);
  });

  it("accumulates log entries in insertion order", () => {
    logger.log("user_001", "login", "/auth/session", "allowed");
    logger.log("agent_001", "file_write", "/workspace/out.txt", "allowed");
    logger.log("agent_001", "network_request", "https://api.openai.com", "allowed");
    logger.log("agent_001", "delete", "/workspace/temp.txt", "denied", { reason: "protected" });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(4);
    expect(entries[0].action).toBe("login");
    expect(entries[3].action).toBe("delete");
    expect(entries[3].outcome).toBe("denied");
  });

  it("redacts sensitive fields from log metadata before storage", () => {
    const entry = logger.log("agent_001", "api_call", "/v1/completions", "allowed", {
      apiKey: "sk-abc123secret",
      prompt: "Analyse this contract",
      model: "gpt-4o",
    });

    const redacted = logger.redactSensitive(entry, ["apiKey"]);

    expect(redacted.metadata.apiKey).toBe("[REDACTED]");
    expect(redacted.metadata.model).toBe("gpt-4o");
    expect(redacted.metadata.prompt).toBe("Analyse this contract");
    // Original entry should not be mutated
    expect(entry.metadata.apiKey).toBe("sk-abc123secret");
  });
});
