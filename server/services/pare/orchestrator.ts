import {
  PromptAnalysisResult,
  PAREConfig,
  DEFAULT_PARE_CONFIG,
  SessionContext,
  RoutingDecision,
  ExecutionPlan,
  TaskNode,
} from "./types";
import { IntentClassifier } from "./intentClassifier";
import { EntityExtractor } from "./entityExtractor";
import { ToolRouter } from "./toolRouter";
import { PlanGenerator } from "./planGenerator";
import { RobustIntentClassifier, IntentResult, RobustIntent } from "./robustIntentClassifier";
import { ContextDetector, ContextSignals } from "./contextDetector";
import { ToolSelector, ToolSelection } from "./toolSelector";
import { DeterministicRouter, RobustRouteDecision } from "./deterministicRouter";
import { ExecutionValidator, ValidationResult } from "./executionValidator";
import { v4 as uuidv4 } from "uuid";

export interface SimpleAttachment {
  name?: string;
  type?: string;
  path?: string;
}

export interface RobustRouteResult {
  route: "chat" | "agent";
  intent: RobustIntent;
  confidence: number;
  tools: string[];
  reason: string;
  ruleApplied: string;
  context: ContextSignals;
  validation: ValidationResult;
  durationMs: number;
}

export class PAREOrchestrator {
  private config: PAREConfig;
  private intentClassifier: IntentClassifier;
  private entityExtractor: EntityExtractor;
  private toolRouter: ToolRouter;
  private planGenerator: PlanGenerator;
  private enabled: boolean;

  private robustIntentClassifier: RobustIntentClassifier;
  private contextDetector: ContextDetector;
  private toolSelector: ToolSelector;
  private deterministicRouter: DeterministicRouter;
  private executionValidator: ExecutionValidator;
  private useRobustRouter: boolean;

