import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
  type ToolDefinition,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "ToolDiscoveryEngine" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoverableTool extends ToolDefinition {
  toolId: string;
  sourceServer?: string; // MCP server name
  category: string;
  tags: string[];
  /** Normalized embedding vector (1536-dim or TF-IDF sparse) */
  embedding?: number[];
  /** How often this tool has been used */
  usageCount: number;
  /** Average success rate 0-1 */
  successRate: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** When this tool was registered */
  registeredAt: number;
  /** Last time it was used */
  lastUsedAt?: number;
  /** Output schema (JSON Schema) */
  outputSchema?: Record<string, unknown>;
  /** If true, tool is available; false = offline/disabled */
  available: boolean;
}

export interface MCPServerConfig {
  serverId: string;
  name: string;
  transport: "stdio" | "sse" | "http";
  endpoint?: string; // for sse/http
  command?: string; // for stdio
  args?: string[];
  env?: Record<string, string>;
  capabilities?: string[];
}

export interface ToolMatch {
  tool: DiscoverableTool;
  relevanceScore: number; // 0-1
  matchReason: string;
  suggestedInput?: Record<string, unknown>;
}

export interface ToolComposition {
  compositionId: string;
  name: string;
  description: string;
  steps: Array<{
    stepId: string;
    toolId: string;
    toolName: string;
    inputMapping: Record<string, string>; // target field → source (prior step result or input)
    description: string;
  }>;
  createdAt: number;
}

export interface DiscoveryQuery {
  taskDescription: string;
  requiredCapabilities?: string[];
  preferredCategories?: string[];
  excludeTools?: string[];
  maxResults?: number;
  minSuccessRate?: number;
}

