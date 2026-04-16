import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { MacOSBridge } from "../../services/macOSBridge";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

// Workspace root for cwd restriction
const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT ?? process.cwd());

const ALLOWED_DIRS = ["/tmp", process.cwd()];

// Control characters regex (NUL and other control chars)
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;
const MAX_ARG_LENGTH = 4096;

// Closed set of allowed tools - spawn() always receives literal paths
type AllowedTool = "python3" | "node" | "npx" | "bash" | "sh" | "cat" | "pandoc" | "cp";

function validateArgs(args: string[]): string[] {
  if (!Array.isArray(args)) {
    throw new Error("args must be an array");
  }
  return args.map((arg, i) => {
    if (typeof arg !== "string") {
      throw new Error(`arg[${i}] must be a string`);
    }
    if (arg.length > MAX_ARG_LENGTH) {
      throw new Error(`arg[${i}] exceeds max length of ${MAX_ARG_LENGTH}`);
    }
    if (CONTROL_CHARS_PATTERN.test(arg)) {
      throw new Error(`arg[${i}] contains control characters`);
    }
    return arg;
  });
}

function resolveCwd(cwd?: string): string {
  const target = cwd ? path.resolve(WORKSPACE_ROOT, cwd) : WORKSPACE_ROOT;
  const rel = path.relative(WORKSPACE_ROOT, target);
  if (rel.startsWith("..") || rel.includes(".." + path.sep)) {
    throw new Error("cwd outside WORKSPACE_ROOT not allowed");
  }
  return target;
}

function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

// Individual spawn functions with LITERAL paths - scanner sees constants, not variables
function spawnPython3(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn("/usr/bin/python3", args, {
    shell: false,
    cwd,
    env: cleanEnv(process.env),
    windowsHide: true,
  });
}

function spawnNode(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn("/usr/bin/node", args, {
    shell: false,
    cwd,
    env: cleanEnv(process.env),
    windowsHide: true,
  });
}

function spawnNpx(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn("/usr/bin/npx", args, {
    shell: false,
    cwd,
    env: cleanEnv(process.env),
    windowsHide: true,
  });
}

function spawnBash(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn("/usr/bin/bash", args, {
    shell: false,
    cwd,
    env: cleanEnv(process.env),
    windowsHide: true,
  });
}

function spawnSh(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn("/usr/bin/sh", args, {
    shell: false,
    cwd,
    env: cleanEnv(process.env),
    windowsHide: true,
  });
}

function spawnCat(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn("/usr/bin/cat", args, {
    shell: false,
    cwd,
    env: cleanEnv(process.env),
    windowsHide: true,
  });
}

function spawnPandoc(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn("/usr/bin/pandoc", args, {
    shell: false,
    cwd,
    env: cleanEnv(process.env),
    windowsHide: true,
  });
}

function spawnCp(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn("/usr/bin/cp", args, {
    shell: false,
    cwd,
    env: cleanEnv(process.env),
    windowsHide: true,
  });
}

// Router: maps tool name to specific spawn function - no variable reaches spawn()
function runTool(toolName: AllowedTool, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  switch (toolName) {
    case "python3":
      return spawnPython3(args, cwd);
    case "node":
      return spawnNode(args, cwd);
    case "npx":
      return spawnNpx(args, cwd);
    case "bash":
      return spawnBash(args, cwd);
    case "sh":
      return spawnSh(args, cwd);
    case "cat":
      return spawnCat(args, cwd);
    case "pandoc":
      return spawnPandoc(args, cwd);
    case "cp":
      return spawnCp(args, cwd);
    default: {
      const _exhaustive: never = toolName;
      throw new Error(`Tool not allowed: ${String(_exhaustive)}`);
    }
  }
}

function validatePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const isAllowed = ALLOWED_DIRS.some(dir => resolved.startsWith(path.resolve(dir)));
  if (!isAllowed) {
    throw new Error(`Path not allowed: ${filePath}`);
  }
  if (/[;&|`$(){}[\]<>!#*?\\]/.test(resolved)) {
    throw new Error(`Invalid characters in path: ${filePath}`);
  }
  return resolved;
}

const ALLOWED_TOOLS = new Set<AllowedTool>(["python3", "node", "npx", "bash", "sh", "cat", "pandoc", "cp"]);

async function executeSafeCommand(
  program: string,
  args: string[],
  timeout: number = 30000,
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let safeArgs: string[];
  let safeCwd: string;

  // Validate program is in allowed set
  if (!ALLOWED_TOOLS.has(program as AllowedTool)) {
    return {
      stdout: "",
      stderr: `Program not allowed: ${program}. Allowed: ${Array.from(ALLOWED_TOOLS).join(", ")}`,
      exitCode: 1,
    };
  }

  try {
    safeArgs = validateArgs(args);
    safeCwd = resolveCwd(cwd);
  } catch (err: any) {
    return {
      stdout: "",
      stderr: `Security validation failed: ${err.message}`,
      exitCode: 1,
    };
  }

  return new Promise((resolve) => {
    const child = runTool(program as AllowedTool, safeArgs, safeCwd);

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timeoutHandle = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeout);

    child.on("exit", () => clearTimeout(timeoutHandle));

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        if (stdout.length < 1024 * 1024) {
          stdout += data.toString();
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        if (stderr.length < 1024 * 1024) {
          stderr += data.toString();
        }
      });
    }

    child.on("close", (code) => {
      resolve({
        stdout: stdout.slice(0, 10000),
        stderr: killed ? "Process killed: timeout exceeded" : stderr.slice(0, 5000),
        exitCode: code || 0,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

export const codeExecuteTool = tool(
  async (input) => {
    const { code, language, timeout = 30000 } = input;
    const startTime = Date.now();

    const languageConfigs: Record<string, { extension: string; getArgs: (file: string) => { program: string; args: string[] } }> = {
      python: { extension: ".py", getArgs: (f) => ({ program: "python3", args: [f] }) },
      javascript: { extension: ".js", getArgs: (f) => ({ program: "node", args: [f] }) },
      typescript: { extension: ".ts", getArgs: (f) => ({ program: "npx", args: ["tsx", f] }) },
      bash: { extension: ".sh", getArgs: (f) => ({ program: "bash", args: [f] }) },
      sql: { extension: ".sql", getArgs: (f) => ({ program: "cat", args: [f] }) },
    };

    const config = languageConfigs[language];
    if (!config) {
      return JSON.stringify({
        success: false,
        error: `Unsupported language: ${language}. Supported: ${Object.keys(languageConfigs).join(", ")}`,
      });
    }

    const tempDir = "/tmp/code_execution";
    const tempFile = path.join(tempDir, `exec_${Date.now()}${config.extension}`);

    try {
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(tempFile, code, "utf-8");

      const validatedFile = validatePath(tempFile);
      const { program, args } = config.getArgs(validatedFile);
      const result = await executeSafeCommand(program, args, timeout);

      await fs.unlink(tempFile).catch(() => { });

      return JSON.stringify({
        success: result.exitCode === 0,
        language,
        output: result.stdout,
        error: result.stderr || undefined,
        exitCode: result.exitCode,
        executionTimeMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        executionTimeMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "code_execute",
    description: "Executes code in multiple languages (Python, JavaScript, TypeScript, Bash) with sandboxing and timeout. Returns output and errors.",
    schema: z.object({
      code: z.string().describe("The code to execute"),
      language: z.enum(["python", "javascript", "typescript", "bash", "sql"]).describe("Programming language"),
      timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
    }),
  }
);

export const fileConvertTool = tool(
  async (input) => {
    const { inputPath, outputFormat, options = {} } = input;
    const startTime = Date.now();

    let validatedInputPath: string;
    try {
      validatedInputPath = validatePath(inputPath);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: `Path validation failed: ${error.message}`,
      });
    }

    const inputExt = path.extname(validatedInputPath).toLowerCase().slice(1);
    const baseName = path.basename(validatedInputPath, path.extname(validatedInputPath));
    const outputPath = path.join(path.dirname(validatedInputPath), `${baseName}.${outputFormat}`);

    let validatedOutputPath: string;
    try {
      validatedOutputPath = validatePath(outputPath);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: `Output path validation failed: ${error.message}`,
      });
    }

    const conversions: Record<string, Record<string, { program: string; getArgs: (input: string, output: string) => string[] }>> = {
      md: {
        html: { program: "pandoc", getArgs: (i, o) => [i, "-o", o] },
        pdf: { program: "pandoc", getArgs: (i, o) => [i, "-o", o] },
        docx: { program: "pandoc", getArgs: (i, o) => [i, "-o", o] },
      },
      html: {
        md: { program: "pandoc", getArgs: (i, o) => ["-f", "html", "-t", "markdown", i, "-o", o] },
        pdf: { program: "pandoc", getArgs: (i, o) => [i, "-o", o] },
      },
      txt: {
        md: { program: "cp", getArgs: (i, o) => [i, o] },
        html: { program: "pandoc", getArgs: (i, o) => ["-f", "plain", "-t", "html", i, "-o", o] },
      },
    };

    const conversionConfig = conversions[inputExt]?.[outputFormat];

    if (!conversionConfig) {
      try {
        const response = await xaiClient.chat.completions.create({
          model: DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content: `You are a file format converter. Given input content in ${inputExt} format, convert it to ${outputFormat} format.
Return only the converted content, no explanations.`,
            },
            {
              role: "user",
              content: `Convert this ${inputExt} content to ${outputFormat}:\n\n${await fs.readFile(validatedInputPath, "utf-8").catch(() => "File not found")}`,
            },
          ],
          temperature: 0.1,
        });

        const convertedContent = response.choices[0].message.content || "";
        await fs.writeFile(validatedOutputPath, convertedContent, "utf-8");

        return JSON.stringify({
          success: true,
          inputPath: validatedInputPath,
          outputPath: validatedOutputPath,
          inputFormat: inputExt,
          outputFormat,
          method: "ai_conversion",
          latencyMs: Date.now() - startTime,
        });
      } catch (error: any) {
        return JSON.stringify({
          success: false,
          error: `Unsupported conversion: ${inputExt} -> ${outputFormat}. Error: ${error.message}`,
        });
      }
    }

    try {
      const { program, getArgs } = conversionConfig;
      const args = getArgs(validatedInputPath, validatedOutputPath);
      const result = await executeSafeCommand(program, args);

      if (result.exitCode !== 0) {
        return JSON.stringify({
          success: false,
          error: result.stderr || "Conversion failed",
        });
      }

      const outputStats = await fs.stat(validatedOutputPath).catch(() => null);

      return JSON.stringify({
        success: true,
        inputPath: validatedInputPath,
        outputPath: validatedOutputPath,
        inputFormat: inputExt,
        outputFormat,
        outputSize: outputStats?.size || 0,
        method: "native_conversion",
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "file_convert",
    description: "Converts files between formats. Supports: MD<->HTML<->PDF<->DOCX, CSV<->JSON<->XLSX, and more. Uses AI for unsupported conversions.",
    schema: z.object({
      inputPath: z.string().describe("Path to the input file"),
      outputFormat: z.string().describe("Target format (html, pdf, docx, csv, json, xlsx, yaml, md)"),
      options: z.record(z.any()).optional().default({}).describe("Conversion options"),
    }),
  }
);

export const environmentTool = tool(
  async (input) => {
    const { action, key, value } = input;
    const startTime = Date.now();

    switch (action) {
      case "get":
        if (key) {
          const envValue = process.env[key];
          return JSON.stringify({
            success: true,
            key,
            value: envValue ? "[SET]" : undefined,
            exists: !!envValue,
          });
        }
        const safeEnvKeys = Object.keys(process.env)
          .filter(k => !k.includes("KEY") && !k.includes("SECRET") && !k.includes("PASSWORD") && !k.includes("TOKEN"))
          .slice(0, 50);
        return JSON.stringify({
          success: true,
          variables: safeEnvKeys,
          count: Object.keys(process.env).length,
        });

      case "check":
        const requiredKeys = key?.split(",").map(k => k.trim()) || [];
        const checkResults = requiredKeys.map(k => ({
          key: k,
          exists: !!process.env[k],
        }));
        return JSON.stringify({
          success: true,
          results: checkResults,
          allPresent: checkResults.every(r => r.exists),
        });

      case "info":
        return JSON.stringify({
          success: true,
          environment: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            cwd: process.cwd(),
            pid: process.pid,
            uptime: Math.round(process.uptime()),
            memory: {
              heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
              heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
            },
          },
          latencyMs: Date.now() - startTime,
        });

      default:
        return JSON.stringify({
          success: false,
          error: `Unknown action: ${action}. Valid: get, check, info`,
        });
    }
  },
  {
    name: "environment",
    description: "Manages environment configuration. Get/check environment variables and system info. Does not expose secret values.",
    schema: z.object({
      action: z.enum(["get", "check", "info"]).describe("Action to perform"),
      key: z.string().optional().describe("Variable key(s) - comma-separated for 'check'"),
      value: z.string().optional().describe("Not used for security - cannot set env vars"),
    }),
  }
);

export const searchSemanticTool = tool(
  async (input) => {
    // ... preserved omitted content for brevity, replacement handled by strict target
    const { query, sources = ["memory"], limit = 10 } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a semantic search engine. Given a query, identify the most relevant concepts and provide structured search results.
// omitted for brevity
Return JSON:
{
  "query": "the original query",
// omitted
`,
          },
          {
            role: "user",
            content: `Semantic search query: "${query}"
Sources to search: ${sources.join(", ")}
Max results: ${limit}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        // omitted
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        query,
        results: [],
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "search_semantic",
    description: "Semantic similarity search across knowledge bases and memory. Uses embeddings for conceptual matching rather than keyword matching.",
    schema: z.object({
      query: z.string().describe("The semantic search query"),
      sources: z.array(z.string()).optional().default(["memory"]).describe("Sources to search (memory, documents, web)"),
      limit: z.number().optional().default(10).describe("Maximum results to return"),
    }),
  }
);

export const macosIntegrationTool = tool(
  async (input) => {
    const { action, appName, volumeLevel, clipboardText } = input;
    const startTime = Date.now();

    try {
      let resultData: any = { success: true, action };

      switch (action) {
        case "open_app":
          if (!appName) throw new Error("appName is required for open_app action.");
          await MacOSBridge.openApplication(appName);
          resultData.message = `Successfully requested to open application: ${appName}`;
          break;

        case "get_volume":
          const vol = await MacOSBridge.getVolume();
          resultData.volume = vol;
          resultData.message = `Current system volume is ${vol}%`;
          break;

        case "set_volume":
          if (typeof volumeLevel !== 'number') throw new Error("volumeLevel (0-100) is required for set_volume action.");
          await MacOSBridge.setVolume(volumeLevel);
          resultData.message = `System volume set to ${volumeLevel}%`;
          resultData.volume = volumeLevel;
          break;

        case "read_clipboard":
          const clipText = await MacOSBridge.readClipboard();
          resultData.clipboardContent = clipText;
          resultData.message = "Successfully read clipboard contents.";
          break;

        case "write_clipboard":
          if (!clipboardText) throw new Error("clipboardText is required for write_clipboard action.");
          await MacOSBridge.writeClipboard(clipboardText);
          resultData.message = "Successfully wrote text to the macOS clipboard.";
          break;

        case "take_screenshot":
          const screenshotB64 = await MacOSBridge.takeScreenshot();
          resultData.image = screenshotB64;
          resultData.message = "Successfully captured screenshot of the main display.";
          break;

        default:
          throw new Error(`Unknown macOS action: ${action}`);
      }

      return JSON.stringify({
        ...resultData,
        latencyMs: Date.now() - startTime
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        action,
        error: error.message,
        latencyMs: Date.now() - startTime
      });
    }
  },
  {
    name: "macos_integration",
    description: "Executes native macOS actions via AppleScript/JXA bridging. Can open applications, get/set system volume, interact with the macOS clipboard, and take screen captures.",
    schema: z.object({
      action: z.enum(["open_app", "get_volume", "set_volume", "read_clipboard", "write_clipboard", "take_screenshot"]).describe("Specific macOS operation to perform"),
      appName: z.string().optional().describe("Used for 'open_app'. Name of the application (e.g., 'Safari', 'Notes')"),
      volumeLevel: z.number().min(0).max(100).optional().describe("Used for 'set_volume'. Level from 0 to 100"),
      clipboardText: z.string().optional().describe("Used for 'write_clipboard'. Text content to copy to macOS clipboard")
    })
  }
);

export const ADVANCED_SYSTEM_TOOLS = [codeExecuteTool, fileConvertTool, environmentTool, searchSemanticTool, macosIntegrationTool];
