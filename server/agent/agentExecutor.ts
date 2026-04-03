import { z } from "zod";
import type { Response } from "express";
import { toolRegistry, type ToolContext, type ToolResult } from "./toolRegistry";
import { emitTraceEvent } from "./unifiedChatHandler";
import type { RequestSpec } from "./requestSpec";

import { randomUUID } from "crypto";
import { getGeminiClientOrThrow } from "../lib/gemini";
import { requestUnderstandingAgent } from "./requestUnderstanding";
import OpenAI from "openai";
import {
  AGENT_TOOLS as OPENCLAW_TOOLS,
  executeToolCall as executeOpenClawToolCall,
  type ToolCall as OpenClawToolCall,
} from "../agents/toolEngine";
import { parseToolCallsFromText, buildToolCallingSystemPrompt, stripToolCallsFromText } from "./toolCallParser";
import {
  ToolHealthTracker,
  smartTruncate,
  buildToolProgressMessage,
  categorizeError,
  buildContextPruningStrategy,
} from "./toolExecutionEngine";

export interface AgentExecutorOptions {
  maxIterations?: number;
  timeout?: number;
  runId: string;
  userId: string;
  chatId: string;
  requestSpec: RequestSpec;
  accessLevel?: 'owner' | 'trusted' | 'unknown';
}

const HIGH_RISK_PATTERNS: Array<{ tool: string; pattern: RegExp; reason: string }> = [
  { tool: "bash", pattern: /\brm\s+(-rf?\s+)?\/(?:etc|usr|var|boot|sys|proc)\b/, reason: "Deleting system directories" },
  { tool: "bash", pattern: /\bmv\s+.*\s+\/(?:dev\/null|tmp)\b/, reason: "Moving files to destructive targets" },
  { tool: "bash", pattern: /\bcurl\b.*\|\s*(?:bash|sh)\b/, reason: "Piping remote script to shell" },
  { tool: "bash", pattern: /\bwget\b.*\|\s*(?:bash|sh)\b/, reason: "Piping remote script to shell" },
  { tool: "bash", pattern: /\bnpm\s+publish\b/, reason: "Publishing package to registry" },
  { tool: "bash", pattern: /\bgit\s+push\s+.*--force\b/, reason: "Force pushing to git" },
  { tool: "write_file", pattern: /^\/etc\/|^\/usr\/|^\/var\//, reason: "Writing to system directory" },
  { tool: "edit_file", pattern: /^\/etc\/|^\/usr\/|^\/var\//, reason: "Editing system file" },
];

function isHighRiskAction(toolName: string, args: Record<string, any>): { risky: boolean; reason: string } {
  const checkValue = toolName === "bash" ? (args.command || "") : (args.file_path || args.filepath || "");
  for (const rule of HIGH_RISK_PATTERNS) {
    if (rule.tool === toolName && rule.pattern.test(checkValue)) {
      return { risky: true, reason: rule.reason };
    }
  }
  return { risky: false, reason: "" };
}

class CircuitBreaker {
  private failures: Map<string, number> = new Map();
  private tripped: Set<string> = new Set();
  private threshold: number;

  constructor(threshold = 3) {
    this.threshold = threshold;
  }

  recordFailure(toolName: string): void {
    const count = (this.failures.get(toolName) || 0) + 1;
    this.failures.set(toolName, count);
    if (count >= this.threshold) {
      this.tripped.add(toolName);
      console.warn(`[CircuitBreaker] Tool "${toolName}" tripped after ${count} failures`);
    }
  }

  recordSuccess(toolName: string): void {
    this.failures.set(toolName, 0);
  }

  isTripped(toolName: string): boolean {
    return this.tripped.has(toolName);
  }

  getStatus(): Record<string, { failures: number; tripped: boolean }> {
    const status: Record<string, { failures: number; tripped: boolean }> = {};
    for (const [name, count] of this.failures) {
      status[name] = { failures: count, tripped: this.tripped.has(name) };
    }
    return status;
  }
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode || 0;
      const isRetryable = status === 429 || status === 503 || status === 502 || err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT";
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      console.log(`[RetryBackoff] Attempt ${attempt + 1} failed (${status || err.code}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

import { type FunctionDeclaration, AGENT_TOOLS } from "../config/agentTools";
import { runCerebroPipeline, shouldUseCerebro, type SubtaskNode, type CerebroWorldModel } from "./cerebro";
import { BudgetManager } from "./budgetManager";

import { zodToJsonSchema } from "zod-to-json-schema";
import { BUNDLED_SKILL_TOOLS } from "./tools/bundledSkillTools";
import { modelRouter } from "./modelRouter";

const dynamicSkillTools: FunctionDeclaration[] = BUNDLED_SKILL_TOOLS.map(t => {
  const schema = zodToJsonSchema(t.inputSchema, { target: "jsonSchema7" }) as any;
  // Remove unsupported keywords for Gemini
  if (schema.$schema) delete schema.$schema;
  if (schema.additionalProperties !== undefined) delete schema.additionalProperties;

  return {
    name: t.name,
    description: t.description,
    parameters: schema
  };
});

const LOCAL_FILESYSTEM_SIGNAL_REGEX =
  /\b(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b.*\b(?:mac|computadora|pc|laptop|sistema|escritorio|desktop|descargas|downloads|documentos|documents|home|disco)\b|\b(?:analiza|explora|listar|list|revisa|cuenta|count|cu[aá]ntas?)\b.*\b(?:mi\s+(?:mac|computadora|pc)|desktop|escritorio|home)\b|\b(?:cu[aá]ntas?|how\s+many|cantidad(?:\s+de)?|n[uú]mero(?:\s+de)?)\s+(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b/i;
const SKILL_SIGNAL_REGEX = /\b(skill|skills|habilidad|habilidades)\b|\$[a-z0-9_-]{2,80}/i;

function tokenizePrompt(rawPrompt: string): string[] {
  return String(rawPrompt || "")
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñ_-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function getRelevantDynamicSkillTools(rawPrompt: string, maxTools = 8): FunctionDeclaration[] {
  if (!SKILL_SIGNAL_REGEX.test(rawPrompt)) {
    return [];
  }
  const tokens = tokenizePrompt(rawPrompt);
  if (tokens.length === 0) {
    return dynamicSkillTools.slice(0, maxTools);
  }

  const scored = dynamicSkillTools
    .map((tool) => {
      const haystack = `${tool.name} ${tool.description || ""}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 1;
        }
      }
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxTools).map((entry) => entry.tool);
}

function withToolSubset(tools: FunctionDeclaration[], names: string[]): FunctionDeclaration[] {
  const allowed = new Set(names);
  return tools.filter((tool) => allowed.has(tool.name));
}

function getToolsForIntent(
  intent: string,
  accessLevel: 'owner' | 'trusted' | 'unknown' = 'owner',
  rawPrompt = "",
): FunctionDeclaration[] {
  const toolPool = [...AGENT_TOOLS, ...getRelevantDynamicSkillTools(rawPrompt)];
  let matchedTools = toolPool;

  if (accessLevel !== 'owner') {
    const sensitiveToolPatterns = ["browse_and_act", "skill_shell", "skill_run_command", "skill_system", "skill_file", "openclaw_clawi_exec"];
    matchedTools = matchedTools.filter(t => !sensitiveToolPatterns.some(pattern => t.name.includes(pattern)));
  }

  if (accessLevel === 'unknown') {
    const safeToolPatterns = ["web_search", "fetch_url", "analyze_data", "list_files", "read_file", "memory_search"];
    matchedTools = matchedTools.filter(t => safeToolPatterns.some(pattern => t.name.includes(pattern)));
  }

  return matchedTools;
}

import {
  type ReservationDetails,
  type ReservationMissingField,
  extractReservationDetails,
  getMissingReservationFields,
  isRestaurantReservationRequest,
  normalizeSpaces,
  formatReservationDetails,
  buildReservationClarificationQuestion
} from "./utils/reservationExtractor";

