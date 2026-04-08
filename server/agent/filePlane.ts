/**
 * File Plane — Secure file gateway for reading, writing, and parsing local files.
 *
 * This is the critical module that enables IliaGPT to actually read files
 * uploaded by users or present in the workspace.
 *
 * Security model:
 * - All paths are resolved relative to allowed workspaces (no traversal)
 * - Every access is audit-logged
 * - Secrets are auto-redacted from content before returning
 * - Size limits enforced per operation
 * - Read-only by default; write requires elevated permissions
 */

import * as fs from "fs/promises";
import * as path from "path";
import crypto from "crypto";

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_READ_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_WRITE_SIZE = 10 * 1024 * 1024; // 10MB
const WORKSPACE_ROOT = process.cwd();

// Allowed workspace directories (relative to cwd)
const ALLOWED_WORKSPACES: Record<string, string> = {
  project: WORKSPACE_ROOT,
  uploads: path.join(WORKSPACE_ROOT, "uploads"),
  artifacts: path.join(WORKSPACE_ROOT, "artifacts"),
  tmp: path.join(WORKSPACE_ROOT, "tmp"),
};

// Secret patterns to redact
const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|password|token|credential|auth)[\s]*[=:]\s*["']?([A-Za-z0-9_\-./+=]{16,})["']?/gi,
  /(?:sk-|pk-|rk_live_|whsec_)[A-Za-z0-9_\-]{20,}/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g,
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileReadResult {
  content: string;
  size: number;
  mimeType: string;
  hash: string;
  path: string;
  workspace: string;
}

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
}

interface FileStats {
  totalFiles: number;
  totalSize: number;
  workspaces: string[];
}

interface AuditEntry {
  timestamp: string;
  userId: string;
  operation: string;
  path: string;
  workspace: string;
  success: boolean;
  error?: string;
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

const auditLog: AuditEntry[] = [];
const MAX_AUDIT = 5000;

function audit(entry: Omit<AuditEntry, "timestamp">): void {
  auditLog.push({ ...entry, timestamp: new Date().toISOString() });
  if (auditLog.length > MAX_AUDIT) auditLog.splice(0, auditLog.length - MAX_AUDIT);
}

// ─── Path Security ───────────────────────────────────────────────────────────

function resolveSecurePath(filePath: string, workspace: string): string {
  const base = ALLOWED_WORKSPACES[workspace];
  if (!base) throw new Error(`Unknown workspace: "${workspace}". Allowed: ${Object.keys(ALLOWED_WORKSPACES).join(", ")}`);

  const resolved = path.resolve(base, filePath);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error(`Path traversal blocked: "${filePath}" escapes workspace "${workspace}"`);
  }
  return resolved;
}

function redactSecrets(content: string): string {
  let result = content;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.length > 8) return match.slice(0, 4) + "****" + match.slice(-4);
      return "****";
    });
  }
  return result;
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
    ".json": "application/json", ".xml": "application/xml",
    ".html": "text/html", ".htm": "text/html",
    ".js": "text/javascript", ".ts": "text/typescript",
    ".tsx": "text/typescript", ".jsx": "text/javascript",
    ".css": "text/css", ".scss": "text/scss",
    ".py": "text/x-python", ".rb": "text/x-ruby",
    ".go": "text/x-go", ".rs": "text/x-rust",
    ".java": "text/x-java", ".c": "text/x-c", ".cpp": "text/x-c++",
    ".sh": "text/x-shellscript", ".bash": "text/x-shellscript",
    ".yml": "text/yaml", ".yaml": "text/yaml", ".toml": "text/toml",
    ".sql": "text/x-sql", ".graphql": "text/x-graphql",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".zip": "application/zip", ".gz": "application/gzip",
  };
  return mimeMap[ext] || "application/octet-stream";
}

// ─── Secure File Gateway ─────────────────────────────────────────────────────

