import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

export interface WorkspaceConfig {
  path: string;
  permissions: {
    read: boolean;
    write: boolean;
    delete: boolean;
  };
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  userId: string;
  operation: string;
  filePath: string;
  result: "success" | "denied" | "error";
  details?: string;
  bytesTransferred?: number;
}

export interface FileProvenance {
  filePath: string;
  createdAt: number;
  lastModifiedAt: number;
  modificationHistory: Array<{
    timestamp: number;
    userId: string;
    operation: string;
    hash: string;
  }>;
  source: string;
}

export interface FileStat {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  createdAt: number;
  modifiedAt: number;
  hash?: string;
}

export interface GatewayStats {
  totalReads: number;
  totalWrites: number;
  totalDeletes: number;
  totalSearches: number;
  bytesRead: number;
  bytesWritten: number;
  blockedAttempts: number;
  pathTraversalBlocks: number;
}

export interface SearchResult {
  filePath: string;
  matches: Array<{
    line: number;
    content: string;
  }>;
}

const MAX_READ_SIZE = 5 * 1024 * 1024;
const MAX_WRITE_SIZE = 10 * 1024 * 1024;
const MAX_AUDIT_ENTRIES = 2000;

export class SecureFileGateway extends EventEmitter {
  private workspaces: Map<string, WorkspaceConfig> = new Map();
  private auditLog: AuditEntry[] = [];
  private provenanceMap: Map<string, FileProvenance> = new Map();
  private stats: GatewayStats = {
    totalReads: 0,
    totalWrites: 0,
    totalDeletes: 0,
    totalSearches: 0,
    bytesRead: 0,
    bytesWritten: 0,
    blockedAttempts: 0,
    pathTraversalBlocks: 0,
  };

  constructor() {
    super();
    this.addWorkspace("default", {
      path: path.resolve(process.cwd(), "server", "agent", "workspace"),
      permissions: { read: true, write: true, delete: true },
    });
    this.addWorkspace("project", {
      path: path.resolve(process.cwd()),
      permissions: { read: true, write: false, delete: false },
    });
  }

  addWorkspace(name: string, config: WorkspaceConfig): void {
    const resolved = path.resolve(config.path);
    this.workspaces.set(name, { ...config, path: resolved });
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
  }

  private resolveAndValidate(
    filePath: string,
    workspace: string,
    requiredPermission: "read" | "write" | "delete"
  ): { resolvedPath: string; config: WorkspaceConfig } | { error: string } {
    const config = this.workspaces.get(workspace);
    if (!config) {
      return { error: `Unknown workspace: ${workspace}` };
    }
    if (!config.permissions[requiredPermission]) {
      this.stats.blockedAttempts++;
      return { error: `Permission denied: ${requiredPermission} not allowed on workspace '${workspace}'` };
    }
    const resolved = path.resolve(config.path, filePath);
    if (!resolved.startsWith(config.path)) {
      this.stats.blockedAttempts++;
      this.stats.pathTraversalBlocks++;
      this.audit("system", "path_traversal_blocked", filePath, "denied", `Attempted path: ${resolved}`);
      return { error: "Path traversal detected and blocked" };
    }
    return { resolvedPath: resolved, config };
  }

