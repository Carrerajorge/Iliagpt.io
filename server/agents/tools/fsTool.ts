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

export const grepSearchToolSchema = {
  type: "function" as const,
  function: {
    name: "grep_search",
    description: "Search for a pattern in files. Uses regex matching to find text across files in a directory. Returns matching lines with file paths and line numbers. Essential for code navigation and finding references.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Search pattern (regex supported)"
        },
        directory: {
          type: "string",
          description: "Directory to search in (defaults to project root)"
        },
        include: {
          type: "string",
          description: "File glob pattern to include (e.g., '*.ts', '*.py')"
        },
        max_results: {
          type: "number",
          description: "Maximum results to return (default 50)"
        }
      },
      required: ["pattern"]
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

export async function executeGrepSearch(params: {
  pattern: string;
  directory?: string;
  include?: string;
  max_results?: number;
}): Promise<{ matches: Array<{ file: string; line: number; text: string }>; count: number; error?: string }> {
  const { execFileSync } = await import("child_process");
  try {
    const dir = resolveSafePath(params.directory || ".");
    const maxResults = Math.min(Math.max(params.max_results || 50, 1), 200);

    const grepArgs: string[] = ["-rn", "--max-count", String(maxResults), "-E"];

    if (params.include && /^[\w.*?{},\-\/]+$/.test(params.include)) {
      grepArgs.push(`--include=${params.include}`);
    } else {
      const defaultExts = ["ts","tsx","js","jsx","py","json","md","css","html","yaml","yml","toml","sh","sql","go","rs","java","c","cpp","h"];
      for (const ext of defaultExts) grepArgs.push(`--include=*.${ext}`);
    }

    grepArgs.push("--", params.pattern, dir);

    let output: string;
    try {
      output = execFileSync("grep", grepArgs, { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
    } catch (e: any) {
      if (e.status === 1) return { matches: [], count: 0 };
      throw e;
    }

    const lines = output.trim().split("\n").filter(Boolean);
    const matches = lines.slice(0, maxResults).map(line => {
      const colonIdx1 = line.indexOf(":");
      const colonIdx2 = line.indexOf(":", colonIdx1 + 1);
      if (colonIdx1 === -1 || colonIdx2 === -1) return { file: "", line: 0, text: line };
      const file = path.relative(PROJECT_ROOT, line.slice(0, colonIdx1));
      const lineNum = parseInt(line.slice(colonIdx1 + 1, colonIdx2), 10);
      const text = line.slice(colonIdx2 + 1).trim();
      return { file, line: lineNum || 0, text: text.slice(0, 500) };
    }).filter(m => m.file);
    return { matches, count: matches.length };
  } catch (err: any) {
    return { matches: [], count: 0, error: err.message };
  }
}
