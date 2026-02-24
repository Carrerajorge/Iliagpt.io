import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from './structuredLogger';

const TOOL_NAME_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const BASE_URL_MAX_LEN = 512;
const TOOL_EXECUTE_INPUT_MAX_BYTES = 196_000;
const TOOL_INPUT_MAX_KEYS = 120;
const TOOL_INPUT_MAX_DEPTH = 8;
const TOOL_INPUT_MAX_ARRAY_LENGTH = 500;
const TOOL_STRING_MAX_LENGTH = 2_000;
const TOOL_KEY_MAX_LENGTH = 120;
const AGENT_CONTEXT_MAX_BYTES = 96_000;
const AGENT_TASK_MAX_LEN = 4_000;
const TOOL_CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const PROHIBITED_TOOL_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const logger = createLogger("python-tools-client");

interface ToolInfo {
  name: string;
  description: string;
  category: string;
  priority: string;
  dependencies: string[];
}

interface ToolExecuteResponse {
  success: boolean;
  data: Record<string, unknown>;
  error?: string;
  metadata: Record<string, unknown>;
}

interface AgentInfo {
  name: string;
  description: string;
  category: string;
  tools_used: string[];
}

interface HealthResponse {
  status: string;
  tools_count: number;
  agents_count?: number;
}

type ToolExecuteInput = Record<string, unknown>;
type AgentContext = Record<string, unknown>;

function safeJsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function sanitizeText(value: unknown): string {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .replace(TOOL_CONTROL_CHARS_RE, "")
    .trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeInputValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth >= TOOL_INPUT_MAX_DEPTH) {
    throw new Error("Tool input depth limit exceeded");
  }

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const normalized = sanitizeText(value);
    return normalized.length > TOOL_STRING_MAX_LENGTH
      ? normalized.slice(0, TOOL_STRING_MAX_LENGTH)
      : normalized;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Tool input contains invalid numeric value");
    }
    return value;
  }

  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();

  if (typeof value === "function" || typeof value === "symbol") {
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
      output.push(sanitizeInputValue(value[i], depth + 1, seen));
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
      if (keys >= TOOL_INPUT_MAX_KEYS) {
        break;
      }
      const sanitizedKey = sanitizeText(key);
      if (
        !TOOL_NAME_RE.test(sanitizedKey)
        || sanitizedKey.length > TOOL_KEY_MAX_LENGTH
        || PROHIBITED_TOOL_KEYS.has(sanitizedKey)
      ) {
        continue;
      }
      output[sanitizedKey] = sanitizeInputValue(item, depth + 1, seen);
      keys += 1;
    }
    seen.delete(value);
    return output;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map || value instanceof Set) {
    throw new Error("Tool input must not contain Map or Set");
  }

  return String(value);
}

function sanitizeContext(context: unknown): Record<string, unknown> {
  if (context == null || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }
  return context as Record<string, unknown>;
}

function sanitizeToolInput(input: unknown): ToolExecuteInput {
  const normalized = sanitizeInputValue(input, 0, new WeakSet<object>()) as unknown;
  if (!isPlainObject(normalized)) {
    throw new Error("Tool input must be a plain object");
  }
  if (safeJsonSize(normalized) > TOOL_EXECUTE_INPUT_MAX_BYTES) {
    throw new Error("Tool input exceeds maximum payload size");
  }
  return normalized;
}

export class PythonToolsClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'PythonToolsClientError';
  }
}

export class PythonToolsClient {
  private client: AxiosInstance;
  private baseUrl: string;

