import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

export const readFileToolSchema = {
  type: "function" as const,
  function: {
    name: "read_file",
    description: "Read the contents of a file. Returns the file text content. Use for reading code, configuration files, documents, logs, etc.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to read (relative to project root or absolute)"
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based, optional)"
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read (optional, default all)"
        }
      },
      required: ["file_path"]
    }
  }
};

export const writeFileToolSchema = {
  type: "function" as const,
  function: {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories as needed.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to write"
        },
        content: {
          type: "string",
          description: "The content to write to the file"
        }
      },
      required: ["file_path", "content"]
    }
  }
};

export const editFileToolSchema = {
  type: "function" as const,
  function: {
    name: "edit_file",
    description: "Make a precise text replacement in a file. Finds the exact old_string and replaces it with new_string. Use for targeted edits without rewriting the entire file.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to edit"
        },
        old_string: {
          type: "string",
          description: "The exact text to find and replace (must match exactly)"
        },
        new_string: {
          type: "string",
          description: "The replacement text"
        }
      },
      required: ["file_path", "old_string", "new_string"]
    }
  }
};

export const listFilesToolSchema = {
  type: "function" as const,
  function: {
    name: "list_files",
    description: "List files and directories in a given path. Returns names, types (file/directory), and sizes.",
    parameters: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Path to the directory to list (defaults to project root)"
        },
        recursive: {
          type: "boolean",
          description: "Whether to list recursively (default false, max depth 3)"
        }
      },
      required: []
    }
  }
};

const PROJECT_ROOT = process.cwd();

function resolveSafePath(filePath: string): string {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

export async function executeReadFile(params: {
  file_path: string;
  offset?: number;
  limit?: number;
}): Promise<{ content: string; lines: number; error?: string }> {
  try {
    const safePath = resolveSafePath(params.file_path);
    const content = await fs.readFile(safePath, "utf-8");
    const allLines = content.split("\n");
    const offset = Math.max((params.offset || 1) - 1, 0);
    const limit = params.limit || allLines.length;
    const selectedLines = allLines.slice(offset, offset + limit);
    return {
      content: selectedLines.join("\n"),
      lines: allLines.length
    };
  } catch (err: any) {
    return { content: "", lines: 0, error: err.message };
  }
}

export async function executeWriteFile(params: {
  file_path: string;
  content: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const safePath = resolveSafePath(params.file_path);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, params.content, "utf-8");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function executeEditFile(params: {
  file_path: string;
  old_string: string;
  new_string: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const safePath = resolveSafePath(params.file_path);
    const content = await fs.readFile(safePath, "utf-8");
    const idx = content.indexOf(params.old_string);
    if (idx === -1) {
      return { success: false, error: "old_string not found in file" };
    }
    const count = content.split(params.old_string).length - 1;
    if (count > 1) {
      return { success: false, error: `old_string found ${count} times; must be unique` };
    }
    const newContent = content.replace(params.old_string, params.new_string);
    await fs.writeFile(safePath, newContent, "utf-8");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function executeListFiles(params: {
  directory?: string;
  recursive?: boolean;
}): Promise<{ entries: Array<{ name: string; type: string; size: number }>; error?: string }> {
  try {
    const dir = resolveSafePath(params.directory || ".");
    const entries: Array<{ name: string; type: string; size: number }> = [];

    async function listDir(dirPath: string, depth: number) {
      if (depth > 3) return;
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name === "node_modules") continue;
        const fullPath = path.join(dirPath, item.name);
        const relPath = path.relative(dir, fullPath);
        try {
          const stat = await fs.stat(fullPath);
          entries.push({
            name: relPath,
            type: item.isDirectory() ? "directory" : "file",
            size: stat.size
          });
          if (item.isDirectory() && params.recursive && depth < 3) {
            await listDir(fullPath, depth + 1);
          }
        } catch {}
      }
    }

    await listDir(dir, 0);
    return { entries };
  } catch (err: any) {
    return { entries: [], error: err.message };
  }
}
