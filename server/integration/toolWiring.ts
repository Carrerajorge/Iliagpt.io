/**
 * toolWiring
 *
 * Connects the abstract ToolRegistry / BuiltInTools definitions to their
 * concrete runtime implementations (filesystem, terminal sessions, code
 * executor, web search, document generation, memory).
 *
 * Call wireTools() once at startup — it patches the built-in tool execute()
 * functions in place so all downstream callers (AgenticLoop, TaskExecutor,
 * direct invocations) get real behaviour.
 */

import path    from 'path';
import os      from 'os';
import fs      from 'fs/promises';
import { Logger } from '../lib/logger';
import { globalToolRegistry } from '../agentic/toolCalling/ToolRegistry';
import { BUILT_IN_TOOLS }     from '../agentic/toolCalling/BuiltInTools';
import type { ToolExecutionContext, ToolResult } from '../agentic/toolCalling/ToolRegistry';
import { getAgenticModelReadiness } from './modelWiring';

// ─── Lazy imports ─────────────────────────────────────────────────────────────
// These are imported lazily so missing optional dependencies don't crash startup.

async function getTerminalManager() {
  const { terminalSessionManager } = await import('../agentic/tools/TerminalSession');
  return terminalSessionManager;
}

async function getCodeExecutor() {
  const { codeExecutor } = await import('../agentic/tools/CodeExecutor');
  return codeExecutor;
}

async function getBackgroundTaskManager() {
  const { backgroundTaskManager } = await import('../tasks/BackgroundTaskManager');
  return backgroundTaskManager;
}

// ─── Web search implementation ────────────────────────────────────────────────

async function webSearch(query: string, maxResults = 5): Promise<string> {
  // Try the existing MultiSearchProvider if available
  try {
    const { multiSearchProvider } = await import('../services/multiSearchProvider');
    const results = await multiSearchProvider.search(query, { maxResults });
    if (results?.length) {
      return results
        .slice(0, maxResults)
        .map((r: { title?: string; url?: string; snippet?: string }, i: number) =>
          `[${i + 1}] ${r.title ?? ''}\n${r.url ?? ''}\n${r.snippet ?? ''}`
        )
        .join('\n\n');
    }
  } catch { /* fallback below */ }

  // DuckDuckGo instant answer API (no key needed)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json() as {
      AbstractText?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const parts: string[] = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    for (const topic of (data.RelatedTopics ?? []).slice(0, maxResults - 1)) {
      if (topic.Text) parts.push(`${topic.Text}\n${topic.FirstURL ?? ''}`);
    }
    return parts.join('\n\n') || `No results found for: ${query}`;
  } catch (e) {
    return `Search failed: ${(e as Error).message}`;
  }
}

// ─── Web fetch implementation ─────────────────────────────────────────────────

async function webFetch(url: string, maxBytes = 50_000): Promise<string> {
  // Try the existing WebScraper if available
  try {
    const { webScraperRobust } = await import('../services/webScraperRobust');
    const result = await webScraperRobust.fetch(url);
    if (result?.text) return result.text.slice(0, maxBytes);
  } catch { /* fallback */ }

  // Plain fetch fallback
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    // Very naive HTML → text strip
    return text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{3,}/g, '\n\n')
      .slice(0, maxBytes);
  } catch (e) {
    return `Fetch failed: ${(e as Error).message}`;
  }
}

// ─── Memory implementation ────────────────────────────────────────────────────

// Simple in-process Map fallback; pgvector store preferred when available.
const _memCache = new Map<string, string>();

async function memoryStore(key: string, value: string, ctx: ToolExecutionContext): Promise<void> {
  const ns = `${ctx.userId}:${key}`;
  try {
    const { pgMemoryStore } = await import('../services/pgMemoryStore');
    await pgMemoryStore.set(ns, value);
    return;
  } catch { /* fallback */ }
  _memCache.set(ns, value);
}

async function memoryRecall(key: string, ctx: ToolExecutionContext): Promise<string | null> {
  const ns = `${ctx.userId}:${key}`;
  try {
    const { pgMemoryStore } = await import('../services/pgMemoryStore');
    return await pgMemoryStore.get(ns) ?? null;
  } catch { /* fallback */ }
  return _memCache.get(ns) ?? null;
}