async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  context: ToolContext,
  runId: string,
  sseRes?: Response,
  preExtractedReservation?: ReservationDetails
): Promise<{ result: any; artifact?: { type: string; url: string; name: string } }> {
  console.log(`[AgentExecutor] Executing tool: ${toolName}`, args);

  await emitTraceEvent(runId, "tool_call_started", {
    toolCall: {
      id: randomUUID(),
      name: toolName,
      input: args,
      status: "running"
    }
  });

  const startTime = Date.now();
  let result: any;
  let artifact: { type: string; url: string; name: string } | undefined;

  try {
    switch (toolName) {
      case "web_search": {
        try {
          // Use DuckDuckGo search directly (avoids toolRegistry network policy blocks)
          const { searchWeb } = await import("../services/webSearch");
          const searchResult = await searchWeb(args.query, args.maxResults || 5);
          result = searchResult.results?.length > 0
            ? searchResult.results.map((r: any) => ({ title: r.title, url: r.url, snippet: r.snippet }))
            : { message: "No results found", query: args.query };
        } catch (err: any) {
          // Fallback to toolRegistry
          const searchResult = await toolRegistry.execute("search", {
            query: args.query,
            maxResults: args.maxResults || 5
          }, context);
          result = searchResult.success ? searchResult.output : { error: searchResult.error?.message };
        }
        break;
      }

      case "fetch_url": {
        try {
          const { fetchUrl } = await import("../services/webSearch");
          const fetchResult = await fetchUrl(args.url, {
            extractText: args.extractText ?? true,
            maxLength: 50000
          });
          result = fetchResult;
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "rag_index_document": {
        try {
          const { ragService } = await import("../services/ragService");
          const userId = context.userId || "anonymous";
          const indexResult = await ragService.indexDocument(userId, args.content, {
            fileName: args.fileName,
            fileType: args.fileType,
            chatId: context.chatId,
            sourceUrl: args.sourceUrl,
          });
          result = { success: true, chunks: indexResult.chunks, docId: indexResult.docId };
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "openclaw_rag_search": {
        try {
          const { ragService } = await import("../services/ragService");
          const userId = context.userId || "anonymous";
          const searchResults = await ragService.search(userId, args.query, {
            limit: args.limit || 5,
            chatId: args.chatId,
            minScore: args.minScore || 0.2,
          });
          result = { results: searchResults, count: searchResults.length };
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }


      case "analyze_data": {
        try {
          // Dynamic import to keep startup fast
          const ss = await import("simple-statistics");

          let parsedData: any[] = [];
          if (typeof args.data === "string") {
            try {
              parsedData = JSON.parse(args.data);
            } catch {
              // Try CSV parsing if JSON fails? For now rely on description or basic numbers
              result = { error: "Could not parse data as JSON" };
            }
          } else if (Array.isArray(args.data)) {
            parsedData = args.data;
          }

          if (parsedData.length > 0) {
            // Extract numeric values if it's an array of objects
            const valueKeys = Object.keys(parsedData[0]).filter(k => typeof parsedData[0][k] === 'number');
            const insights: string[] = [];

            valueKeys.forEach(key => {
              const values = parsedData.map((d: any) => d[key]);
              const mean = ss.mean(values);
              const median = ss.median(values);
              const max = ss.max(values);
              const min = ss.min(values);
              const stdDev = ss.standardDeviation(values);

              insights.push(`Field '${key}': Mean=${mean.toFixed(2)}, Median=${median}, Range=[${min}, ${max}], StdDev=${stdDev.toFixed(2)}`);
            });

            result = {
              summary: `Analysis performed on ${parsedData.length} records.`,
              type: args.analysisType || "statistical",
              insights,
              stats: {
                recordCount: parsedData.length,
                fieldsAnalyzed: valueKeys
              }
            };
          } else {
            result = { error: "No valid data provided for analysis" };
          }
        } catch (e: any) {
          result = { error: `Analysis failed: ${e.message}` };
        }
        break;
      }

      case "generate_chart": {
        // Return a structured Chart.js/Recharts compatible config
        const chartConfig = {
          type: args.chartType,
          data: args.data, // Expects { labels: [], datasets: [{ label: '', data: [] }] }
          options: {
            responsive: true,
            plugins: {
              title: {
                display: true,
                text: args.title
              },
              legend: {
                position: 'top'
              }
            }
          }
        };

        result = {
          success: true,
          chartType: args.chartType,
          title: args.title,
          config: chartConfig,
          message: "Chart configuration generated successfully"
        };
        break;
      }

      case "run_code": {
        try {
          const { execSync } = await import("child_process");
          const { randomUUID: genId } = await import("crypto");
          const lang = args.language || "javascript";
          const timeout = Math.min((args.timeout || 30) * 1000, 120000);
          const code = String(args.code || "");
          if (code.length > 100000) { result = { error: "Code too large (max 100KB)" }; break; }
          let stdout: string;
          const uniqueId = genId().replace(/-/g, "");
          if (lang === "python") {
            const fs = await import("fs");
            const tmpFile = `/tmp/agent_code_${uniqueId}.py`;
            fs.writeFileSync(tmpFile, code);
            try {
              stdout = execSync(`python3 ${tmpFile}`, { timeout, encoding: "utf8", maxBuffer: 1024 * 1024 });
            } finally { try { fs.unlinkSync(tmpFile); } catch {} }
          } else {
            const fs = await import("fs");
            const tmpFile = `/tmp/agent_code_${uniqueId}.js`;
            fs.writeFileSync(tmpFile, code);
            try {
              stdout = execSync(`node ${tmpFile}`, { timeout, encoding: "utf8", maxBuffer: 1024 * 1024 });
            } finally { try { fs.unlinkSync(tmpFile); } catch {} }
          }
          result = { success: true, stdout: stdout.slice(0, 10000), exitCode: 0 };
        } catch (err: any) {
          result = { success: false, stdout: (err.stdout || "").slice(0, 5000), stderr: (err.stderr || err.message || "").slice(0, 5000), exitCode: err.status || 1 };
        }
        break;
      }

      case "bash": {
        const BASH_BLOCKLIST = /\b(rm\s+-rf\s+\/|dd\s+if=|mkfs|shutdown|reboot|chmod\s+777|curl\s*\|.*bash|wget\s*\|.*sh|>\s*\/etc\/|>\s*\/dev\/|kill\s+-9\s+1\b|init\s+0)/i;
        try {
          const { execSync } = await import("child_process");
          const timeout = Math.min((args.timeout || 30) * 1000, 120000);
          const cmd = String(typeof args === "string" ? args : (args.command || args.cmd || ""));
          if (!cmd.trim()) { result = { error: "Empty command" }; break; }
          if (BASH_BLOCKLIST.test(cmd)) { result = { error: "Command blocked by security policy" }; break; }
          const stdout = execSync(cmd, { timeout, encoding: "utf8", maxBuffer: 1024 * 1024, cwd: process.cwd() });
          result = { success: true, stdout: stdout.slice(0, 10000), exitCode: 0 };
        } catch (err: any) {
          result = { success: false, stdout: (err.stdout || "").slice(0, 5000), stderr: (err.stderr || err.message || "").slice(0, 5000), exitCode: err.status || 1 };
        }
        break;
      }

      case "write_file": {
        try {
          const fs = await import("fs");
          const pathMod = await import("path");
          const filepath = String(args.file_path || args.filepath || args.path || args.file || "");
          if (!filepath) { result = { error: "No filepath provided" }; break; }
          const resolved = pathMod.resolve(filepath);
          const BLOCKED_PREFIXES = ["/etc/", "/dev/", "/proc/", "/sys/", "/boot/", "/usr/", "/sbin/", "/bin/"];
          if (BLOCKED_PREFIXES.some(p => resolved.startsWith(p))) {
            result = { error: `Write to ${resolved} blocked by security policy` }; break;
          }
          const content = String(args.content || "");
          if (Buffer.byteLength(content) > 10 * 1024 * 1024) { result = { error: "Content too large (max 10MB)" }; break; }
          const dir = pathMod.dirname(resolved);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(resolved, content, "utf8");
          result = { success: true, filepath: resolved, bytesWritten: Buffer.byteLength(content) };
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "edit_file": {
        try {
          const fs = await import("fs");
          const pathMod = await import("path");
          const filepath = String(args.file_path || args.filepath || args.path || args.file || "");
          if (!filepath) { result = { error: "No filepath provided" }; break; }
          const resolved = pathMod.resolve(filepath);
          const BLOCKED_PREFIXES = ["/etc/", "/dev/", "/proc/", "/sys/", "/boot/", "/usr/", "/sbin/", "/bin/"];
          if (BLOCKED_PREFIXES.some(p => resolved.startsWith(p))) {
            result = { error: `Edit of ${resolved} blocked by security policy` }; break;
          }
          if (!fs.existsSync(resolved)) {
            result = { error: `File not found: ${resolved}` }; break;
          }
          const oldString = args.old_string || args.oldString || args.old;
          const newString = args.new_string !== undefined ? args.new_string : (args.newString !== undefined ? args.newString : args.new);
          if (oldString !== undefined && oldString !== null) {
            const existingContent = fs.readFileSync(resolved, "utf8");
            if (!existingContent.includes(oldString)) {
              result = { error: `old_string not found in file. The exact text to replace was not found. Use read_file to see current content.` }; break;
            }
            const updatedContent = existingContent.replace(oldString, newString ?? "");
            fs.writeFileSync(resolved, updatedContent, "utf8");
            result = { success: true, filepath: resolved, replacements: 1 };
          } else if (args.content !== undefined) {
            fs.writeFileSync(resolved, String(args.content), "utf8");
            result = { success: true, filepath: resolved, bytesWritten: Buffer.byteLength(String(args.content)) };
          } else {
            result = { error: "edit_file requires either (old_string + new_string) or content" };
          }
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "process_list": {
        try {
          const { execSync } = await import("child_process");
          const sortCol = args.sortBy === "mem" ? "-k4" : args.sortBy === "pid" ? "-k1" : "-k3";
          const limit = Math.min(Math.max(parseInt(String(args.limit || "30"), 10) || 30, 1), 100);
          const raw = execSync(`ps aux --sort=${sortCol}r | head -n ${limit + 1}`, { encoding: "utf8", timeout: 10000 });
          const lines = raw.trim().split("\n");
          const processes = lines.slice(1).map(line => {
            const parts = line.trim().split(/\s+/);
            return { user: parts[0], pid: parts[1], cpu: parts[2], mem: parts[3], command: parts.slice(10).join(" ") };
          });
          const filterStr = String(args.filter || "");
          const filtered = filterStr ? processes.filter(p => p.command.toLowerCase().includes(filterStr.toLowerCase())) : processes;
          result = { processes: filtered, count: filtered.length };
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "port_check": {
        try {
          const { execSync } = await import("child_process");
          const portNum = parseInt(String(args.port || "0"), 10);
          if (args.port && (isNaN(portNum) || portNum < 1 || portNum > 65535)) {
            result = { error: "Invalid port number (must be 1-65535)" }; break;
          }
          if (portNum > 0) {
            const raw = execSync(`ss -tlnp | grep ':${portNum} '`, { encoding: "utf8", timeout: 5000 }).trim();
            result = { port: portNum, listening: raw.length > 0, details: raw || "Port not in use" };
          } else {
            const raw = execSync(`ss -tlnp`, { encoding: "utf8", timeout: 5000 }).trim();
            result = { ports: raw.split("\n").slice(1).map(l => l.trim()).filter(Boolean) };
          }
        } catch (err: any) {
          result = { port: args.port, listening: false, details: "Port not in use or command failed" };
        }
        break;
      }

      case "read_file": {
        try {
          const fs = await import("fs");
          const pathMod = await import("path");
          const filepath = String(args.filepath || args.path || args.file || "");
          if (!filepath) { result = { error: "No filepath provided" }; break; }
          const resolved = pathMod.resolve(filepath);
          const cwd = process.cwd();
          const home = process.env.HOME || "/home/runner";
          const allowedRoots = [cwd, home, "/tmp"];
          const denyPatterns = ["/etc/shadow", "/etc/passwd", "/.env", "/node_modules/", "/.git/"];
          const realResolved = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
          const inAllowed = allowedRoots.some(r => realResolved.startsWith(r));
          const isDenied = denyPatterns.some(p => realResolved.includes(p));
          if (!inAllowed || isDenied) { result = { error: `Access denied: ${filepath}` }; break; }
          if (!fs.existsSync(resolved)) { result = { error: `File not found: ${resolved}` }; break; }
          const stat = fs.statSync(resolved);
          if (stat.isDirectory()) { result = { error: `Path is a directory, use list_files instead: ${resolved}` }; break; }
          if (stat.size > 5 * 1024 * 1024) { result = { error: "File too large (max 5MB for reading)" }; break; }
          const content = fs.readFileSync(resolved, "utf8");
          const maxLines = Math.max(1, Math.min(args.maxLines || 500, 2000));
          const lines = content.split("\n");
          const truncated = lines.length > maxLines;
          result = { 
            success: true, filepath: resolved, 
            content: truncated ? lines.slice(0, maxLines).join("\n") + `\n... [truncated, ${lines.length - maxLines} more lines]` : content,
            lines: lines.length, size: stat.size 
          };
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "list_files": {
        try {
          const fs = await import("fs");
          const pathMod = await import("path");
          const dirPath = String(args.directory || args.path || args.dir || ".");
          const resolved = pathMod.resolve(dirPath);
          const cwd = process.cwd();
          const home = process.env.HOME || "/home/runner";
          const allowedRoots = [cwd, home, "/tmp"];
          const denyPatterns = ["/etc/shadow", "/.env", "/.git/"];
          const realResolved = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
          const inAllowed = allowedRoots.some(r => realResolved.startsWith(r));
          const isDenied = denyPatterns.some(p => realResolved.includes(p));
          if (!inAllowed || isDenied) { result = { error: `Access denied: ${dirPath}` }; break; }
          if (!fs.existsSync(resolved)) { result = { error: `Directory not found: ${resolved}` }; break; }
          const entries = fs.readdirSync(resolved, { withFileTypes: true });
          const maxEntries = Math.max(1, Math.min(args.maxEntries || 200, 500));
          const files = entries.slice(0, maxEntries).map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            path: pathMod.join(resolved, entry.name),
          }));
          result = { 
            success: true, directory: resolved, 
            entries: files, count: entries.length,
            truncated: entries.length > maxEntries
          };
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "grep_search": {
        try {
          const { execFileSync } = await import("child_process");
          const pathMod = await import("path");
          const pattern = String(args.pattern || "");
          if (!pattern) { result = { error: "No search pattern provided" }; break; }
          const rawDir = String(args.directory || process.cwd());
          const resolvedDir = pathMod.resolve(rawDir);
          const BLOCKED_SEARCH_PREFIXES = ["/etc/", "/dev/", "/proc/", "/sys/", "/boot/", "/usr/", "/sbin/", "/bin/"];
          if (BLOCKED_SEARCH_PREFIXES.some(p => resolvedDir.startsWith(p))) {
            result = { error: `Search in ${resolvedDir} blocked by security policy` }; break;
          }
          const maxResults = Math.min(args.max_results || 50, 200);
          const grepArgs: string[] = ["-rn", "--color=never", `-m`, String(maxResults)];
          if (args.include) {
            const includeVal = String(args.include).replace(/[^a-zA-Z0-9.*?_\-\/]/g, "");
            if (includeVal) grepArgs.push(`--include=${includeVal}`);
          }
          grepArgs.push("--", pattern, resolvedDir);
          let stdout = "";
          try {
            stdout = execFileSync("grep", grepArgs, { timeout: 15000, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
          } catch (e: any) {
            stdout = e.stdout || "";
          }
          const lines = stdout.trim().split("\n").filter(Boolean).slice(0, maxResults);
          const matches = lines.map(line => {
            const colonIdx = line.indexOf(":");
            const secondColon = line.indexOf(":", colonIdx + 1);
            return {
              file: line.substring(0, colonIdx),
              line: parseInt(line.substring(colonIdx + 1, secondColon), 10) || 0,
              content: line.substring(secondColon + 1).trim(),
            };
          });
          result = { success: true, matches, count: matches.length, pattern };
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      default: {
        const toolResult = await toolRegistry.execute(toolName, args, context);
        result = toolResult.success ? toolResult.output : { error: toolResult.error?.message };
      }
    }

    const durationMs = Date.now() - startTime;

    await emitTraceEvent(runId, "tool_call_succeeded", {
      toolCall: {
        id: randomUUID(),
        name: toolName,
        input: args,
        output: result,
        status: "completed",
        durationMs
      }
    });

    return { result, artifact };

  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    await emitTraceEvent(runId, "tool_call_failed", {
      toolCall: {
        id: randomUUID(),
        name: toolName,
        input: args,
        status: "failed",
        error: error.message,
        durationMs
      }
    });

    return { result: { error: error.message } };
  }
}

function collectRecentUserText(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((m) => m.role === "user")
    .slice(-4)
    .map((m) => normalizeSpaces(m.content))
    .filter(Boolean)
    .join(" ");
}

function extractExplicitPath(rawText: string): string | null {
  const text = String(rawText || "");
  const absolutePath = text.match(/(\/[^\s"'`]+)/);
  if (absolutePath?.[1]) {
    return absolutePath[1];
  }
  const homePath = text.match(/(~\/[^\s"'`]+)/);
  if (homePath?.[1]) {
    return homePath[1];
  }
  return null;
}

function inferLocalDirectoryFromPrompt(rawText: string): string {
  const explicit = extractExplicitPath(rawText);
  if (explicit) return explicit;

  const lower = String(rawText || "").toLowerCase();
  if (/\b(escritorio|desktop)\b/i.test(lower)) return "~/Desktop";
  if (/\b(descargas|downloads)\b/i.test(lower)) return "~/Downloads";
  if (/\b(documentos|documents)\b/i.test(lower)) return "~/Documents";
  if (/\b(im[aá]genes|pictures|fotos|photos)\b/i.test(lower)) return "~/Pictures";
  if (/\b(m[uú]sica|music)\b/i.test(lower)) return "~/Music";
  if (/\b(videos|movies)\b/i.test(lower)) return "~/Movies";
  return "~";
}

export async function executeAgentLoop(
  messages: Array<{ role: string; content: string }>,
  res: Response,
  options: AgentExecutorOptions
): Promise<string> {
  const ai = getGeminiClientOrThrow();
  const { runId, userId, chatId, requestSpec, maxIterations = 25, accessLevel = 'owner' } = options;

  const writeSse = (event: string, payload: Record<string, unknown>) => {
    try {
      const r = res as any;
      if (r.writableEnded || r.destroyed) return false;
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      if (typeof r.flush === "function") r.flush();
      return true;
    } catch {
      return false;
    }
  };

  const sse = {
    write: (event: string, payload: Record<string, unknown>) => writeSse(event, payload),
    end: () => {
      try {
        const r = res as any;
        if (!r.writableEnded && !r.destroyed) {
          res.end();
        }
      } catch {
        // ignore
      }
    },
  };

  const tools = getToolsForIntent(requestSpec.intent, accessLevel, requestSpec.rawMessage || "");
  const toolContext: ToolContext = { userId, chatId, runId };

  const artifacts: Array<{ type: string; url: string; name: string }> = [];
  let iteration = 0;
  let conversationHistory = [...messages];
  let fullResponse = "";
  const circuitBreaker = new CircuitBreaker(3);
  const toolHealth = new ToolHealthTracker();
  let totalTokensUsed = 0;
  let consecutiveLoopErrors = 0;

  const defaultModel = process.env.AGENT_MODEL || "google/gemini-2.5-flash";
  const budgetMgr = new BudgetManager(runId, defaultModel, { maxIterations: maxIterations });

  const recentUserText = collectRecentUserText(messages) || requestSpec.rawMessage || "";
  const isLocalFsRequest = LOCAL_FILESYSTEM_SIGNAL_REGEX.test(recentUserText || requestSpec.rawMessage || "");

  try {
    const { promptInjectionDetector } = await import("./security/promptInjectionDetector");
    const { governanceModeManager } = await import("./governance/modeManager");
    const injectionResult = promptInjectionDetector.scanUserInput(recentUserText, userId);
    if (injectionResult.blocked) {
      sse.write("security_block", { runId, reason: "prompt_injection_detected", severity: injectionResult.severity });
      const msg = "Tu solicitud fue bloqueada por el sistema de seguridad. Por favor reformula tu mensaje.";
      sse.write("chunk", { content: msg, sequence: 1, runId });
      sse.end();
      return msg;
    }
    const perms = governanceModeManager.getPermissions();
    if (!perms.allowCodeExecution && requestSpec.intent === "code_execution") {
      sse.write("governance_block", { runId, reason: "mode_restriction", mode: governanceModeManager.getMode() });
      const msg = `Ejecución de código no permitida en modo ${governanceModeManager.getMode()}.`;
      sse.write("chunk", { content: msg, sequence: 1, runId });
      sse.end();
      return msg;
    }
  } catch {
    // Security checks are best-effort; don't block execution if they fail
  }

  // Request understanding brief is best-effort: if the planner LLM is unavailable
  // or the call fails for any reason, we continue without the brief rather than
  // aborting the entire agent loop (which would surface as a generic error).
  let requestBrief: Awaited<ReturnType<typeof requestUnderstandingAgent.buildBrief>> | null = null;
  try {
    requestBrief = await requestUnderstandingAgent.buildBrief({
      text: recentUserText || requestSpec.rawMessage || "",
      conversationHistory: messages
        .slice(-6)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content || "") })),
      availableTools: tools.map((tool) => tool.name),
      userId,
      chatId,
      requestId: runId,
      userPlan: "free",
    });

    sse.write("brief", {
      runId,
      brief: requestBrief,
    });

    if (requestBrief.blocker?.is_blocked) {
      const blockerReason = String(requestBrief.blocker.question || "").toLowerCase();
      const blockerSeverity = String((requestBrief.blocker as any).severity || "").toLowerCase();
      const isCriticalBySeverity = ["high", "critical"].includes(blockerSeverity);
      const isCriticalByKeyword = /destruc|eliminar|delete|peligro|irreversible|drop\s+table|rm\s+-rf|format|wipe|purge|credential|password|secret|sudo|admin|root|payment|transfer|money|dinero|pago/.test(blockerReason);
      const isCriticalBlocker = isCriticalBySeverity || isCriticalByKeyword;
      
      if (isCriticalBlocker) {
        const question =
          normalizeSpaces(requestBrief.blocker.question || "") ||
          "Necesito una aclaración para ejecutar la solicitud con seguridad.";
        fullResponse = question;

        sse.write("clarification", {
          runId,
          question,
          blocker: "intent_requirements",
        });

        const chunks = question.match(/.{1,100}/g) || [question];
        for (let i = 0; i < chunks.length; i++) {
          sse.write("chunk", {
            content: chunks[i],
            sequence: i + 1,
            runId,
          });
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        return fullResponse;
      }
      console.log(`[AgentExecutor] Non-critical blocker bypassed: ${blockerReason.slice(0, 100)}`);
    }

    conversationHistory.unshift({
      role: "system",
      content: `Execution brief:
- Objective: ${requestBrief.objective}
- Scope(in): ${requestBrief.scope.in_scope.join("; ") || "n/a"}
- Required inputs: ${requestBrief.required_inputs.filter((entry) => entry.required).map((entry) => entry.input).join("; ") || "none"}
- Expected output: ${requestBrief.expected_output.format} :: ${requestBrief.expected_output.description}
- Definition of done: ${requestBrief.definition_of_done.join("; ") || "n/a"}
- Suggested tools: ${requestBrief.tool_routing.suggested_tools.join(", ") || "none"}
- Blocked tools: ${requestBrief.tool_routing.blocked_tools.join(", ") || "none"}
- Guardrails flags: ${requestBrief.guardrails.flags.join(", ") || "none"}`,
    });
  } catch (briefErr: any) {
    console.warn(`[AgentLoop] requestUnderstanding.buildBrief failed (non-fatal):`, briefErr?.message || briefErr);
  }

  const isReservationRequest =
    requestSpec.intent === "web_automation" && isRestaurantReservationRequest(recentUserText);
  const reservationDetails = isReservationRequest ? extractReservationDetails(recentUserText) : undefined;

  if (isReservationRequest && reservationDetails) {
    const missingFields = getMissingReservationFields(reservationDetails);
    if (missingFields.length > 0) {
      const clarificationQuestion = buildReservationClarificationQuestion(reservationDetails, missingFields);
      fullResponse = clarificationQuestion;
      sse.write("clarification", {
        runId,
        question: clarificationQuestion,
        missingFields,
      });
      const chunks = clarificationQuestion.match(/.{1,100}/g) || [clarificationQuestion];
      for (let i = 0; i < chunks.length; i++) {
        sse.write("chunk", {
          content: chunks[i],
          sequence: i + 1,
          runId
        });
        await new Promise(r => setTimeout(r, 10));
      }
      await emitTraceEvent(runId, "progress_update", {
        progress: {
          current: 0,
          total: maxIterations,
          message: "Waiting for missing reservation details from user"
        }
      });
      await emitTraceEvent(runId, "agent_completed", {
        agent: {
          name: requestSpec.primaryAgent,
          role: "primary",
          status: "completed"
        },
        iterations: 0,
        artifactsGenerated: 0,
      });
      return fullResponse;
    }
  }

  // For web_automation intent, inject a system hint so the LLM uses browse_and_act
  // We PREPEND it as the first system message for maximum priority
  if (requestSpec.intent === "web_automation") {
    const reservationHint =
      isReservationRequest && reservationDetails
        ? `\nReservation details extracted from the user: ${formatReservationDetails(reservationDetails)}`
        : "";
    conversationHistory.unshift({
      role: "system",
      content: `YOU ARE A WEB AUTOMATION AGENT. YOUR PRIMARY FUNCTION IS TO CALL TOOLS, NOT GENERATE TEXT.

YOU MUST IMMEDIATELY call the "browse_and_act" function to complete the user's request. DO NOT write text responses.

MANDATORY RULES:
1. Your FIRST action MUST be a function call to "browse_and_act" with a URL and goal
2. For restaurant reservations in Peru: url="https://www.mesa247.pe", goal="[full details from user]"
3. For hotel bookings: url="https://www.booking.com"
4. For flights: url="https://www.google.com/travel/flights"
5. For general web tasks: url="https://www.google.com"
6. The browse_and_act tool controls a REAL Chromium browser — it can click, type, scroll, fill forms, navigate
7. Include ALL details in the goal: date, time, number of people, location, contact details, preferences
8. For reservations, only claim success if a real confirmation page or confirmation code is visible.

DO NOT respond with text. CALL browse_and_act NOW.${reservationHint}`
    });
  }

  if (isLocalFsRequest) {
    const inferredDirectory = inferLocalDirectoryFromPrompt(recentUserText || requestSpec.rawMessage || "");
    conversationHistory.unshift({
      role: "system",
      content: `YOU ARE A LOCAL FILESYSTEM ANALYST.
You MUST inspect the user's local folders by calling tools, not by asking the user to run commands.

MANDATORY RULES:
1) Your first action should call "list_files".
2) If the user did not provide a path, start with directory="${inferredDirectory}".
3) Use additional list_files calls for key folders when useful (Desktop/Downloads/Documents).
4) Summarize findings clearly with concrete paths and counts.
5) NEVER tell the user to run /local or terminal commands manually.`,
    });
  }

  if (requestSpec.intent !== "web_automation" && !isLocalFsRequest) {
    const openclawToolNames = OPENCLAW_TOOLS.map(t => t.function.name).join(", ");
    const allToolNames = [
      "bash", "run_code", "read_file", "write_file", "edit_file", "list_files",
      "web_search", "fetch_url", "browse_and_act", "process_list", "port_check",
      "analyze_data", "generate_chart", "openclaw_rag_search", "rag_index_document",
      openclawToolNames,
      tools.map(t => t.name).join(", ")
    ].filter(Boolean).join(", ");

    const { getAgentOSASIPrompt } = await import("./prompts/agentosAsi");
    conversationHistory.unshift({
      role: "system",
      content: getAgentOSASIPrompt(allToolNames)
    });
  }

  console.log(`[AgentExecutor] Starting loop: intent=${requestSpec.intent}, tools=[${tools.map(t => t.name).join(', ')}], messages=${conversationHistory.length}, systemMsgs=${conversationHistory.filter(m => m.role === 'system').length}, toolDeclarations=${tools.length}`);

  const useCerebro = shouldUseCerebro(requestSpec.intent, recentUserText || requestSpec.rawMessage || "");
  if (useCerebro) {
    try {
      sse.write("thinking", {
        runId,
        step: "cerebro_pipeline",
        message: "Activando pipeline Cerebro: Planner → Executor → Critic → Judge",
        timestamp: Date.now(),
      });

      const cerebroExecutor = async (subtask: SubtaskNode, wm: CerebroWorldModel): Promise<string> => {
        const subtaskMessages = [
          ...conversationHistory,
          { role: "user", content: `Execute this subtask: ${subtask.label}\nDescription: ${subtask.description}${subtask.toolHint ? `\nSuggested tool: ${subtask.toolHint}` : ''}` },
        ];

        const geminiTools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));

        const response = await retryWithBackoff(() =>
          ai.models.generateContent({
            model: process.env.AGENT_MODEL || "gemini-2.5-flash",
            contents: subtaskMessages.filter(m => m.role !== "system").map(m => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            config: {
              systemInstruction: subtaskMessages.filter(m => m.role === "system").map(m => m.content).join("\n"),
              tools: [{ functionDeclarations: geminiTools }],
              temperature: 0.4,
              maxOutputTokens: 4000,
            },
          })
        );

        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const textParts: string[] = [];

        for (const part of parts) {
          if (part.functionCall) {
            const toolName = part.functionCall.name || "";
            const toolArgs = (part.functionCall.args || {}) as Record<string, any>;
            const { result } = await executeToolCall(toolName, toolArgs, toolContext, runId, res);
            wm.updateFromToolResult(toolName, toolArgs, result);
            textParts.push(`[Tool: ${toolName}] ${JSON.stringify(result).substring(0, 1000)}`);
          } else if (part.text) {
            textParts.push(part.text);
          }
        }

        return textParts.join("\n");
      };

      const cerebroResult = await runCerebroPipeline(
        recentUserText || requestSpec.rawMessage || "",
        conversationHistory.filter(m => m.role === "user").slice(-3).map(m => m.content).join("\n"),
        cerebroExecutor,
        runId,
        res,
      );

      sse.write("thinking", {
        runId,
        step: "cerebro_complete",
        message: `Cerebro: ${cerebroResult.judgeVerdict.approved ? 'Aprobado' : 'Parcial'} (confianza: ${cerebroResult.judgeVerdict.confidence.toFixed(2)})`,
        timestamp: Date.now(),
      });

      const cerebroSummary = cerebroResult.subtaskResults
        .map(r => r.result)
        .filter(Boolean)
        .join("\n\n");

      if (cerebroSummary.length > 0) {
        conversationHistory.push({
          role: "system",
          content: `[Cerebro Pipeline Results]\nObjective: ${cerebroResult.objective}\nJudge verdict: ${cerebroResult.judgeVerdict.approved ? 'APPROVED' : 'PARTIAL'} (confidence: ${cerebroResult.judgeVerdict.confidence.toFixed(2)})\nReasoning: ${cerebroResult.judgeVerdict.reasoning}\n\nSubtask outputs:\n${cerebroSummary.substring(0, 4000)}`,
        });
      }

      console.log(`[AgentExecutor] Cerebro pipeline completed: ${cerebroResult.subtaskResults.length} subtasks, judge=${cerebroResult.judgeVerdict.approved}`);
    } catch (cerebroErr: any) {
      console.warn(`[AgentExecutor] Cerebro pipeline failed (non-fatal), falling back to standard loop:`, cerebroErr?.message);
    }
  }

  await emitTraceEvent(runId, "progress_update", {
    progress: {
      current: 0,
      total: maxIterations,
      message: `Starting agent loop with ${tools.length} available tools`
    }
  });

  const intentToSteps: Record<string, string[]> = {
    web_automation: ["Analizando la solicitud", "Abriendo navegador", "Ejecutando acciones web", "Verificando resultados"],
    code_generation: ["Analizando requerimientos", "Buscando contexto en archivos", "Generando código", "Verificando resultado"],
    research: ["Analizando la pregunta", "Buscando información", "Sintetizando resultados"],
    document_analysis: ["Leyendo documentos", "Extrayendo información clave", "Preparando resumen"],
    chat: ["Procesando solicitud", "Preparando respuesta"],
  };
  const planSteps = intentToSteps[requestSpec?.intent || "chat"] || intentToSteps.chat;
  sse.write("plan", {
    runId,
    steps: planSteps.map((label, i) => ({ id: `step_${i}`, label, status: i === 0 ? "active" : "pending" })),
    intent: requestSpec?.intent || "chat",
    timestamp: Date.now(),
  });

  const keepaliveInterval = setInterval(() => {
    sse.write("keepalive", { runId, timestamp: Date.now() });
  }, 10000);

  try {

  while (iteration < maxIterations) {
    iteration++;

    const stepIdx = Math.min(iteration - 1, planSteps.length - 1);
    sse.write("exec_plan_update", {
      runId,
      stepId: `step_${stepIdx}`,
      status: "active",
      previousStepId: stepIdx > 0 ? `step_${stepIdx - 1}` : undefined,
      previousStatus: "done",
      timestamp: Date.now(),
    });

    sse.write("thinking", {
      runId,
      step: "iteration",
      message: `Iteración ${iteration}/${maxIterations}: ${planSteps[stepIdx] || "Analizando"}...`,
      iteration,
      timestamp: Date.now(),
    });

    await emitTraceEvent(runId, "thinking", {
      content: `Iteration ${iteration}: Analyzing and planning next action...`,
      phase: "executing"
    });

    try {
      budgetMgr.recordIteration();

      if (budgetMgr.isExceeded) {
        const exceededMsg = budgetMgr.buildExceededMessage();
        console.warn(`[AgentExecutor] ${exceededMsg}`);
        budgetMgr.emitBudgetUpdate(sse.write);
        if (!fullResponse) {
          fullResponse = exceededMsg;
          sse.write("chunk", { content: exceededMsg, sequence: 1, runId });
        }
        break;
      }

      if (budgetMgr.shouldWarn) {
        budgetMgr.markWarningIssued();
        const warnMsg = budgetMgr.buildWarningMessage();
        console.warn(`[AgentExecutor] ${warnMsg}`);
        budgetMgr.emitBudgetUpdate(sse.write);
        conversationHistory.push({
          role: "system",
          content: `${warnMsg}. Wrap up your current task and provide a summary. Avoid starting new tool calls unless essential.`,
        });
      }

      if (iteration > 5) {
        const pruneResult = buildContextPruningStrategy(conversationHistory as any, 80000);
        if (pruneResult.removed > 0) {
          conversationHistory = pruneResult.pruned as typeof conversationHistory;
          console.log(`[AgentExecutor] Context pruned: ${pruneResult.removed} messages trimmed to fit context window`);
        }
      }

      const openaiClient = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
      });

      const openaiMessages: OpenAI.ChatCompletionMessageParam[] = conversationHistory.map(m => {
        const msg = m as any;
        if (msg.role === "tool") {
          return {
            role: "tool" as const,
            tool_call_id: msg.tool_call_id,
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          };
        }
        if (msg.role === "assistant" && msg.tool_calls) {
          return {
            role: "assistant" as const,
            content: msg.content || null,
            tool_calls: msg.tool_calls,
          };
        }
        return {
          role: msg.role as "system" | "user" | "assistant",
          content: msg.content,
        };
      });

      const openaiTools: OpenAI.ChatCompletionTool[] = [
        ...tools.map(t => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.parameters || {},
          }
        })),
        ...OPENCLAW_TOOLS,
      ];

      const uniqueToolNames = new Set<string>();
      const dedupedTools = openaiTools.filter(t => {
        if (uniqueToolNames.has(t.function.name)) return false;
        uniqueToolNames.add(t.function.name);
        return true;
      });

      const routeResult = modelRouter.route(
        requestSpec.intent,
        recentUserText.length,
        tools.length,
      );
      const agentModel = routeResult.modelId;
      console.log(`[AgentExecutor] Model routed: ${agentModel} (reason: ${routeResult.reason})`);

      const budgetWarning = modelRouter.getBudgetWarning();
      if (budgetWarning) {
        console.warn(`[AgentExecutor] ${budgetWarning}`);
        sse.write("budget_update", { runId, warning: budgetWarning, cost: modelRouter.getCostSummary() });
      }
      if (modelRouter.isBudgetExceeded()) {
        console.warn(`[AgentExecutor] Cost budget exceeded, halting agent loop`);
        sse.write("budget_update", { runId, exceeded: true, cost: modelRouter.getCostSummary() });
        fullResponse = "He alcanzado el límite de presupuesto para esta ejecución. Por favor, inicia una nueva solicitud.";
        sse.write("chunk", { content: fullResponse, sequence: 1, runId });
        break;
      }

      let usedNativeTools = true;
      const hasUsedAnyTool = conversationHistory.some(m => (m as any).role === "tool");
      const isActionIntent = requestSpec?.intent !== "chat" || recentUserText.length > 30;
      const shouldForceToolUse = iteration <= 2 && !hasUsedAnyTool && isActionIntent && dedupedTools.length > 0;
      const toolChoiceValue = shouldForceToolUse ? "required" as const : "auto" as const;

      const inferenceProgressMessages = [
        "Analizando tu solicitud...",
        "Evaluando herramientas disponibles...",
        "Decidiendo plan de acción...",
        "Preparando ejecución...",
      ];
      let inferenceProgressIdx = 0;
      let inferenceProgressInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
        if (inferenceProgressIdx < inferenceProgressMessages.length) {
          sse.write("thinking", {
            runId,
            step: `inference_${inferenceProgressIdx}`,
            message: inferenceProgressMessages[inferenceProgressIdx],
            iteration,
            timestamp: Date.now(),
          });
          inferenceProgressIdx++;
        }
      }, 2500);

      const response = await retryWithBackoff(async () => {
        try {
          const completionPromise = openaiClient.chat.completions.create({
            model: agentModel,
            messages: openaiMessages,
            temperature: 0.7,
            max_tokens: 4096,
            tools: dedupedTools.length > 0 ? dedupedTools : undefined,
            tool_choice: dedupedTools.length > 0 ? toolChoiceValue : undefined,
          });

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Agent LLM call timed out after 90s")), 90000)
          );

          return await Promise.race([completionPromise, timeoutPromise]);
        } catch (nativeErr: any) {
          const errMsg = String(nativeErr?.message || nativeErr?.error?.message || "").toLowerCase();
          const isToolUnsupported = errMsg.includes("tool") || errMsg.includes("function") ||
            errMsg.includes("not supported") || errMsg.includes("does not support") ||
            errMsg.includes("invalid") || nativeErr?.status === 400;
          if (!isToolUnsupported) throw nativeErr;

          console.log(`[AgentExecutor] Model ${agentModel} doesn't support native tools, falling back to prompt-based tool calling`);
          usedNativeTools = false;

          const toolSchemas = dedupedTools.map(t => ({
            name: t.function.name,
            description: t.function.description || "",
            parameters: t.function.parameters || {},
          }));
          const toolPrompt = buildToolCallingSystemPrompt(toolSchemas);

          const fallbackMessages: OpenAI.ChatCompletionMessageParam[] = [
            { role: "system", content: toolPrompt },
          ];
          for (const m of openaiMessages) {
            if (m.role === "tool") {
              const toolName = (m as any).tool_call_id || "tool";
              fallbackMessages.push({
                role: "user",
                content: `[Tool Result (${toolName})]\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
              });
            } else if (m.role === "assistant" && (m as any).tool_calls) {
              const tc = (m as any).tool_calls;
              const toolSummary = tc.map((t: any) => `${t.function.name}(${t.function.arguments})`).join(", ");
              fallbackMessages.push({
                role: "assistant",
                content: ((m as any).content || "") + `\n[Called tools: ${toolSummary}]`,
              });
            } else {
              fallbackMessages.push(m as OpenAI.ChatCompletionMessageParam);
            }
          }

          const fallbackPromise = openaiClient.chat.completions.create({
            model: agentModel,
            messages: fallbackMessages,
            temperature: 0.7,
            max_tokens: 4096,
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Agent LLM call timed out after 90s")), 90000)
          );
          return await Promise.race([fallbackPromise, timeoutPromise]);
        }
      }, 2, 1500);

      if (inferenceProgressInterval) { clearInterval(inferenceProgressInterval); inferenceProgressInterval = null; }

      if (response.usage) {
        totalTokensUsed += (response.usage.total_tokens || 0);
        modelRouter.trackUsage(
          agentModel,
          response.usage.prompt_tokens || 0,
          response.usage.completion_tokens || 0,
        );
        modelRouter.recordSuccess(agentModel);
        budgetMgr.recordUsage({
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        });
        budgetMgr.emitBudgetUpdate(sse.write);
      }

      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error("No response from model");
      }

      let toolCalls = choice.message?.tool_calls || [];
      let hasToolCall = toolCalls.length > 0;
      let textContent = choice.message?.content || "";
      let shouldExitAgentLoop = false;

      if (!hasToolCall && textContent && !usedNativeTools) {
        const allToolNameSet = new Set<string>();
        for (const t of dedupedTools) allToolNameSet.add(t.function.name);
        const parsedCalls = parseToolCallsFromText(textContent, allToolNameSet);
        if (parsedCalls.length > 0) {
          console.log(`[AgentExecutor] Parsed ${parsedCalls.length} tool call(s) from text (prompt-based fallback)`);
          toolCalls = parsedCalls.map(pc => ({
            id: pc.id,
            type: "function" as const,
            function: { name: pc.name, arguments: pc.arguments },
          })) as any;
          hasToolCall = true;
          textContent = stripToolCallsFromText(textContent);
        }
      }

      console.log(`[AgentExecutor] Iteration ${iteration}: ${toolCalls.length} tool_calls, text=${textContent.slice(0, 80)}...`);

      if (hasToolCall) {
        conversationHistory.push({
          role: "assistant",
          content: textContent || null,
          tool_calls: toolCalls.map((tc: any) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        } as any);
      }

      const executeOneTool = async (tc: OpenAI.ChatCompletionMessageToolCall) => {
        const TOOL_NAME_ALIASES: Record<string, string> = {
          "fetch_url": "web_fetch",
          "search": "web_search",
          "search_web": "web_search",
          "execute_bash": "bash",
          "shell": "bash",
          "terminal": "bash",
          "file_read": "read_file",
          "file_write": "write_file",
          "file_edit": "edit_file",
          "file_list": "list_files",
          "dir_list": "list_files",
          "code_run": "run_code",
          "execute_code": "run_code",
          "grep": "grep_search",
          "search_files": "grep_search",
        };

        const rawName = tc.function.name;
        const name = TOOL_NAME_ALIASES[rawName] || rawName;
        let args: Record<string, any> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}

        const PARAM_NORMALIZERS: Record<string, (a: Record<string, any>) => Record<string, any>> = {
          "write_file": (a) => ({ file_path: a.file_path || a.filepath || a.path, content: a.content }),
          "edit_file": (a) => {
            const fp = a.file_path || a.filepath || a.path;
            const hasOldNew = a.old_string || a.oldString || a.old;
            if (hasOldNew) {
              return {
                file_path: fp,
                old_string: a.old_string || a.oldString || a.old || "",
                new_string: a.new_string !== undefined ? a.new_string : (a.newString !== undefined ? a.newString : (a.new !== undefined ? a.new : "")),
              };
            }
            return { file_path: fp, content: a.content || "" };
          },
          "read_file": (a) => ({ file_path: a.file_path || a.filepath || a.path || a.file, offset: a.offset, limit: a.limit }),
          "list_files": (a) => ({ directory: a.directory || a.dir || a.path || ".", recursive: a.recursive, maxEntries: a.maxEntries || a.max_entries }),
          "web_fetch": (a) => ({ url: a.url, extract_mode: a.extract_mode || a.extractMode || (a.extractText === false ? "html" : "text") }),
        };

        const normalizedArgs = PARAM_NORMALIZERS[name]?.(args) || args;

        if (circuitBreaker.isTripped(name)) {
          console.warn(`[AgentExecutor] Skipping tripped tool: ${name}`);
          return {
            tc,
            name,
            args: normalizedArgs,
            result: { error: `Tool "${name}" disabled: too many consecutive failures` },
            artifact: undefined as { type: string; url: string; name: string } | undefined,
            skipped: true,
          };
        }

        const riskCheck = isHighRiskAction(name, normalizedArgs);
        if (riskCheck.risky && accessLevel !== 'owner') {
          console.warn(`[AgentExecutor] HIGH RISK blocked for non-owner: ${name} - ${riskCheck.reason}`);
          return {
            tc, name, args: normalizedArgs,
            result: { error: `Action blocked: ${riskCheck.reason}. Requires owner approval.` },
            artifact: undefined as { type: string; url: string; name: string } | undefined,
            skipped: true,
          };
        }

        if (riskCheck.risky) {
          sse.write("tool_requires_confirmation", {
            runId, toolName: name, args: normalizedArgs, reason: riskCheck.reason, iteration,
          });
          console.warn(`[AgentExecutor] HIGH RISK action detected: ${name} - ${riskCheck.reason}. Proceeding with caution for owner.`);
          await emitTraceEvent(runId, "high_risk_action", {
            toolName: name, args: normalizedArgs, reason: riskCheck.reason, accessLevel,
          });
        }

        const progressMsg = buildToolProgressMessage(name, normalizedArgs);
        sse.write("tool_start", {
          runId, toolName: name, args: normalizedArgs, iteration, message: progressMsg,
        });

        let result: any;
        let artifact: { type: string; url: string; name: string } | undefined;
        const toolStartTime = Date.now();
        const adaptiveTimeout = toolHealth.getAdaptiveTimeout(name);

        try {
          const toolPromise = (async () => {
            const isOpenClawTool = OPENCLAW_TOOLS.some(t => t.function.name === name);
            if (isOpenClawTool) {
              const toolResult = await executeOpenClawToolCall(
                { id: tc.id, type: "function", function: { name, arguments: JSON.stringify(normalizedArgs) } },
                (msg) => sse.write("tool_status", { runId, toolName: name, status: msg, iteration })
              );
              try { return { result: JSON.parse(toolResult.content) }; } catch { return { result: toolResult.content }; }
            } else {
              return await executeToolCall(
                name, normalizedArgs, toolContext, runId, res, reservationDetails
              );
            }
          })();

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${Math.round(adaptiveTimeout / 1000)}s`)), adaptiveTimeout)
          );

          const execResult = await Promise.race([toolPromise, timeoutPromise]);
          result = execResult.result;
          artifact = (execResult as any).artifact;

          const hasError = result && typeof result === "object" && "error" in result;
          const durationMs = Date.now() - toolStartTime;
          toolHealth.record(name, durationMs, !hasError, hasError ? String(result.error) : undefined);

          if (hasError) {
            circuitBreaker.recordFailure(name);
          } else {
            circuitBreaker.recordSuccess(name);
          }
        } catch (toolErr: any) {
          const durationMs = Date.now() - toolStartTime;
          const errInfo = categorizeError(toolErr);
          circuitBreaker.recordFailure(name);
          toolHealth.record(name, durationMs, false, errInfo.message);
          result = {
            error: errInfo.message,
            errorCategory: errInfo.category,
            retryable: errInfo.retryable,
          };
        }

        const toolDurationMs = Date.now() - toolStartTime;

        if (artifact) {
          artifacts.push(artifact);
        }

        sse.write("tool_result", {
          runId, toolName: name, result, artifact, iteration, durationMs: toolDurationMs,
          degraded: toolHealth.isDegraded(name),
        });

        return { tc, name, args, result, artifact, skipped: false };
      };

      const toolResults = toolCalls.length > 1
        ? await Promise.all(toolCalls.map(tc => executeOneTool(tc)))
        : toolCalls.length === 1
          ? [await executeOneTool(toolCalls[0])]
          : [];

      for (const { tc, name, result, artifact } of toolResults) {

        let resultSummary: string;
        if (name === "browse_and_act") {
          const r = result as any;
          resultSummary = JSON.stringify({
            success: r.success,
            stepsCount: r.stepsCount || r.steps?.length || 0,
            summary: r.data?.summary || r.data?.finalUrl || "Task completed",
            lastSteps: (r.steps || []).slice(-3).map((s: any) =>
              typeof s === 'string' ? s.slice(0, 100) : JSON.stringify(s).slice(0, 100)
            ),
          });
        } else {
          const { text: truncatedText } = smartTruncate(result, 2500);
          resultSummary = truncatedText;
        }

        conversationHistory.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultSummary,
        } as any);

        if (name === "browse_and_act") {
          const r = result as any;
          const wasSuccessful = r.success === true;
          const stepsCount = r.stepsCount || r.steps?.length || 0;
          const lastSteps = (r.steps || []).slice(-3).map((s: any) =>
            typeof s === 'string' ? s : (s?.action || s?.description || JSON.stringify(s).slice(0, 80))
          );
          const dataStatus = String(r?.data?.status || "").toLowerCase();
          const missingFields = Array.isArray(r?.data?.missingFields)
            ? (r.data.missingFields as string[])
            : [];
          const clarificationQuestion = typeof r?.data?.question === "string" ? r.data.question.trim() : "";
          const confirmationCode =
            r?.data?.confirmationCode ||
            r?.data?.reservationCode ||
            r?.data?.bookingReference ||
            r?.data?.confirmation;
          const isNeedsUserInput = dataStatus === "needs_user_input" || missingFields.length > 0;

          let summaryText: string;
          if (isNeedsUserInput) {
            const reason = String(r?.data?.reason || "").toLowerCase();
            const question =
              clarificationQuestion ||
              `Para continuar con la reserva necesito: ${missingFields.join(", ")}.`;
            if (reason === "no_web_availability" && isReservationRequest) {
              const rd = reservationDetails;
              const avail = Array.isArray(r?.data?.availableTimes) ? r.data.availableTimes : [];
              const availBlock = avail.length > 0 ? `\n\n**Horarios disponibles:** ${avail.join(", ")}` : "";
              summaryText = `**Sin disponibilidad online**\n\n${question}${availBlock}\n\n_Restaurante: ${rd?.restaurant || "—"} · Fecha: ${rd?.date || "—"} · Personas: ${rd?.partySize || "—"}_`;
            } else if (reason === "past_date" && isReservationRequest) {
              summaryText = `**Fecha pasada**\n\n${question}`;
            } else if (reason === "duplicate_reservation_detected" && isReservationRequest) {
              summaryText = `**Reserva duplicada**\n\n${question}`;
            } else if (reason === "restaurant_closed" && isReservationRequest) {
              summaryText = `**Restaurante cerrado**\n\n${question}`;
            } else if (reason === "runtime_timeout") {
              summaryText = `**Tiempo agotado**\n\n${question}`;
            } else if (reason === "page_navigation_error" || reason === "browser_session_closed") {
              summaryText = `**Error de conexion**\n\n${question}`;
            } else if (reason === "invalid_contact_data") {
              summaryText = `**Datos invalidos**\n\n${question}`;
            } else {
              summaryText = question;
            }
            sse.write("clarification", {
              runId,
              question,
              missingFields,
            });
          } else if (isReservationRequest) {
            const rd = reservationDetails;
            const checkItems: string[] = [];
            if (rd?.restaurant) checkItems.push(`- [x] **Restaurante:** ${rd.restaurant}`);
            if (rd?.date) checkItems.push(`- [x] **Fecha:** ${rd.date}`);
            if (r?.data?.timeAdjusted && r?.data?.selectedTime) {
              checkItems.push(`- [x] **Hora:** ${r.data.selectedTime} _(solicitada: ${r.data.requestedTime || rd?.time})_`);
            } else if (rd?.time) {
              checkItems.push(`- [x] **Hora:** ${rd.time}`);
            }
            if (rd?.partySize) checkItems.push(`- [x] **Personas:** ${rd.partySize}`);
            if (rd?.contactName) checkItems.push(`- [x] **Nombre:** ${rd.contactName}`);
            if (rd?.phone) checkItems.push(`- [x] **Telefono:** ${rd.phone}`);
            if (rd?.email) checkItems.push(`- [x] **Email:** ${rd.email}`);

            const checklistBlock = checkItems.length > 0 ? `\n\n**Checklist:**\n${checkItems.join("\n")}` : "";
            if (wasSuccessful && confirmationCode) {
              summaryText = `**Reserva confirmada en la web**\n\nCodigo/confirmacion: ${confirmationCode}${checklistBlock}\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}`;
            } else if (wasSuccessful) {
              summaryText = `**Automatizacion web completada exitosamente**${checklistBlock}\n\nRealice ${stepsCount} acciones en el navegador para completar tu solicitud.\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}`;
            } else {
              summaryText = `**Automatizacion web finalizada** (${stepsCount} pasos)${checklistBlock}\n\nNavegue por el sitio web y realice varias acciones, pero no pude confirmar que la tarea se completo al 100%.\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}\n\nTe recomiendo verificar directamente en el sitio web.`;
            }
          } else if (wasSuccessful && confirmationCode) {
            summaryText = `**Reserva confirmada en la web**\n\nCodigo/confirmacion: ${confirmationCode}\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}`;
          } else if (wasSuccessful) {
            summaryText = `**Automatizacion web completada exitosamente**\n\nRealice ${stepsCount} acciones en el navegador para completar tu solicitud.\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}`;
          } else {
            summaryText = `**Automatizacion web finalizada** (${stepsCount} pasos)\n\nNavegue por el sitio web y realice varias acciones, pero no pude confirmar que la tarea se completo al 100%.\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}\n\nTe recomiendo verificar directamente en el sitio web.`;
          }

          fullResponse = summaryText;
          sse.write("chunk", {
            content: "\n\n" + summaryText,
            sequence: 1,
            runId,
          });
          console.log(`[AgentExecutor] browse_and_act FAST EXIT: success=${wasSuccessful}, steps=${stepsCount}`);
          shouldExitAgentLoop = true;
          break;
        }
      }

      if (shouldExitAgentLoop) {
        break;
      }

      consecutiveLoopErrors = 0;

      if (textContent) {
        fullResponse += textContent;

        if (!hasToolCall) {
          // For web_automation intent: if the LLM returned text instead of a tool call
          // AND we haven't already tried browse_and_act (iteration 1 = first attempt),
          // force it to use browse_and_act by injecting a strong nudge and retrying.
          // After the first browse_and_act attempt, allow text responses (result summaries).
          const alreadyUsedBrowser = conversationHistory.some(m =>
            (m as any).role === "tool" && (m as any).tool_call_id && String(m.content || "").includes("browse_and_act")
            || (m as any).tool_calls?.some((tc: any) => tc.function?.name === "browse_and_act")
          );
          if (requestSpec.intent === "web_automation" && iteration <= 2 && !alreadyUsedBrowser) {
            console.log(`[AgentExecutor] web_automation: LLM returned text instead of tool call on iteration ${iteration}, forcing tool use...`);
            conversationHistory.push({
              role: "assistant",
              content: textContent
            });
            conversationHistory.push({
              role: "user",
              content: `IMPORTANT: Do NOT respond with text. You MUST call the "browse_and_act" function right now to open a real browser and complete the task. Call browse_and_act with url="https://www.mesa247.pe" and goal containing all the details from the user's request. Do it NOW.`
            });
            textContent = "";
            fullResponse = "";
            continue; // retry the iteration
          }

          const alreadyUsedListFiles = conversationHistory.some((m) =>
            (m as any).tool_calls?.some((tc: any) => tc.function?.name === "list_files"),
          );
          if (isLocalFsRequest && iteration <= 2 && !alreadyUsedListFiles) {
            const inferredDirectory = inferLocalDirectoryFromPrompt(recentUserText || requestSpec.rawMessage || "");
            console.log(`[AgentExecutor] local_fs: LLM returned text instead of tool call on iteration ${iteration}, forcing list_files(${inferredDirectory})...`);
            conversationHistory.push({
              role: "assistant",
              content: textContent,
            });
            conversationHistory.push({
              role: "user",
              content: `IMPORTANT: do not ask the user to run commands. Call list_files now with {"directory":"${inferredDirectory}","maxEntries":200}. After that, summarize findings with concrete paths and counts.`,
            });
            textContent = "";
            fullResponse = "";
            continue; // retry the iteration
          }

          if (iteration <= 2 && !hasUsedAnyTool && textContent.length > 20 && isActionIntent) {
            console.log(`[AgentExecutor] Agentic nudge: LLM returned text without tools on iteration ${iteration}, forcing tool use...`);
            conversationHistory.push({
              role: "assistant",
              content: textContent,
            });
            conversationHistory.push({
              role: "user",
              content: `SYSTEM: You responded with text only. As an autonomous agent, you MUST use your tools to gather real information before answering. Call web_search, bash, read_file, or another appropriate tool NOW to verify and enrich your response. Do NOT just talk — ACT first, then summarize findings.`,
            });
            textContent = "";
            fullResponse = "";
            continue;
          }

          try {
            const { validateResponse } = await import("../services/responseValidator");
            const validation = validateResponse(textContent);

            if (!validation.isValid && iteration < maxIterations) {
              console.warn(`[AgentVerifier] Response rejected: ${validation.issues.map(i => i.message).join(", ")}`);

              await emitTraceEvent(runId, "verification_failed", {
                issues: validation.issues,
                rejectedContent: textContent.substring(0, 100) + "..."
              });

              conversationHistory.push({
                role: "assistant",
                content: textContent
              });
              conversationHistory.push({
                role: "user",
                content: `SYSTEM_ALERT: Your response was rejected by the Quality Verifier. 
Issues detected:
${validation.issues.map(i => `- ${i.message}`).join("\n")}

Please rewrite your response addressing these issues.`
              });

              // Skip streaming and continue to next iteration for retry
              continue;
            }
          } catch (err: any) {
            console.error("[AgentVerifier] Error during validation:", err);
            // Fail open: if verifier crashes, let the response through but log it
            await emitTraceEvent(runId, "verification_failed", {
              error: {
                message: `Verifier crashed: ${err.message}`,
                details: { stack: err.stack }
              },
              metadata: {
                checkName: "System Integrity",
                contentSnippet: textContent.substring(0, 50)
              }
            });
          }

          const chunks = textContent.match(/.{1,100}/g) || [textContent];
          for (let i = 0; i < chunks.length; i++) {
            sse.write("chunk", {
              content: chunks[i],
              sequence: i + 1,
              runId
            });
            await new Promise(r => setTimeout(r, 10));
          }

          break;
        }
      }

      await emitTraceEvent(runId, "progress_update", {
        progress: {
          current: iteration,
          total: maxIterations,
          message: `Completed iteration ${iteration}`
        }
      });

    } catch (error: any) {
      if (inferenceProgressInterval) { clearInterval(inferenceProgressInterval); inferenceProgressInterval = null; }
      console.error(`[AgentExecutor] Error in iteration ${iteration}:`, error?.message || error);
      consecutiveLoopErrors++;

      const failedModel = process.env.AGENT_MODEL || "minimax/minimax-m2.5";
      modelRouter.recordFailure(failedModel);

      await emitTraceEvent(runId, "error", {
        error: {
          code: "AGENT_EXECUTION_ERROR",
          message: error.message,
          retryable: iteration < maxIterations,
          consecutiveErrors: consecutiveLoopErrors,
        }
      });

      if (consecutiveLoopErrors >= 2 && iteration < maxIterations - 1) {
        console.log(`[AgentExecutor] Auto-strategy adjustment after ${consecutiveLoopErrors} consecutive errors`);
        sse.write("thinking", {
          runId,
          step: "strategy_adjustment",
          message: `Ajustando estrategia después de ${consecutiveLoopErrors} errores consecutivos...`,
          timestamp: Date.now(),
        });

        const degradedTools = Object.entries(toolHealth.getSummary())
          .filter(([_, v]) => v.degraded)
          .map(([name]) => name);

        if (degradedTools.length > 0) {
          conversationHistory.push({
            role: "system",
            content: `STRATEGY ADJUSTMENT: The following tools are degraded and should be avoided: ${degradedTools.join(", ")}. Use alternative approaches. If you've been trying the same tool repeatedly, try a different tool or approach entirely.`,
          });
        } else {
          conversationHistory.push({
            role: "system",
            content: `STRATEGY ADJUSTMENT: Previous attempts failed. Try a simpler, more direct approach. If a complex tool chain isn't working, try using fewer tools or a single tool. Focus on completing the core task.`,
          });
        }
        consecutiveLoopErrors = 0;
      }

      // If browse_and_act already ran successfully and the follow-up LLM call
      // failed (timeout, too-large context, etc.), generate a fallback summary
      // instead of retrying forever or crashing.
      const alreadyBrowsed = conversationHistory.some(m =>
        (m as any).tool_calls?.some((tc: any) => tc.function?.name === "browse_and_act")
      );
      if (alreadyBrowsed && !fullResponse) {
        console.log(`[AgentExecutor] Post-browse LLM call failed, generating fallback summary`);
        // Extract browse result from conversation history
        const browseResultMsg = conversationHistory.find(m =>
          (m as any).role === "tool" && String(m.content || "").includes('"success"')
        );
        const browseData = String(browseResultMsg?.content || "");
        const successMatch = browseData.match(/"success"\s*:\s*(true|false)/);
        const wasSuccessful = successMatch?.[1] === "true";

        const fallback = wasSuccessful
          ? "✅ He completado la automatización web exitosamente. El navegador realizó todas las acciones necesarias en el sitio web."
          : "⚠️ He intentado completar la tarea de automatización web. El navegador navegó por el sitio web y realizó varias acciones, pero no pude confirmar que la tarea se completó al 100%. Te recomiendo verificar directamente en el sitio.";

        fullResponse = fallback;
        const chunks = fallback.match(/.{1,100}/g) || [fallback];
        for (let i = 0; i < chunks.length; i++) {
          sse.write("chunk", {
            content: chunks[i],
            sequence: i + 1,
            runId
          });
        }
        break; // Exit the while loop
      }

      if (iteration >= maxIterations) {
        throw error;
      }
    }
  }

  const finalStepIdx = Math.min(iteration - 1, planSteps.length - 1);
  for (let si = 0; si <= finalStepIdx; si++) {
    sse.write("exec_plan_update", {
      runId,
      stepId: `step_${si}`,
      status: si <= finalStepIdx ? "done" : "pending",
      timestamp: Date.now(),
    });
  }

  if (!fullResponse && iteration >= maxIterations) {
    const fallbackMsg = artifacts.length > 0
      ? `He completado las tareas solicitadas y generé ${artifacts.length} archivo(s) para ti.`
      : "He procesado tu solicitud. Avísame si necesitas algo más.";
    fullResponse = fallbackMsg;
    sse.write("chunk", {
      content: fallbackMsg,
      sequence: 1,
      runId
    });
  }

  if (artifacts.length > 0) {
    sse.write("artifacts", {
      runId,
      artifacts,
      count: artifacts.length
    });
  }

  budgetMgr.emitBudgetUpdate(sse.write);

  await emitTraceEvent(runId, "agent_completed", {
    agent: {
      name: requestSpec.primaryAgent,
      role: "primary",
      status: "completed"
    },
    iterations: iteration,
    artifactsGenerated: artifacts.length,
    totalTokensUsed,
    circuitBreakerStatus: circuitBreaker.getStatus(),
    toolHealthSummary: toolHealth.getSummary(),
    modelRouting: {
      costSummary: modelRouter.getCostSummary(),
      healthStatus: modelRouter.getHealthStatus(),
    },
    budget: budgetMgr.snapshot(),
  });

  try {
    const { ragService } = await import("../services/ragService");
    if (fullResponse && fullResponse.length > 50) {
      const toolsUsed = conversationHistory
        .filter((m: any) => m.tool_calls)
        .flatMap((m: any) => m.tool_calls?.map((tc: any) => tc.function?.name) || []);
      const uniqueTools = [...new Set(toolsUsed)];

      await ragService.indexMessage(userId, chatId, fullResponse, "assistant");

      if (artifacts.length > 0 || uniqueTools.length > 0) {
        const memoryNote = [
          `Agent run ${runId}: ${requestSpec.intent}`,
          uniqueTools.length > 0 ? `Tools used: ${uniqueTools.join(", ")}` : "",
          artifacts.length > 0 ? `Artifacts: ${artifacts.map(a => a.name).join(", ")}` : "",
          `Iterations: ${iteration}, Tokens: ${totalTokensUsed}`,
          fullResponse.substring(0, 500),
        ].filter(Boolean).join("\n");
        await ragService.indexDocument(userId, memoryNote, {
          chatId,
          fileName: `agent_run_${runId}.md`,
          fileType: "agent_memory",
        });
      }
    }
  } catch (memErr: any) {
    console.warn(`[AgentExecutor] Memory persistence failed (non-fatal):`, memErr?.message);
  }

  try {
    const { outputSanitizer } = await import("./security/outputSanitizer");
    const sanitized = outputSanitizer.sanitize(fullResponse);
    if (sanitized.redactions.length > 0) {
      console.log(`[SecurityPlane] Output sanitized: ${sanitized.redactions.length} redactions applied`);
    }
    fullResponse = sanitized.sanitizedText;
  } catch {
    // Output sanitization is best-effort
  }

  return fullResponse;

  } finally {
    clearInterval(keepaliveInterval);
  }
}

export {
  AGENT_TOOLS,
  getToolsForIntent,
  isRestaurantReservationRequest,
  extractReservationDetails,
  getMissingReservationFields,
  formatReservationDetails,
  buildReservationClarificationQuestion,
  normalizeSpaces,
  collectRecentUserText,
};
export type { ReservationDetails, ReservationMissingField };