// ─── TF-IDF vector helpers ────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function buildTFIDF(
  terms: string[],
  corpus: string[][]
): Map<string, number> {
  const tf = new Map<string, number>();
  for (const term of terms) {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  }

  const idf = new Map<string, number>();
  const docCount = corpus.length;
  for (const [term, count] of tf.entries()) {
    const docsWithTerm = corpus.filter((doc) => doc.includes(term)).length;
    idf.set(term, Math.log((docCount + 1) / (docsWithTerm + 1)) + 1);
    tf.set(term, (count / terms.length) * (idf.get(term) ?? 1));
  }

  return tf;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, valA] of a.entries()) {
    const valB = b.get(term) ?? 0;
    dot += valA * valB;
    normA += valA * valA;
  }
  for (const valB of b.values()) {
    normB += valB * valB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ─── ToolDiscoveryEngine ──────────────────────────────────────────────────────

export class ToolDiscoveryEngine extends EventEmitter {
  private tools = new Map<string, DiscoverableTool>(); // toolId → tool
  private nameIndex = new Map<string, string>(); // name → toolId
  private mcpServers = new Map<string, MCPServerConfig>(); // serverId → config
  private compositions = new Map<string, ToolComposition>(); // compositionId → comp
  /** TF-IDF corpus: tokenized tool descriptions */
  private corpus: string[][] = [];
  private corpusDirty = true;

  constructor(
    private readonly backbone = getClaudeAgentBackbone()
  ) {
    super();
    logger.info("[ToolDiscoveryEngine] Initialized");
  }

  // ── Tool registration ─────────────────────────────────────────────────────────

  registerTool(
    tool: Omit<DiscoverableTool, "toolId" | "usageCount" | "successRate" | "avgLatencyMs" | "registeredAt">
  ): DiscoverableTool {
    const existing = this.nameIndex.get(tool.name);
    if (existing) {
      // Update existing tool
      const current = this.tools.get(existing)!;
      const updated: DiscoverableTool = {
        ...current,
        ...tool,
        toolId: current.toolId,
        registeredAt: current.registeredAt,
      };
      this.tools.set(current.toolId, updated);
      this.corpusDirty = true;
      logger.debug({ toolId: current.toolId, name: tool.name }, "[ToolDiscoveryEngine] Tool updated");
      return updated;
    }

    const registered: DiscoverableTool = {
      ...tool,
      toolId: randomUUID(),
      usageCount: 0,
      successRate: 1.0,
      avgLatencyMs: 0,
      registeredAt: Date.now(),
      available: tool.available ?? true,
    };

    this.tools.set(registered.toolId, registered);
    this.nameIndex.set(tool.name, registered.toolId);
    this.corpusDirty = true;

    logger.info(
      { toolId: registered.toolId, name: tool.name, category: tool.category },
      "[ToolDiscoveryEngine] Tool registered"
    );

    this.emit("tool:registered", { toolId: registered.toolId, name: tool.name });
    return registered;
  }

  registerTools(tools: Parameters<ToolDiscoveryEngine["registerTool"]>[0][]): DiscoverableTool[] {
    return tools.map((t) => this.registerTool(t));
  }

  deregisterTool(toolId: string): void {
    const tool = this.tools.get(toolId);
    if (!tool) return;
    this.tools.delete(toolId);
    this.nameIndex.delete(tool.name);
    this.corpusDirty = true;
    this.emit("tool:deregistered", { toolId, name: tool.name });
  }

  setToolAvailability(toolId: string, available: boolean): void {
    const tool = this.tools.get(toolId);
    if (tool) {
      tool.available = available;
      this.emit("tool:availability_changed", { toolId, available });
    }
  }

  // ── MCP server integration ────────────────────────────────────────────────────

  registerMCPServer(config: MCPServerConfig): void {
    this.mcpServers.set(config.serverId, config);
    logger.info(
      { serverId: config.serverId, name: config.name },
      "[ToolDiscoveryEngine] MCP server registered"
    );
    this.emit("mcp:registered", config);
  }

  async discoverFromMCPServer(serverId: string): Promise<DiscoverableTool[]> {
    const server = this.mcpServers.get(serverId);
    if (!server) throw new Error(`MCP server '${serverId}' not registered`);

    logger.info({ serverId, name: server.name }, "[ToolDiscoveryEngine] Discovering tools from MCP server");

    // Use LLM to infer tools from server capabilities description
    // In a real impl, this would call the MCP protocol's tools/list endpoint
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Infer likely tools available from this MCP server configuration.

SERVER: ${server.name}
CAPABILITIES: ${JSON.stringify(server.capabilities ?? [])}
TRANSPORT: ${server.transport}

Generate 2-4 realistic tool definitions for this server.
Output JSON array: [{ "name": "...", "description": "...", "category": "...", "tags": ["..."], "inputSchema": { "type": "object", "properties": {}, "required": [] } }]

Return ONLY valid JSON array.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.HAIKU,
      maxTokens: 1024,
      system: "Generate realistic MCP tool definitions based on server capabilities.",
    });

    const discovered: DiscoverableTool[] = [];
    try {
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          name?: string;
          description?: string;
          category?: string;
          tags?: string[];
          inputSchema?: Record<string, unknown>;
        }>;
        for (const t of parsed) {
          if (!t.name || !t.description) continue;
          const tool = this.registerTool({
            name: t.name,
            description: t.description,
            category: t.category ?? "mcp",
            tags: t.tags ?? [],
            inputSchema: t.inputSchema ?? { type: "object", properties: {}, required: [] },
            sourceServer: serverId,
            available: true,
          });
          discovered.push(tool);
        }
      }
    } catch (err) {
      logger.error({ err, serverId }, "[ToolDiscoveryEngine] Failed to parse MCP tools");
    }

    logger.info(
      { serverId, discovered: discovered.length },
      "[ToolDiscoveryEngine] MCP discovery complete"
    );

    return discovered;
  }

  // ── Tool search ───────────────────────────────────────────────────────────────

  async findTools(query: DiscoveryQuery): Promise<ToolMatch[]> {
    const {
      taskDescription,
      requiredCapabilities = [],
      preferredCategories = [],
      excludeTools = [],
      maxResults = 5,
      minSuccessRate = 0,
    } = query;

    // Rebuild corpus if stale
    if (this.corpusDirty) this.rebuildCorpus();

    const available = Array.from(this.tools.values()).filter(
      (t) =>
        t.available &&
        !excludeTools.includes(t.toolId) &&
        !excludeTools.includes(t.name) &&
        t.successRate >= minSuccessRate
    );

    if (available.length === 0) return [];

    // Tokenize query
    const corpusTokenized = available.map((t) =>
      tokenize(`${t.name} ${t.description} ${t.tags.join(" ")} ${t.category}`)
    );
    const queryTokens = tokenize(taskDescription);
    const queryTF = buildTFIDF(queryTokens, corpusTokenized);

    const matches: ToolMatch[] = [];

    for (let i = 0; i < available.length; i++) {
      const tool = available[i];
      const toolTokens = corpusTokenized[i];
      const toolTF = buildTFIDF(toolTokens, corpusTokenized);

      let relevance = cosineSimilarity(queryTF, toolTF);

      // Boost for preferred categories
      if (preferredCategories.includes(tool.category)) {
        relevance = Math.min(1, relevance + 0.15);
      }

      // Boost for required capabilities (tag match)
      for (const cap of requiredCapabilities) {
        if (tool.tags.includes(cap) || tool.description.toLowerCase().includes(cap)) {
          relevance = Math.min(1, relevance + 0.1);
        }
      }

      // Weight by success rate (tools with higher success rate score better)
      relevance = relevance * (0.7 + tool.successRate * 0.3);

      if (relevance > 0.05) {
        matches.push({
          tool,
          relevanceScore: relevance,
          matchReason: this.buildMatchReason(tool, taskDescription, relevance),
        });
      }
    }

    // Sort by relevance and return top N
    matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topMatches = matches.slice(0, maxResults);

    // Use LLM to suggest input for top matches
    if (topMatches.length > 0) {
      await this.enrichWithSuggestedInput(topMatches, taskDescription);
    }

    logger.info(
      { query: taskDescription.slice(0, 60), found: topMatches.length },
      "[ToolDiscoveryEngine] Tool search completed"
    );

    return topMatches;
  }

  private async enrichWithSuggestedInput(
    matches: ToolMatch[],
    taskDescription: string
  ): Promise<void> {
    const topTool = matches[0];
    if (!topTool) return;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Given this task, suggest input parameters for this tool.

TASK: ${taskDescription}

TOOL: ${topTool.tool.name}
DESCRIPTION: ${topTool.tool.description}
INPUT SCHEMA: ${JSON.stringify(topTool.tool.inputSchema, null, 2).slice(0, 500)}

Output JSON object with suggested input values, or {} if no suggestions.
Return ONLY valid JSON.`,
      },
    ];

    try {
      const response = await this.backbone.call(messages, {
        model: CLAUDE_MODELS.HAIKU,
        maxTokens: 256,
        system: "Suggest tool input parameters for a given task.",
      });

      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        topTool.suggestedInput = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Non-critical — skip suggested input
    }
  }

  private buildMatchReason(
    tool: DiscoverableTool,
    query: string,
    score: number
  ): string {
    const parts: string[] = [];
    if (score > 0.7) parts.push("Strong semantic match");
    else if (score > 0.4) parts.push("Moderate semantic match");
    else parts.push("Weak semantic match");

    if (tool.usageCount > 10) parts.push(`used ${tool.usageCount} times`);
    if (tool.successRate >= 0.9) parts.push(`${(tool.successRate * 100).toFixed(0)}% success rate`);

    return parts.join(", ");
  }

  private rebuildCorpus(): void {
    this.corpus = Array.from(this.tools.values()).map((t) =>
      tokenize(`${t.name} ${t.description} ${t.tags.join(" ")} ${t.category}`)
    );
    this.corpusDirty = false;
  }

  // ── Tool composition ──────────────────────────────────────────────────────────

  async composeTools(
    taskDescription: string,
    availableToolIds?: string[]
  ): Promise<ToolComposition | null> {
    const toolPool = availableToolIds
      ? availableToolIds
          .map((id) => this.tools.get(id))
          .filter(Boolean) as DiscoverableTool[]
      : Array.from(this.tools.values()).filter((t) => t.available);

    if (toolPool.length < 2) return null;

    const toolList = toolPool
      .slice(0, 10)
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Create a tool composition pipeline for this task.

TASK: ${taskDescription}

AVAILABLE TOOLS:
${toolList}

Design a multi-step pipeline using 2-4 of these tools.
Output JSON:
{
  "name": "pipeline name",
  "description": "what this pipeline does",
  "steps": [
    {
      "toolName": "tool_name",
      "inputMapping": { "param": "input.field or step1.result.field" },
      "description": "what this step does"
    }
  ]
}

Only use tools from the available list. Return ONLY valid JSON.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 1024,
      system:
        "Design efficient tool composition pipelines. Only use listed tools. Be precise about data flow.",
    });

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as {
        name?: string;
        description?: string;
        steps?: Array<{
          toolName?: string;
          inputMapping?: Record<string, string>;
          description?: string;
        }>;
      };

      if (!parsed.steps || !Array.isArray(parsed.steps)) return null;

      const composition: ToolComposition = {
        compositionId: randomUUID(),
        name: String(parsed.name ?? "Custom Pipeline"),
        description: String(parsed.description ?? taskDescription),
        steps: parsed.steps
          .filter((s) => s.toolName && this.nameIndex.has(s.toolName))
          .map((s) => ({
            stepId: randomUUID(),
            toolId: this.nameIndex.get(s.toolName!)!,
            toolName: s.toolName!,
            inputMapping: s.inputMapping ?? {},
            description: String(s.description ?? ""),
          })),
        createdAt: Date.now(),
      };

      if (composition.steps.length < 2) return null;

      this.compositions.set(composition.compositionId, composition);

      logger.info(
        { compositionId: composition.compositionId, steps: composition.steps.length },
        "[ToolDiscoveryEngine] Tool composition created"
      );

      this.emit("composition:created", composition);
      return composition;
    } catch (err) {
      logger.error({ err }, "[ToolDiscoveryEngine] Failed to create composition");
      return null;
    }
  }

  // ── Usage tracking ────────────────────────────────────────────────────────────

  recordToolUsage(
    toolId: string,
    success: boolean,
    latencyMs: number
  ): void {
    const tool = this.tools.get(toolId);
    if (!tool) return;

    tool.usageCount++;
    tool.lastUsedAt = Date.now();

    // Rolling average for success rate (weight recent more)
    tool.successRate = tool.successRate * 0.9 + (success ? 0.1 : 0);

    // Rolling average for latency
    tool.avgLatencyMs =
      tool.avgLatencyMs === 0
        ? latencyMs
        : tool.avgLatencyMs * 0.85 + latencyMs * 0.15;
  }

  // ── Recommendations ───────────────────────────────────────────────────────────

  getRecommendedTools(limit = 10): DiscoverableTool[] {
    return Array.from(this.tools.values())
      .filter((t) => t.available)
      .sort((a, b) => {
        // Score = usage * successRate / latency_penalty
        const scoreA = a.usageCount * a.successRate * (1 / (1 + a.avgLatencyMs / 1000));
        const scoreB = b.usageCount * b.successRate * (1 / (1 + b.avgLatencyMs / 1000));
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getTool(toolIdOrName: string): DiscoverableTool | null {
    const byId = this.tools.get(toolIdOrName);
    if (byId) return byId;
    const id = this.nameIndex.get(toolIdOrName);
    return id ? (this.tools.get(id) ?? null) : null;
  }

  listTools(category?: string): DiscoverableTool[] {
    const all = Array.from(this.tools.values());
    return category ? all.filter((t) => t.category === category) : all;
  }

  listCategories(): Array<{ category: string; count: number }> {
    const counts = new Map<string, number>();
    for (const tool of this.tools.values()) {
      counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  getComposition(compositionId: string): ToolComposition | null {
    return this.compositions.get(compositionId) ?? null;
  }

  /** Convert to ToolDefinition[] for use with ClaudeAgentBackbone */
  toToolDefinitions(toolIds?: string[]): ToolDefinition[] {
    const tools = toolIds
      ? toolIds.map((id) => this.tools.get(id) ?? this.tools.get(this.nameIndex.get(id) ?? "")).filter(Boolean) as DiscoverableTool[]
      : Array.from(this.tools.values()).filter((t) => t.available);

    return tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  getStats() {
    const tools = Array.from(this.tools.values());
    return {
      totalTools: tools.length,
      availableTools: tools.filter((t) => t.available).length,
      mcpServers: this.mcpServers.size,
      compositions: this.compositions.size,
      categories: this.listCategories().length,
      avgSuccessRate:
        tools.length > 0
          ? tools.reduce((s, t) => s + t.successRate, 0) / tools.length
          : 0,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ToolDiscoveryEngine | null = null;

export function getToolDiscoveryEngine(): ToolDiscoveryEngine {
  if (!_instance) _instance = new ToolDiscoveryEngine();
  return _instance;
}
