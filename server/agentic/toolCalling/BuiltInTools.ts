/**
 * BuiltInTools
 *
 * All first-party built-in tools for the agentic system.
 *
 * Tools implemented:
 *   bash           — execute shell command (spawn, no interpolation)
 *   python         — run Python code snippet
 *   javascript     — run JS in vm sandbox
 *   read_file      — read file from workspace or local home
 *   write_file     — write file to workspace
 *   edit_file      — string-replace patch on a file
 *   list_files     — list directory contents
 *   web_search     — search the web via existing searchWeb service
 *   web_fetch      — fetch a URL and return text/markdown
 *   create_document — create Word/PDF document via existing service
 *   memory_store   — persist a fact to user memory
 *   memory_recall  — search user memory
 *   spawn_task     — spawn a background task
 */

import vm       from 'vm';
import os       from 'os';
import path     from 'path';
import fs       from 'fs/promises';
import { spawn }               from 'child_process';
import { randomUUID }          from 'crypto';
import { z }                   from 'zod';
import { Logger }              from '../../lib/logger';
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from './ToolRegistry';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_OUTPUT  = 100_000;
const DEFAULT_TIMEOUT_MS = 15_000;

function ok(output: unknown, durationMs = 0): ToolResult {
  return { success: true, output, durationMs };
}
function fail(code: string, message: string, durationMs = 0, retryable = false): ToolResult {
  return { success: false, output: null, error: { code, message, retryable }, durationMs };
}

/** Resolve path within workspace, disallowing escapes. */
function resolveWorkspacePath(root: string, p: string): string | null {
  const expanded = p.startsWith('~/')
    ? path.join(os.homedir(), p.slice(2))
    : p;
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(root, expanded);
  if (!resolved.startsWith(path.resolve(root))) return null;
  return resolved;
}

/** Run a child process safely (spawn, not exec). */
function runProcess(
  bin    : string,
  args   : string[],
  timeout: number,
  signal?: AbortSignal,
  onChunk?: (s: string) => void,
): Promise<{ stdout: string; stderr: string; exitCode: number; killed: boolean }> {
  return new Promise(resolve => {
    const bufs: { o: Buffer[]; e: Buffer[] } = { o: [], e: [] };
    let killed = false;

    const proc = spawn(bin, args, {
      env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8' },
      signal,
    });

    const timer = setTimeout(() => { killed = true; proc.kill('SIGKILL'); }, timeout);

    proc.stdout.on('data', (chunk: Buffer) => {
      bufs.o.push(chunk);
      onChunk?.(chunk.toString());
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      bufs.e.push(chunk);
    });

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({
        stdout  : Buffer.concat(bufs.o).toString('utf8').slice(0, MAX_OUTPUT),
        stderr  : Buffer.concat(bufs.e).toString('utf8').slice(0, MAX_OUTPUT),
        exitCode: code ?? (killed ? -1 : 0),
        killed,
      });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: -1, killed: false });
    });
  });
}

