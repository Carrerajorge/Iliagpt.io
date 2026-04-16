import { z } from "zod";

// ... (existing imports)

const SearchRequestSchema = z.object({
  query: z.string().min(1, "Query is required"),
  num_results: z.number().min(1).max(20).optional(),
  use_browser: z.boolean().optional(),
});

const BrowseRequestSchema = z.object({
  url: z.string().url("Invalid URL"),
  screenshot: z.boolean().optional(),
  scroll: z.boolean().optional(),
  wait_for: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
});

const DocumentRequestSchema = z.object({
  doc_type: z.enum(['pptx', 'docx', 'xlsx']),
  title: z.string().min(1),
  content: z.any(),
  theme: z.string().optional(),
  filename: z.string().optional(),
});

const ExecuteRequestSchema = z.object({
  tool: z.string().min(1),
  params: z.record(z.any()),
});

// ... (existing code)

const PYTHON_AGENT_BASE_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8081';
const DEFAULT_TIMEOUT = 120000; // 2 minutes

// ... (existing code)

interface RunAgentRequest {
  input: string;
  verbose?: boolean;
  timeout?: number;
}

interface AgentStatus {
  name: string;
  version: string;
  state: string;
  tools: number;
  browser: string;
}

interface RunAgentResponse {
  success: boolean;
  result: string | null;
  error: string | null;
  execution_time: number;
  status: AgentStatus;
}

interface ToolInfo {
  name: string;
  description: string;
  category: string;
  parameters: Record<string, any>;
}

interface ToolsResponse {
  tools: ToolInfo[];
  count: number;
}

interface HealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
  agent_state: string;
  tools_count: number;
}

class PythonAgentClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'PythonAgentClientError';
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new PythonAgentClientError(`Request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Execute the Python agent with user input.
 */
export async function runAgent(
  input: string,
  options: { verbose?: boolean; timeout?: number } = {}
): Promise<RunAgentResponse> {
  const { verbose = false, timeout = 60 } = options;

  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        verbose,
        timeout,
      } as RunAgentRequest),
      timeout: (timeout + 10) * 1000, // Add buffer for HTTP overhead
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    return await response.json() as RunAgentResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) {
      throw error;
    }
    if (error.code === 'ECONNREFUSED') {
      throw new PythonAgentClientError(
        'Python agent service is not running. Start it with: python run_service.py'
      );
    }
    throw new PythonAgentClientError(
      `Failed to connect to Python agent: ${error.message}`
    );
  }
}

/**
 * Get the list of available tools from the Python agent.
 */
export async function getTools(): Promise<ToolsResponse> {
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/tools`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 seconds should be enough for tools list
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    return await response.json() as ToolsResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) {
      throw error;
    }
    if (error.code === 'ECONNREFUSED') {
      throw new PythonAgentClientError(
        'Python agent service is not running. Start it with: python run_service.py'
      );
    }
    throw new PythonAgentClientError(
      `Failed to get tools from Python agent: ${error.message}`
    );
  }
}

/**
 * Check if the Python agent service is healthy.
 */
export async function healthCheck(): Promise<HealthResponse> {
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000, // 5 seconds for health check
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    return await response.json() as HealthResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) {
      throw error;
    }
    if (error.code === 'ECONNREFUSED') {
      throw new PythonAgentClientError(
        'Python agent service is not running',
        503
      );
    }
    throw new PythonAgentClientError(
      `Health check failed: ${error.message}`,
      503
    );
  }
}

/**
 * Check if the Python agent service is available.
 * Returns true if healthy, false otherwise (doesn't throw).
 */
export async function isServiceAvailable(): Promise<boolean> {
  try {
    await healthCheck();
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENDED API - Additional endpoints for Python Agent v5.0
// ═══════════════════════════════════════════════════════════════════════════════

interface BrowseRequest {
  url: string;
  screenshot?: boolean;
  scroll?: boolean;
  wait_for?: 'load' | 'domcontentloaded' | 'networkidle';
}

interface BrowseResponse {
  success: boolean;
  data: any;
  message: string;
  error: string | null;
  screenshots: string[];
}

interface SearchRequest {
  query: string;
  num_results?: number;
  use_browser?: boolean;
}

interface SearchResponse {
  success: boolean;
  query: string;
  results: Array<{ title: string; url: string; snippet: string }>;
  total: number;
  cached: boolean;
}

interface DocumentRequest {
  doc_type: 'pptx' | 'docx' | 'xlsx';
  title: string;
  content: any;
  theme?: string;
  filename?: string;
}

interface DocumentResponse {
  success: boolean;
  message: string;
  files_created: string[];
  error: string | null;
}

interface ExecuteRequest {
  tool: string;
  params: Record<string, any>;
}

interface ExecuteResponse {
  success: boolean;
  tool: string;
  data: any;
  message: string;
  error: string | null;
  files_created: string[];
  screenshots: string[];
  execution_time: number;
}

interface FileInfo {
  name: string;
  category: string;
  size: number;
  modified: string;
  download_url: string;
}

interface FilesResponse {
  files: FileInfo[];
  count: number;
}

/**
 * Browse a URL using the Python agent's browser.
 */
export async function browse(request: BrowseRequest): Promise<BrowseResponse> {
  const validRequest = BrowseRequestSchema.parse(request);
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
      timeout: 60000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return await response.json() as BrowseResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) throw error;
    throw new PythonAgentClientError(`Browse failed: ${error.message}`);
  }
}

/**
 * Search the web using the Python agent.
 */
export async function search(request: SearchRequest): Promise<SearchResponse> {
  const validRequest = SearchRequestSchema.parse(request);
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
      timeout: 30000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return await response.json() as SearchResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) throw error;
    throw new PythonAgentClientError(`Search failed: ${error.message}`);
  }
}

/**
 * Create a document using the Python agent.
 */
export async function createDocument(request: DocumentRequest): Promise<DocumentResponse> {
  const validRequest = DocumentRequestSchema.parse(request);
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
      timeout: 120000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return await response.json() as DocumentResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) throw error;
    throw new PythonAgentClientError(`Document creation failed: ${error.message}`);
  }
}

/**
 * Execute a specific tool directly.
 */
export async function executeTool(request: ExecuteRequest): Promise<ExecuteResponse> {
  const validRequest = ExecuteRequestSchema.parse(request);
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
      timeout: 60000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return await response.json() as ExecuteResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) throw error;
    throw new PythonAgentClientError(`Tool execution failed: ${error.message}`);
  }
}

/**
 * List files created by the Python agent.
 */
export async function listFiles(): Promise<FilesResponse> {
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/files`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return await response.json() as FilesResponse;
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) throw error;
    throw new PythonAgentClientError(`List files failed: ${error.message}`);
  }
}

/**
 * Get agent status.
 */
export async function getStatus(): Promise<any> {
  try {
    const response = await fetchWithTimeout(`${PYTHON_AGENT_BASE_URL}/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new PythonAgentClientError(
        errorData.detail || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return await response.json();
  } catch (error: any) {
    if (error instanceof PythonAgentClientError) throw error;
    throw new PythonAgentClientError(`Get status failed: ${error.message}`);
  }
}

export type {
  RunAgentRequest,
  RunAgentResponse,
  ToolInfo,
  ToolsResponse,
  HealthResponse,
  AgentStatus,
  BrowseRequest,
  BrowseResponse,
  SearchRequest,
  SearchResponse,
  DocumentRequest,
  DocumentResponse,
  ExecuteRequest,
  ExecuteResponse,
  FileInfo,
  FilesResponse,
};

export { PythonAgentClientError };
