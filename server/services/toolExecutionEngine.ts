import { EventEmitter } from 'events';
import crypto from 'crypto';
import { pythonToolsClient, PythonToolsClientError, type ToolExecuteResponse } from '../lib/pythonToolsClient';
import { ALL_TOOLS, getToolByName } from '../agent/langgraph/tools';
import { createServiceCircuitBreaker, type ServiceCircuitConfig, type ServiceCallResult, CircuitState } from '../lib/circuitBreaker';
import { createLogger } from '../lib/structuredLogger';
import { withToolSpan } from '../lib/tracing';

const logger = createLogger('tool-execution-engine');

export type ToolType = 'python' | 'typescript' | 'unknown';

export interface UnifiedToolInfo {
  name: string;
  description: string;
  type: ToolType;
  category: string;
  isAvailable: boolean;
  schema?: Record<string, any>;
  lastHealthCheck?: number;
}

export interface ExecutionProgress {
  executionId: string;
  toolName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  step: number;
  totalSteps: number;
  startedAt: number;
  updatedAt: number;
  duration?: number;
}

export interface ExecutionResult {
  executionId: string;
  toolName: string;
  toolType: ToolType;
  success: boolean;
  data?: any;
  error?: string;
  errorCode?: string;
  metadata?: {
    userId?: string;
    conversationId?: string;
    runId?: string;
    traceId?: string;
    requestId?: string;
  };
  metrics: {
    startTime: number;
    endTime: number;
    durationMs: number;
    attempts: number;
    circuitState: CircuitState;
    fromCache?: boolean;
  };
}

export interface ExecutionHistoryEntry {
  executionId: string;
  toolName: string;
  toolType: ToolType;
  input: Record<string, any>;
  success: boolean;
  durationMs: number;
  timestamp: number;
  error?: string;
  userId?: string;
  conversationId?: string;
  runId?: string;
  traceId?: string;
  requestId?: string;
}

export interface ToolAnalytics {
  toolName: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDurationMs: number;
  successRate: number;
  lastExecutedAt?: number;
  circuitState: CircuitState;
}

export interface EngineAnalytics {
  totalExecutions: number;
  activeExecutions: number;
  pythonToolsAvailable: boolean;
  typescriptToolsCount: number;
  pythonToolsCount: number;
  cacheHitRate: number;
  toolAnalytics: Map<string, ToolAnalytics>;
}

export interface ExecutionOptions {
  timeout?: number;
  maxRetries?: number;
  userId?: string;
  conversationId?: string;
  runId?: string;
  traceId?: string;
  requestId?: string;
  skipCache?: boolean;
  onProgress?: (progress: ExecutionProgress) => void;
  idempotencyKey?: string;
}

type ValidationResult = {
  success: boolean;
  message?: string;
};

type IdempotencyState = "running" | "resolved" | "error";

interface IdempotentExecution {
  key: string;
  inputHash: string;
  status: IdempotencyState;
  result?: ExecutionResult;
  promise?: Promise<ExecutionResult>;
  createdAt: number;
  error?: string;
}

type ToolSchemaValidator = {
  safeParse?: (value: unknown) => { success: boolean; data?: unknown; error?: unknown };
  parse?: (value: unknown) => unknown;
};

const CACHE_TTL_MS = 300000;
const HEALTH_CHECK_INTERVAL_MS = 60000;
const MAX_HISTORY_SIZE = 1000;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;
const TOOL_NAME_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const TOOL_INPUT_MAX_BYTES = 196_000;
const TOOL_INPUT_MAX_KEYS = 120;
const TOOL_INPUT_MAX_DEPTH = 8;
const TOOL_INPUT_MAX_ARRAY_LENGTH = 500;
const TOOL_KEY_MAX_LENGTH = 120;
const TOOL_STRING_MAX_LENGTH = 2_000;
const TOOL_TIMEOUT_MIN_MS = 250;
const TOOL_TIMEOUT_MAX_MS = 120_000;
const TOOL_MAX_RETRIES = 4;
const TOOL_HISTORY_PAYLOAD_BYTES = 12_000;
const TOOL_IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._-]{6,140}$/;
const TOOL_IDEMPOTENCY_TTL_MS = 5 * 60_000;
const TOOL_IDEMPOTENCY_MAX_ENTRIES = 300;
const TOOL_MAX_CONCURRENT_EXECUTIONS = 64;

const TOOL_EXECUTION_OVERLOADED_MESSAGE = "Tool execution concurrency limit exceeded";

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeToolName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !TOOL_NAME_RE.test(trimmed)) return null;
  return trimmed;
}