/** Write code to a tmpfile then execute it. */
async function execCodeFile(
  code   : string,
  ext    : string,
  bin    : string,
  args   : string[],
  timeout: number,
  onChunk?: (s: string) => void,
): Promise<ToolResult> {
  const tmp = path.join(os.tmpdir(), `ilia_${randomUUID()}${ext}`);
  const start = Date.now();
  try {
    await fs.writeFile(tmp, code, 'utf8');
    const { stdout, stderr, exitCode, killed } = await runProcess(bin, [...args, tmp], timeout, undefined, onChunk);
    const output = stdout || stderr;
    if (killed) return fail('TIMEOUT', `Execution timed out after ${timeout}ms`, Date.now() - start, true);
    return exitCode === 0
      ? ok(output, Date.now() - start)
      : fail('EXIT_CODE', stderr || stdout || `Exited with code ${exitCode}`, Date.now() - start, true);
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}

// ─── JS sandbox sessions ──────────────────────────────────────────────────────

const jsSessions = new Map<string, { ctx: vm.Context; logs: string[] }>();

function getJsSession(sessionId?: string): { ctx: vm.Context; logs: string[]; ephemeral: boolean } {
  if (sessionId && jsSessions.has(sessionId)) {
    return { ...jsSessions.get(sessionId)!, ephemeral: false };
  }
  const logs: string[] = [];
  const sandbox = {
    console : { log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
                 error: (...a: unknown[]) => logs.push('[err] ' + a.map(String).join(' ')),
                 warn : (...a: unknown[]) => logs.push('[warn] ' + a.map(String).join(' ')) },
    Math, JSON, Date, Array, Object, String, Number, Boolean,
    RegExp, Error, Promise, Map, Set, parseInt, parseFloat, isNaN,
    __state: Object.create(null) as Record<string, unknown>,
  };
  const ctx = vm.createContext(sandbox);
  const session = { ctx, logs };
  if (sessionId) jsSessions.set(sessionId, session);
  return { ...session, ephemeral: !sessionId };
}

// ─── Tool factories ───────────────────────────────────────────────────────────

const bashTool: ToolDefinition = {
  name       : 'bash',
  description: 'Execute a shell command. Returns stdout/stderr. Use for system commands, file operations, git, npm, etc.',
  category   : 'shell',
  permissions: ['shell'],
  parameters : [
    { name: 'command', type: 'string', description: 'Shell command to run', required: true },
    { name: 'timeout', type: 'number', description: 'Timeout in milliseconds (default 15000)', required: false, default: 15000 },
    { name: 'cwd',     type: 'string', description: 'Working directory', required: false },
  ],
  inputSchema: z.object({
    command: z.string().min(1),
    timeout: z.number().int().min(1).max(120_000).optional().default(DEFAULT_TIMEOUT_MS),
    cwd    : z.string().optional(),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { command, timeout, cwd } = input as { command: string; timeout: number; cwd?: string };
    const start = Date.now();
    const tmp = path.join(os.tmpdir(), `ilia_bash_${randomUUID()}.sh`);
    try {
      await fs.writeFile(tmp, command, 'utf8');
      const spawnArgs: string[] = [];
      const proc = spawn('sh', [tmp], {
        cwd    : cwd ?? ctx.workspaceRoot,
        signal : ctx.signal,
        env    : { ...process.env, PWD: cwd ?? ctx.workspaceRoot },
      });
      const bufs = { o: [] as Buffer[], e: [] as Buffer[] };
      let killed = false;
      const timer = setTimeout(() => { killed = true; proc.kill('SIGKILL'); }, timeout);
      proc.stdout.on('data', (c: Buffer) => { bufs.o.push(c); ctx.onStream?.(c.toString()); });
      proc.stderr.on('data', (c: Buffer) => { bufs.e.push(c); ctx.onStream?.(c.toString()); });
      await new Promise<void>(res => proc.on('close', () => { clearTimeout(timer); res(); }));
      const stdout = Buffer.concat(bufs.o).toString().slice(0, MAX_OUTPUT);
      const stderr = Buffer.concat(bufs.e).toString().slice(0, MAX_OUTPUT);
      if (killed) return fail('TIMEOUT', `Command timed out after ${timeout}ms`, Date.now() - start, true);
      return ok({ stdout, stderr }, Date.now() - start);
    } finally {
      fs.unlink(tmp).catch(() => {});
    }
  },
};

const pythonTool: ToolDefinition = {
  name       : 'python',
  description: 'Run a Python code snippet. Returns printed output.',
  category   : 'code',
  permissions: ['shell'],
  parameters : [
    { name: 'code',    type: 'string', description: 'Python code to execute', required: true },
    { name: 'timeout', type: 'number', description: 'Timeout ms (default 15000)', required: false, default: 15000 },
  ],
  inputSchema: z.object({
    code   : z.string().min(1),
    timeout: z.number().int().min(1).max(120_000).optional().default(DEFAULT_TIMEOUT_MS),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { code, timeout } = input as { code: string; timeout: number };
    return execCodeFile(code, '.py', 'python3', [], timeout, ctx.onStream);
  },
};

const javascriptTool: ToolDefinition = {
  name       : 'javascript',
  description: 'Run JavaScript code in a secure Node.js vm sandbox. Returns console.log output.',
  category   : 'code',
  permissions: ['shell'],
  parameters : [
    { name: 'code',      type: 'string',  description: 'JS code to run', required: true },
    { name: 'sessionId', type: 'string',  description: 'Persistent session ID for stateful REPL', required: false },
    { name: 'timeout',   type: 'number',  description: 'Timeout ms (default 5000)', required: false, default: 5000 },
  ],
  inputSchema: z.object({
    code     : z.string().min(1),
    sessionId: z.string().optional(),
    timeout  : z.number().int().min(1).max(30_000).optional().default(5000),
  }),
  execute: async (input: unknown, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { code, sessionId, timeout } = input as { code: string; sessionId?: string; timeout: number };
    const start  = Date.now();
    const sess   = getJsSession(sessionId);
    const before = sess.logs.length;
    try {
      vm.runInContext(code, sess.ctx, { timeout, filename: 'sandbox.js' });
      const output = sess.logs.slice(before).join('\n');
      return ok(output, Date.now() - start);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail('JS_ERROR', msg, Date.now() - start, false);
    }
  },
};

const readFileTool: ToolDefinition = {
  name       : 'read_file',
  description: 'Read a file from the workspace. Returns file content as text.',
  category   : 'file',
  permissions: ['read'],
  parameters : [
    { name: 'path',   type: 'string', description: 'File path relative to workspace', required: true },
    { name: 'offset', type: 'number', description: 'Start line (0-indexed)', required: false },
    { name: 'limit',  type: 'number', description: 'Max lines to read', required: false },
  ],
  inputSchema: z.object({
    path  : z.string().min(1),
    offset: z.number().int().min(0).optional(),
    limit : z.number().int().min(1).optional(),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { path: p, offset, limit } = input as { path: string; offset?: number; limit?: number };
    const start = Date.now();
    const resolved = resolveWorkspacePath(ctx.workspaceRoot, p);
    if (!resolved) return fail('BLOCKED', 'Path outside workspace', Date.now() - start);
    try {
      const stat = await fs.stat(resolved);
      if (stat.size > 10 * 1024 * 1024) return fail('TOO_LARGE', 'File exceeds 10 MB', Date.now() - start);
      let content = await fs.readFile(resolved, 'utf8');
      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n');
        content = lines.slice(offset ?? 0, limit ? (offset ?? 0) + limit : undefined).join('\n');
      }
      return ok(content, Date.now() - start);
    } catch (err: unknown) {
      return fail('READ_ERROR', (err as Error).message, Date.now() - start);
    }
  },
};

const writeFileTool: ToolDefinition = {
  name       : 'write_file',
  description: 'Write or create a file in the workspace.',
  category   : 'file',
  permissions: ['write'],
  parameters : [
    { name: 'path',    type: 'string', description: 'File path relative to workspace', required: true },
    { name: 'content', type: 'string', description: 'Content to write', required: true },
  ],
  inputSchema: z.object({
    path   : z.string().min(1),
    content: z.string(),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { path: p, content } = input as { path: string; content: string };
    const start    = Date.now();
    const resolved = resolveWorkspacePath(ctx.workspaceRoot, p);
    if (!resolved) return fail('BLOCKED', 'Path outside workspace', Date.now() - start);
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf8');
      return ok(`Written ${content.length} bytes to ${p}`, Date.now() - start);
    } catch (err: unknown) {
      return fail('WRITE_ERROR', (err as Error).message, Date.now() - start);
    }
  },
};

const editFileTool: ToolDefinition = {
  name       : 'edit_file',
  description: 'Edit a file by replacing exact text. Use for surgical code edits.',
  category   : 'file',
  permissions: ['write'],
  parameters : [
    { name: 'path',       type: 'string',  description: 'File path', required: true },
    { name: 'old_string', type: 'string',  description: 'Exact string to replace', required: true },
    { name: 'new_string', type: 'string',  description: 'Replacement string', required: true },
    { name: 'replace_all',type: 'boolean', description: 'Replace all occurrences', required: false, default: false },
  ],
  inputSchema: z.object({
    path       : z.string().min(1),
    old_string : z.string().min(1),
    new_string : z.string(),
    replace_all: z.boolean().optional().default(false),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { path: p, old_string, new_string, replace_all } = input as {
      path: string; old_string: string; new_string: string; replace_all: boolean;
    };
    const start    = Date.now();
    const resolved = resolveWorkspacePath(ctx.workspaceRoot, p);
    if (!resolved) return fail('BLOCKED', 'Path outside workspace', Date.now() - start);
    try {
      const content  = await fs.readFile(resolved, 'utf8');
      const count    = content.split(old_string).length - 1;
      if (count === 0) return fail('NOT_FOUND', `String not found in ${p}`, Date.now() - start);
      if (!replace_all && count > 1) return fail('AMBIGUOUS', `Found ${count} occurrences — set replace_all:true or make old_string more specific`, Date.now() - start);
      const updated  = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);
      await fs.writeFile(resolved, updated, 'utf8');
      return ok(`Replaced ${replace_all ? count : 1} occurrence(s) in ${p}`, Date.now() - start);
    } catch (err: unknown) {
      return fail('EDIT_ERROR', (err as Error).message, Date.now() - start);
    }
  },
};

const listFilesTool: ToolDefinition = {
  name       : 'list_files',
  description: 'List files and directories in a workspace path.',
  category   : 'file',
  permissions: ['read'],
  parameters : [
    { name: 'path',      type: 'string',  description: 'Directory path (default: workspace root)', required: false },
    { name: 'recursive', type: 'boolean', description: 'List recursively', required: false, default: false },
  ],
  inputSchema: z.object({
    path     : z.string().optional().default('.'),
    recursive: z.boolean().optional().default(false),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { path: p, recursive } = input as { path: string; recursive: boolean };
    const start    = Date.now();
    const resolved = resolveWorkspacePath(ctx.workspaceRoot, p);
    if (!resolved) return fail('BLOCKED', 'Path outside workspace', Date.now() - start);
    try {
      const entries: string[] = [];
      async function walk(dir: string, base: string): Promise<void> {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const rel = path.join(base, item.name);
          entries.push(item.isDirectory() ? rel + '/' : rel);
          if (recursive && item.isDirectory()) await walk(path.join(dir, item.name), rel);
        }
      }
      await walk(resolved, '');
      return ok(entries, Date.now() - start);
    } catch (err: unknown) {
      return fail('LIST_ERROR', (err as Error).message, Date.now() - start);
    }
  },
};

const webSearchTool: ToolDefinition = {
  name       : 'web_search',
  description: 'Search the web for current information. Returns titles, URLs, and snippets.',
  category   : 'web',
  permissions: ['network'],
  parameters : [
    { name: 'query', type: 'string', description: 'Search query', required: true },
    { name: 'limit', type: 'number', description: 'Max results (default 5)', required: false, default: 5 },
  ],
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).optional().default(5),
  }),
  execute: async (input: unknown, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { query, limit } = input as { query: string; limit: number };
    const start = Date.now();
    try {
      const { searchWeb } = await import('../../services/webSearch');
      const results = await searchWeb(query);
      return ok(results.slice(0, limit), Date.now() - start);
    } catch (err: unknown) {
      return fail('SEARCH_ERROR', (err as Error).message, Date.now() - start, true);
    }
  },
};

