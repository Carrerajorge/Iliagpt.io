import { z } from "zod";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  type AnalysisResult,
  type ComplexityLevel,
  type DeliverableSpec
} from "./promptAnalyzer";
import {
  type SpecializedAgent,
  SpecializedAgentSchema
} from "../requestSpec";

export const AGENTIC_ROUTING_ENABLED = process.env.AGENTIC_ROUTING_ENABLED !== "false";

export const ExecutionPathSchema = z.enum(["direct", "single_agent", "multi_agent"]);
export type ExecutionPath = z.infer<typeof ExecutionPathSchema>;

export const ExecutionStrategySchema = z.enum(["parallel", "sequential", "hybrid"]);
export type ExecutionStrategy = z.infer<typeof ExecutionStrategySchema>;

export const AgentSelectionSchema = z.object({
  agentName: z.string(),
  role: SpecializedAgentSchema,
  priority: z.number().int().min(1).max(10),
  requiredTools: z.array(z.string()).default([]),
  estimatedDurationMs: z.number().optional(),
  capabilities: z.array(z.string()).default([])
});
export type AgentSelection = z.infer<typeof AgentSelectionSchema>;

export const RouteDecisionSchema = z.object({
  id: z.string().uuid(),
  path: ExecutionPathSchema,
  agents: z.array(AgentSelectionSchema).default([]),
  tools: z.array(z.string()).default([]),
  estimatedSteps: z.number().int().min(1),
  executionStrategy: ExecutionStrategySchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  metadata: z.record(z.any()).optional()
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

const AGENT_ROLE_TO_NAME: Record<SpecializedAgent, string> = {
  orchestrator: "OrchestratorAgent",
  research: "ResearchAssistantAgent",
  code: "CodeAgent",
  data: "DataAnalystAgent",
  content: "ContentAgent",
  communication: "CommunicationAgent",
  browser: "BrowserAgent",
  document: "DocumentAgent",
  qa: "QAAgent",
  security: "SecurityAgent",
  // Computer use is disabled; route to the safer BrowserAgent.
  computer_use: "BrowserAgent"
};

const AGENT_TO_TOOLS: Record<SpecializedAgent, string[]> = {
  orchestrator: ["plan", "orchestrate", "decide", "reflect", "delegate_task"],
  research: ["web_search", "research_deep", "fetch_url", "browser_extract", "summarize"],
  code: ["code_generate", "code_review", "code_refactor", "code_test", "code_debug", "shell_execute"],
  data: ["data_analyze", "data_visualize", "data_transform", "data_query", "spreadsheet_analyze"],
  content: ["text_generate", "generate_text", "doc_create", "slides_create", "image_generate"],
  communication: ["email_send", "notification_push", "message", "email_compose"],
  browser: ["browser_navigate", "browser_interact", "browser_extract", "browser_session", "screenshot"],
  document: ["doc_create", "pdf_generate", "pdf_manipulate", "spreadsheet_create", "slides_create", "ocr_extract"],
  qa: ["code_test", "code_review", "verify", "health_check", "validate_output"],
  security: ["encrypt_data", "decrypt_data", "hash_data", "validate_input", "audit_log", "secrets_manage"],
  // Computer use is disabled; restrict to browser-safe tools.
  computer_use: ["browser_navigate", "browser_interact", "browser_extract", "browser_session", "screenshot"]
};

const AGENT_CAPABILITIES: Record<SpecializedAgent, string[]> = {
  orchestrator: ["plan_execution", "delegate_task", "coordinate_workflow", "multi_agent_coordination"],
  research: ["web_search", "deep_research", "fact_check", "information_gathering"],
  code: ["generate_code", "review_code", "debug_code", "refactor_code", "test_code"],
  data: ["analyze_data", "transform_data", "visualize_data", "query_data"],
  content: ["write_article", "create_document", "create_marketing", "generate_content"],
  communication: ["compose_email", "create_notification", "send_message"],
  browser: ["navigate", "scrape", "automate", "extract_content"],
  document: ["parse_document", "convert_document", "analyze_document", "create_document"],
  qa: ["generate_tests", "validate", "find_bugs", "quality_assurance"],
  security: ["vulnerability_scan", "security_audit", "compliance_check", "encryption"],
  // Computer use is disabled; keep capabilities aligned with BrowserAgent.
  computer_use: ["navigate", "scrape", "automate", "extract_content"]
};

const COMPLEXITY_TO_STRATEGY: Record<ComplexityLevel, ExecutionStrategy> = {
  trivial: "sequential",
  simple: "sequential",
  moderate: "sequential",
  complex: "hybrid",
  expert: "parallel"
};

const COMPLEXITY_TO_PATH: Record<ComplexityLevel, ExecutionPath> = {
  trivial: "direct",
  simple: "direct",
  moderate: "single_agent",
  complex: "multi_agent",
  expert: "multi_agent"
};

export type IntentRouterEvent =
  | "routing_started"
  | "agents_selected"
  | "strategy_determined"
  | "routing_completed"
  | "routing_failed";

export interface IntentRouterOptions {
  enableMultiAgent?: boolean;
  maxAgentsPerTask?: number;
  defaultTimeout?: number;
  strictValidation?: boolean;
}

export class IntentRouter extends EventEmitter {
  private options: Required<IntentRouterOptions>;

  constructor(options: IntentRouterOptions = {}) {
    super();
    this.options = {
      enableMultiAgent: options.enableMultiAgent ?? true,
      maxAgentsPerTask: options.maxAgentsPerTask ?? 5,
      defaultTimeout: options.defaultTimeout ?? 120000,
      strictValidation: options.strictValidation ?? false
    };
    this.setMaxListeners(50);
  }

  async route(analysis: AnalysisResult): Promise<RouteDecision> {
    if (!AGENTIC_ROUTING_ENABLED) {
      return this.createDirectRouteDecision(analysis, "Agentic routing disabled");
    }

    const routeId = randomUUID();
    const startTime = Date.now();

    this.emitEvent("routing_started", {
      routeId,
      complexity: analysis.complexity,
      intent: analysis.intent
    });

    try {
      const path = this.determinePath(analysis);
      const agents = this.selectAgents(analysis);
      const strategy = this.determineExecutionStrategy(analysis.complexity);
      const tools = this.aggregateTools(agents);
      const estimatedSteps = this.estimateSteps(analysis, agents);

      this.emitEvent("agents_selected", {
        routeId,
        agentCount: agents.length,
        agents: agents.map(a => a.agentName)
      });

      this.emitEvent("strategy_determined", {
        routeId,
        strategy,
        path
      });

      const decision: RouteDecision = {
        id: routeId,
        path,
        agents,
        tools,
        estimatedSteps,
        executionStrategy: strategy,
        confidence: this.calculateConfidence(analysis, path, agents),
        reasoning: this.generateReasoning(analysis, path, agents, strategy),
        metadata: {
          analysisId: analysis.id,
          complexity: analysis.complexity,
          intent: analysis.intent,
          deliverableCount: analysis.deliverables.length,
          routingTimeMs: Date.now() - startTime
        }
      };

      this.emitEvent("routing_completed", {
        routeId,
        path: decision.path,
        agentCount: decision.agents.length,
        estimatedSteps: decision.estimatedSteps,
        timeMs: Date.now() - startTime
      });

      return RouteDecisionSchema.parse(decision);

    } catch (error: any) {
      this.emitEvent("routing_failed", {
        routeId,
        error: error.message,
        timeMs: Date.now() - startTime
      });

      return this.createDirectRouteDecision(
        analysis,
        `Routing failed: ${error.message}, falling back to direct`
      );
    }
  }

  selectAgents(analysis: AnalysisResult): AgentSelection[] {
    const agents: AgentSelection[] = [];
    const seenRoles = new Set<SpecializedAgent>();

    const primaryRole = analysis.primaryAgent;
    if (primaryRole && !seenRoles.has(primaryRole)) {
      agents.push(this.createAgentSelection(primaryRole, 1));
      seenRoles.add(primaryRole);
    }

    for (const role of analysis.suggestedAgents) {
      if (!seenRoles.has(role) && agents.length < this.options.maxAgentsPerTask) {
        agents.push(this.createAgentSelection(role, agents.length + 1));
        seenRoles.add(role);
      }
    }

    const additionalAgents = this.inferAgentsFromDeliverables(analysis.deliverables);
    for (const role of additionalAgents) {
      if (!seenRoles.has(role) && agents.length < this.options.maxAgentsPerTask) {
        agents.push(this.createAgentSelection(role, agents.length + 1));
        seenRoles.add(role);
      }
    }

    if (agents.length === 0) {
      agents.push(this.createAgentSelection("content", 1));
    }

    return agents.slice(0, this.options.maxAgentsPerTask);
  }

  determineExecutionStrategy(complexity: ComplexityLevel | string): ExecutionStrategy {
    const level = complexity as ComplexityLevel;
    return COMPLEXITY_TO_STRATEGY[level] || "sequential";
  }

  private determinePath(analysis: AnalysisResult): ExecutionPath {
    const { complexity, deliverables, suggestedAgents } = analysis;

    if (complexity === "trivial") {
      return "direct";
    }

    if (complexity === "simple" && deliverables.length === 0) {
      return "direct";
    }

    if (
      complexity === "simple" &&
      deliverables.length <= 1 &&
      deliverables.every(d => d.type === "text_response")
    ) {
      return "direct";
    }

    if (
      complexity === "complex" ||
      complexity === "expert" ||
      deliverables.length >= 2
    ) {
      if (this.options.enableMultiAgent) {
        return "multi_agent";
      }
      return "single_agent";
    }

    if (
      complexity === "moderate" ||
      deliverables.length === 1 ||
      suggestedAgents.length === 1
    ) {
      return "single_agent";
    }

    if (suggestedAgents.length > 1 && this.options.enableMultiAgent) {
      return "multi_agent";
    }

    return "single_agent";
  }

  private createAgentSelection(role: SpecializedAgent, priority: number): AgentSelection {
    return {
      agentName: AGENT_ROLE_TO_NAME[role] || `${role}Agent`,
      role,
      priority,
      requiredTools: AGENT_TO_TOOLS[role] || [],
      capabilities: AGENT_CAPABILITIES[role] || [],
      estimatedDurationMs: this.estimateAgentDuration(role)
    };
  }

  private inferAgentsFromDeliverables(deliverables: DeliverableSpec[]): SpecializedAgent[] {
    const inferredAgents: SpecializedAgent[] = [];

    for (const deliverable of deliverables) {
      switch (deliverable.type) {
        case "document":
          if (!inferredAgents.includes("document")) {
            inferredAgents.push("document");
          }
          break;
        case "presentation":
          if (!inferredAgents.includes("content")) {
            inferredAgents.push("content");
          }
          break;
        case "spreadsheet":
        case "data_analysis":
          if (!inferredAgents.includes("data")) {
            inferredAgents.push("data");
          }
          break;
        case "code":
          if (!inferredAgents.includes("code")) {
            inferredAgents.push("code");
          }
          break;
        case "research":
          if (!inferredAgents.includes("research")) {
            inferredAgents.push("research");
          }
          break;
        case "image":
          if (!inferredAgents.includes("content")) {
            inferredAgents.push("content");
          }
          break;
      }
    }

    return inferredAgents;
  }

  private aggregateTools(agents: AgentSelection[]): string[] {
    const toolSet = new Set<string>();

    for (const agent of agents) {
      for (const tool of agent.requiredTools) {
        toolSet.add(tool);
      }
    }

    return Array.from(toolSet);
  }

  private estimateSteps(analysis: AnalysisResult, agents: AgentSelection[]): number {
    let baseSteps = 1;

    baseSteps += analysis.deliverables.length;

    if (agents.length > 1) {
      baseSteps += agents.length - 1;
    }

    switch (analysis.complexity) {
      case "trivial":
        break;
      case "simple":
        baseSteps += 1;
        break;
      case "moderate":
        baseSteps += 2;
        break;
      case "complex":
        baseSteps += 4;
        break;
      case "expert":
        baseSteps += 6;
        break;
    }

    return Math.max(1, Math.min(baseSteps, 20));
  }

  private estimateAgentDuration(role: SpecializedAgent): number {
    const baseDurations: Record<SpecializedAgent, number> = {
      orchestrator: 5000,
      research: 30000,
      code: 20000,
      data: 15000,
      content: 25000,
      communication: 10000,
      browser: 45000,
      document: 20000,
      qa: 15000,
      security: 10000,
      computer_use: 60000
    };

    return baseDurations[role] || 15000;
  }

  private calculateConfidence(
    analysis: AnalysisResult,
    path: ExecutionPath,
    agents: AgentSelection[]
  ): number {
    let confidence = analysis.intentConfidence;

    if (path === "direct") {
      confidence *= 1.0;
    } else if (path === "single_agent") {
      confidence *= 0.95;
    } else {
      confidence *= 0.85;
    }

    if (agents.length > 0) {
      confidence *= 0.95 + (0.05 / agents.length);
    }

    if (analysis.policyValidation?.valid === false) {
      confidence *= 0.7;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  private generateReasoning(
    analysis: AnalysisResult,
    path: ExecutionPath,
    agents: AgentSelection[],
    strategy: ExecutionStrategy
  ): string {
    const parts: string[] = [];

    parts.push(`Complexity: ${analysis.complexity}`);
    parts.push(`Intent: ${analysis.intent}`);

    if (analysis.deliverables.length > 0) {
      const types = analysis.deliverables.map(d => d.type).join(", ");
      parts.push(`Deliverables: ${types}`);
    }

    parts.push(`Path: ${path}`);

    if (agents.length > 0) {
      const agentNames = agents.map(a => a.agentName).join(", ");
      parts.push(`Agents: ${agentNames}`);
    }

    parts.push(`Strategy: ${strategy}`);

    return parts.join(" | ");
  }

  private createDirectRouteDecision(
    analysis: AnalysisResult,
    reasoning: string
  ): RouteDecision {
    return {
      id: randomUUID(),
      path: "direct",
      agents: [],
      tools: [],
      estimatedSteps: 1,
      executionStrategy: "sequential",
      confidence: analysis.intentConfidence * 0.9,
      reasoning,
      metadata: {
        analysisId: analysis.id,
        fallback: true
      }
    };
  }

  private emitEvent(event: IntentRouterEvent, data: Record<string, any>): void {
    try {
      this.emit(event, {
        timestamp: Date.now(),
        ...data
      });
    } catch (error) {
      console.error(`[IntentRouter] Event emission error for ${event}:`, error);
    }
  }

  getAgentInfo(role: SpecializedAgent): {
    name: string;
    tools: string[];
    capabilities: string[];
  } {
    return {
      name: AGENT_ROLE_TO_NAME[role] || `${role}Agent`,
      tools: AGENT_TO_TOOLS[role] || [],
      capabilities: AGENT_CAPABILITIES[role] || []
    };
  }

  getAllAgentMappings(): Record<SpecializedAgent, string> {
    return { ...AGENT_ROLE_TO_NAME };
  }

  isEnabled(): boolean {
    return AGENTIC_ROUTING_ENABLED;
  }
}

export const intentRouter = new IntentRouter();

export function createIntentRouter(options?: IntentRouterOptions): IntentRouter {
  return new IntentRouter(options);
}
