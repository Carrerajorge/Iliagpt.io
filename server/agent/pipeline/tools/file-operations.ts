import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

function getSandboxPath(runId: string): string {
  return `/tmp/agent-${runId}`;
}

function ensureSandbox(runId: string): string {
  const sandboxPath = getSandboxPath(runId);
  if (!fs.existsSync(sandboxPath)) {
    fs.mkdirSync(sandboxPath, { recursive: true });
  }
  return sandboxPath;
}

function resolveSafePath(sandboxPath: string, relativePath: string): string | null {
  const resolved = path.resolve(sandboxPath, relativePath);
  if (!resolved.startsWith(sandboxPath)) {
    return null;
  }
  return resolved;
}

export const fileOperationsTool: ToolDefinition = {
  id: "file_operations",
  name: "File Operations",
  description: "Perform file operations (read, write, append, edit, search, copy, move, delete, list) in a sandboxed environment",
  category: "file",
  capabilities: ["file", "read", "write", "append", "edit", "search", "copy", "move", "delete", "list", "grep"],
  inputSchema: {
    action: {
      type: "string",
      description: "The file operation to perform",
      enum: ["read", "write", "append", "edit", "search", "copy", "move", "delete", "list"],
      required: true
    },
    path: {
      type: "string",
      description: "Relative path within sandbox (required for most actions)"
    },
    content: {
      type: "string",
      description: "Content for write/append operations"
    },
    find: {
      type: "string",
      description: "Text to find (for edit action)"
    },
    replace: {
      type: "string",
      description: "Replacement text (for edit action)"
    },
    pattern: {
      type: "string",
      description: "Search pattern (for search action, supports regex)"
    },
    destination: {
      type: "string",
      description: "Destination path (for copy/move actions)"
    },
    recursive: {
      type: "boolean",
      description: "Recursive operation (for list/delete)",
      default: false
    }
  },
  outputSchema: {
    content: { type: "string", description: "File content (for read)" },
    matches: { type: "array", description: "Search matches (for search)" },
    files: { type: "array", description: "File list (for list)" },
    success: { type: "boolean", description: "Operation success" }
  },

  validate(params: Record<string, any>) {
    const { action, path: filePath, content, find, replace, pattern, destination } = params;
    const errors: string[] = [];

    if (!action) {
      errors.push("Action is required");
    }

    if (["read", "write", "append", "edit", "delete"].includes(action) && !filePath) {
      errors.push(`Path is required for '${action}' action`);
    }

    if (["write", "append"].includes(action) && content === undefined) {
      errors.push(`Content is required for '${action}' action`);
    }

    if (action === "edit" && (!find || replace === undefined)) {
      errors.push("Both 'find' and 'replace' are required for 'edit' action");
    }

    if (action === "search" && !pattern) {
      errors.push("Pattern is required for 'search' action");
    }

    if (["copy", "move"].includes(action) && (!filePath || !destination)) {
      errors.push(`Both 'path' and 'destination' are required for '${action}' action`);
    }

    return { valid: errors.length === 0, errors };
  },

  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { action, path: filePath, content, find, replace, pattern, destination, recursive } = params;

    try {
      const sandboxPath = ensureSandbox(context.runId);

      switch (action) {
        case "read": {
          const safePath = resolveSafePath(sandboxPath, filePath);
          if (!safePath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          if (!fs.existsSync(safePath)) {
            return { success: false, error: "File not found" };
          }
          const fileContent = fs.readFileSync(safePath, "utf-8");
          return {
            success: true,
            data: { content: fileContent, path: filePath, size: fileContent.length }
          };
        }

        case "write": {
          const safePath = resolveSafePath(sandboxPath, filePath);
          if (!safePath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          const dir = path.dirname(safePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(safePath, content, "utf-8");
          
          const artifact: Artifact = {
            id: crypto.randomUUID(),
            type: "file",
            name: path.basename(filePath),
            content: content.slice(0, 50000),
            size: content.length,
            metadata: { path: filePath }
          };
          
          return {
            success: true,
            data: { path: filePath, size: content.length },
            artifacts: [artifact]
          };
        }

        case "append": {
          const safePath = resolveSafePath(sandboxPath, filePath);
          if (!safePath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          const dir = path.dirname(safePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.appendFileSync(safePath, content, "utf-8");
          const newSize = fs.statSync(safePath).size;
          return {
            success: true,
            data: { path: filePath, appendedBytes: content.length, totalSize: newSize }
          };
        }

        case "edit": {
          const safePath = resolveSafePath(sandboxPath, filePath);
          if (!safePath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          if (!fs.existsSync(safePath)) {
            return { success: false, error: "File not found" };
          }
          let fileContent = fs.readFileSync(safePath, "utf-8");
          const occurrences = (fileContent.match(new RegExp(find, "g")) || []).length;
          fileContent = fileContent.split(find).join(replace);
          fs.writeFileSync(safePath, fileContent, "utf-8");
          return {
            success: true,
            data: { path: filePath, replacements: occurrences }
          };
        }

        case "search": {
          const safePath = filePath ? resolveSafePath(sandboxPath, filePath) : sandboxPath;
          if (!safePath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          
          const matches: Array<{ file: string; line: number; content: string }> = [];
          const regex = new RegExp(pattern, "gi");

          function searchDir(dir: string) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                searchDir(fullPath);
              } else if (entry.isFile()) {
                try {
                  const content = fs.readFileSync(fullPath, "utf-8");
                  const lines = content.split("\n");
                  lines.forEach((line, idx) => {
                    if (regex.test(line)) {
                      matches.push({
                        file: path.relative(sandboxPath, fullPath),
                        line: idx + 1,
                        content: line.slice(0, 200)
                      });
                    }
                    regex.lastIndex = 0;
                  });
                } catch {
                }
              }
            }
          }

          if (fs.existsSync(safePath)) {
            if (fs.statSync(safePath).isDirectory()) {
              searchDir(safePath);
            } else {
              const content = fs.readFileSync(safePath, "utf-8");
              const lines = content.split("\n");
              lines.forEach((line, idx) => {
                if (regex.test(line)) {
                  matches.push({
                    file: filePath,
                    line: idx + 1,
                    content: line.slice(0, 200)
                  });
                }
                regex.lastIndex = 0;
              });
            }
          }

          return {
            success: true,
            data: { matches: matches.slice(0, 100), totalMatches: matches.length }
          };
        }

        case "copy": {
          const srcPath = resolveSafePath(sandboxPath, filePath);
          const destPath = resolveSafePath(sandboxPath, destination);
          if (!srcPath || !destPath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          if (!fs.existsSync(srcPath)) {
            return { success: false, error: "Source file not found" };
          }
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          fs.copyFileSync(srcPath, destPath);
          return {
            success: true,
            data: { source: filePath, destination, size: fs.statSync(destPath).size }
          };
        }

        case "move": {
          const srcPath = resolveSafePath(sandboxPath, filePath);
          const destPath = resolveSafePath(sandboxPath, destination);
          if (!srcPath || !destPath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          if (!fs.existsSync(srcPath)) {
            return { success: false, error: "Source file not found" };
          }
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          fs.renameSync(srcPath, destPath);
          return {
            success: true,
            data: { source: filePath, destination }
          };
        }

        case "delete": {
          const safePath = resolveSafePath(sandboxPath, filePath);
          if (!safePath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          if (!fs.existsSync(safePath)) {
            return { success: false, error: "Path not found" };
          }
          if (fs.statSync(safePath).isDirectory()) {
            fs.rmSync(safePath, { recursive: !!recursive });
          } else {
            fs.unlinkSync(safePath);
          }
          return {
            success: true,
            data: { deleted: filePath }
          };
        }

        case "list": {
          const safePath = filePath ? resolveSafePath(sandboxPath, filePath) : sandboxPath;
          if (!safePath) {
            return { success: false, error: "Path escapes sandbox" };
          }
          if (!fs.existsSync(safePath)) {
            return { success: false, error: "Directory not found" };
          }

          const files: Array<{ name: string; type: "file" | "directory"; size?: number }> = [];

          function listDir(dir: string, prefix: string = "") {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
              if (entry.isDirectory()) {
                files.push({ name: relativePath, type: "directory" });
                if (recursive) {
                  listDir(path.join(dir, entry.name), relativePath);
                }
              } else {
                const stats = fs.statSync(path.join(dir, entry.name));
                files.push({ name: relativePath, type: "file", size: stats.size });
              }
            }
          }

          listDir(safePath);

          return {
            success: true,
            data: { files, count: files.length, path: filePath || "/" }
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
};