const webFetchTool: ToolDefinition = {
  name       : 'web_fetch',
  description: 'Fetch the content of a URL as text. Useful for reading articles, docs, or APIs.',
  category   : 'web',
  permissions: ['network'],
  parameters : [
    { name: 'url',    type: 'string', description: 'URL to fetch', required: true },
    { name: 'format', type: 'string', description: '"text" or "markdown" (default: text)', required: false, default: 'text', enum: ['text', 'markdown'] },
  ],
  inputSchema: z.object({
    url   : z.string().url(),
    format: z.enum(['text', 'markdown']).optional().default('text'),
  }),
  execute: async (input: unknown, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { url, format } = input as { url: string; format: string };
    const start = Date.now();
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'IliaGPT/1.0 Agent' },
        signal : AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return fail('HTTP_ERROR', `${resp.status} ${resp.statusText}`, Date.now() - start, true);
      const text = await resp.text();
      const output = format === 'markdown'
        ? text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        : text;
      return ok(output.slice(0, 50_000), Date.now() - start);
    } catch (err: unknown) {
      return fail('FETCH_ERROR', (err as Error).message, Date.now() - start, true);
    }
  },
};

const createDocumentTool: ToolDefinition = {
  name       : 'create_document',
  description: 'Create a Word, Excel, or PDF document from structured content.',
  category   : 'document',
  permissions: ['write'],
  parameters : [
    { name: 'type',    type: 'string', description: 'Document type: "word", "excel", or "pdf"', required: true, enum: ['word', 'excel', 'pdf'] },
    { name: 'title',   type: 'string', description: 'Document title', required: true },
    { name: 'content', type: 'string', description: 'Document content (markdown for word/pdf, JSON for excel)', required: true },
  ],
  inputSchema: z.object({
    type   : z.enum(['word', 'excel', 'pdf']),
    title  : z.string().min(1),
    content: z.string().min(1),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { type, title, content } = input as { type: string; title: string; content: string };
    const start = Date.now();
    try {
      const { generateWordDocument } = await import('../../services/documentGeneration');
      if (type === 'word') {
        const result = await generateWordDocument(content, title, ctx.userId);
        return ok(result, Date.now() - start);
      }
      return fail('UNSUPPORTED', `Document type '${type}' not yet supported`, Date.now() - start);
    } catch (err: unknown) {
      return fail('DOC_ERROR', (err as Error).message, Date.now() - start);
    }
  },
};

const memoryStoreTool: ToolDefinition = {
  name       : 'memory_store',
  description: 'Save a fact or piece of information to the user\'s long-term memory.',
  category   : 'memory',
  permissions: ['write'],
  parameters : [
    { name: 'key',   type: 'string', description: 'A short identifier for this memory', required: true },
    { name: 'value', type: 'string', description: 'The information to remember', required: true },
    { name: 'tags',  type: 'array',  description: 'Tags for categorisation', required: false },
  ],
  inputSchema: z.object({
    key  : z.string().min(1),
    value: z.string().min(1),
    tags : z.array(z.string()).optional(),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { key, value, tags } = input as { key: string; value: string; tags?: string[] };
    const start = Date.now();
    try {
      // Persist via redis for durability
      const { redis } = await import('../../lib/redis');
      const memKey = `agent:memory:${ctx.userId}:${key}`;
      await redis.set(memKey, JSON.stringify({ value, tags, ts: Date.now() }), 'EX', 86400 * 30);
      return ok({ stored: true, key }, Date.now() - start);
    } catch (err: unknown) {
      return fail('STORE_ERROR', (err as Error).message, Date.now() - start, true);
    }
  },
};

const memoryRecallTool: ToolDefinition = {
  name       : 'memory_recall',
  description: 'Search the user\'s long-term memory for relevant information.',
  category   : 'memory',
  permissions: ['read'],
  parameters : [
    { name: 'query', type: 'string', description: 'What to search for', required: true },
    { name: 'limit', type: 'number', description: 'Max results (default 5)', required: false, default: 5 },
  ],
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).optional().default(5),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { query, limit } = input as { query: string; limit: number };
    const start  = Date.now();
    try {
      const { redis } = await import('../../lib/redis');
      const pattern = `agent:memory:${ctx.userId}:*`;
      const keys    = await redis.keys(pattern);
      const needle  = query.toLowerCase();
      const results: Array<{ key: string; value: string; score: number }> = [];

      for (const k of keys.slice(0, 200)) {
        const raw = await redis.get(k);
        if (!raw) continue;
        const { value } = JSON.parse(raw) as { value: string };
        const score = (value.toLowerCase().split(needle).length - 1) / (value.length / 100 + 1);
        if (score > 0) results.push({ key: k.split(':').pop()!, value, score });
      }

      results.sort((a, b) => b.score - a.score);
      return ok(results.slice(0, limit), Date.now() - start);
    } catch (err: unknown) {
      return fail('RECALL_ERROR', (err as Error).message, Date.now() - start, true);
    }
  },
};

