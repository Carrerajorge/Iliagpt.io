import * as path from 'path';

export type PermissionMode = 'read_only' | 'workspace' | 'full_access';

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

export interface AuditEntry {
  userId: string;
  toolName: string;
  input: any;
  result: PermissionResult;
  timestamp: Date;
}

const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_files', 'web_search', 'web_fetch',
  'search_files', 'glob_files', 'get_file_info',
]);

const WORKSPACE_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'write_file', 'edit_file', 'create_file', 'rename_file',
]);

const DANGEROUS_TOOLS = new Set([
  'bash', 'shell', 'exec', 'run_command', 'delete_file',
  'rm', 'sudo', 'system', 'kill_process',
]);

const AUDIT_BUFFER_SIZE = 1000;
const DEFAULT_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

interface RateBucket {
  count: number;
  windowStart: number;
}

export class ClawPermissionEnforcer {
  private modes = new Map<string, PermissionMode>();
  private auditLog: AuditEntry[] = [];
  private rateBuckets = new Map<string, RateBucket>();
  private rateLimit: number;
  private workspaceRoot: string;

  constructor(workspaceRoot?: string, rateLimit?: number) {
    this.workspaceRoot = workspaceRoot ?? path.join(process.cwd(), 'workspaces');
    this.rateLimit = rateLimit ?? DEFAULT_RATE_LIMIT;
  }

  check(userId: string, toolName: string, input: any): PermissionResult {
    const rateResult = this.checkRateLimit(userId);
    if (!rateResult.allowed) {
      this.addAuditLog({ userId, toolName, input, result: rateResult, timestamp: new Date() });
      return rateResult;
    }

    const mode = this.getMode(userId);
    let result: PermissionResult;

    switch (mode) {
      case 'read_only':
        result = this.checkReadOnly(toolName);
        break;
      case 'workspace':
        result = this.checkWorkspace(userId, toolName, input);
        break;
      case 'full_access':
        result = { allowed: true };
        break;
      default:
        result = { allowed: false, reason: `Unknown permission mode: ${mode}` };
    }

    this.addAuditLog({ userId, toolName, input, result, timestamp: new Date() });
    return result;
  }

  setMode(userId: string, mode: PermissionMode): void {
    this.modes.set(userId, mode);
  }

  getMode(userId: string): PermissionMode {
    return this.modes.get(userId) ?? 'read_only';
  }

  addAuditLog(entry: AuditEntry): void {
    this.auditLog.push(entry);
    if (this.auditLog.length > AUDIT_BUFFER_SIZE) {
      this.auditLog = this.auditLog.slice(-AUDIT_BUFFER_SIZE);
    }
  }

  getAuditLog(userId: string, limit?: number): AuditEntry[] {
    const entries = this.auditLog.filter((e) => e.userId === userId);
    if (limit !== undefined && limit > 0) {
      return entries.slice(-limit);
    }
    return entries;
  }

  private checkReadOnly(toolName: string): PermissionResult {
    if (READ_ONLY_TOOLS.has(toolName)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Tool "${toolName}" is not allowed in read_only mode` };
  }

  private checkWorkspace(userId: string, toolName: string, input: any): PermissionResult {
    if (DANGEROUS_TOOLS.has(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is blocked in workspace mode` };
    }

    if (!WORKSPACE_TOOLS.has(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is not allowed in workspace mode` };
    }

    const writableTools = new Set(['write_file', 'edit_file', 'create_file', 'rename_file']);
    if (writableTools.has(toolName)) {
      const boundaryResult = this.checkWorkspaceBoundary(userId, input);
      if (!boundaryResult.allowed) return boundaryResult;
    }

    return { allowed: true };
  }

  private checkWorkspaceBoundary(userId: string, input: any): PermissionResult {
    const filePath = input?.path ?? input?.file_path ?? input?.filePath ?? input?.target;
    if (!filePath || typeof filePath !== 'string') {
      return { allowed: false, reason: 'No file path provided for workspace boundary check' };
    }

    const resolved = path.resolve(filePath);
    const userWorkspace = path.join(this.workspaceRoot, userId);

    if (!resolved.startsWith(userWorkspace + path.sep) && resolved !== userWorkspace) {
      return {
        allowed: false,
        reason: `Path "${resolved}" is outside workspace boundary "${userWorkspace}"`,
      };
    }

    if (resolved.includes('..') || resolved.includes('\0')) {
      return { allowed: false, reason: 'Path contains disallowed traversal sequences' };
    }

    return { allowed: true };
  }

  private checkRateLimit(userId: string): PermissionResult {
    const now = Date.now();
    const bucket = this.rateBuckets.get(userId);

    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
      this.rateBuckets.set(userId, { count: 1, windowStart: now });
      return { allowed: true };
    }

    bucket.count++;
    if (bucket.count > this.rateLimit) {
      const retryAfterSec = Math.ceil((bucket.windowStart + RATE_WINDOW_MS - now) / 1000);
      return {
        allowed: false,
        reason: `Rate limit exceeded (${this.rateLimit}/min). Retry after ${retryAfterSec}s`,
      };
    }

    return { allowed: true };
  }
}

export const permissionEnforcer = new ClawPermissionEnforcer();