const PROHIBITED_TOOL_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeToolValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth >= TOOL_INPUT_MAX_DEPTH) {
    throw new Error("Tool input depth limit exceeded");
  }

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const cleaned = value
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
    return cleaned.length > TOOL_STRING_MAX_LENGTH ? cleaned.slice(0, TOOL_STRING_MAX_LENGTH) : cleaned;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Tool input contains invalid numeric value");
    }
    return value;
  }

  if (typeof value === "boolean") return value;

  if (typeof value === "bigint") return value.toString();

  if (typeof value === "symbol" || typeof value === "function") {
    throw new Error("Tool input contains unsupported value type");
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error("Tool input has circular reference");
    }
    seen.add(value);
    const output: unknown[] = [];
    const limit = Math.min(value.length, TOOL_INPUT_MAX_ARRAY_LENGTH);
    for (let i = 0; i < limit; i += 1) {
      output.push(sanitizeToolValue(value[i], depth + 1, seen));
    }
    seen.delete(value);
    return output;
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      throw new Error("Tool input has circular reference");
    }
    seen.add(value);
    const output: Record<string, unknown> = {};
    let keys = 0;
    for (const [key, item] of Object.entries(value)) {
      if (keys >= TOOL_INPUT_MAX_KEYS) break;
      if (!TOOL_NAME_RE.test(key) || key.length > TOOL_KEY_MAX_LENGTH || PROHIBITED_TOOL_KEYS.has(key)) {
        continue;
      }
      output[key] = sanitizeToolValue(item, depth + 1, seen);
      keys += 1;
    }
    seen.delete(value);
    return output;
  }

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Map || value instanceof Set) {
    throw new Error("Tool input must not contain Map or Set");
  }

  return String(value);
}

function sanitizeToolInput(value: unknown): Record<string, unknown> {
  const normalized = sanitizeToolValue(value, 0, new WeakSet<object>()) as unknown;
  if (!isPlainObject(normalized)) {
    throw new Error("Tool input must be a plain object");
  }
  const serialized = safeStringify(normalized);
  if (serialized.length > TOOL_INPUT_MAX_BYTES) {
    throw new Error("Tool input exceeds maximum payload size");
  }
  return normalized;
}

function clipForHistory(payload: Record<string, unknown>): Record<string, unknown> {
  const serialized = safeStringify(payload);
  if (serialized.length <= TOOL_HISTORY_PAYLOAD_BYTES) {
    return payload;
  }
  return {
    _truncated: true,
    _size: serialized.length,
    _sample: serialized.slice(0, TOOL_HISTORY_PAYLOAD_BYTES),
  };
}

function normalizeTimeout(timeout: number | undefined): number {
  if (!Number.isFinite(timeout)) {
    return DEFAULT_TIMEOUT_MS;
  }
  const clamped = Math.floor(timeout);
  if (clamped < TOOL_TIMEOUT_MIN_MS) return TOOL_TIMEOUT_MIN_MS;
  if (clamped > TOOL_TIMEOUT_MAX_MS) return TOOL_TIMEOUT_MAX_MS;
  return clamped;
}

function normalizeRetryCount(maxRetries: number | undefined): number {
  if (!Number.isFinite(maxRetries)) {
    return DEFAULT_MAX_RETRIES;
  }
  const clamped = Math.floor(maxRetries);
  if (clamped < 0) return 0;
  if (clamped > TOOL_MAX_RETRIES) return TOOL_MAX_RETRIES;
  return clamped;
}

function normalizeIdempotencyKey(rawKey: unknown): string | null {
  if (typeof rawKey !== "string") {
    return null;
  }
  const normalized = rawKey.trim();
  return TOOL_IDEMPOTENCY_KEY_RE.test(normalized) ? normalized : null;
}

function buildIdempotencyHash(
  toolName: string,
  input: Record<string, unknown>,
  options: { timeout?: number; maxRetries?: number; skipCache?: boolean; userId?: string }
): string {
  const fingerprint = safeStringify({
    toolName,
    input,
    timeout: options.timeout,
    maxRetries: options.maxRetries,
    skipCache: options.skipCache,
    userId: options.userId,
  });
  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

function extractValidationMessage(validationError: unknown): string {
  const errorMessage = validationError as {
    message?: string;
    errors?: Array<{ path?: unknown; message?: string }>;
    issues?: Array<{ path?: unknown; message?: string }>;
  };

  const issues = errorMessage.issues ?? errorMessage.errors;
  if (Array.isArray(issues) && issues.length > 0) {
    const details = issues
      .slice(0, 3)
      .map((issue) => `${Array.isArray(issue.path) ? issue.path.join('.') : 'root'}: ${issue.message || 'invalid'}`)
      .join('; ');
    return `Input validation failed: ${details}`;
  }

  return errorMessage.message || 'Input validation failed';
}

function buildFailureExecutionResult(
  executionId: string,
  toolName: string,
  startTime: number,
  error: unknown,
  metadata?: ExecutionResult['metadata'],
): ExecutionResult {
  const endTime = Date.now();
  return {
    executionId,
    toolName,
    toolType: "unknown",
    success: false,
    error: safeToolError(error),
    errorCode: classifyToolError(error),
    metadata,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      attempts: 1,
      circuitState: CircuitState.CLOSED,
    },
  };
}

function classifyToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('Tool not found')) return 'TOOL_NOT_FOUND';
  if (message.includes('Invalid tool name') || message.includes('Tool input')) return 'INVALID_INPUT';
  if (message.includes('concurrency limit')) return 'TOOL_OVERLOADED';
  if (message.includes('timed out')) return 'TOOL_TIMEOUT';
  if (message.includes('Circuit breaker is OPEN')) return 'TOOL_CIRCUIT_OPEN';
  if (error instanceof PythonToolsClientError) return 'PYTHON_TOOL_FAILURE';
  return 'EXECUTION_FAILED';
}

function sanitizeMetadataValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function buildExecutionMetadata(options: ExecutionOptions): ExecutionResult['metadata'] {
  return {
    userId: sanitizeMetadataValue(options.userId),
    conversationId: sanitizeMetadataValue(options.conversationId),
    runId: sanitizeMetadataValue(options.runId),
    traceId: sanitizeMetadataValue(options.traceId),
    requestId: sanitizeMetadataValue(options.requestId),
  };
}

function sanitizeErrorMessage(message: string): string {
  return message.replace(/(api[_-]?key|token|secret|passwd|password)=?[^&\s]*/gi, '[REDACTED]');
}

function safeToolError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  return sanitizeErrorMessage(String(error || 'Unknown error'));
}

function buildSafeInputForExecution(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) {
    return {};
  }
  return sanitizeToolInput(input);
}

function extractValidatedPayload(schema: unknown, input: Record<string, unknown>): ValidationResult & { payload?: Record<string, unknown> } {
  if (!schema || !isPlainObject(input)) {
    return { success: true, payload: input };
  }

  const validator = schema as ToolSchemaValidator;
  if (typeof validator.safeParse === 'function') {
    try {
      const parseResult = validator.safeParse(input);
      if (!parseResult.success) {
        return {
          success: false,
          message: extractValidationMessage(parseResult.error),
        };
      }
      const parsedData = parseResult.data;
      if (isPlainObject(parsedData)) {
        return { success: true, payload: parsedData };
      }
      if (parsedData === undefined) {
        return { success: true, payload: {} };
      }
      return { success: false, message: "Tool schema output is not an object" };
    } catch (error) {
      return { success: false, message: extractValidationMessage(error) };
    }
  }

  if (typeof validator.parse === 'function') {
    try {
      const parsedData = validator.parse(input);
      if (parsedData && isPlainObject(parsedData)) {
        return { success: true, payload: parsedData };
      }
      if (parsedData === undefined) {
        return { success: true, payload: {} };
      }
      return { success: false, message: "Tool schema output is not an object" };
    } catch (error) {
      return { success: false, message: extractValidationMessage(error) };
    }
  }

  return { success: true, payload: input };
}

