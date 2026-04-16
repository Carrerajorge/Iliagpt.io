export type SessionKey = `agent:${string}:${string}`;

export interface WsRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface WsResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

export interface WsEvent {
  type: 'event';
  event: string;
  payload: unknown;
  timestamp: number;
}

export type WsMessage = WsRequest | WsResponse | WsEvent;

export interface ToolPolicy {
  exec: {
    security: 'ask' | 'warn' | 'allow';
    safeBins: string[];
    timeout: number;
  };
  fs: {
    workspaceOnly: boolean;
    maxFileSize: number;
    allowedPaths: string[];
  };
  browser: {
    enabled: boolean;
    timeout: number;
  };
}

export interface OpenClawPlugin {
  id: string;
  version?: string;
  title?: string;
  hooks?: Partial<Record<HookPoint, HookHandler>>;
  tools?: (ctx: any) => any[];
  setup?: (ctx: any) => Promise<void>;
  shutdown?: (ctx: any) => Promise<void>;
}

export type HookPoint =
  | 'before_model_resolve'
  | 'before_prompt_build'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'agent_end'
  | 'message_received'
  | 'message_sent'
  | 'session_start'
  | 'session_end'
  | 'gateway_start'
  | 'gateway_stop'
  | 'error';

export type HookHandler = (ctx: HookContext) => Promise<void> | void;

export interface HookContext {
  runId?: string;
  sessionKey?: string;
  userId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  error?: Error;
  metadata?: Record<string, unknown>;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  bootstrap?: Record<string, string>;
  source?: 'builtin' | 'filesystem';
  status?: 'ready' | 'needs_setup' | 'disabled';
  filePath?: string;
  metadata?: Record<string, unknown>;
  updatedAt?: number;
}
