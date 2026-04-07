/**
 * File operations tool with path validation for the Claw agent system.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import type { ToolDefinition, ToolResult, ToolContext } from "../toolTypes";
import { createError } from "../toolTypes";

const MAX_READ_BYTES = 16 * 1024 * 1024;
const MAX_WRITE_BYTES = 10 * 1024 * 1024;
const DEFAULT_WORKSPACE = process.cwd();

export type FileOperation = "read" | "write" | "edit" | "delete" | "list" | "exists";

export interface FileOpOptions {
  operation: FileOperation;
  path: string;
  content?: string;
  oldText?: string;
  newText?: string;
  offset?: number;
  limit?: number;
}

export interface FileOpResult { success: boolean; data?: any; error?: string }

function resolveAndValidate(filePath: string, workspace?: string): string {
  const base = workspace || DEFAULT_WORKSPACE;
  const resolved = path.resolve(base, filePath);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error(`Path escapes workspace: ${filePath}`);
  }
  return resolved;
}

async function assertNoSymlinkEscape(resolved: string, workspace: string): Promise<void> {
  try {
    const real = await fs.realpath(resolved);
    const realBase = await fs.realpath(workspace);
    if (!real.startsWith(realBase)) throw new Error(`Symlink escapes workspace: resolved to ${real}`);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }
}

async function readFile(resolved: string, offset?: number, limit?: number): Promise<any> {
  const stat = await fs.stat(resolved);
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`File exceeds 16MB read limit (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  }

  const raw = await fs.readFile(resolved, "utf-8");
  const lines = raw.split("\n");
  const start = offset ?? 0;
  const end = limit ? start + limit : lines.length;
  const slice = lines.slice(start, end);

  const numbered = slice.map((line, i) => `${start + i + 1}\t${line}`).join("\n");
  return { content: numbered, totalLines: lines.length, from: start + 1, to: Math.min(end, lines.length) };
}

async function writeFile(resolved: string, content: string): Promise<any> {
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`Content exceeds 10MB write limit (${(bytes / 1024 / 1024).toFixed(1)}MB)`);
  }

  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf-8");
  return { bytesWritten: bytes, path: resolved };
}

async function editFile(resolved: string, oldText: string, newText: string): Promise<any> {
  const raw = await fs.readFile(resolved, "utf-8");
  const idx = raw.indexOf(oldText);
  if (idx === -1) {
    throw new Error("oldText not found in file -- edit failed");
  }

  // Ensure unique match
  if (raw.indexOf(oldText, idx + 1) !== -1) {
    throw new Error("oldText matches multiple locations -- provide a more specific string");
  }

  const updated = raw.slice(0, idx) + newText + raw.slice(idx + oldText.length);
  const bytes = Buffer.byteLength(updated, "utf-8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`Edited file would exceed 10MB write limit`);
  }

  await fs.writeFile(resolved, updated, "utf-8");
  return { bytesWritten: bytes, replacements: 1, path: resolved };
}

async function deleteFile(resolved: string): Promise<any> {
  await fs.unlink(resolved);
  return { deleted: resolved };
}

async function listDir(resolved: string): Promise<any> {
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const items = await Promise.all(entries.map(async (e) => {
    const fp = path.join(resolved, e.name);
    const size = e.isFile() ? (await fs.stat(fp).catch(() => null))?.size : undefined;
    const type = e.isDirectory() ? "directory" : e.isSymbolicLink() ? "symlink" : "file";
    return { name: e.name, type, ...(size !== undefined ? { size } : {}) };
  }));
  return { entries: items, count: items.length, path: resolved };
}

async function existsCheck(resolved: string): Promise<any> {
  try {
    const s = await fs.stat(resolved);
    return { exists: true, type: s.isDirectory() ? "directory" : "file", size: s.size };
  } catch { return { exists: false }; }
}

export async function executeFileOp(opts: FileOpOptions, workspace?: string): Promise<FileOpResult> {
  const base = workspace || DEFAULT_WORKSPACE;

  try {
    const resolved = resolveAndValidate(opts.path, base);
    await assertNoSymlinkEscape(resolved, base);

    switch (opts.operation) {
      case "read":
        return { success: true, data: await readFile(resolved, opts.offset, opts.limit) };
      case "write": {
        if (opts.content === undefined) throw new Error("content is required for write");
        return { success: true, data: await writeFile(resolved, opts.content) };
      }
      case "edit": {
        if (!opts.oldText || opts.newText === undefined) throw new Error("oldText and newText are required for edit");
        return { success: true, data: await editFile(resolved, opts.oldText, opts.newText) };
      }
      case "delete":
        return { success: true, data: await deleteFile(resolved) };
      case "list":
        return { success: true, data: await listDir(resolved) };
      case "exists":
        return { success: true, data: await existsCheck(resolved) };
      default:
        throw new Error(`Unknown operation: ${opts.operation}`);
    }
  } catch (err: any) {
    return { success: false, error: err.message ?? "Unknown error" };
  }
}

// --- Tool Definition ---

const inputSchema = z.object({
  operation: z.enum(["read", "write", "edit", "delete", "list", "exists"]).describe("File operation to perform"),
  path: z.string().min(1).describe("File or directory path (relative to workspace)"),
  content: z.string().optional().describe("File content (for write)"),
  oldText: z.string().optional().describe("Text to find (for edit)"),
  newText: z.string().optional().describe("Replacement text (for edit)"),
  offset: z.number().int().min(0).optional().describe("Start line (0-based, for read)"),
  limit: z.number().int().min(1).optional().describe("Max lines to return (for read)"),
});

export const FILE_TOOL_DEFINITION: ToolDefinition = {
  name: "file",
  description: "Perform file operations (read, write, edit, delete, list, exists) with path traversal protection and size limits. Read returns line-numbered content. Edit uses unique string replacement.",
  inputSchema,
  capabilities: ["reads_files", "writes_files"],
  async execute(input: z.infer<typeof inputSchema>, context: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    const result = await executeFileOp(input as FileOpOptions);

    if (!result.success) {
      return {
        success: false,
        output: null,
        metrics: { durationMs: Date.now() - start },
        error: createError("FILE_OP_ERROR", result.error ?? "File operation failed", false),
      };
    }

    return {
      success: true,
      output: result.data,
      metrics: { durationMs: Date.now() - start },
    };
  },
};