const spawnTaskTool: ToolDefinition = {
  name       : 'spawn_task',
  description: 'Spawn a background task that runs independently. Returns a task ID to check progress.',
  category   : 'agent',
  permissions: ['agent'],
  parameters : [
    { name: 'objective',    type: 'string', description: 'What the task should accomplish', required: true },
    { name: 'instructions', type: 'string', description: 'Detailed instructions', required: false },
    { name: 'tools',        type: 'array',  description: 'Tool names the sub-task is allowed to use', required: false },
  ],
  inputSchema: z.object({
    objective   : z.string().min(1),
    instructions: z.string().optional(),
    tools       : z.array(z.string()).optional(),
  }),
  execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const { objective, instructions, tools } = input as {
      objective: string; instructions?: string; tools?: string[];
    };
    const start = Date.now();
    try {
      const { backgroundTaskManager } = await import('../../tasks/BackgroundTaskManager');
      const task = await backgroundTaskManager.spawn({
        userId     : ctx.userId,
        chatId     : ctx.chatId,
        objective,
        instructions,
        allowedTools: tools,
        parentRunId: ctx.runId,
      });
      return ok({ taskId: task.id, status: task.status }, Date.now() - start);
    } catch (err: unknown) {
      return fail('SPAWN_ERROR', (err as Error).message, Date.now() - start, true);
    }
  },
};

// ─── Export all built-in tools ────────────────────────────────────────────────

export const BUILT_IN_TOOLS: ToolDefinition[] = [
  bashTool,
  pythonTool,
  javascriptTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  webSearchTool,
  webFetchTool,
  createDocumentTool,
  memoryStoreTool,
  memoryRecallTool,
  spawnTaskTool,
];

export {
  bashTool,
  pythonTool,
  javascriptTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  webSearchTool,
  webFetchTool,
  createDocumentTool,
  memoryStoreTool,
  memoryRecallTool,
  spawnTaskTool,
};