  constructor(config: Partial<PAREConfig> = {}) {
    this.config = { ...DEFAULT_PARE_CONFIG, ...config };
    this.enabled = process.env.PARE_ENABLED !== "false";
    this.useRobustRouter = process.env.PARE_USE_ROBUST !== "false";

    this.intentClassifier = new IntentClassifier({
      confidenceThreshold: this.config.intentConfidenceThreshold,
      useLLMFallback: this.config.useLLMFallback,
    });

    this.entityExtractor = new EntityExtractor();

    this.toolRouter = new ToolRouter({
      similarityThreshold: this.config.similarityThreshold,
    });

    this.planGenerator = new PlanGenerator();

    this.robustIntentClassifier = new RobustIntentClassifier();
    this.contextDetector = new ContextDetector();
    this.toolSelector = new ToolSelector();
    this.deterministicRouter = new DeterministicRouter();
    this.executionValidator = new ExecutionValidator();

    console.log(`[PARE] Orchestrator initialized (enabled=${this.enabled}, robust=${this.useRobustRouter})`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[PARE] Orchestrator ${enabled ? "enabled" : "disabled"}`);
  }

  setUseRobustRouter(useRobust: boolean): void {
    this.useRobustRouter = useRobust;
    console.log(`[PARE] Robust router ${useRobust ? "enabled" : "disabled"}`);
  }

  robustRoute(message: string, attachments: SimpleAttachment[] = []): RobustRouteResult {
    const startTime = Date.now();

    console.log(`[PARE:Robust] Starting route for message: "${message.slice(0, 80)}${message.length > 80 ? "..." : ""}"`);
    console.log(`[PARE:Robust] Attachments: ${attachments.length > 0 ? attachments.map(a => a.name || a.path || "unknown").join(", ") : "none"}`);

    const intentResult = this.robustIntentClassifier.classify(message);
    console.log(`[PARE:Robust] Intent: ${intentResult.intent} (confidence: ${intentResult.confidence.toFixed(2)})`);

    const context = this.contextDetector.detect(message, attachments);
    console.log(`[PARE:Robust] Context: attachments=${context.hasAttachments}, urls=${context.hasUrls}, lang=${context.language}, urgency=${context.hasUrgency}`);

    const toolSelection = this.toolSelector.select(intentResult.intent, context, message);
    console.log(`[PARE:Robust] Tools: [${toolSelection.tools.slice(0, 5).join(", ")}${toolSelection.tools.length > 5 ? "..." : ""}], requiresAgent=${toolSelection.requiresAgent}`);

    const decision = this.deterministicRouter.route(intentResult, context, toolSelection);

    const validation = this.executionValidator.validatePreExecution(decision, context);
    
    if (validation.warnings.length > 0) {
      console.log(`[PARE:Robust] Validation warnings: ${validation.warnings.map(w => w.code).join(", ")}`);
    }
    if (validation.suggestions.length > 0) {
      console.log(`[PARE:Robust] Suggestions: ${validation.suggestions.slice(0, 2).join("; ")}`);
    }

    const durationMs = Date.now() - startTime;

    console.log(`[PARE:Robust] DECISION: route=${decision.route}, rule=${decision.ruleApplied}, validation_score=${validation.score}, duration=${durationMs}ms`);
    console.log(`[PARE:Robust] Reason: ${decision.reason}`);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      component: "PARE",
      event: "robust_route_decision",
      route: decision.route,
      intent: decision.intent,
      confidence: decision.confidence,
      tools: decision.tools.slice(0, 5),
      rule: decision.ruleApplied,
      validationScore: validation.score,
      warnings: validation.warnings.length,
      durationMs,
    }));

    return {
      route: decision.route,
      intent: decision.intent,
      confidence: decision.confidence,
      tools: decision.tools,
      reason: decision.reason,
      ruleApplied: decision.ruleApplied,
      context,
      validation,
      durationMs
    };
  }

  async analyze(prompt: string, context?: SessionContext): Promise<PromptAnalysisResult> {
    const startTime = Date.now();
    console.log(`[PARE] Analyzing prompt: ${prompt.slice(0, 100)}...`);

    const normalized = this.normalizePrompt(prompt);

    const [intents, entities] = await Promise.all([
      this.intentClassifier.classify(normalized, context),
      this.entityExtractor.extract(normalized),
    ]);

    console.log(`[PARE] Classified intents: ${intents.map((i) => i.category).join(", ")}`);
    console.log(`[PARE] Extracted entities: ${entities.map((e) => e.type).join(", ")}`);

    if (this.needsClarification(intents, entities)) {
      const questions = await this.generateClarificationQuestions(prompt, intents, entities);

      return {
        originalPrompt: prompt,
        normalizedPrompt: normalized,
        intents,
        entities,
        toolCandidates: [],
        executionPlan: this.createEmptyPlan(prompt),
        requiresClarification: true,
        clarificationQuestions: questions,
        contextUsed: context || {},
        analysisMetadata: {
          durationMs: Date.now() - startTime,
          primaryIntent: intents[0]?.category || null,
        },
      };
    }

    const toolCandidates = await this.toolRouter.route(
      normalized,
      intents,
      entities,
      this.config.maxToolCandidates
    );

    console.log(`[PARE] Tool candidates: ${toolCandidates.map((t) => t.toolName).join(", ")}`);

    const executionPlan = await this.planGenerator.generate(
      prompt,
      intents,
      entities,
      toolCandidates,
      context
    );

    console.log(`[PARE] Generated plan with ${executionPlan.nodes.length} tasks (${Date.now() - startTime}ms)`);

    return {
      originalPrompt: prompt,
      normalizedPrompt: normalized,
      intents,
      entities,
      toolCandidates,
      executionPlan,
      requiresClarification: false,
      clarificationQuestions: [],
      contextUsed: context || {},
      analysisMetadata: {
        durationMs: Date.now() - startTime,
        primaryIntent: intents[0]?.category || null,
        entityCount: entities.length,
        toolCount: toolCandidates.length,
        planTaskCount: executionPlan.nodes.length,
      },
    };
  }

  async route(prompt: string, hasAttachments: boolean = false, context?: SessionContext): Promise<RoutingDecision> {
    if (!this.enabled) {
      return this.legacyRoute(prompt, hasAttachments);
    }

    if (this.useRobustRouter) {
      try {
        const attachments: SimpleAttachment[] = context?.attachments?.map(a => ({
          name: a.name,
          type: a.type,
        })) || [];

        if (hasAttachments && attachments.length === 0) {
          attachments.push({ type: "unknown", name: "attachment" });
        }

        const robustResult = this.robustRoute(prompt, attachments);

        return {
          route: robustResult.route,
          confidence: robustResult.confidence,
          reasons: [robustResult.reason],
          toolNeeds: robustResult.tools,
          planHint: [`Rule: ${robustResult.ruleApplied}`],
          analysisResult: undefined,
        };
      } catch (error) {
        console.error("[PARE] Robust router failed, falling back to legacy:", error);
      }
    }

    try {
      const enrichedContext: SessionContext = {
        ...context,
        hasAttachments,
        attachmentTypes: context?.attachments?.map(a => a.type) || [],
      };
      const analysis = await this.analyze(prompt, enrichedContext);

      if (analysis.requiresClarification) {
        return {
          route: "chat",
          confidence: 0.9,
          reasons: ["Necesita clarificación"],
          toolNeeds: [],
          planHint: analysis.clarificationQuestions,
          analysisResult: analysis,
        };
      }

      const primaryIntent = analysis.intents[0];
      
      const agentRequiredTools = [
        "web_search", "fetch_url", "code_execute", "file_write", "doc_create",
        "file_read", "document_analyze", "read_file", "analyze_document",
        "summarize", "text_summarize", "data_analyze", "data_visualize"
      ];
      
      const hasExternalToolNeeds = analysis.toolCandidates.some((t) =>
        agentRequiredTools.includes(t.toolName)
      );
      
      const hasAttachmentsForAnalysis = hasAttachments && 
        ["analysis", "creation", "query"].includes(primaryIntent?.category || "");

      if (primaryIntent?.category === "conversation" && !hasExternalToolNeeds && !hasAttachments) {
        return {
          route: "chat",
          confidence: primaryIntent.confidence,
          reasons: ["Conversación general"],
          toolNeeds: [],
          planHint: [],
          analysisResult: analysis,
        };
      }

      if (hasExternalToolNeeds || hasAttachmentsForAnalysis || 
          ["command", "creation", "automation", "research", "analysis", "code"].includes(primaryIntent?.category || "")) {
        const reasons = [];
        if (hasAttachmentsForAnalysis) reasons.push("Archivo adjunto requiere procesamiento");
        reasons.push(...analysis.toolCandidates.slice(0, 3).map((t) => `Requiere: ${t.toolName}`));
        
        return {
          route: "agent",
          confidence: primaryIntent?.confidence || 0.7,
          reasons,
          toolNeeds: analysis.toolCandidates.map((t) => t.toolName),
          planHint: analysis.executionPlan.nodes.map((n) => `${n.tool}: ${JSON.stringify(n.inputs).slice(0, 50)}`),
          analysisResult: analysis,
        };
      }

      return {
        route: "chat",
        confidence: 0.7,
        reasons: ["Consulta manejable por chat"],
        toolNeeds: [],
        planHint: [],
        analysisResult: analysis,
      };
    } catch (error) {
      console.error("[PARE] Analysis failed, falling back to legacy router:", error);
      return this.legacyRoute(prompt, hasAttachments);
    }
  }

  private async legacyRoute(prompt: string, hasAttachments: boolean): Promise<RoutingDecision> {
    const { router } = await import("../router");
    const decision = await router.decide(prompt, hasAttachments);

    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: decision.reasons,
      toolNeeds: decision.tool_needs,
      planHint: decision.plan_hint,
    };
  }

  private normalizePrompt(prompt: string): string {
    let normalized = prompt.split(/\s+/).join(" ").trim();
    normalized = normalized.replace(/[\x00-\x1F\x7F]/g, "");
    return normalized;
  }

  private needsClarification(intents: { category: string; confidence: number }[], entities: unknown[]): boolean {
    if (intents.length === 0 || intents[0].confidence < 0.4) {
      return true;
    }

    if (intents[0].category === "clarification") {
      return true;
    }

    if (["command", "creation", "automation"].includes(intents[0].category) && entities.length === 0) {
      return true;
    }

    return false;
  }

  private async generateClarificationQuestions(
    prompt: string,
    intents: { category: string; confidence: number }[],
    entities: { type: string; value: string }[]
  ): Promise<string[]> {
    try {
      const { geminiChat } = await import("../../lib/gemini");

      const systemPrompt = `Genera 1-2 preguntas breves para clarificar la intención del usuario.
Responde SOLO con JSON: {"questions":["pregunta1","pregunta2"]}`;

      const intentsStr = intents.slice(0, 3).map((i) => i.category).join(", ");
      const entitiesStr = entities.slice(0, 5).map((e) => `${e.type}:${e.value}`).join(", ");

      const result = await geminiChat(
        [{ role: "user", parts: [{ text: `${systemPrompt}\n\nPrompt: ${prompt}\nIntenciones: ${intentsStr}\nEntidades: ${entitiesStr}` }] }],
        { model: "gemini-2.0-flash", maxOutputTokens: 150, temperature: 0.3 }
      );

      const responseText = result.content?.trim() || "";
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.questions || [];
      }
    } catch (error) {
      console.warn("[PARE] Failed to generate clarification questions:", error);
    }

    return ["¿Podrías dar más detalles sobre lo que necesitas?"];
  }

  private createEmptyPlan(objective: string): ExecutionPlan {
    return {
      planId: `plan_empty_${uuidv4().slice(0, 8)}`,
      objective,
      nodes: [
        {
          id: "clarify",
          tool: "clarify",
          inputs: { originalPrompt: objective },
          dependencies: [],
          priority: 10,
          canFail: false,
          timeoutMs: 0,
          retryCount: 0,
        },
      ],
      edges: [],
      estimatedDurationMs: 0,
      parallelGroups: [],
    };
  }
}

export const pareOrchestrator = new PAREOrchestrator();

export function route(message: string, attachments: SimpleAttachment[] = []): RobustRouteResult {
  return pareOrchestrator.robustRoute(message, attachments);
}