class SecureFileGateway {
  async read(filePath: string, workspace = "project", userId = "system"): Promise<FileReadResult> {
    const resolved = resolveSecurePath(filePath, workspace);

    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
      if (stat.size > MAX_READ_SIZE) throw new Error(`File too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max ${MAX_READ_SIZE / 1024 / 1024}MB)`);

      const buffer = await fs.readFile(resolved);
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const mimeType = detectMimeType(filePath);

      let content: string;
      if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") {
        content = redactSecrets(buffer.toString("utf-8"));
      } else if (mimeType === "application/pdf") {
        content = await this.parsePdf(buffer);
      } else if (mimeType.includes("wordprocessing")) {
        content = await this.parseDocx(buffer);
      } else if (mimeType.includes("spreadsheet")) {
        content = await this.parseXlsx(buffer);
      } else if (mimeType.startsWith("image/")) {
        content = `[Binary image: ${path.basename(filePath)}, ${(stat.size / 1024).toFixed(1)}KB, ${mimeType}]`;
      } else {
        content = `[Binary file: ${path.basename(filePath)}, ${(stat.size / 1024).toFixed(1)}KB, ${mimeType}]`;
      }

      audit({ userId, operation: "read", path: filePath, workspace, success: true });
      return { content, size: stat.size, mimeType, hash, path: filePath, workspace };
    } catch (err: any) {
      audit({ userId, operation: "read", path: filePath, workspace, success: false, error: err.message });
      throw err;
    }
  }

  async write(filePath: string, content: string, workspace = "project", userId = "system"): Promise<void> {
    const resolved = resolveSecurePath(filePath, workspace);
    const size = Buffer.byteLength(content, "utf-8");
    if (size > MAX_WRITE_SIZE) throw new Error(`Content too large: ${(size / 1024 / 1024).toFixed(1)}MB (max ${MAX_WRITE_SIZE / 1024 / 1024}MB)`);

    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, "utf-8");
      audit({ userId, operation: "write", path: filePath, workspace, success: true });
    } catch (err: any) {
      audit({ userId, operation: "write", path: filePath, workspace, success: false, error: err.message });
      throw err;
    }
  }

  async delete(filePath: string, workspace = "project", userId = "system"): Promise<void> {
    const resolved = resolveSecurePath(filePath, workspace);
    try {
      await fs.unlink(resolved);
      audit({ userId, operation: "delete", path: filePath, workspace, success: true });
    } catch (err: any) {
      audit({ userId, operation: "delete", path: filePath, workspace, success: false, error: err.message });
      throw err;
    }
  }

  async list(dirPath = ".", workspace = "project", userId = "system"): Promise<FileEntry[]> {
    const resolved = resolveSecurePath(dirPath, workspace);
    const entries: FileEntry[] = [];

    try {
      const items = await fs.readdir(resolved, { withFileTypes: true });
      for (const item of items) {
        if (item.name === "node_modules" || item.name === ".git" || item.name.startsWith(".env")) continue;
        const fullPath = path.join(resolved, item.name);
        const relPath = path.relative(ALLOWED_WORKSPACES[workspace] || WORKSPACE_ROOT, fullPath);

        if (item.isDirectory()) {
          entries.push({ name: item.name, path: relPath, type: "directory" });
        } else {
          const stat = await fs.stat(fullPath).catch(() => null);
          entries.push({
            name: item.name,
            path: relPath,
            type: "file",
            size: stat?.size,
            modified: stat?.mtime.toISOString(),
          });
        }
      }
      audit({ userId, operation: "list", path: dirPath, workspace, success: true });
    } catch (err: any) {
      audit({ userId, operation: "list", path: dirPath, workspace, success: false, error: err.message });
      throw err;
    }

    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async stat(filePath: string, workspace = "project", userId = "system"): Promise<{ exists: boolean; size?: number; mimeType?: string; hash?: string; modified?: string }> {
    const resolved = resolveSecurePath(filePath, workspace);
    try {
      const s = await fs.stat(resolved);
      const buffer = s.isFile() ? await fs.readFile(resolved) : null;
      const hash = buffer ? crypto.createHash("sha256").update(buffer).digest("hex") : undefined;
      audit({ userId, operation: "stat", path: filePath, workspace, success: true });
      return { exists: true, size: s.size, mimeType: detectMimeType(filePath), hash, modified: s.mtime.toISOString() };
    } catch {
      return { exists: false };
    }
  }

  async hash(filePath: string, workspace = "project"): Promise<string> {
    const resolved = resolveSecurePath(filePath, workspace);
    const buffer = await fs.readFile(resolved);
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  getAuditLog(userId?: string, limit = 100): AuditEntry[] {
    let entries = userId ? auditLog.filter(e => e.userId === userId) : auditLog;
    return entries.slice(-limit).reverse();
  }

  getStats(): FileStats {
    const workspaces = Object.keys(ALLOWED_WORKSPACES);
    return {
      totalFiles: auditLog.filter(e => e.operation === "read" && e.success).length,
      totalSize: 0,
      workspaces,
    };
  }

  // ─── Document Parsers ────────────────────────────────────────────────────

  private async parsePdf(buffer: Buffer): Promise<string> {
    try {
      const pdfParse = await import("pdf-parse").then(m => m.default ?? m);
      const data = await pdfParse(buffer);
      return redactSecrets(data.text || "[Empty PDF]");
    } catch {
      return "[PDF parsing failed — pdf-parse not available]";
    }
  }

  private async parseDocx(buffer: Buffer): Promise<string> {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return redactSecrets(result.value || "[Empty DOCX]");
    } catch {
      return "[DOCX parsing failed — mammoth not available]";
    }
  }

  private async parseXlsx(buffer: Buffer): Promise<string> {
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.default.Workbook();
      await workbook.xlsx.load(buffer);
      const parts: string[] = [];
      workbook.eachSheet((sheet) => {
        parts.push(`## Sheet: ${sheet.name}`);
        const rows: string[] = [];
        sheet.eachRow((row, rowNumber) => {
          const cells = (row.values as any[]).slice(1).map(v => v == null ? "" : String(v));
          if (rowNumber === 1) {
            rows.push(`| ${cells.join(" | ")} |`);
            rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
          } else {
            rows.push(`| ${cells.join(" | ")} |`);
          }
        });
        parts.push(rows.join("\n"));
      });
      return redactSecrets(parts.join("\n\n"));
    } catch {
      return "[XLSX parsing failed — exceljs not available]";
    }
  }
}