// ─── Document creation ────────────────────────────────────────────────────────

async function createDocument(
  title: string,
  content: string,
  format: string,
  ctx: ToolExecutionContext,
): Promise<string> {
  const outDir = path.join(os.tmpdir(), 'ilia-docs', ctx.userId);
  await fs.mkdir(outDir, { recursive: true });

  const safeTitle = title.replace(/[^\w\s-]/g, '').slice(0, 60).trim().replace(/\s+/g, '_');
  const filename  = `${safeTitle}_${Date.now()}.${format}`;
  const outPath   = path.join(outDir, filename);

  if (format === 'txt' || format === 'md') {
    await fs.writeFile(outPath, content, 'utf8');
    return outPath;
  }

  // Try existing docx generator
  try {
    const { generateDocx } = await import('../services/docxGenerator');
    const buf = await generateDocx({ title, content });
    await fs.writeFile(outPath, buf);
    return outPath;
  } catch { /* fallback to plain text */ }

  await fs.writeFile(outPath.replace(`.${format}`, '.txt'), content, 'utf8');
  return outPath.replace(`.${format}`, '.txt');
}

// ─── Wire bash tool ───────────────────────────────────────────────────────────

async function wireBashTool(): Promise<void> {
  const tool = globalToolRegistry.getTool('bash');
  if (!tool) return;

  const orig = tool.execute.bind(tool);
  tool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { command, timeout, cwd } = input as { command: string; timeout?: number; cwd?: string };

    try {
      const mgr = await getTerminalManager();
      const session = await mgr.getOrCreate(ctx.userId, ctx.chatId);

      if (cwd) await mgr.changeDir(session.id, cwd);

      const output: string[] = [];
      const result = await mgr.runCommand(session.id, command, {
        timeoutMs: timeout ?? 30_000,
        onChunk  : (stream, data) => {
          output.push(data);
          ctx.onStream?.(data);
        },
      });

      const text = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
        || output.join('').trim()
        || '(no output)';

      return {
        success: result.exitCode === 0,
        output : text,
        metadata: { exitCode: result.exitCode, cwd: result.cwd, durationMs: result.durationMs },
      };
    } catch (e) {
      return { success: false, output: `bash error: ${(e as Error).message}` };
    }
  };
}

// ─── Wire python tool ─────────────────────────────────────────────────────────

async function wirePythonTool(): Promise<void> {
  const tool = globalToolRegistry.getTool('python');
  if (!tool) return;

  tool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { code, timeout, packages } = input as {
      code: string; timeout?: number; packages?: string[];
    };

    try {
      const executor = await getCodeExecutor();
      const chunks: string[] = [];
      const result = await executor.run(code, {
        language       : 'python',
        sessionId      : ctx.chatId || undefined,
        timeoutMs      : timeout ?? 30_000,
        installPackages: packages,
        onChunk        : c => { chunks.push(c); ctx.onStream?.(c); },
      });

      return {
        success : result.success,
        output  : result.stdout || result.stderr || chunks.join('') || '(no output)',
        metadata: { exitCode: result.exitCode, durationMs: result.durationMs },
      };
    } catch (e) {
      return { success: false, output: `python error: ${(e as Error).message}` };
    }
  };
}

// ─── Wire javascript tool ─────────────────────────────────────────────────────

async function wireJsTool(): Promise<void> {
  const tool = globalToolRegistry.getTool('javascript');
  if (!tool) return;

  tool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { code, timeout, sessionId } = input as {
      code: string; timeout?: number; sessionId?: string;
    };

    try {
      const executor = await getCodeExecutor();
      const result = await executor.run(code, {
        language : 'javascript',
        sessionId: sessionId ?? ctx.chatId ?? undefined,
        timeoutMs: timeout ?? 15_000,
      });

      return {
        success : result.success,
        output  : result.stdout || result.stderr || '(no output)',
        metadata: { exitCode: result.exitCode, durationMs: result.durationMs },
      };
    } catch (e) {
      return { success: false, output: `js error: ${(e as Error).message}` };
    }
  };
}

// ─── Path sandboxing ──────────────────────────────────────────────────────────