export class ToolExecutionEngine extends EventEmitter {
  private toolCache: Map<string, { tool: UnifiedToolInfo; cachedAt: number }> = new Map();
  private executionHistory: ExecutionHistoryEntry[] = [];
  private activeExecutions: Map<string, ExecutionProgress> = new Map();
  private toolAnalytics: Map<string, ToolAnalytics> = new Map();
  private circuitBreakers: Map<string, ReturnType<typeof createServiceCircuitBreaker>> = new Map();
  private toolInputSchemas: Map<string, unknown> = new Map();
  private idempotentExecutions: Map<string, IdempotentExecution> = new Map();
  private pythonToolsHealthy: boolean = false;
  private lastHealthCheck: number = 0;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private initialized: boolean = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing Tool Execution Engine');
    await this.discoverAllTools();
    this.startHealthCheckLoop();
    this.initialized = true;
    logger.info('Tool Execution Engine initialized', {
      pythonToolsAvailable: this.pythonToolsHealthy,
      totalTools: this.toolCache.size,
    });
  }

  private startHealthCheckLoop(): void {
    setInterval(async () => {
      try {
        await this.checkPythonToolsHealth();
      } catch (error) {
        logger.warn('Python tools health check failed', { error });
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private async checkPythonToolsHealth(): Promise<boolean> {
    try {
      const health = await pythonToolsClient.health();
      this.pythonToolsHealthy = health.status === 'healthy';
      this.lastHealthCheck = Date.now();
      return this.pythonToolsHealthy;
    } catch {
      this.pythonToolsHealthy = false;
      this.lastHealthCheck = Date.now();
      return false;
    }
  }

  private pruneIdempotentExecutions(now = Date.now()): void {
    const entries = Array.from(this.idempotentExecutions.entries());
    if (!entries.length) return;

    const valid = entries.filter(([, entry]) => entry.result || entry.promise || entry.createdAt + TOOL_IDEMPOTENCY_TTL_MS > now);
    if (valid.length === 0) {
      this.idempotentExecutions.clear();
      return;
    }

    if (valid.length <= TOOL_IDEMPOTENCY_MAX_ENTRIES) {
      if (valid.length === entries.length) return;
      this.idempotentExecutions = new Map(valid);
      return;
    }

    const sorted = valid
      .sort(([, a], [, b]) => a.createdAt - b.createdAt)
      .slice(-TOOL_IDEMPOTENCY_MAX_ENTRIES);
    this.idempotentExecutions = new Map(sorted);
  }

  private getIdempotentExecution(key: string, inputHash: string): IdempotentExecution | null {
    const existing = this.idempotentExecutions.get(key);
    if (!existing) return null;
    if (existing.createdAt + TOOL_IDEMPOTENCY_TTL_MS < Date.now()) {
      this.idempotentExecutions.delete(key);
      return null;
    }
    if (existing.inputHash !== inputHash) {
      return {
        key,
        inputHash,
        status: "error",
        createdAt: Date.now(),
        error: "Idempotency key replayed with different input",
      };
    }
    return existing;
  }

  private registerInFlightExecution(
    key: string,
    inputHash: string,
    execution: Promise<ExecutionResult>,
    now = Date.now()
  ): IdempotentExecution {
    const entry: IdempotentExecution = {
      key,
      inputHash,
      status: "running",
      promise: execution,
      createdAt: now,
    };
    this.idempotentExecutions.set(key, entry);
    this.pruneIdempotentExecutions(now);
    return entry;
  }

  private finalizeIdempotentExecution(
    key: string,
    result: ExecutionResult
  ): ExecutionResult {
    const existing = this.idempotentExecutions.get(key);
    if (!existing) return result;
    existing.status = result.success ? "resolved" : "error";
    existing.result = result;
    existing.promise = undefined;
    existing.createdAt = Date.now();
    return result;
  }

  async discoverAllTools(): Promise<UnifiedToolInfo[]> {
    const tools: UnifiedToolInfo[] = [];

    for (const langTool of ALL_TOOLS) {
      if (!TOOL_NAME_RE.test(langTool.name)) continue;
      if (langTool.schema) {
        this.toolInputSchemas.set(`ts:${langTool.name}`, langTool.schema);
      }

      const toolInfo: UnifiedToolInfo = {
        name: langTool.name,
        description: langTool.description,
        type: 'typescript',
        category: this.inferCategory(langTool.name),
        isAvailable: true,
        schema: langTool.schema ? JSON.parse(JSON.stringify(langTool.schema)) : undefined,
        lastHealthCheck: Date.now(),
      };
      tools.push(toolInfo);
      this.toolCache.set(`ts:${langTool.name}`, { tool: toolInfo, cachedAt: Date.now() });
    }

    try {
      await this.checkPythonToolsHealth();
      if (this.pythonToolsHealthy) {
        const pythonTools = await pythonToolsClient.listTools();
        for (const pyTool of pythonTools) {
          const toolInfo: UnifiedToolInfo = {
            name: pyTool.name,
            description: pyTool.description,
            type: 'python',
            category: pyTool.category || 'general',
            isAvailable: true,
            lastHealthCheck: Date.now(),
          };
          tools.push(toolInfo);
          this.toolCache.set(`py:${pyTool.name}`, { tool: toolInfo, cachedAt: Date.now() });
        }
      }
    } catch (error) {
      logger.warn('Failed to discover Python tools', { error });
    }

    return tools;
  }

  private inferCategory(toolName: string): string {
    const categoryMap: Record<string, string[]> = {
      document: ['document', 'file', 'pdf', 'docx', 'xlsx', 'slides'],
      search: ['search', 'browser', 'research', 'web'],
      code: ['python', 'shell', 'code', 'execute'],
      communication: ['message', 'email', 'clarify', 'explain', 'summarize'],
      data: ['data', 'database', 'query', 'transform'],
      memory: ['memory', 'store', 'retrieve', 'context', 'session'],
      reasoning: ['reason', 'reflect', 'verify', 'decide'],
      orchestration: ['orchestrate', 'workflow', 'plan', 'schedule'],
      generation: ['generate', 'image', 'diagram', 'chart'],
      security: ['security', 'encrypt', 'auth'],
    };

    const lowerName = toolName.toLowerCase();
    for (const [category, keywords] of Object.entries(categoryMap)) {
      if (keywords.some(kw => lowerName.includes(kw))) {
        return category;
      }
    }
    return 'general';
  }

  async listTools(options?: { type?: ToolType; category?: string; refresh?: boolean }): Promise<UnifiedToolInfo[]> {
    if (options?.refresh || this.toolCache.size === 0) {
      await this.discoverAllTools();
    }

    const tools: UnifiedToolInfo[] = [];
    const now = Date.now();

    for (const { tool, cachedAt } of this.toolCache.values()) {
      if (now - cachedAt > CACHE_TTL_MS) {
        continue;
      }
      if (options?.type && tool.type !== options.type) {
        continue;
      }
      if (options?.category && tool.category !== options.category) {
        continue;
      }
      tools.push(tool);
    }

    return tools;
  }

  async getTool(name: string): Promise<UnifiedToolInfo | null> {
    const sanitized = sanitizeToolName(name);
    if (!sanitized) {
      return null;
    }

    const tsCached = this.toolCache.get(`ts:${sanitized}`);
    if (tsCached && Date.now() - tsCached.cachedAt < CACHE_TTL_MS) {
      this.cacheHits++;
      return tsCached.tool;
    }

    const pyCached = this.toolCache.get(`py:${sanitized}`);
    if (pyCached && Date.now() - pyCached.cachedAt < CACHE_TTL_MS) {
      this.cacheHits++;
      return pyCached.tool;
    }

    this.cacheMisses++;

    const langTool = getToolByName(sanitized);
    if (langTool) {
      if (langTool.schema) {
        this.toolInputSchemas.set(`ts:${sanitized}`, langTool.schema);
      }
      const toolInfo: UnifiedToolInfo = {
        name: langTool.name,
        description: langTool.description,
        type: 'typescript',
        category: this.inferCategory(langTool.name),
        isAvailable: true,
        schema: langTool.schema ? JSON.parse(JSON.stringify(langTool.schema)) : undefined,
        lastHealthCheck: Date.now(),
      };
      this.toolCache.set(`ts:${sanitized}`, { tool: toolInfo, cachedAt: Date.now() });
      return toolInfo;
    }

    if (this.pythonToolsHealthy) {
      try {
        const pyTool = await pythonToolsClient.getTool(sanitized);
        const toolInfo: UnifiedToolInfo = {
          name: pyTool.name,
          description: pyTool.description,
          type: 'python',
          category: pyTool.category || 'general',
          isAvailable: true,
          lastHealthCheck: Date.now(),
        };
        this.toolCache.set(`py:${sanitized}`, { tool: toolInfo, cachedAt: Date.now() });
        return toolInfo;
      } catch {
        // Tool not found in Python
      }
    }

    return null;
  }

  private getCircuitBreaker(
    toolName: string,
    options: { timeout?: number; maxRetries?: number } = {}
  ): ReturnType<typeof createServiceCircuitBreaker> {
    const normalizedTimeout = normalizeTimeout(options.timeout);
    const normalizedRetries = normalizeRetryCount(options.maxRetries);
    const breakerName = `${toolName}:${normalizedTimeout}:${normalizedRetries}`;

    if (!this.circuitBreakers.has(breakerName)) {
      const config: ServiceCircuitConfig = {
        name: `tool:${breakerName}`,
        failureThreshold: 5,
        resetTimeout: 60000,
        timeout: normalizedTimeout,
        retries: normalizedRetries,
        retryDelay: 1000,
        onStateChange: (from, to) => {
          logger.info(`Circuit breaker state change for ${breakerName}`, { from, to });
          this.emit('circuitStateChange', { toolName: breakerName, from, to });
        },
      };
      this.circuitBreakers.set(breakerName, createServiceCircuitBreaker(config));
    }
    return this.circuitBreakers.get(breakerName)!;
  }

  async execute(
    toolName: string,
    input: Record<string, any>,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const sanitizedToolName = sanitizeToolName(toolName);
    const metadata = buildExecutionMetadata(options);

    try {
      if (!sanitizedToolName) {
        const errorMessage = "Invalid tool name";
        const errorResult: ExecutionResult = {
          executionId,
          toolName,
          toolType: "unknown",
          success: false,
          error: errorMessage,
          errorCode: classifyToolError(new Error(errorMessage)),
          metadata,
          metrics: {
            startTime,
            endTime: Date.now(),
            durationMs: Date.now() - startTime,
            attempts: 1,
            circuitState: CircuitState.CLOSED,
          },
        };
        this.recordExecution(errorResult, {}, metadata);
        return errorResult;
      }

      const sanitizedInput = buildSafeInputForExecution(input);
      const {
        timeout = DEFAULT_TIMEOUT_MS,
        maxRetries = DEFAULT_MAX_RETRIES,
        userId,
        onProgress,
        skipCache,
        idempotencyKey,
      } = options;
      const safeTimeout = normalizeTimeout(timeout);
      const safeMaxRetries = normalizeRetryCount(maxRetries);
      const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
      const idempotencyInputHash = buildIdempotencyHash(sanitizedToolName, sanitizedInput, {
        timeout: safeTimeout,
        maxRetries: safeMaxRetries,
        skipCache,
        userId,
      });

      if (this.activeExecutions.size >= TOOL_MAX_CONCURRENT_EXECUTIONS) {
        return buildFailureExecutionResult(
          executionId,
          sanitizedToolName,
          startTime,
          new Error(TOOL_EXECUTION_OVERLOADED_MESSAGE),
          metadata
        );
      }

      if (normalizedIdempotencyKey) {
        const existing = this.getIdempotentExecution(normalizedIdempotencyKey, idempotencyInputHash);
        if (existing) {
          if (existing.status === "running" && existing.promise) {
            return existing.promise;
          }
          if (existing.status === "resolved" && existing.result) {
            return existing.result;
          }
          if (existing.status === "error" && existing.error) {
            const conflictResult: ExecutionResult = {
              executionId,
              toolName: sanitizedToolName,
              toolType: "unknown",
              success: false,
              error: existing.error,
              errorCode: "IDEMPOTENCY_CONFLICT",
              metadata,
              metrics: {
                startTime,
                endTime: Date.now(),
                durationMs: Date.now() - startTime,
                attempts: 1,
                circuitState: CircuitState.CLOSED,
              },
            };
            return conflictResult;
          }
        }
      }

      const execution = withToolSpan(
        sanitizedToolName,
        () => this.performExecution({
          executionId,
          sanitizedToolName,
          sanitizedInput,
          safeTimeout,
          safeMaxRetries,
          userId,
          onProgress,
          conversationId: options.conversationId,
          runId: options.runId,
          traceId: options.traceId,
          requestId: options.requestId,
        }),
        { userId, requestId: options.requestId, sessionId: options.conversationId }
      );

      if (normalizedIdempotencyKey) {
        const inFlight = this.registerInFlightExecution(
          normalizedIdempotencyKey,
          idempotencyInputHash,
          execution,
          startTime
        );
        try {
          const result = await execution;
          this.finalizeIdempotentExecution(inFlight.key, result);
          return result;
        } catch (error: unknown) {
          const failureResult = buildFailureExecutionResult(
            executionId,
            sanitizedToolName,
            startTime,
            error,
            metadata
          );
          this.finalizeIdempotentExecution(inFlight.key, failureResult);
          return failureResult;
        }
      }

      return await execution;
    } catch (error: unknown) {
      return buildFailureExecutionResult(
        executionId,
        sanitizedToolName,
        startTime,
        error,
        metadata
      );
    }
  }

  private async performExecution(params: {
    executionId: string;
    sanitizedToolName: string;
    sanitizedInput: Record<string, unknown>;
    safeTimeout: number;
    safeMaxRetries: number;
    userId?: string;
    onProgress?: (progress: ExecutionProgress) => void;
    conversationId?: string;
    runId?: string;
    traceId?: string;
    requestId?: string;
  }): Promise<ExecutionResult> {
    const {
      executionId,
      sanitizedToolName,
      sanitizedInput,
      safeTimeout,
      safeMaxRetries,
      userId,
      onProgress,
      conversationId,
      runId,
      traceId,
      requestId,
    } = params;
    const startTime = Date.now();
    const metadata = buildExecutionMetadata({
      userId,
      conversationId,
      runId,
      traceId,
      requestId,
    });

    if (this.activeExecutions.size >= TOOL_MAX_CONCURRENT_EXECUTIONS) {
      return buildFailureExecutionResult(
        executionId,
        sanitizedToolName,
        startTime,
        new Error(TOOL_EXECUTION_OVERLOADED_MESSAGE),
        metadata
      );
    }

    let attempts = 1;
    const progress: ExecutionProgress = {
      executionId,
      toolName: sanitizedToolName,
      status: "queued",
      progress: 0,
      message: "Initializing...",
      step: 0,
      totalSteps: 3,
      startedAt: startTime,
      updatedAt: startTime,
    };

    this.activeExecutions.set(executionId, progress);
    this.emitProgress(progress, onProgress);

    try {
      const tool = await this.getTool(sanitizedToolName);
      if (!tool) {
        throw new Error(`Tool '${sanitizedToolName}' not found`);
      }

      progress.status = "running";
      progress.step = 1;
      progress.message = `Executing ${tool.type} tool: ${sanitizedToolName}`;
      progress.progress = 33;
      progress.updatedAt = Date.now();
      this.emitProgress(progress, onProgress);

      const validatedInput = this.validateToolInput(tool, sanitizedInput);

      const circuitBreaker = this.getCircuitBreaker(tool.name, {
        timeout: safeTimeout,
        maxRetries: safeMaxRetries,
      });

      let result: ServiceCallResult<any>;

      if (tool.type === "python") {
        result = await circuitBreaker.call(
          () => this.executePythonTool(tool.name, validatedInput, safeTimeout),
          `execute:${sanitizedToolName}`
        );
      } else {
        result = await circuitBreaker.call(
          () => this.executeTypescriptTool(tool.name, validatedInput, safeTimeout),
          `execute:${sanitizedToolName}`
        );
      }

      progress.step = 2;
      progress.progress = 66;
      progress.message = "Processing result...";
      progress.updatedAt = Date.now();
      this.emitProgress(progress, onProgress);

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      const executionResult: ExecutionResult = {
        executionId,
        toolName: sanitizedToolName,
        toolType: tool.type,
        success: result.success,
        data: result.data,
        error: result.error,
        errorCode: result.success ? undefined : classifyToolError(result.error || "EXECUTION_FAILED"),
        metrics: {
          startTime,
          endTime,
          durationMs,
          attempts: result.retryCount === undefined ? 1 : result.retryCount + 1,
          circuitState: result.circuitState,
          fromCache: result.fromFallback,
        },
      };

      attempts = executionResult.metrics.attempts;
      this.recordExecution(executionResult, validatedInput, userId, metadata);

      progress.step = 3;
      progress.progress = 100;
      progress.status = result.success ? "completed" : "failed";
      progress.message = result.success ? "Completed successfully" : (result.error || "Execution failed");
      progress.duration = durationMs;
      progress.updatedAt = Date.now();
      this.emitProgress(progress, onProgress);

      this.activeExecutions.delete(executionId);
      return executionResult;
    } catch (error: any) {
      const endTime = Date.now();
      const durationMs = endTime - startTime;

      progress.status = "failed";
      progress.message = error.message || "Unknown error";
      progress.duration = durationMs;
      progress.updatedAt = Date.now();
      this.emitProgress(progress, onProgress);

      this.activeExecutions.delete(executionId);

      const errorResult: ExecutionResult = {
        executionId,
        toolName: sanitizedToolName,
        toolType: "unknown",
        success: false,
        error: safeToolError(error),
        errorCode: classifyToolError(error),
        metadata,
        metrics: {
          startTime,
          endTime,
          durationMs,
          attempts,
          circuitState: CircuitState.CLOSED,
        },
      };

      this.recordExecution(errorResult, sanitizedInput, userId, metadata);
      return errorResult;
    }
  }

  private validateToolInput(tool: UnifiedToolInfo, input: Record<string, unknown>): Record<string, unknown> {
    const schema = this.toolInputSchemas.get(`${tool.type === 'python' ? 'py' : 'ts'}:${tool.name}`);
    if (!schema) {
      return input;
    }

    const validation = extractValidatedPayload(schema, input);
    if (!validation.success) {
      throw new Error(validation.message || `Tool input validation failed for '${tool.name}'`);
    }
    return validation.payload || input;
  }

  private async executePythonTool(
    toolName: string,
    input: Record<string, unknown>,
    timeout: number
  ): Promise<any> {
    const safeTimeout = normalizeTimeout(timeout);
    const normalizedInput = buildSafeInputForExecution(input);
    const result = await this.executeWithTimeout<ToolExecuteResponse>(async () => {
      return pythonToolsClient.executeTool(toolName, normalizedInput as Record<string, any>);
    }, safeTimeout, `python:${toolName}`);

    if (!result) {
      throw new Error('Python tool execution returned no response');
    }
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error || 'Python tool execution failed');
  }

  private async executeTypescriptTool(
    toolName: string,
    input: Record<string, unknown>,
    timeout: number
  ): Promise<any> {
    const tool = getToolByName(toolName);
    if (!tool) {
      throw new Error(`TypeScript tool '${toolName}' not found`);
    }

    const safeInput = buildSafeInputForExecution(input);
    const safeTimeout = normalizeTimeout(timeout);
    const result = await this.executeWithTimeout(async () => {
      const invocation = (tool as any).invoke(safeInput);
      return invocation;
    }, safeTimeout, `typescript:${toolName}`);

    if (typeof result === 'string') {
      try {
        return JSON.parse(result);
      } catch {
        return { result };
      }
    }
    return result;
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const safeTimeout = normalizeTimeout(timeoutMs);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${safeTimeout}ms`));
      }, safeTimeout);
    });

    try {
      return await Promise.race([operation(), timeout]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private emitProgress(progress: ExecutionProgress, callback?: (progress: ExecutionProgress) => void): void {
    this.emit('progress', progress);
    callback?.(progress);
  }

  private recordExecution(
    result: ExecutionResult,
    input: Record<string, any>,
    userId?: string,
    metadata?: ExecutionResult['metadata']
  ): void {
    const safeInput = input && isPlainObject(input) ? clipForHistory(input) : {};
    const resolvedMetadata = metadata || result.metadata || {};
    const entry: ExecutionHistoryEntry = {
      executionId: result.executionId,
      toolName: result.toolName,
      toolType: result.toolType,
      input: safeInput,
      success: result.success,
      durationMs: result.metrics.durationMs,
      timestamp: result.metrics.startTime,
      error: result.error,
      userId: userId || resolvedMetadata.userId,
      conversationId: resolvedMetadata.conversationId,
      runId: resolvedMetadata.runId,
      traceId: resolvedMetadata.traceId,
      requestId: resolvedMetadata.requestId,
    };

    this.executionHistory.unshift(entry);
    if (this.executionHistory.length > MAX_HISTORY_SIZE) {
      this.executionHistory.pop();
    }

    this.updateToolAnalytics(result);
  }

  private updateToolAnalytics(result: ExecutionResult): void {
    const existing = this.toolAnalytics.get(result.toolName) || {
      toolName: result.toolName,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageDurationMs: 0,
      successRate: 0,
      circuitState: CircuitState.CLOSED,
    };

    const newTotal = existing.totalExecutions + 1;
    const newSuccessful = existing.successfulExecutions + (result.success ? 1 : 0);
    const newFailed = existing.failedExecutions + (result.success ? 0 : 1);

    const newAvgDuration = Math.round(
      (existing.averageDurationMs * existing.totalExecutions + result.metrics.durationMs) / newTotal
    );

    this.toolAnalytics.set(result.toolName, {
      toolName: result.toolName,
      totalExecutions: newTotal,
      successfulExecutions: newSuccessful,
      failedExecutions: newFailed,
      averageDurationMs: newAvgDuration,
      successRate: Math.round((newSuccessful / newTotal) * 100),
      lastExecutedAt: result.metrics.endTime,
      circuitState: result.metrics.circuitState,
    });
  }

  getExecutionHistory(options?: {
    toolName?: string;
    conversationId?: string;
    runId?: string;
    requestId?: string;
    userId?: string;
    limit?: number;
    successOnly?: boolean;
  }): ExecutionHistoryEntry[] {
    let history = [...this.executionHistory];

    if (options?.toolName) {
      history = history.filter(e => e.toolName === options.toolName);
    }
    if (options?.userId) {
      history = history.filter(e => e.userId === options.userId);
    }
    if (options?.conversationId) {
      history = history.filter(e => e.conversationId === options.conversationId);
    }
    if (options?.runId) {
      history = history.filter(e => e.runId === options.runId);
    }
    if (options?.requestId) {
      history = history.filter(e => e.requestId === options.requestId);
    }
    if (options?.successOnly) {
      history = history.filter(e => e.success);
    }
    if (options?.limit) {
      history = history.slice(0, options.limit);
    }

    return history;
  }

  getToolAnalytics(toolName?: string): ToolAnalytics | ToolAnalytics[] | null {
    if (toolName) {
      return this.toolAnalytics.get(toolName) || null;
    }
    return Array.from(this.toolAnalytics.values());
  }

  getEngineAnalytics(): EngineAnalytics {
    const tsTools = ALL_TOOLS.length;
    let pyTools = 0;
    for (const { tool } of this.toolCache.values()) {
      if (tool.type === 'python') pyTools++;
    }

    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0
      ? Math.round((this.cacheHits / totalCacheRequests) * 100)
      : 0;

    return {
      totalExecutions: this.executionHistory.length,
      activeExecutions: this.activeExecutions.size,
      pythonToolsAvailable: this.pythonToolsHealthy,
      typescriptToolsCount: tsTools,
      pythonToolsCount: pyTools,
      cacheHitRate,
      toolAnalytics: this.toolAnalytics,
    };
  }

  getActiveExecutions(): ExecutionProgress[] {
    return Array.from(this.activeExecutions.values());
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return false;
    }

    execution.status = 'cancelled';
    execution.message = 'Cancelled by user';
    execution.updatedAt = Date.now();
    this.emit('progress', execution);
    this.activeExecutions.delete(executionId);
    return true;
  }

  private findCircuitBreaker(toolName: string): ReturnType<typeof createServiceCircuitBreaker> | null {
    const normalizedToolName = sanitizeToolName(toolName);
    if (!normalizedToolName) return null;

    const canonicalKey = `${normalizedToolName}:${normalizeTimeout(DEFAULT_TIMEOUT_MS)}:${normalizeRetryCount(DEFAULT_MAX_RETRIES)}`;
    const candidates = [
      canonicalKey,
      normalizedToolName,
      ...Array.from(this.circuitBreakers.keys()).filter((key) => key.startsWith(`${normalizedToolName}:`)),
    ];

    for (const candidate of candidates) {
      const breaker = this.circuitBreakers.get(candidate);
      if (breaker) {
        return breaker;
      }
    }
    return null;
  }

  getCircuitBreakerStatus(toolName: string): { state: CircuitState; stats: any } | null {
    const breaker = this.findCircuitBreaker(toolName);
    if (!breaker) {
      return null;
    }
    return {
      state: breaker.getState(),
      stats: breaker.getStats(),
    };
  }

  resetCircuitBreaker(toolName: string): void {
    const breaker = this.findCircuitBreaker(toolName);
    if (breaker) {
      breaker.reset();
      logger.info(`Circuit breaker reset for tool: ${sanitizeToolName(toolName)}`);
    }
  }

  clearCache(): void {
    this.toolCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    logger.info('Tool cache cleared');
  }

  async refreshTools(): Promise<UnifiedToolInfo[]> {
    this.clearCache();
    return this.discoverAllTools();
  }

  subscribeToProgress(callback: (progress: ExecutionProgress) => void): () => void {
    this.on('progress', callback);
    return () => this.off('progress', callback);
  }

  subscribeToCircuitChanges(
    callback: (event: { toolName: string; from: CircuitState; to: CircuitState }) => void
  ): () => void {
    this.on('circuitStateChange', callback);
    return () => this.off('circuitStateChange', callback);
  }
}

export const toolExecutionEngine = new ToolExecutionEngine();

export async function initializeToolExecutionEngine(): Promise<void> {
  await toolExecutionEngine.initialize();
}
