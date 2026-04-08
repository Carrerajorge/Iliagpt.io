/**
 * Managed Agent Service — wraps the Anthropic Managed Agents API.
 *
 * Provides CRUD for agents/environments/sessions and SSE event streaming.
 * All calls go through the beta endpoint with the managed-agents-2026-04-01 header.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { createLogger } from "../utils/logger";

const log = createLogger("managed-agents");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManagedAgentConfig {
  name: string;
  model: string;
  system?: string;
  description?: string;
  tools?: ManagedAgentTool[];
  metadata?: Record<string, string>;
}

export type ManagedAgentTool =
  | { type: "agent_toolset_20260401"; configs?: Array<{ name: string; enabled: boolean }> }
  | { type: "custom"; name: string; description: string; input_schema: Record<string, unknown> };

export interface ManagedEnvironmentConfig {
  name: string;
  packages?: {
    pip?: string[];
    npm?: string[];
    apt?: string[];
  };
  networking?: { type: "unrestricted" } | { type: "limited"; allowed_hosts: string[] };
}

export interface CreateSessionOptions {
  agentId: string;
  environmentId?: string;
  title?: string;
  metadata?: Record<string, string>;
}

export interface SendEventOptions {
  sessionId: string;
  message: string;
}

export interface ManagedAgentPreset {
  key: string;
  name: string;
  description: string;
  icon: string;
  config: ManagedAgentConfig;
  environmentConfig?: ManagedEnvironmentConfig;
}

// ---------------------------------------------------------------------------
// Predefined Agent Presets
// ---------------------------------------------------------------------------

export const MANAGED_AGENT_PRESETS: ManagedAgentPreset[] = [
  {
    key: "coder",
    name: "Coder",
    description: "Expert software engineer — writes, debugs, and refactors code with full terminal and file access.",
    icon: "code",
    config: {
      name: "IliaGPT Coder",
      model: "claude-sonnet-4-6",
      system: `You are an expert software engineer working inside IliaGPT. You have full access to a development environment with bash, file read/write, and web search. Follow these principles:
- Write clean, well-structured code with proper error handling.
- Explain your reasoning before making changes.
- Run tests after modifications when possible.
- Use web_search to look up current API docs when unsure.`,
      tools: [{ type: "agent_toolset_20260401" }],
      metadata: { preset: "coder", platform: "iliagpt" },
    },
    environmentConfig: {
      name: "coder-env",
      packages: { pip: ["pytest", "black", "ruff"], npm: ["typescript", "prettier"], apt: ["git"] },
      networking: { type: "unrestricted" },
    },
  },
  {
    key: "researcher",
    name: "Researcher",
    description: "Deep research agent — searches the web, synthesizes information, and produces comprehensive reports.",
    icon: "search",
    config: {
      name: "IliaGPT Researcher",
      model: "claude-sonnet-4-6",
      system: `You are a thorough research agent inside IliaGPT. Your job is to find, verify, and synthesize information from multiple sources. Follow these principles:
- Always cite your sources with URLs.
- Cross-reference claims across multiple sources.
- Present findings in a structured format with sections and bullet points.
- Distinguish between well-established facts and emerging/uncertain information.
- Use web_search extensively to find current data.`,
      tools: [{ type: "agent_toolset_20260401" }],
      metadata: { preset: "researcher", platform: "iliagpt" },
    },
  },
  {
    key: "document-creator",
    name: "Document Creator",
    description: "Creates polished documents, reports, and presentations with code execution for charts and formatting.",
    icon: "file-text",
    config: {
      name: "IliaGPT Document Creator",
      model: "claude-sonnet-4-6",
      system: `You are a professional document creator inside IliaGPT. You produce well-formatted reports, analyses, and documents. Follow these principles:
- Structure content with clear headings, sections, and bullet points.
- Use code execution to generate charts, tables, and formatted outputs when helpful.
- Write in a professional, clear tone appropriate for business or academic audiences.
- Include executive summaries for long documents.
- Save generated files to /mnt/user/output/ so they can be downloaded.`,
      tools: [{ type: "agent_toolset_20260401" }],
      metadata: { preset: "document-creator", platform: "iliagpt" },
    },
    environmentConfig: {
      name: "doc-creator-env",
      packages: { pip: ["python-docx", "python-pptx", "matplotlib", "pandas", "openpyxl"] },
      networking: { type: "unrestricted" },
    },
  },
  {
    key: "data-analyst",
    name: "Data Analyst",
    description: "Analyzes datasets, builds visualizations, and delivers statistical insights with code execution.",
    icon: "bar-chart",
    config: {
      name: "IliaGPT Data Analyst",
      model: "claude-sonnet-4-6",
      system: `You are an expert data analyst inside IliaGPT. You analyze datasets, build visualizations, and deliver actionable insights. Follow these principles:
- Always start by understanding the data: check shape, types, missing values, and distributions.
- Use pandas, numpy, and scipy for analysis; matplotlib and seaborn for visualization.
- Provide statistical context (confidence intervals, p-values) when making claims.
- Save charts as PNG files and include them in your response.
- Explain findings in plain language, not just numbers.`,
      tools: [{ type: "agent_toolset_20260401" }],
      metadata: { preset: "data-analyst", platform: "iliagpt" },
    },
    environmentConfig: {
      name: "data-analyst-env",
      packages: { pip: ["pandas", "numpy", "scipy", "matplotlib", "seaborn", "scikit-learn", "statsmodels"] },
      networking: { type: "unrestricted" },
    },
  },
];

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured — cannot use Managed Agents.");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// Shared beta header required for all managed-agent endpoints.
const BETA_HEADER = "managed-agents-2026-04-01";

// ---------------------------------------------------------------------------
// Agents CRUD
// ---------------------------------------------------------------------------

export async function createAgent(config: ManagedAgentConfig) {
  const client = getClient();
  log.info("Creating managed agent", { name: config.name, model: config.model });

  const res = await client.post("/v1/agents", {
    body: {
      name: config.name,
      model: config.model,
      system: config.system,
      description: config.description,
      tools: config.tools ?? [{ type: "agent_toolset_20260401" }],
      metadata: config.metadata ?? {},
    },
    headers: { "anthropic-beta": BETA_HEADER },
  });
  log.info("Agent created", { id: (res as any).id });
  return res as any;
}

export async function listAgents() {
  const client = getClient();
  const res = await client.get("/v1/agents", {
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

export async function getAgent(agentId: string) {
  const client = getClient();
  const res = await client.get(`/v1/agents/${agentId}`, {
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

export async function archiveAgent(agentId: string) {
  const client = getClient();
  const res = await client.post(`/v1/agents/${agentId}/archive`, {
    body: {},
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

// ---------------------------------------------------------------------------
// Environments CRUD
// ---------------------------------------------------------------------------

export async function createEnvironment(config: ManagedEnvironmentConfig) {
  const client = getClient();
  log.info("Creating environment", { name: config.name });

  const res = await client.post("/v1/environments", {
    body: {
      name: config.name,
      config: {
        type: "cloud",
        packages: config.packages ?? {},
        networking: config.networking ?? { type: "unrestricted" },
      },
    },
    headers: { "anthropic-beta": BETA_HEADER },
  });
  log.info("Environment created", { id: (res as any).id });
  return res as any;
}

export async function listEnvironments() {
  const client = getClient();
  const res = await client.get("/v1/environments", {
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

// ---------------------------------------------------------------------------
// Sessions CRUD
// ---------------------------------------------------------------------------

export async function createSession(opts: CreateSessionOptions) {
  const client = getClient();
  log.info("Creating session", { agentId: opts.agentId });

  const body: Record<string, unknown> = {
    agent: opts.agentId,
    title: opts.title,
    metadata: opts.metadata ?? {},
  };
  if (opts.environmentId) body.environment_id = opts.environmentId;

  const res = await client.post("/v1/sessions", {
    body,
    headers: { "anthropic-beta": BETA_HEADER },
  });
  log.info("Session created", { id: (res as any).id, status: (res as any).status });
  return res as any;
}

export async function getSession(sessionId: string) {
  const client = getClient();
  const res = await client.get(`/v1/sessions/${sessionId}`, {
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

export async function listSessions(agentId?: string) {
  const client = getClient();
  const query = agentId ? `?agent_id=${agentId}` : "";
  const res = await client.get(`/v1/sessions${query}`, {
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

export async function deleteSession(sessionId: string) {
  const client = getClient();
  const res = await client.delete(`/v1/sessions/${sessionId}`, {
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

// ---------------------------------------------------------------------------
// Events — send message + stream
// ---------------------------------------------------------------------------

export async function sendMessage(sessionId: string, message: string) {
  const client = getClient();
  log.info("Sending message to session", { sessionId, length: message.length });

  const res = await client.post(`/v1/sessions/${sessionId}/events`, {
    body: {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: message }],
        },
      ],
    },
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

export async function interruptSession(sessionId: string) {
  const client = getClient();
  const res = await client.post(`/v1/sessions/${sessionId}/events`, {
    body: {
      events: [{ type: "user.interrupt" }],
    },
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

export async function listEvents(sessionId: string) {
  const client = getClient();
  const res = await client.get(`/v1/sessions/${sessionId}/events`, {
    headers: { "anthropic-beta": BETA_HEADER },
  });
  return res as any;
}

/**
 * Opens an SSE stream for the given session. Returns a ReadableStream of
 * Server-Sent Events from the Anthropic API.
 *
 * The caller is responsible for forwarding these events to the HTTP response.
 */
