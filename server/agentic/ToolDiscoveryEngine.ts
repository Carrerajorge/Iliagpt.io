/**
 * ToolDiscoveryEngine — Dynamic tool discovery, capability matching,
 * tool composition, and runtime MCP tool registration.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import { FAST_MODEL } from "./ClaudeAgentBackbone";
import type { ToolDefinition, ToolCapability } from "../agent/toolTypes";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface DiscoveredTool {
  id: string;
  name: string;
  description: string;
  capabilities: ToolCapability[];
  inputSchema: Record<string, unknown>;
  outputDescription: string;
  source: "builtin" | "mcp" | "dynamic";
  mcpServer?: string;
  registeredAt: Date;
  lastUsedAt?: Date;
  useCount: number;
  averageLatencyMs?: number;
}

export interface ToolCompositionChain {
  id: string;
  description: string;
  steps: Array<{
    toolName: string;
    purpose: string;
    outputMapping?: Record<string, string>; // maps output field to next tool input field
  }>;
}

export interface ToolRecommendation {
  tool: DiscoveredTool;
  relevanceScore: number; // 0-1
  reason: string;
  suggestedInput?: Record<string, unknown>;
}

export interface ToolCompatibilityCheck {
  compatible: boolean;
  outputTool: string;
  inputTool: string;
  issues: string[];
  suggestions: string[];
}

// ─── ToolDiscoveryEngine ───────────────────────────────────────────────────────
export class ToolDiscoveryEngine {
  private readonly client: Anthropic;
  private readonly registry = new Map<string, DiscoveredTool>();
  private readonly mcpServers = new Map<string, { url: string; connected: boolean }>();

  constructor() {
    this.client = new Anthropic();
  }

  // ─── Registration ────────────────────────────────────────────────────────────

  /** Register a built-in tool definition. */
  registerBuiltin(def: ToolDefinition): void {
    const tool: DiscoveredTool = {
      id: randomUUID(),
      name: def.name,
      description: def.description,
      capabilities: def.capabilities ?? [],
      inputSchema: def.inputSchema ? this.zodToJsonSchema(def.inputSchema) : {},
      outputDescription: "See tool documentation.",
      source: "builtin",
      registeredAt: new Date(),
      useCount: 0,
    };
    this.registry.set(def.name, tool);
    Logger.info("[ToolDiscovery] Registered builtin tool", { name: def.name });
  }

  /** Register a tool discovered from an MCP server. */
  registerMcpTool(
    serverName: string,
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    outputDescription: string
  ): void {
    const tool: DiscoveredTool = {
      id: randomUUID(),
      name: `${serverName}__${name}`,
      description,
      capabilities: this.inferCapabilities(description),
      inputSchema,
      outputDescription,
      source: "mcp",
      mcpServer: serverName,
      registeredAt: new Date(),
      useCount: 0,
    };
    this.registry.set(tool.name, tool);
    Logger.info("[ToolDiscovery] Registered MCP tool", { name: tool.name, server: serverName });
  }

  /** Deregister a tool by name. */
  deregister(toolName: string): boolean {
    const removed = this.registry.delete(toolName);
    if (removed) Logger.info("[ToolDiscovery] Deregistered tool", { name: toolName });
    return removed;
  }

  /** Connect to an MCP server and import its tools (stub — implement MCP client call). */
  async connectMcpServer(serverName: string, serverUrl: string): Promise<number> {
    this.mcpServers.set(serverName, { url: serverUrl, connected: false });

    // In a real implementation, call the MCP server's tools/list endpoint
    // and call registerMcpTool for each. Here we mark connected and return 0.
    this.mcpServers.get(serverName)!.connected = true;
    Logger.info("[ToolDiscovery] MCP server connected (stub)", { serverName, serverUrl });
    return 0; // number of tools imported
  }

  // ─── Discovery ───────────────────────────────────────────────────────────────

  /** Return all registered tools. */
  listAll(): DiscoveredTool[] {
    return Array.from(this.registry.values());
  }

  /** Return tools filtered by capability. */
  byCapability(capability: ToolCapability): DiscoveredTool[] {
    return this.listAll().filter((t) => t.capabilities.includes(capability));
  }

  /** Convert registered tools to Anthropic Tool format for API calls. */
  toAnthropicTools(toolNames?: string[]): Tool[] {
    const tools = toolNames
      ? toolNames.map((n) => this.registry.get(n)).filter(Boolean) as DiscoveredTool[]
      : this.listAll();

    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as any,
    }));
  }

  // ─── Capability matching ─────────────────────────────────────────────────────

  /** Find tools that can solve a natural-language sub-task description. */
  async matchToSubTask(subTaskDescription: string): Promise<ToolRecommendation[]> {
    const allTools = this.listAll();
    if (allTools.length === 0) return [];

    const toolListText = allTools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    const prompt = `Given this sub-task, rank the most relevant tools (max 5).

SUB-TASK: ${subTaskDescription}

AVAILABLE TOOLS:
${toolListText}

Return JSON array:
[
  {
    "tool_name": "name",
    "relevance_score": 0.0-1.0,
    "reason": "why this tool fits",
    "suggested_input": {}
  }
]

Only include tools with relevance_score >= 0.5.`;

    try {
      const response = await this.client.messages.create({
        model: FAST_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "[]";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const parsed: any[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

      return parsed
        .map((item) => {
          const tool = this.registry.get(item.tool_name);
          if (!tool) return null;
          return {
            tool,
            relevanceScore: item.relevance_score ?? 0,
            reason: item.reason ?? "",
            suggestedInput: item.suggested_input,
          } as ToolRecommendation;
        })
        .filter(Boolean) as ToolRecommendation[];
    } catch (err) {
      Logger.error("[ToolDiscovery] matchToSubTask failed", err);
      return [];
    }
  }

  // ─── Composition ─────────────────────────────────────────────────────────────

  /** Generate a composition chain to accomplish a goal from available tools. */
  async composeChain(goal: string, availableToolNames: string[]): Promise<ToolCompositionChain> {
    const tools = availableToolNames
      .map((n) => this.registry.get(n))
      .filter(Boolean) as DiscoveredTool[];

    const toolListText = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");

    const prompt = `Design a tool chain to accomplish the goal.

GOAL: ${goal}

AVAILABLE TOOLS:
${toolListText}

Return JSON:
{
  "description": "what the chain accomplishes",
  "steps": [
    {
      "tool_name": "name",
      "purpose": "what this step achieves",
      "output_mapping": { "output_field": "next_tool_input_field" }
    }
  ]
}

Use the minimum number of steps needed. Each step's output should feed naturally into the next.`;

    try {
      const response = await this.client.messages.create({
        model: FAST_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed: any = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      return {
        id: randomUUID(),
        description: String(parsed.description ?? goal),
        steps: Array.isArray(parsed.steps)
          ? parsed.steps.map((s: any) => ({
              toolName: String(s.tool_name ?? ""),
              purpose: String(s.purpose ?? ""),
              outputMapping: s.output_mapping ?? {},
            }))
          : [],
      };
    } catch (err) {
      Logger.error("[ToolDiscovery] composeChain failed", err);
      return { id: randomUUID(), description: goal, steps: [] };
    }
  }

  // ─── Compatibility ────────────────────────────────────────────────────────────

  /** Check if outputTool's output is compatible as input to inputTool. */
  checkCompatibility(outputToolName: string, inputToolName: string): ToolCompatibilityCheck {
    const outputTool = this.registry.get(outputToolName);
    const inputTool = this.registry.get(inputToolName);
    const issues: string[] = [];
    const suggestions: string[] = [];

    if (!outputTool) issues.push(`Output tool "${outputToolName}" not found in registry`);
    if (!inputTool) issues.push(`Input tool "${inputToolName}" not found in registry`);

    if (outputTool && inputTool) {
      // Check for network-required tools in sandboxed chains
      if (
        outputTool.capabilities.includes("requires_network") &&
        inputTool.capabilities.includes("executes_code")
      ) {
        suggestions.push("Consider caching network output before passing to code execution");
      }

      if (
        outputTool.capabilities.includes("produces_artifacts") &&
        !inputTool.capabilities.includes("reads_files")
      ) {
        issues.push(`${outputToolName} produces artifacts but ${inputToolName} may not consume file artifacts`);
      }
    }

    return {
      compatible: issues.length === 0,
      outputTool: outputToolName,
      inputTool: inputToolName,
      issues,
      suggestions,
    };
  }

  // ─── Recommendations ─────────────────────────────────────────────────────────

  /** Suggest tools the user might not know about, relevant to a context. */
  async recommend(context: string, alreadyUsed: string[] = []): Promise<ToolRecommendation[]> {
    const unused = this.listAll().filter(
      (t) => !alreadyUsed.includes(t.name) && t.useCount === 0
    );
    if (unused.length === 0) return [];

    const toolListText = unused.slice(0, 20).map((t) => `- ${t.name}: ${t.description}`).join("\n");

    const prompt = `Suggest tools that would be useful but haven't been used yet.

CONTEXT: ${context}

UNUSED TOOLS:
${toolListText}

Return JSON array of up to 3 recommendations:
[{ "tool_name": "name", "relevance_score": 0.0-1.0, "reason": "why it would help" }]`;

    try {
      const response = await this.client.messages.create({
        model: FAST_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "[]";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const parsed: any[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

      return parsed
        .map((item) => {
          const tool = this.registry.get(item.tool_name);
          if (!tool) return null;
          return {
            tool,
            relevanceScore: item.relevance_score ?? 0,
            reason: item.reason ?? "",
          } as ToolRecommendation;
        })
        .filter(Boolean) as ToolRecommendation[];
    } catch (err) {
      Logger.error("[ToolDiscovery] recommend failed", err);
      return [];
    }
  }

  // ─── Metrics tracking ─────────────────────────────────────────────────────────

  /** Record a tool use result for metrics. */
  recordUse(toolName: string, latencyMs: number): void {
    const tool = this.registry.get(toolName);
    if (!tool) return;
    tool.useCount++;
    tool.lastUsedAt = new Date();
    tool.averageLatencyMs =
      tool.averageLatencyMs === undefined
        ? latencyMs
        : Math.round(0.8 * tool.averageLatencyMs + 0.2 * latencyMs);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private inferCapabilities(description: string): ToolCapability[] {
    const caps: ToolCapability[] = [];
    const d = description.toLowerCase();
    if (/read|fetch|get|retrieve|search/.test(d)) caps.push("reads_files");
    if (/write|save|create|generate/.test(d)) caps.push("writes_files");
    if (/web|http|url|internet/.test(d)) caps.push("requires_network");
    if (/api|service|endpoint/.test(d)) caps.push("accesses_external_api");
    if (/execut|run|code|script/.test(d)) caps.push("executes_code");
    if (/artifact|output|file|document/.test(d)) caps.push("produces_artifacts");
    return caps;
  }

  private zodToJsonSchema(schema: any): Record<string, unknown> {
    // Minimal zod → JSON Schema conversion for InputSchema
    try {
      if (schema && typeof schema._def === "object") {
        const shape = schema._def.shape?.() ?? {};
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [key, value] of Object.entries<any>(shape)) {
          properties[key] = { type: "string", description: key };
          if (!value.isOptional?.()) required.push(key);
        }
        return { type: "object", properties, required };
      }
    } catch {}
    return { type: "object", properties: {} };
  }
}
