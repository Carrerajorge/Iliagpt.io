import { z } from "zod";

export type ISODate = string;

export interface UserIdentity {
  id: string;
  name?: string;
  email?: string;
  roles: string[];
  capabilities: string[];
  plan: "free" | "pro" | "admin";
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: ISODate;
  meta?: Record<string, unknown>;
}

export interface ToolExecutionOptions {
  timeoutMs?: number;
  retries?: number;
  retryBaseBackoffMs?: number;
  retryMaxBackoffMs?: number;
  cacheKey?: string;
  cacheTtlMs?: number;
  rateLimitKey?: string;
  maxConcurrent?: number;
}

export interface ToolDefinition<TParams extends z.ZodTypeAny = z.ZodAny, TResult = unknown> {
  id: number;
  name: string;
  category: string;
  priority: "Crítica" | "Alta" | "Media" | "Baja";
  description: string;
  schema: TParams;
  tags?: string[];
  defaultOptions?: ToolExecutionOptions;
  handler: (params: z.infer<TParams>, ctx: ToolContext) => Promise<TResult>;
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowTools: string[];
  denyTools?: string[];
  requiredCapabilities?: string[];
  maxToolCallsPerTurn?: number;
  maxTokensPerTurn?: number;
}

export interface RoutingDecision {
  action: "respond" | "delegate";
  targetAgent?: string;
  response?: string;
  task?: string;
  confidence?: number;
  reasons?: string[];
}

export interface ToolCall {
  tool: string;
  params: unknown;
  options?: ToolExecutionOptions;
}

export interface ToolContext {
  traceId: string;
  requestId: string;
  now: () => Date;
  user?: UserIdentity;
  config: ResolvedConfig;
  logger: Logger;
  metrics: Metrics;
  audit: Audit;
  cache: Cache;
  memory: Memory;
  events: EventBus;
  services: ServiceRegistry;
  policy: PolicyEngine;
}

export interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
}

export interface Metrics {
  inc: (name: string, tags?: Record<string, string>) => void;
  timing: (name: string, ms: number, tags?: Record<string, string>) => void;
  gauge: (name: string, value: number, tags?: Record<string, string>) => void;
}

export interface AuditEntry {
  action: string;
  actor: string;
  resource: string;
  details?: Record<string, unknown>;
  timestamp: ISODate;
  traceId?: string;
  requestId?: string;
}

export interface Audit {
  log: (entry: AuditEntry) => void;
  query: (filter: Partial<AuditEntry>, limit?: number) => AuditEntry[];
}

export interface Cache {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, value: T, ttlMs?: number) => void;
  delete: (key: string) => boolean;
  clear: () => void;
}

export interface MemoryRecord {
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  createdAt: ISODate;
  expiresAt?: ISODate;
}

export interface Memory {
  store: (rec: { key: string; value: unknown; metadata?: Record<string, unknown>; ttlSeconds?: number }) => Promise<void>;
  get: (key: string) => Promise<MemoryRecord | null>;
  search: (query: string, limit: number, threshold: number) => Promise<Array<MemoryRecord & { score: number }>>;
}

export interface EventBus {
  on: (event: string, handler: (payload: any) => void) => void;
  off: (event: string, handler: (payload: any) => void) => void;
  emit: (event: string, payload: any) => void;
}

export interface ServiceRegistry {
  set: <T>(key: string, value: T) => void;
  get: <T>(key: string) => T;
  has: (key: string) => boolean;
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

export interface PolicyEngine {
  canUseTool: (args: { agent: AgentDefinition; toolName: string; user?: UserIdentity; tool?: ToolDefinition<any, any> }) => PolicyDecision;
  sanitize: (args: { userMessage: string }) => string;
}

export interface ResolvedConfig {
  MODEL: string;
  API_KEY?: string;
  BASE_URL: string;
  TEMPERATURE: number;
  MAX_TOKENS: number;
  TIMEOUT_MS: number;
  MAX_CONCURRENCY: number;
  CB_FAILURE_THRESHOLD: number;
  CB_OPEN_MS: number;
  CB_HALF_OPEN_MAX_CALLS: number;
  RL_BUCKET_CAPACITY: number;
  RL_REFILL_PER_SEC: number;
  TOOL_MAX_CONCURRENT_DEFAULT: number;
  CACHE_DEFAULT_TTL_MS: number;
  LOG_LEVEL: "debug" | "info" | "warn" | "error";
  ENABLE_AUDIT: boolean;
}

export interface LLMAdapter {
  chat: (args: {
    model: string;
    system: string;
    messages: ChatMessage[];
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
  }) => Promise<string>;
}

export interface WorkflowStep {
  id: string;
  tool: string;
  params: unknown;
  dependsOn?: string[];
  options?: ToolExecutionOptions;
  retries?: number;
}

export interface WorkflowResult {
  workflowId: string;
  status: "succeeded" | "failed";
  results: Record<string, unknown>;
  errors: Record<string, string>;
}

export interface TracerSpan {
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;
}