  private audit(
    userId: string,
    operation: string,
    filePath: string,
    result: "success" | "denied" | "error",
    details?: string,
    bytesTransferred?: number
  ): void {
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      userId,
      operation,
      filePath,
      result,
      details,
      bytesTransferred,
    };
    this.auditLog.push(entry);
    if (this.auditLog.length > MAX_AUDIT_ENTRIES) {
      this.auditLog.shift();
    }
    this.emit("audit", entry);
  }

  private trackProvenance(
    filePath: string,
    userId: string,
    operation: string,
    hash: string,
    source: string = "agent"
  ): void {
    const existing = this.provenanceMap.get(filePath);
    const now = Date.now();
    if (existing) {
      existing.lastModifiedAt = now;
      existing.modificationHistory.push({ timestamp: now, userId, operation, hash });
      if (existing.modificationHistory.length > 100) {
        existing.modificationHistory.shift();
      }
    } else {
      this.provenanceMap.set(filePath, {
        filePath,
        createdAt: now,
        lastModifiedAt: now,
        modificationHistory: [{ timestamp: now, userId, operation, hash }],
        source,
      });
    }
  }

  async list(
    dirPath: string = ".",
    workspace: string = "default",
    userId: string = "system"
  ): Promise<{ files: FileStat[] } | { error: string }> {
    const validation = this.resolveAndValidate(dirPath, workspace, "read");
    if ("error" in validation) {
      this.audit(userId, "list", dirPath, "denied", validation.error);
      return { error: validation.error };
    }
    try {
      const { resolvedPath } = validation;
      if (!fs.existsSync(resolvedPath)) {
        this.audit(userId, "list", dirPath, "error", "Directory not found");
        return { error: "Directory not found" };
      }
      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      const files: FileStat[] = entries.map((entry) => {
        const fullPath = path.join(resolvedPath, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          return {
            name: entry.name,
            path: path.relative(validation.config.path, fullPath),
            size: stat.size,
            isDirectory: entry.isDirectory(),
            createdAt: stat.birthtimeMs,
            modifiedAt: stat.mtimeMs,
          };
        } catch {
          return {
            name: entry.name,
            path: path.relative(validation.config.path, fullPath),
            size: 0,
            isDirectory: entry.isDirectory(),
            createdAt: 0,
            modifiedAt: 0,
          };
        }
      });
      this.stats.totalReads++;
      this.audit(userId, "list", dirPath, "success", `${files.length} entries`);
      return { files };
    } catch (err: any) {
      this.audit(userId, "list", dirPath, "error", err.message);
      return { error: err.message };
    }
  }

  async read(
    filePath: string,
    workspace: string = "default",
    userId: string = "system"
  ): Promise<{ content: string; size: number; hash: string; truncated: boolean } | { error: string }> {
    const validation = this.resolveAndValidate(filePath, workspace, "read");
    if ("error" in validation) {
      this.audit(userId, "read", filePath, "denied", validation.error);
      return { error: validation.error };
    }
    try {
      const { resolvedPath } = validation;
      if (!fs.existsSync(resolvedPath)) {
        this.audit(userId, "read", filePath, "error", "File not found");
        return { error: "File not found" };
      }
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return { error: "Cannot read a directory" };
      }
      let truncated = false;
      let content: string;
      if (stat.size > MAX_READ_SIZE) {
        const buffer = Buffer.alloc(MAX_READ_SIZE);
        const fd = fs.openSync(resolvedPath, "r");
        fs.readSync(fd, buffer, 0, MAX_READ_SIZE, 0);
        fs.closeSync(fd);
        content = buffer.toString("utf-8");
        truncated = true;
      } else {
        content = fs.readFileSync(resolvedPath, "utf-8");
      }
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      this.stats.totalReads++;
      this.stats.bytesRead += content.length;
      this.audit(userId, "read", filePath, "success", truncated ? "truncated" : undefined, content.length);
      return { content, size: stat.size, hash, truncated };
    } catch (err: any) {
      this.audit(userId, "read", filePath, "error", err.message);
      return { error: err.message };
    }
  }

  async write(
    filePath: string,
    content: string,
    workspace: string = "default",
    userId: string = "system"
  ): Promise<{ success: boolean; hash: string; size: number } | { error: string }> {
    const validation = this.resolveAndValidate(filePath, workspace, "write");
    if ("error" in validation) {
      this.audit(userId, "write", filePath, "denied", validation.error);
      return { error: validation.error };
    }
    try {
      const { resolvedPath } = validation;
      const bytes = Buffer.byteLength(content, "utf-8");
      if (bytes > MAX_WRITE_SIZE) {
        this.stats.blockedAttempts++;
        this.audit(userId, "write", filePath, "denied", `File too large: ${bytes} bytes`);
        return { error: `File exceeds maximum write size of ${MAX_WRITE_SIZE} bytes` };
      }
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, content, "utf-8");
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      this.stats.totalWrites++;
      this.stats.bytesWritten += bytes;
      this.trackProvenance(filePath, userId, "write", hash);
      this.audit(userId, "write", filePath, "success", undefined, bytes);
      return { success: true, hash, size: bytes };
    } catch (err: any) {
      this.audit(userId, "write", filePath, "error", err.message);
      return { error: err.message };
    }
  }

  async delete(
    filePath: string,
    workspace: string = "default",
    userId: string = "system"
  ): Promise<{ success: boolean } | { error: string }> {
    const validation = this.resolveAndValidate(filePath, workspace, "delete");
    if ("error" in validation) {
      this.audit(userId, "delete", filePath, "denied", validation.error);
      return { error: validation.error };
    }
    try {
      const { resolvedPath } = validation;
      if (!fs.existsSync(resolvedPath)) {
        this.audit(userId, "delete", filePath, "error", "File not found");
        return { error: "File not found" };
      }
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return { error: "Cannot delete a directory with this operation" };
      }
      fs.unlinkSync(resolvedPath);
      this.stats.totalDeletes++;
      this.audit(userId, "delete", filePath, "success");
      return { success: true };
    } catch (err: any) {
      this.audit(userId, "delete", filePath, "error", err.message);
      return { error: err.message };
    }
  }

  async stat(
    filePath: string,
    workspace: string = "default",
    userId: string = "system"
  ): Promise<FileStat | { error: string }> {
    const validation = this.resolveAndValidate(filePath, workspace, "read");
    if ("error" in validation) {
      return { error: validation.error };
    }
    try {
      const { resolvedPath, config } = validation;
      if (!fs.existsSync(resolvedPath)) {
        return { error: "File not found" };
      }
      const s = fs.statSync(resolvedPath);
      return {
        name: path.basename(resolvedPath),
        path: path.relative(config.path, resolvedPath),
        size: s.size,
        isDirectory: s.isDirectory(),
        createdAt: s.birthtimeMs,
        modifiedAt: s.mtimeMs,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async search(
    query: string,
    workspace: string = "default",
    userId: string = "system",
    options: { maxResults?: number; filenameOnly?: boolean } = {}
  ): Promise<{ results: SearchResult[] } | { error: string }> {
    const config = this.workspaces.get(workspace);
    if (!config) return { error: `Unknown workspace: ${workspace}` };
    if (!config.permissions.read) return { error: "Read permission denied" };
    const maxResults = options.maxResults || 20;
    try {
      const results: SearchResult[] = [];
      const searchDir = (dir: string, depth: number = 0) => {
        if (depth > 5 || results.length >= maxResults) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(config.path, fullPath);
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          if (entry.name.toLowerCase().includes(query.toLowerCase())) {
            results.push({ filePath: relPath, matches: [{ line: 0, content: `Filename match: ${entry.name}` }] });
          }
          if (entry.isDirectory()) {
            searchDir(fullPath, depth + 1);
          } else if (!options.filenameOnly && entry.isFile()) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size > 1024 * 1024) continue;
              const content = fs.readFileSync(fullPath, "utf-8");
              const lines = content.split("\n");
              const matches: Array<{ line: number; content: string }> = [];
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                  matches.push({ line: i + 1, content: lines[i].substring(0, 200) });
                  if (matches.length >= 5) break;
                }
              }
              if (matches.length > 0) {
                results.push({ filePath: relPath, matches });
              }
            } catch {
              // skip unreadable files
            }
          }
        }
      };
      searchDir(config.path);
      this.stats.totalSearches++;
      this.audit(userId, "search", query, "success", `${results.length} results`);
      return { results };
    } catch (err: any) {
      this.audit(userId, "search", query, "error", err.message);
      return { error: err.message };
    }
  }

  async hash(
    filePath: string,
    workspace: string = "default",
    userId: string = "system"
  ): Promise<{ hash: string; algorithm: string } | { error: string }> {
    const validation = this.resolveAndValidate(filePath, workspace, "read");
    if ("error" in validation) return { error: validation.error };
    try {
      const { resolvedPath } = validation;
      if (!fs.existsSync(resolvedPath)) return { error: "File not found" };
      const content = fs.readFileSync(resolvedPath);
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      this.audit(userId, "hash", filePath, "success");
      return { hash, algorithm: "sha256" };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  getAuditLog(limit: number = 50): AuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  getProvenance(filePath: string): FileProvenance | null {
    return this.provenanceMap.get(filePath) || null;
  }

  getStats(): GatewayStats {
    return { ...this.stats };
  }

  getWorkspaces(): Array<{ name: string; config: WorkspaceConfig }> {
    return Array.from(this.workspaces.entries()).map(([name, config]) => ({ name, config }));
  }
}

export const secureFileGateway = new SecureFileGateway();