  private sanitizeBaseUrl(baseUrl: string): string {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
      throw new Error("Python tool service URL is required");
    }
    if (baseUrl.length > BASE_URL_MAX_LEN) {
      throw new Error(`Python tool service URL exceeds maximum length: ${BASE_URL_MAX_LEN}`);
    }
    const trimmed = baseUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(`Invalid Python tool service URL: ${trimmed}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Invalid Python tool service protocol: ${parsed.protocol}`);
    }
    if (parsed.username || parsed.password) {
      throw new Error("Python tool service URL must not include credentials");
    }
    return `${parsed.protocol}//${parsed.host}`;
  }

  private sanitizeToolName(name: string, type: "tool" | "agent" = "tool"): string {
    if (!TOOL_NAME_RE.test(name || "")) {
      throw new Error(`Invalid ${type} name: ${name}`);
    }
    return name;
  }

  private sanitizeTask(task: unknown): string {
    const normalized = String(task ?? "").replace(/\u0000/g, "").trim();
    if (!normalized) {
      throw new Error("Task cannot be empty");
    }
    if (normalized.length > AGENT_TASK_MAX_LEN) {
      throw new Error(`Task exceeds maximum length: ${AGENT_TASK_MAX_LEN}`);
    }
    return normalized;
  }
  
  constructor(baseUrl: string = 'http://localhost:8001') {
    this.baseUrl = this.sanitizeBaseUrl(baseUrl);
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  private handleError(error: unknown, operation: string): never {
    const isExplicitlyConfigured = !!process.env.PYTHON_TOOLS_API_URL;

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;
      const errorData = axiosError.response?.data as any;

      // If Python tools are not explicitly configured, avoid noisy error logs in production.
      // ToolExecutionEngine will mark them unavailable and continue.
      if (isExplicitlyConfigured) {
        logger.error(`[PythonToolsClient] ${operation} failed`, {
          statusCode,
          message: axiosError.message,
          details: errorData,
        });
      }

      throw new PythonToolsClientError(
        errorData?.detail || errorData?.error || axiosError.message,
        statusCode,
        errorData
      );
    }

    if (isExplicitlyConfigured) {
      logger.error(`[PythonToolsClient] ${operation} failed with unknown error`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    throw new PythonToolsClientError(
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
  
  async health(): Promise<HealthResponse> {
    try {
      const { data } = await this.client.get('/health');
      return data;
    } catch (error) {
      this.handleError(error, 'health check');
    }
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }
  
  async listTools(): Promise<ToolInfo[]> {
    try {
      const { data } = await this.client.get('/tools');
      if (!Array.isArray(data)) {
        throw new Error("Invalid tool list response from server");
      }
      return data;
    } catch (error) {
      this.handleError(error, 'list tools');
    }
  }
  
  async getTool(name: string): Promise<ToolInfo> {
    try {
      const toolName = this.sanitizeToolName(name, "tool");
      const { data } = await this.client.get(`/tools/${encodeURIComponent(toolName)}`);
      return data;
    } catch (error) {
      this.handleError(error, `get tool '${name}'`);
    }
  }
  
  async executeTool(name: string, input: ToolExecuteInput): Promise<ToolExecuteResponse> {
    try {
      const toolName = this.sanitizeToolName(name, "tool");
      const safeInput = sanitizeToolInput(input);
      
      logger.debug(`[PythonToolsClient] Tool execution requested`, {
        toolName,
        hasInput: Object.keys(safeInput).length > 0,
      });
      
      const { data } = await this.client.post(`/tools/${encodeURIComponent(toolName)}/execute`, {
        tool_name: toolName,
        input: safeInput,
      });

      logger.info(`[PythonToolsClient] Tool '${toolName}' execution completed`, {
        success: data.success,
        hasData: !!data.data,
        hasError: !!data.error
      });
      
      return data;
    } catch (error) {
      this.handleError(error, `execute tool '${name}'`);
    }
  }
  
  async listAgents(): Promise<AgentInfo[]> {
    try {
      const { data } = await this.client.get('/agents');
      if (!Array.isArray(data)) {
        throw new Error("Invalid agents list response from server");
      }
      return data;
    } catch (error) {
      this.handleError(error, 'list agents');
    }
  }
  
  async getAgent(name: string): Promise<AgentInfo> {
    try {
      const agentName = this.sanitizeToolName(name, "agent");
      const { data } = await this.client.get(`/agents/${encodeURIComponent(agentName)}`);
      return data;
    } catch (error) {
      this.handleError(error, `get agent '${name}'`);
    }
  }
  
  async executeAgent(
    name: string, 
    task: string,
    context?: AgentContext
  ): Promise<any> {
    try {
      const agentName = this.sanitizeToolName(name, "agent");
      const safeTask = this.sanitizeTask(task);
      const safeContext = sanitizeContext(context);
      if (safeJsonSize(safeContext) > AGENT_CONTEXT_MAX_BYTES) {
        throw new Error("Agent context exceeds maximum payload size");
      }
      
      const { data } = await this.client.post(`/agents/${encodeURIComponent(agentName)}/execute`, {
        task: safeTask,
        context: safeContext,
      });

      logger.info(`[PythonToolsClient] Agent '${agentName}' execution completed`, {
        taskLength: safeTask.length,
      });
      
      return data;
    } catch (error) {
      this.handleError(error, `execute agent '${name}'`);
    }
  }
  
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const pythonToolsClient = new PythonToolsClient(
  process.env.PYTHON_TOOLS_API_URL || 'http://localhost:8001'
);

export type { ToolInfo, ToolExecuteResponse, AgentInfo, HealthResponse };