/**
 * Resolve `filePath` relative to `root` and reject any path that escapes the
 * sandbox via `..` traversal or absolute references outside the workspace.
 */
function resolveSafe(filePath: string, root: string): string {
  // Always resolve to absolute first
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  // Normalize to collapse any ../.. sequences
  const normalized = path.normalize(abs);
  // Enforce containment
  const sandboxRoot = path.normalize(root + path.sep);
  if (!normalized.startsWith(sandboxRoot) && normalized !== path.normalize(root)) {
    throw new Error(`Path '${filePath}' escapes workspace sandbox (${root})`);
  }
  return normalized;
}

// ─── Wire file tools ──────────────────────────────────────────────────────────

async function wireFileTools(): Promise<void> {
  const readTool = globalToolRegistry.getTool('read_file');
  if (readTool) {
    readTool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
      const { path: filePath, encoding } = input as { path: string; encoding?: string };
      try {
        const root = ctx.workspaceRoot ?? os.tmpdir();
        const abs  = resolveSafe(filePath, root);
        const text = await fs.readFile(abs, (encoding as BufferEncoding | undefined) ?? 'utf8');
        return { success: true, output: text.toString() };
      } catch (e) {
        return { success: false, output: `read_file error: ${(e as Error).message}` };
      }
    };
  }

  const writeTool = globalToolRegistry.getTool('write_file');
  if (writeTool) {
    writeTool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
      const { path: filePath, content } = input as { path: string; content: string };
      try {
        const root = ctx.workspaceRoot ?? os.tmpdir();
        const abs  = resolveSafe(filePath, root);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf8');
        return { success: true, output: `Written ${abs}` };
      } catch (e) {
        return { success: false, output: `write_file error: ${(e as Error).message}` };
      }
    };
  }

  const editTool = globalToolRegistry.getTool('edit_file');
  if (editTool) {
    editTool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
      const { path: filePath, oldString, newString } = input as {
        path: string; oldString: string; newString: string;
      };
      try {
        const root = ctx.workspaceRoot ?? os.tmpdir();
        const abs  = resolveSafe(filePath, root);
        const orig = await fs.readFile(abs, 'utf8');
        if (!orig.includes(oldString)) {
          return { success: false, output: `String not found in file: ${filePath}` };
        }
        await fs.writeFile(abs, orig.replace(oldString, newString), 'utf8');
        return { success: true, output: `Edited ${abs}` };
      } catch (e) {
        return { success: false, output: `edit_file error: ${(e as Error).message}` };
      }
    };
  }

  const listTool = globalToolRegistry.getTool('list_files');
  if (listTool) {
    listTool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
      const { path: dir, recursive } = input as { path?: string; recursive?: boolean };
      try {
        const root   = ctx.workspaceRoot ?? os.tmpdir();
        const target = dir ? resolveSafe(dir, root) : root;
        const entries = await (recursive
          ? readdirRecursive(target)
          : fs.readdir(target));
        return { success: true, output: entries.join('\n') };
      } catch (e) {
        return { success: false, output: `list_files error: ${(e as Error).message}` };
      }
    };
  }
}

async function readdirRecursive(dir: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    results.push(full);
    if (e.isDirectory()) results.push(...await readdirRecursive(full, depth + 1));
  }
  return results;
}

// ─── Wire web tools ───────────────────────────────────────────────────────────

async function wireWebTools(): Promise<void> {
  const searchTool = globalToolRegistry.getTool('web_search');
  if (searchTool) {
    searchTool.execute = async (input: unknown): Promise<ToolResult> => {
      const { query, maxResults } = input as { query: string; maxResults?: number };
      try {
        const out = await webSearch(query, maxResults ?? 5);
        return { success: true, output: out };
      } catch (e) {
        return { success: false, output: `web_search error: ${(e as Error).message}` };
      }
    };
  }

  const fetchTool = globalToolRegistry.getTool('web_fetch');
  if (fetchTool) {
    fetchTool.execute = async (input: unknown): Promise<ToolResult> => {
      const { url, maxBytes } = input as { url: string; maxBytes?: number };
      try {
        const out = await webFetch(url, maxBytes ?? 50_000);
        return { success: true, output: out };
      } catch (e) {
        return { success: false, output: `web_fetch error: ${(e as Error).message}` };
      }
    };
  }
}

