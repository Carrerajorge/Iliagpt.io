/**
 * ToolRegistry — Central registry for all agent tools.
 *
 * Responsibilities:
 *   - Register / unregister tool definitions
 *   - Categorize tools (file, shell, web, memory, code, agent)
 *   - Permission checks per category
 *   - Dynamic registration at runtime (plugins, user tools)
 *   - Retrieve by name or category
 *   - Execute a tool by name with typed input
 */

import { z }      from 'zod';
import { Logger } from '../../lib/logger';

// ─── Core types ───────────────────────────────────────────────────────────────

export const ToolCategorySchema = z.enum([
  'file',     // read_file, write_file, edit_file, list_files
  'shell',    // bash, python, javascript
  'web',      // web_search, web_fetch
  'memory',   // memory_store, memory_recall
  'agent',    // spawn_task, sub_agent
  'document', // create_document
  'code',     // code executor variants
  'custom',   // user-registered tools
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const ToolPermissionSchema = z.enum([
  'read',        // non-mutating operations
  'write',       // mutates filesystem / memory
  'network',     // HTTP calls
  'shell',       // spawns processes
  'agent',       // spawns agents / tasks
  'privileged',  // cross-user / system-level
]);
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;

export interface ToolParameter {
  name       : string;
  type       : 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required   : boolean;
  default?   : unknown;
  enum?      : string[];
}

export interface ToolDefinition {
  name        : string;
  description : string;
  category    : ToolCategory;
  permissions : ToolPermission[];
  parameters  : ToolParameter[];
  /** Zod schema — used for input validation */
  inputSchema : z.ZodTypeAny;
  /** Execute the tool. Returns serialisable output. */
  execute     : (input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult>;
  /** Optional: whether to show this tool to the model */
  hidden?     : boolean;
  /** Optional: tags for filtering */
  tags?       : string[];
  version?    : string;
}

export interface ToolExecutionContext {
  userId     : string;
  chatId     : string;
  runId      : string;
  sessionId? : string;
  workspaceRoot: string;
  signal?    : AbortSignal;
  onStream?  : (chunk: string) => void;
}

export interface ToolResult {
  success   : boolean;
  output    : unknown;
  error?    : { code: string; message: string; retryable: boolean };
  durationMs: number;
}

export interface ToolCallRecord {
  toolName  : string;
  callId    : string;
  input     : unknown;
  result    : ToolResult;
  timestamp : number;
}

// ─── Permission profile ───────────────────────────────────────────────────────

export interface PermissionProfile {
  /** Allow these categories. undefined = allow all. */
  allowedCategories?: ToolCategory[];
  /** Deny these specific tools regardless of category. */
  deniedTools?      : string[];
  /** Require explicit approval for these categories. */
  approvalRequired? : ToolCategory[];
}

export const PERMISSIVE_PROFILE: PermissionProfile  = {};
export const READ_ONLY_PROFILE: PermissionProfile   = {
  allowedCategories: ['file', 'web', 'memory'],
  deniedTools      : [],
};
export const SAFE_CODING_PROFILE: PermissionProfile = {
  allowedCategories: ['file', 'web', 'memory', 'code', 'document'],
};
export const FULL_AGENT_PROFILE: PermissionProfile  = {};

// ─── Registry ─────────────────────────────────────────────────────────────────

export class ToolRegistry {
  private readonly tools    = new Map<string, ToolDefinition>();
  private readonly history  : ToolCallRecord[] = [];
  private profile           : PermissionProfile = PERMISSIVE_PROFILE;

  // ── Registration ────────────────────────────────────────────────────────────

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      Logger.warn('[ToolRegistry] overwriting existing tool', { name: tool.name });
    }
    this.tools.set(tool.name, tool);
    Logger.debug('[ToolRegistry] registered', { name: tool.name, category: tool.category });
  }

  registerMany(tools: ToolDefinition[]): void {
    tools.forEach(t => this.register(t));
  }

  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) Logger.debug('[ToolRegistry] unregistered', { name });
    return removed;
  }

  // ── Lookup ───────────────────────────────────────────────────────────────────

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(opts: {
    category?  : ToolCategory;
    tags?      : string[];
    includeHidden?: boolean;
    profile?   : PermissionProfile;
  } = {}): ToolDefinition[] {
    const p = opts.profile ?? this.profile;
    return [...this.tools.values()].filter(t => {
      if (!opts.includeHidden && t.hidden) return false;
      if (opts.category && t.category !== opts.category) return false;
      if (opts.tags?.length) {
        if (!opts.tags.some(tag => t.tags?.includes(tag))) return false;
      }
      return this._isAllowed(t.name, t.category, p);
    });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  // ── Permissions ──────────────────────────────────────────────────────────────

  setProfile(profile: PermissionProfile): void {
    this.profile = profile;
    Logger.debug('[ToolRegistry] permission profile updated', {
      categories: profile.allowedCategories ?? 'all',
      denied     : profile.deniedTools?.length ?? 0,
    });
  }

  private _isAllowed(name: string, category: ToolCategory, profile: PermissionProfile): boolean {
    if (profile.deniedTools?.includes(name)) return false;
    if (profile.allowedCategories && !profile.allowedCategories.includes(category)) return false;
    return true;
  }

  isAllowed(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    return this._isAllowed(name, tool.category, this.profile);
  }

  // ── Execution ────────────────────────────────────────────────────────────────

  async execute(
    name  : string,
    input : unknown,
    ctx   : ToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success   : false,
        output    : null,
        error     : { code: 'TOOL_NOT_FOUND', message: `No tool named '${name}'`, retryable: false },
        durationMs: 0,
      };
    }

    if (!this._isAllowed(name, tool.category, this.profile)) {
      return {
        success   : false,
        output    : null,
        error     : { code: 'PERMISSION_DENIED', message: `Tool '${name}' is not permitted in the current profile`, retryable: false },
        durationMs: 0,
      };
    }

    // Validate input
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success   : false,
        output    : null,
        error     : { code: 'INVALID_INPUT', message: parsed.error.message, retryable: false },
        durationMs: 0,
      };
    }

    const start = Date.now();
    try {
      const result = await tool.execute(parsed.data, ctx);
      result.durationMs = Date.now() - start;

      this.history.push({
        toolName : name,
        callId   : `${name}-${Date.now()}`,
        input    : parsed.data,
        result,
        timestamp: Date.now(),
      });
      if (this.history.length > 500) this.history.shift();

      Logger.debug('[ToolRegistry] executed', {
        name, success: result.success, durationMs: result.durationMs,
      });
      return result;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error('[ToolRegistry] tool execution threw', { name, error: msg });
      return {
        success   : false,
        output    : null,
        error     : { code: 'EXECUTION_ERROR', message: msg, retryable: true },
        durationMs: Date.now() - start,
      };
    }
  }

  // ── History ──────────────────────────────────────────────────────────────────

  recentCalls(limit = 20): ToolCallRecord[] {
    return this.history.slice(-limit);
  }

  stats(): Record<string, { calls: number; failures: number }> {
    const out: Record<string, { calls: number; failures: number }> = {};
    for (const r of this.history) {
      const s = out[r.toolName] ?? { calls: 0, failures: 0 };
      s.calls++;
      if (!r.result.success) s.failures++;
      out[r.toolName] = s;
    }
    return out;
  }

  // ── Snapshot for prompt injection ────────────────────────────────────────────

  /** Returns a compact human-readable tool manifest for system prompt injection. */
  toManifest(profile?: PermissionProfile): string {
    const available = this.list({ profile });
    if (available.length === 0) return 'No tools available.';
    return available
      .map(t => `- **${t.name}** (${t.category}): ${t.description}`)
      .join('\n');
  }
}

// Singleton for direct import
export const globalToolRegistry = new ToolRegistry();