export async function streamEvents(sessionId: string, signal?: AbortSignal): Promise<Response> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const url = `https://api.anthropic.com/v1/sessions/${sessionId}/events/stream`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": BETA_HEADER,
      "Accept": "text/event-stream",
    },
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Managed Agents stream failed (${res.status}): ${body}`);
  }

  return res;
}

// ---------------------------------------------------------------------------
// High-level: provision a preset agent end-to-end
// ---------------------------------------------------------------------------

/**
 * Creates an agent + optional environment from a preset key.
 * Returns { agent, environment? } with their IDs.
 */
export async function provisionPreset(presetKey: string) {
  const preset = MANAGED_AGENT_PRESETS.find((p) => p.key === presetKey);
  if (!preset) throw new Error(`Unknown preset: ${presetKey}`);

  let environmentId: string | undefined;

  if (preset.environmentConfig) {
    const envResult = await createEnvironment(preset.environmentConfig);
    environmentId = envResult.id;
  }

  const agent = await createAgent(preset.config);
  return { agent, environmentId };
}

/**
 * One-shot convenience: provision a preset, create a session, send the first
 * message, and return the session ID + SSE stream Response.
 */
export async function startPresetSession(presetKey: string, message: string, title?: string) {
  const { agent, environmentId } = await provisionPreset(presetKey);

  const session = await createSession({
    agentId: agent.id,
    environmentId,
    title: title ?? `${presetKey} session`,
    metadata: { preset: presetKey, platform: "iliagpt" },
  });

  // Open the SSE stream *before* sending the message to avoid missing events.
  const sseStream = await streamEvents(session.id);

  // Send the user message (non-blocking relative to the stream).
  await sendMessage(session.id, message);

  return { sessionId: session.id, agentId: agent.id, environmentId, sseStream };
}