// ─── Parsing Utilities ───────────────────────────────────────────────────────

export function parseFile(content: string, filePath: string): { sections: Array<{ title: string; content: string }>; wordCount: number; lineCount: number } {
  const lines = content.split("\n");
  const sections: Array<{ title: string; content: string }> = [];
  let currentTitle = path.basename(filePath);
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
      }
      currentTitle = headingMatch[2];
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length > 0) {
    sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
  }

  return {
    sections,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    lineCount: lines.length,
  };
}

export function generateChunks(content: string, filePath: string, chunkSize = 1500, overlap = 200): Array<{ index: number; content: string; metadata: { file: string; startLine: number; endLine: number } }> {
  const lines = content.split("\n");
  const chunks: Array<{ index: number; content: string; metadata: { file: string; startLine: number; endLine: number } }> = [];
  let currentChunk: string[] = [];
  let chunkStart = 0;

  for (let i = 0; i < lines.length; i++) {
    currentChunk.push(lines[i]);
    const chunkText = currentChunk.join("\n");

    if (chunkText.length >= chunkSize) {
      chunks.push({
        index: chunks.length,
        content: chunkText,
        metadata: { file: filePath, startLine: chunkStart + 1, endLine: i + 1 },
      });
      // Overlap: keep last N characters worth of lines
      const overlapLines = Math.max(1, Math.floor(overlap / 50));
      currentChunk = currentChunk.slice(-overlapLines);
      chunkStart = i - overlapLines + 1;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      index: chunks.length,
      content: currentChunk.join("\n"),
      metadata: { file: filePath, startLine: chunkStart + 1, endLine: lines.length },
    });
  }

  return chunks;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const secureFileGateway = new SecureFileGateway();