// ─── Wire memory tools ────────────────────────────────────────────────────────

async function wireMemoryTools(): Promise<void> {
  const storeTool = globalToolRegistry.getTool('memory_store');
  if (storeTool) {
    storeTool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
      const { key, value } = input as { key: string; value: string };
      await memoryStore(key, value, ctx);
      return { success: true, output: `Stored "${key}"` };
    };
  }

  const recallTool = globalToolRegistry.getTool('memory_recall');
  if (recallTool) {
    recallTool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
      const { key } = input as { key: string };
      const val = await memoryRecall(key, ctx);
      return { success: true, output: val ?? `(no value for "${key}")` };
    };
  }
}

// ─── Wire document tool ───────────────────────────────────────────────────────

async function wireDocumentTool(): Promise<void> {
  const tool = globalToolRegistry.getTool('create_document');
  if (!tool) return;

  const delegate = tool.execute.bind(tool);
  tool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const format = typeof raw.format === 'string' ? raw.format.toLowerCase() : undefined;
    const normalizedType =
      typeof raw.type === 'string' ? raw.type.toLowerCase() :
      format === 'pdf' ? 'pdf' :
      format === 'xlsx' || format === 'excel' ? 'excel' :
      format === 'ppt' || format === 'pptx' ? 'ppt' :
      'word';
    const normalizedInput = {
      type: normalizedType,
      title: typeof raw.title === 'string' ? raw.title : 'Document',
      content: typeof raw.content === 'string' ? raw.content : String(raw.content ?? ''),
      theme: typeof raw.theme === 'string' ? raw.theme : undefined,
    };
    return delegate(normalizedInput, ctx);
  };
}

// ─── Wire spawn_task tool ─────────────────────────────────────────────────────

async function wireSpawnTaskTool(): Promise<void> {
  const tool = globalToolRegistry.getTool('spawn_task');
  if (!tool) return;

  tool.execute = async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { objective, instructions, allowedTools, tools, priority } = input as {
      objective: string;
      instructions?: string;
      allowedTools?: string[];
      tools?: string[];
      priority?: 'low' | 'normal' | 'high' | 'critical';
    };
    const requestedTools =
      Array.isArray(allowedTools) && allowedTools.length > 0
        ? allowedTools
        : Array.isArray(tools) && tools.length > 0
          ? tools
          : undefined;
    const start = Date.now();
    const readiness = getAgenticModelReadiness();
    if (!readiness.ok) {
      return {
        success: false,
        output: readiness.reason,
        error: {
          code: 'AGENTIC_LLM_UNAVAILABLE',
          message: readiness.reason ?? 'No LLM providers configured.',
          retryable: false,
        },
        durationMs: Date.now() - start,
      };
    }
    try {
      const mgr  = await getBackgroundTaskManager();
      const task = await mgr.spawn({
        userId      : ctx.userId,
        chatId      : ctx.chatId,
        objective,
        instructions,
        allowedTools: requestedTools,
        priority,
        metadata: {
          source: 'spawn_task',
          permissionProfile: 'full_agent',
        },
      });
      return {
        success : true,
        output  : {
          taskId: task.id,
          status: task.status,
          objective,
          message: `Task ${task.id} queued in background.`,
        },
        metadata: { taskId: task.id, status: task.status },
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        output: `spawn_task error: ${(e as Error).message}`,
        error: {
          code: 'SPAWN_ERROR',
          message: (e as Error).message,
          retryable: true,
        },
        durationMs: Date.now() - start,
      };
    }
  };
}

// ─── Master wire function ─────────────────────────────────────────────────────

export async function wireTools(): Promise<void> {
  // Ensure all built-in tools are registered first
  for (const t of BUILT_IN_TOOLS) {
    if (!globalToolRegistry.has(t.name)) {
      globalToolRegistry.register(t);
    }
  }

  await Promise.all([
    wireBashTool(),
    wirePythonTool(),
    wireJsTool(),
    wireFileTools(),
    wireWebTools(),
    wireMemoryTools(),
    wireDocumentTool(),
    wireSpawnTaskTool(),
  ]);

  Logger.info('[ToolWiring] all tools wired', {
    registered: globalToolRegistry.list().length,
  });
}
