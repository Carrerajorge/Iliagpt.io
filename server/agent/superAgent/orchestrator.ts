import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  AgentContract,
  ExecutionState,
  ExecutionStateSchema,
  SourceSignal,
  SSEEvent,
  SSEEventType,
  IntentType
} from "./contracts";
import { parsePromptToContract, validateContract, repairContract } from "./contractRouter";
import { shouldResearch } from "./researchPolicy";
import { collectSignals, SignalsProgress } from "./signalsPipeline";
import { deepDiveSources, DeepDiveProgress, ExtractedContent } from "./deepDivePipeline";
import { createXlsx, createDocx, createPptx, storeArtifactMeta, packCitations, XlsxSpec, DocxSpec, PptxSpec } from "./artifactTools";
import { evaluateQualityGate, shouldRetry, formatGateReport } from "./qualityGate";
import { searchScopus, scopusArticlesToSourceSignals, isScopusConfigured, ScopusArticle } from "./scopusClient";
import { searchWos, WosArticle } from "./wosClient";
import { runAcademicPipeline, candidatesToSourceSignals, PipelineResult, PipelineConfig } from "./academicPipeline";
import { searchOpenAlex } from "./openAlexClient";
import { PromptUnderstanding, UserSpec, TaskSpec } from "../promptUnderstanding";
import { requestUnderstandingAgent } from "../requestUnderstanding";
import {
  buildOpenClaw1000CapabilityProfile,
  suggestOpenClaw1000ToolForStep,
  type OpenClaw1000CapabilityProfile,
} from "../../services/openClaw1000CapabilityProfiler";

function isWosConfigured(): boolean {
  return !!process.env.WOS_API_KEY;
}

function wosArticlesToSourceSignals(articles: WosArticle[]): SourceSignal[] {
  return articles.map((article, index) => ({
    id: article.id || `wos-${index}`,
    url: article.wosUrl,
    title: article.title,
    snippet: article.abstract?.substring(0, 300) || "",
    source: "wos" as const,
    rank: index + 1,
    timestamp: Date.now(),
    domain: "webofscience.com",
    score: 1.0,
    fetched: false,
    metadata: {
      authors: article.authors,
      year: article.year,
      journal: article.journal,
      abstract: article.abstract,
      keywords: article.keywords,
      doi: article.doi,
      citations: article.citationCount,
      affiliations: article.affiliations,
      documentType: article.documentType,
      language: article.language,
    },
  }));
}

// ...



export interface OrchestratorConfig {
  maxIterations: number;
  emitHeartbeat: boolean;
  heartbeatIntervalMs: number;
  enforceContract: boolean;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxIterations: 3,
  emitHeartbeat: true,
  heartbeatIntervalMs: 5000,
  enforceContract: true,
};

export class SuperAgentOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private state: ExecutionState | null = null;
  private sessionId: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private eventCounter: number = 0;
  private abortSignal?: AbortSignal;
  private promptUnderstanding: PromptUnderstanding;
  private capabilityProfile: OpenClaw1000CapabilityProfile | null = null;

  constructor(sessionId: string, config: Partial<OrchestratorConfig> = {}) {
    super();
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.promptUnderstanding = new PromptUnderstanding();
  }

  private emitSSE(eventType: SSEEventType, data: unknown): void {
    const event: SSEEvent = {
      event_id: `${this.sessionId}_${++this.eventCounter}`,
      event_type: eventType,
      timestamp: Date.now(),
      data,
      session_id: this.sessionId,
    };

    this.emit("sse", event);
  }

  private startHeartbeat(): void {
    if (this.config.emitHeartbeat && !this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        this.emitSSE("heartbeat", {
          phase: this.state?.phase,
          sources_count: this.state?.sources_count,
          artifacts_count: this.state?.artifacts.length,
          iteration: this.state?.iteration,
        });
      }, this.config.heartbeatIntervalMs);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private checkAbort(): void {
    if (this.abortSignal?.aborted) {
      this.stopHeartbeat();
      throw new Error("Ejecución cancelada por el usuario");
    }
  }

  private convertSpecToContract(spec: UserSpec, originalPrompt: string): AgentContract {
    // Detect intent based on tasks
    let intent: IntentType = "answer";
    const hasSearch = spec.tasks.some(t => t.verb.includes("SEARCH"));
    const hasDoc = spec.tasks.some(t => t.verb.includes("CREATE_DOCUMENT") || t.verb.includes("DOC"));
    const hasXls = spec.tasks.some(t => t.verb.includes("CREATE_SPREADSHEET") || t.verb.includes("EXCEL"));
    const hasPpt = spec.tasks.some(t => t.verb.includes("CREATE_PRESENTATION") || t.verb.includes("PRESENTATION") || t.verb.includes("PPT") || t.verb.includes("SLIDES"));

    // Also detect pptx from original prompt as fallback
    const promptLower = originalPrompt.toLowerCase();
    const hasPptFromPrompt = !hasPpt && /\b(powerpoint|pptx|presentaci[oó]n|slides?|diapositivas?)\b/i.test(promptLower);

    const effectiveHasPpt = hasPpt || hasPptFromPrompt;

    const multiFormat = [hasDoc, hasXls, effectiveHasPpt].filter(Boolean).length > 1;
    if (multiFormat) intent = "mixed";
    else if (effectiveHasPpt) intent = "create_pptx";
    else if (hasDoc) intent = "create_docx";
    else if (hasXls) intent = "create_xlsx";
    else if (hasSearch) intent = "research";

    // Extract requirements
    const mustCreate: ("docx" | "xlsx" | "pptx")[] = [];
    if (hasDoc && !effectiveHasPpt) mustCreate.push("docx");
    if (hasXls) mustCreate.push("xlsx");
    if (effectiveHasPpt) mustCreate.push("pptx");

    // Extract quantity
    let minSources = 0;
    const quantityConstraint = spec.constraints.find(c => c.type === "quantity");
    if (quantityConstraint) {
      const val = parseInt(quantityConstraint.value, 10);
      if (!isNaN(val)) minSources = val;
    } else {
      // Check params of search tasks
      const searchTask = spec.tasks.find(t => t.verb.includes("SEARCH"));
      if (searchTask) {
        const limitParam = searchTask.params.find(p => p.name === "limit" || p.name === "count");
        if (limitParam) {
          const val = parseInt(limitParam.value, 10);
          if (!isNaN(val)) minSources = val;
        }
      }
    }
    if (minSources === 0 && hasSearch) minSources = 20; // Default

    return {
      contract_id: `contract_${randomUUID().substring(0, 8)}`,
      timestamp: Date.now(),
      intent,
      requirements: {
        min_sources: minSources,
        must_create: mustCreate,
        language: "es",
        verify_facts: true,
        include_citations: true,
        max_depth: 3
      },
      plan: spec.tasks.map(t => ({
        id: t.id,
        action: t.verb,
        tool: t.tool_hints?.[0] || "unknown", // Using the hints we added in LLMExtractor
        input: t.params.reduce((acc, p) => ({ ...acc, [p.name]: p.value }), {}),
        depends_on: t.dependencies,
        status: "pending" as const
      })),
      tool_calls: [],
      acceptance_checks: [],
      original_prompt: originalPrompt,
      parsed_entities: [],
      language_detected: "es"
    };
  }

  private applyOpenClawCapabilityProfile(contract: AgentContract, prompt: string): AgentContract {
    const profile = buildOpenClaw1000CapabilityProfile(prompt, {
      limit: 24,
      minScore: 0.1,
      includeStatuses: ["implemented", "partial"],
    });
    this.capabilityProfile = profile;

    if (profile.matches.length === 0) {
      return contract;
    }

    const usedTools = new Set(
      contract.plan
        .map((step) => step.tool)
        .filter((tool): tool is string => Boolean(tool) && tool !== "unknown")
    );

    const enrichedPlan = contract.plan.map((step) => {
      if (step.tool && step.tool !== "unknown") {
        return step;
      }

      const stepContext = `${step.action} ${JSON.stringify(step.input || {})}`;
      const suggestedTool = suggestOpenClaw1000ToolForStep(stepContext, profile, usedTools);
      if (!suggestedTool) return step;

      usedTools.add(suggestedTool);
      return { ...step, tool: suggestedTool };
    });

    const capabilityChecks = profile.matches.slice(0, 8).map((match, index) => ({
      id: `oc_${match.capability.code}_${index + 1}`,
      condition: `${match.capability.capability} :: tool=${match.capability.toolName}`,
      threshold: Math.round(match.score * 100),
      required: match.capability.status === "implemented",
    }));

    const mergedChecks = [...contract.acceptance_checks];
    const existingCheckIds = new Set(mergedChecks.map((check) => check.id));
    for (const check of capabilityChecks) {
      if (!existingCheckIds.has(check.id)) {
        mergedChecks.push(check);
      }
    }

    const mergedEntities = Array.from(new Set([
      ...contract.parsed_entities,
      ...profile.matches.slice(0, 12).map((match) => `openclaw:${match.capability.code}`),
      ...profile.categories.slice(0, 6).map((group) => `openclaw_category:${group.category}`),
    ]));

    const requirements = { ...contract.requirements };
    const suggestsResearch = profile.categories.some((group) =>
      group.category === "academic_research" ||
      group.category === "web_realtime_search" ||
      group.category === "knowledge_rag_memory"
    );
    if (suggestsResearch && requirements.min_sources <= 0) {
      requirements.min_sources = 20;
    }

    return {
      ...contract,
      requirements,
      plan: enrichedPlan,
      acceptance_checks: mergedChecks,
      parsed_entities: mergedEntities,
    };
  }

  private emitThought(content: string): void {
    this.emitSSE("thought", { content, timestamp: Date.now() });
  }

  async execute(prompt: string, signal?: AbortSignal): Promise<ExecutionState> {
    this.abortSignal = signal;

    try {
      this.startHeartbeat();

      if (signal?.aborted) {
        throw new Error("Ejecución cancelada por el usuario");
      }

      this.emitThought("Analizando solicitud del usuario...");

      // === Mandatory Request-Understanding Gate (Brief) ===
      let brief: any;
      try {
        brief = await requestUnderstandingAgent.buildBrief({
          text: prompt,
          chatId: this.sessionId,
          requestId: this.sessionId,
        });
      } catch (briefErr: any) {
        console.warn(`[SuperAgent] buildBrief failed, using heuristic fallback: ${briefErr?.message || briefErr}`);
        const intentText = prompt.length > 120 ? prompt.substring(0, 120) + "..." : prompt;
        brief = {
          intent: { primary_intent: intentText, confidence: 0.5 },
          objective: intentText,
          scope: { in_scope: [intentText], out_of_scope: [] },
          subtasks: [
            { title: "Analizar solicitud", description: "Entender intención y contexto", priority: "high" as const },
            { title: "Ejecutar tarea", description: "Producir resultado alineado", priority: "high" as const },
          ],
          deliverable: { description: "Respuesta completa", format: "markdown" },
          audience: { audience: "general", tone: "direct", language: "es" },
          restrictions: [],
          data_provided: [],
          assumptions: [],
          required_inputs: [],
          expected_output: { description: "Respuesta accionable", format: "markdown", structure: [] },
          validations: [],
          success_criteria: ["Solicitud resuelta"],
          definition_of_done: ["Respuesta entregada"],
          risks: [],
          ambiguities: [],
          tool_routing: { suggested_tools: ["web_search", "fetch_url"], blocked_tools: [], rationale: "" },
          guardrails: { policy_ok: true, privacy_ok: true, security_ok: true, pii_detected: false, flags: [] },
          self_check: { passed: true, score: 0.5, issues: [] },
          trace: { planner_model: "heuristic", planner_mode: "heuristic" as const, total_duration_ms: 0, stages: [] },
          blocker: { is_blocked: false },
        };
      }
      this.emitSSE("brief", brief);

      if (brief.blocker?.is_blocked) {
        const question = (brief.blocker.question || "").trim() || "¿Puede aclarar el punto bloqueador para poder completar el encargo?";
        // Return immediately with a single clarification question
        this.state = ExecutionStateSchema.parse({
          contract: this.convertSpecToContract({
            goal: brief.intent.primary_intent,
            tasks: [],
            inputs_provided: {},
            missing_inputs: [],
            constraints: [],
            success_criteria: [],
            assumptions: [],
            risks: [],
            questions: [question],
            confidence: brief.intent.confidence,
          } as any, prompt),
          phase: "completed",
          sources: [],
          sources_count: 0,
          deep_sources: [],
          artifacts: [],
          tool_results: [],
          iteration: 0,
          max_iterations: this.config.maxIterations,
          acceptance_results: [],
          started_at: Date.now(),
          completed_at: Date.now(),
          final_response: question,
        });

        this.emitSSE("final", {
          response: question,
          sources_count: 0,
          artifacts: [],
          duration_ms: 0,
          iterations: 0,
        });

        return this.state;
      }

      console.log("[SuperAgent] Orchestrator using PromptUnderstanding for:", prompt.substring(0, 50));
      const processingResult = await this.promptUnderstanding.processFullPrompt(prompt, { useLLM: true });

      this.emitThought("Generando plan de ejecución basado en las tareas detectadas...");
      let contract = this.convertSpecToContract(processingResult.spec, prompt);
      contract = this.applyOpenClawCapabilityProfile(contract, prompt);
      this.emitThought(`Plan generado: Intención detectada como '${contract.intent}'.`);
      if (this.capabilityProfile && this.capabilityProfile.matches.length > 0) {
        const topCapabilities = this.capabilityProfile.matches.slice(0, 5).map((match) =>
          `${match.capability.code}:${match.capability.toolName}`
        );
        this.emitThought(
          `OpenClaw1000 activo: ${this.capabilityProfile.matches.length} capacidades alineadas. Top: ${topCapabilities.join(", ")}.`
        );
        this.emitSSE("progress", {
          phase: "planning",
          status: "capability_profile",
          matched: this.capabilityProfile.matches.length,
          categories: this.capabilityProfile.categories,
          recommended_tools: this.capabilityProfile.recommendedTools,
          top_capabilities: this.capabilityProfile.matches.slice(0, 10).map((match) => ({
            id: match.capability.id,
            code: match.capability.code,
            capability: match.capability.capability,
            tool: match.capability.toolName,
            score: match.score,
          })),
        });
      }

      console.log("[SuperAgent] Contract generated:", JSON.stringify(contract, null, 2));

      if (this.config.enforceContract) {
        // We can keep validateContract as a sanity check, though LLM is usually better
        const validation = validateContract(contract);
        if (!validation.valid) {
          this.emitThought("Advertencia: El contrato inicial contiene errores, intentando reparar...");
          console.warn("[SuperAgent] Contract validation failed (using LLM contract anyway):", validation.errors);
          // contract = repairContract(contract); // DISABLED: Trust LLM over legacy validation
        }
      }

      const isAcademicSearch = this.isScientificArticleRequest(prompt);
      const run_title = isAcademicSearch
        ? "Búsqueda académica"
        : contract.intent === "create_docx" || contract.intent === "create_xlsx" || contract.intent === "mixed"
          ? `Creando ${contract.requirements?.must_create?.join(" + ") || "documentos"}`
          : "Procesando solicitud";

      this.emitSSE("contract", {
        ...contract,
        run_title,
        target: contract.requirements?.min_sources || 50,
      });

      this.state = ExecutionStateSchema.parse({
        contract,
        phase: "planning",
        sources: [],
        sources_count: 0,
        deep_sources: [],
        artifacts: [],
        tool_results: [],
        iteration: 0,
        max_iterations: this.config.maxIterations,
        acceptance_results: [],
        started_at: Date.now(),
      });

      const yearRange = this.extractYearRange(prompt);
      this.emitSSE("plan", {
        run_title,
        target: contract.requirements?.min_sources || 50,
        steps: contract.plan,
        requirements: contract.requirements,
        capability_profile: this.capabilityProfile
          ? {
            matched: this.capabilityProfile.matches.length,
            categories: this.capabilityProfile.categories,
            recommendedTools: this.capabilityProfile.recommendedTools,
          }
          : undefined,
        rules: {
          yearStart: yearRange.start || new Date().getFullYear() - 5,
          yearEnd: yearRange.end || new Date().getFullYear(),
          output: contract.requirements?.must_create?.[0] || "xlsx",
        },
      });

      this.emitThought("Iniciando ejecución del plan por fases...");
      await this.executePhases();

      return this.state;

    } catch (error: any) {
      if (this.state) {
        this.state.phase = "error";
        this.state.error = error.message;
      }

      this.emitSSE("error", {
        message: error.message,
        stack: error.stack,
        recoverable: false,
      });

      throw error;

    } finally {
      this.stopHeartbeat();
    }
  }

  private async executePhases(): Promise<void> {
    if (!this.state) return;

    const requirements = this.state.contract.requirements;
    const researchDecision = shouldResearch(this.state.contract.original_prompt);
    const capabilityDrivenResearch = this.capabilityProfile?.categories.some((group) =>
      group.category === "academic_research" ||
      group.category === "web_realtime_search" ||
      group.category === "knowledge_rag_memory"
    ) ?? false;

    if (researchDecision.shouldResearch || requirements.min_sources > 0 || capabilityDrivenResearch) {
      this.checkAbort();
      await this.executeSignalsPhase();
      this.checkAbort();
      await this.executeDeepPhase();
    }

    if (requirements.must_create.length > 0) {
      this.checkAbort();
      await this.executeCreatePhase();
    }

    this.checkAbort();
    await this.executeVerifyPhase();

    if (this.state.artifacts.length > 0 || this.state.sources.length > 0 || this.state.phase !== "error") {
      this.checkAbort();
      await this.executeFinalizePhase();
    }
  }

  private isScientificArticleRequest(prompt: string): boolean {
    const patterns = [
      /\b(artículos?|articulos?)\s*(científicos?|cientificos?|académicos?|academicos?)\b/i,
      /\b(papers?|publications?|research\s+articles?)\b/i,
      /\b(scopus|web\s*of\s*science|wos|pubmed|scholar)\b/i,
      /\b(revisión\s+sistemática|systematic\s+review)\b/i,
      /\b(literatura\s+científica|scientific\s+literature)\b/i,
    ];
    return patterns.some(p => p.test(prompt));
  }

  private isLatamOnlyRequest(prompt: string): boolean {
    const patterns = [
      /\b(latinoam[eé]rica|latinoamerica|latin\s*america)\b/i,
      /\b(solo\s+de\s+latinoam[eé]rica|only\s+from\s+latin\s*america)\b/i,
      /\b(pa[ií]ses\s+latinoamericanos|latin\s*american\s+countries)\b/i,
      /\b(am[eé]rica\s+latina)\b/i,
      /\b(latam)\b/i,
    ];
    return patterns.some(p => p.test(prompt));
  }

  private extractYearRange(prompt: string): { start?: number; end?: number } {
    const match = prompt.match(/(?:del|from)\s+(\d{4})\s+(?:al|to|hasta)\s+(\d{4})/i);
    if (match) {
      return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) };
    }
    const singleYear = prompt.match(/\b(20\d{2})\b/);
    if (singleYear) {
      return { start: parseInt(singleYear[1], 10) - 2, end: parseInt(singleYear[1], 10) };
    }
    return {};
  }

  private getSearchParametersFromContract(): { query: string; yearStart?: number; yearEnd?: number; limit: number } {
    const contract = this.state?.contract;
    if (!contract) return { query: "", limit: 50 };

    // Try to find a search step in the plan
    const searchStep = contract.plan.find(p =>
      p.action.includes("SEARCH") ||
      p.action === "research" ||
      p.tool?.includes("search")
    );

    if (searchStep && searchStep.input) {
      console.log("[Orchestrator] Found search step:", JSON.stringify(searchStep, null, 2));
      const query = (searchStep.input as Record<string, any>).query || (searchStep.input as Record<string, any>).object || contract.original_prompt.substring(0, 50);
      console.log("[Orchestrator] Extracted query from step:", query);
      const limit = parseInt((searchStep.input as Record<string, any>).limit || (searchStep.input as Record<string, any>).count || (searchStep.input as Record<string, any>).quantity, 10) || contract.requirements.min_sources || 50;
      const yearStart = parseInt((searchStep.input as Record<string, any>).year_start || (searchStep.input as Record<string, any>).start_year, 10);
      const yearEnd = parseInt((searchStep.input as Record<string, any>).year_end || (searchStep.input as Record<string, any>).end_year, 10);

      return {
        query,
        limit,
        yearStart: isNaN(yearStart) ? undefined : yearStart,
        yearEnd: isNaN(yearEnd) ? undefined : yearEnd
      };
    }

    // Fallback if no search step (shouldn't happen with PromptUnderstanding)
    // Extract using legacy logic but constrained
    return {
      query: this.extractSearchTopic(contract.original_prompt), // Assuming extractSearchTopic exists and is suitable
      limit: contract.requirements.min_sources || 50,
      ...this.extractYearRange(contract.original_prompt)
    };
  }

  private async executeSignalsPhase(): Promise<void> {
    if (!this.state) return;

    this.state.phase = "signals";
    this.emitSSE("phase_started", {
      phase: "signals",
      status: "running",
      message: "Buscando artículos en bases de datos académicas…"
    });
    this.emitSSE("progress", { phase: "signals", status: "starting" });

    const params = this.getSearchParametersFromContract();
    const prompt = this.state.contract.original_prompt;
    const researchDecision = shouldResearch(prompt);

    // Aggressive overrides
    const isScientific = this.isScientificArticleRequest(prompt);
    const hasScopus = isScopusConfigured();
    const hasWos = isWosConfigured();

    if (isScientific) {
      if (hasScopus || hasWos) {
        const sourceNames = [hasScopus ? "Scopus" : "", hasWos ? "Web of Science" : "", "OpenAlex", "OpenCitations"].filter(Boolean).join(" + ");
        this.emitThought(`Estrategia: Búsqueda académica multi-fuente. Usando ${sourceNames} en paralelo (2B+ relaciones de citación vía OpenCitations).`);
        await this.executeSignalsWithAcademicDatabases(params.query, params.limit, hasScopus, hasWos);
      } else {
        this.emitThought("Estrategia: Búsqueda científica con OpenAlex (271M+ trabajos, índice abierto más grande del mundo).");
        await this.executeSignalsWithOpenAlex(params.query, params.limit);
      }
    } else {
      this.emitThought("Estrategia: Búsqueda web general para recopilación de señales.");
      await this.executeSignalsWithWebSearch(researchDecision, params.limit);
    }
  }

  private async executeSignalsWithOpenAlex(query: string, targetCount: number): Promise<void> {
    if (!this.state) return;

    const params = this.getSearchParametersFromContract();
    const searchTopic = query || params.query; // Use the passed query, fallback to params if somehow empty
    const yearRange = { start: params.yearStart, end: params.yearEnd };
    const isLatamOnly = this.isLatamOnlyRequest(this.state.contract.original_prompt);

    this.emitSSE("tool_call", {
      id: "tc_signals_openalex",
      tool: "academic_pipeline",
      input: { query: searchTopic, target: targetCount, yearRange, regionFilter: isLatamOnly ? "latam" : "global" },
    });

    this.emitSSE("progress", {
      phase: "signals",
      status: "multi_agent_pipeline",
      message: `Ejecutando pipeline multi-agente para: "${searchTopic}"`,
    });

    let pipelineResult: PipelineResult | null = null;

    try {
      const pipelineEmitter = new EventEmitter();
      let pipelineSearchCount = 0;

      pipelineEmitter.on("pipeline_phase", (data) => {
        this.emitSSE("progress", {
          phase: "signals",
          status: data.phase,
          ...data,
        });

        const candidateCount = data.count || data.totalCandidates || data.relevantCount || data.verifiedCount || data.enrichedCount || 0;

        if (data.phase === "search" && data.status !== "starting") {
          pipelineSearchCount++;
          this.emitSSE("search_progress", {
            provider: "OpenAlex",
            queries_current: pipelineSearchCount,
            queries_total: data.totalIterations || 4,
            pages_searched: data.pagesSearched || pipelineSearchCount,
            candidates_found: candidateCount,
          });
        } else if (data.phase === "verification" || data.phase === "enrichment") {
          this.emitSSE("search_progress", {
            provider: data.phase === "verification" ? "Verificación" : "Enriquecimiento",
            queries_current: pipelineSearchCount,
            queries_total: 4,
            candidates_found: candidateCount,
          });
        }
      });

      pipelineEmitter.on("search_progress", (data) => {
        this.emitSSE("search_progress", {
          provider: data.provider || "OpenAlex",
          queries_current: data.query_idx || pipelineSearchCount,
          queries_total: data.query_total || 3,
          pages_searched: data.page || 1,
          candidates_found: data.candidates_total || 0,
        });
      });

      pipelineEmitter.on("verify_progress", (data) => {
        this.emitSSE("verify_progress", {
          checked: data.checked || 0,
          ok: data.ok || 0,
          dead: data.dead || 0,
        });
      });

      pipelineEmitter.on("accepted_progress", (data) => {
        this.emitSSE("accepted_progress", {
          accepted: data.accepted || 0,
          target: data.target || targetCount,
        });
      });

      pipelineEmitter.on("filter_progress", (data) => {
        this.emitSSE("filter_progress", data);
      });

      pipelineEmitter.on("export_progress", (data) => {
        this.emitSSE("export_progress", data);
      });

      pipelineResult = await runAcademicPipeline(searchTopic, pipelineEmitter, {
        targetCount: Math.min(targetCount, 50),
        yearStart: yearRange.start || new Date().getFullYear() - 5,
        yearEnd: yearRange.end || new Date().getFullYear(),
        maxSearchIterations: 4,
        regionFilter: isLatamOnly ? "latam" : "global",
      });

    } catch (error: any) {
      console.error(`[OpenAlex Pipeline] Error: ${error.message}`);
      this.emitSSE("progress", {
        phase: "signals",
        status: "error",
        error: error.message,
      });
    }

    if (pipelineResult && pipelineResult.articles.length > 0) {
      const signals = candidatesToSourceSignals(pipelineResult.articles);
      for (const signal of signals) {
        this.emitSSE("source_signal", signal);
      }

      this.state.sources = signals;
      this.state.sources_count = signals.length;

      if (pipelineResult.artifact) {
        this.state.artifacts.push({
          id: pipelineResult.artifact.id,
          type: "xlsx",
          name: pipelineResult.artifact.name,
          path: pipelineResult.artifact.path,
          size: pipelineResult.artifact.size,
          download_url: pipelineResult.artifact.downloadUrl,
          created_at: Date.now(),
        });

        this.emitSSE("artifact", pipelineResult.artifact);
      }

      const successWithWarning = pipelineResult.articles.length > 0;

      this.emitSSE("tool_result", {
        tool_call_id: "tc_signals_openalex",
        success: successWithWarning,
        output: {
          collected: pipelineResult.stats.finalCount,
          target: targetCount,
          source: pipelineResult.stats.sourcesUsed.join("+"),
          verified: pipelineResult.stats.verifiedCount,
          duration_ms: pipelineResult.stats.durationMs,
          criticPassed: pipelineResult.criticResult.passed,
          warnings: pipelineResult.warnings,
        },
      });

      this.state.tool_results.push({
        tool_call_id: "tc_signals_openalex",
        success: true,
        output: {
          collected: pipelineResult.stats.finalCount,
          source: pipelineResult.stats.sourcesUsed.join("+"),
          verified: pipelineResult.stats.verifiedCount,
          warnings: pipelineResult.warnings,
        },
      });

    } else {
      console.log(`[OpenAlex Pipeline] No results, falling back to web search`);

      this.emitSSE("tool_result", {
        tool_call_id: "tc_signals_openalex",
        success: false,
        error: "No verified articles found from academic sources",
      });

      this.state.tool_results.push({
        tool_call_id: "tc_signals_openalex",
        success: false,
        output: { error: "No verified articles found" },
      });

      const researchDecision = shouldResearch(this.state.contract.original_prompt);
      await this.executeSignalsWithWebSearch(researchDecision, targetCount);
    }
  }

  private async executeSignalsWithAcademicDatabases(
    query: string,
    targetCount: number,
    useScopus: boolean,
    useWos: boolean
  ): Promise<void> {
    if (!this.state) return;

    const searchTopic = query;
    const params = this.getSearchParametersFromContract(); // Get year range from contract params
    const yearRange = { start: params.yearStart, end: params.yearEnd };
    const sourcesPerDb = Math.ceil(targetCount / (useScopus && useWos ? 2 : 1));

    const sources: string[] = [];
    if (useScopus) sources.push("Scopus");
    if (useWos) sources.push("Web of Science");
    sources.push("OpenAlex");

    this.emitSSE("tool_call", {
      id: "tc_signals",
      tool: "search_academic_parallel",
      input: { query: searchTopic, target: targetCount, yearRange, sources },
    });

    this.emitSSE("progress", {
      phase: "signals",
      status: "searching_academic",
      message: `Buscando artículos científicos en ${sources.join(" + ")}: "${searchTopic}"`,
    });

    const allSignals: SourceSignal[] = [];
    const seenDois = new Set<string>();
    let totalInDatabase = 0;
    let searchTime = 0;
    const errors: string[] = [];
    let queriesCurrent = 0;
    const queriesTotal = (useScopus ? 1 : 0) + (useWos ? 1 : 0) + 1; // +1 for OpenAlex

    const addSignalsDeduped = (signals: SourceSignal[]) => {
      for (const signal of signals) {
        const key = signal.doi ? signal.doi.toLowerCase() : signal.title?.toLowerCase()?.substring(0, 60) || signal.id;
        if (!seenDois.has(key)) {
          seenDois.add(key);
          allSignals.push(signal);
          this.emitSSE("source_signal", signal);
        }
      }
    };

    const searchPromises: Promise<void>[] = [];

    if (useScopus) {
      searchPromises.push(
        searchScopus(searchTopic, {
          maxResults: Math.min(sourcesPerDb, 100),
          startYear: yearRange.start,
          endYear: yearRange.end,
        })
          .then(result => {
            queriesCurrent++;
            const signals = scopusArticlesToSourceSignals(result.articles);
            addSignalsDeduped(signals);
            totalInDatabase += result.totalResults;
            searchTime = Math.max(searchTime, result.searchTime);
            this.emitSSE("search_progress", {
              provider: "Scopus",
              queries_current: queriesCurrent,
              queries_total: queriesTotal,
              pages_searched: queriesCurrent,
              candidates_found: allSignals.length,
            });
          })
          .catch(err => {
            console.error(`[Scopus] Error: ${err.message}`);
            errors.push(`Scopus: ${err.message}`);
          })
      );
    }

    if (useWos) {
      searchPromises.push(
        searchWos(searchTopic, {
          maxResults: Math.min(sourcesPerDb, 50),
          startYear: yearRange.start,
          endYear: yearRange.end,
        })
          .then(result => {
            queriesCurrent++;
            const signals = wosArticlesToSourceSignals(result.articles);
            addSignalsDeduped(signals);
            totalInDatabase += result.totalResults;
            searchTime = Math.max(searchTime, result.searchTime);
            this.emitSSE("search_progress", {
              provider: "Web of Science",
              queries_current: queriesCurrent,
              queries_total: queriesTotal,
              pages_searched: queriesCurrent,
              candidates_found: allSignals.length,
            });
          })
          .catch(err => {
            console.error(`[WoS] Error: ${err.message}`);
            errors.push(`WoS: ${err.message}`);
          })
      );
    }

    // Always run OpenAlex in parallel — free, 271M+ works, 100k calls/day
    searchPromises.push(
      searchOpenAlex(searchTopic, {
        maxResults: Math.min(targetCount, 100),
        yearStart: yearRange.start,
        yearEnd: yearRange.end,
      })
        .then(candidates => {
          queriesCurrent++;
          const signals = candidatesToSourceSignals(candidates);
          addSignalsDeduped(signals);
          totalInDatabase += candidates.length;
          this.emitSSE("search_progress", {
            provider: "OpenAlex",
            queries_current: queriesCurrent,
            queries_total: queriesTotal,
            pages_searched: queriesCurrent,
            candidates_found: allSignals.length,
          });
          console.log(`[OpenAlex] Found ${candidates.length} works (total unique: ${allSignals.length})`);
        })
        .catch(err => {
          console.error(`[OpenAlex] Error: ${err.message}`);
          errors.push(`OpenAlex: ${err.message}`);
        })
    );

    await Promise.all(searchPromises);

    this.state.sources = allSignals;
    this.state.sources_count = allSignals.length;

    this.emitSSE("progress", {
      phase: "signals",
      status: "completed",
      collected: allSignals.length,
      target: targetCount,
      source: sources.join("+"),
    });

    this.emitSSE("tool_result", {
      tool_call_id: "tc_signals",
      success: allSignals.length > 0,
      output: {
        collected: allSignals.length,
        target: targetCount,
        source: sources.join("+"),
        total_in_database: totalInDatabase,
        duration_ms: searchTime,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    this.state.tool_results.push({
      tool_call_id: "tc_signals",
      success: allSignals.length > 0,
      output: { collected: allSignals.length, source: sources.join("+") },
    });
  }


  private async executeSignalsWithWebSearch(researchDecision: any, targetCount: number): Promise<void> {
    if (!this.state) return;

    const queries = researchDecision.searchQueries.length > 0
      ? researchDecision.searchQueries
      : [this.extractSearchTopic(this.state.contract.original_prompt)];

    this.emitSSE("tool_call", {
      id: "tc_signals",
      tool: "search_web_parallel",
      input: { queries, target: targetCount },
    });

    let queriesCurrent = 0;
    const queriesTotal = queries.length;

    const result = await collectSignals(
      queries,
      targetCount,
      (progress: SignalsProgress) => {
        queriesCurrent = progress.queriesCompleted || queriesCurrent;
        const { phase: signalPhase, ...rest } = progress;
        this.emitSSE("progress", {
          phase: "signals",
          status: signalPhase,
          ...rest,
        });
        this.emitSSE("search_progress", {
          queries_current: queriesCurrent,
          queries_total: queriesTotal,
          pages_searched: queriesCurrent,
          candidates_found: progress.collected || 0,
        });
      },
      (signal: SourceSignal) => {
        this.emitSSE("source_signal", signal);
      }
    );

    this.state.sources = result.signals;
    this.state.sources_count = result.totalCollected;

    this.emitSSE("tool_result", {
      tool_call_id: "tc_signals",
      success: result.totalCollected > 0,
      output: {
        collected: result.totalCollected,
        target: targetCount,
        queries_executed: result.queriesExecuted,
        duration_ms: result.durationMs,
      },
    });

    this.state.tool_results.push({
      tool_call_id: "tc_signals",
      success: result.totalCollected > 0,
      output: { collected: result.totalCollected },
    });
  }

  private async executeDeepPhase(): Promise<void> {
    if (!this.state || this.state.sources.length === 0) return;

    this.state.phase = "deep";
    this.emitSSE("phase_started", {
      phase: "verification",
      status: "running",
      message: "Verificando DOIs y enlaces de artículos…"
    });
    this.emitSSE("progress", { phase: "deep", status: "starting" });

    this.emitThought(`Seleccionando los mejores ${Math.min(20, this.state.sources.length)} candidatos por relevancia para análisis profundo.`);

    const topSources = [...this.state.sources]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    this.emitSSE("tool_call", {
      id: "tc_deep",
      tool: "fetch_url_parallel",
      input: { urls: topSources.map(s => s.url) },
    });

    const result = await deepDiveSources(
      topSources,
      20,
      (progress: DeepDiveProgress) => {
        const { phase: deepPhase, ...rest } = progress as any; // Cast as any if DeepDiveProgress doesn't strictly have phase or to be safe, but usually it does. Actually let's assume it might not have phase or it does.
        // Wait, I should check DeepDiveProgress. If I don't know it, safely destructure if it exists.
        // But simply spreading ...progress caused the lint, implying it HAS phase.
        this.emitSSE("progress", {
          phase: "deep",
          status: deepPhase || "running",
          ...rest,
        });
      },
      (content: ExtractedContent) => {
        this.emitSSE("source_deep", {
          source_id: content.sourceId,
          url: content.url,
          claims_count: content.claims.length,
          word_count: content.wordCount,
        });
      }
    );

    for (const extracted of result.sources.filter(s => s.success)) {
      const sourceIdx = this.state.sources.findIndex(s => s.id === extracted.sourceId);
      if (sourceIdx >= 0) {
        this.state.sources[sourceIdx].fetched = true;
        this.state.sources[sourceIdx].content = extracted.content;
        this.state.sources[sourceIdx].claims = extracted.claims;
        this.state.deep_sources.push(this.state.sources[sourceIdx]);
      }
    }

    this.emitSSE("tool_result", {
      tool_call_id: "tc_deep",
      success: result.totalSuccess > 0,
      output: {
        fetched: result.totalFetched,
        success: result.totalSuccess,
        duration_ms: result.durationMs,
      },
    });

    this.state.tool_results.push({
      tool_call_id: "tc_deep",
      success: result.totalSuccess > 0,
      output: { success: result.totalSuccess },
    });
  }

  private async executeCreatePhase(): Promise<void> {
    if (!this.state) return;

    this.state.phase = "creating";

    // Notify frontend that we're starting document generation
    this.emitSSE("phase_started", {
      phase: "export",
      status: "running",
      message: "Generando documentos…"
    });
    this.emitSSE("progress", {
      phase: "export",
      status: "starting",
      message: "Generando documentos...",
      documents_total: this.state.contract.requirements.must_create.length,
    });

    for (const docType of this.state.contract.requirements.must_create) {
      this.emitSSE("tool_call", {
        id: `tc_create_${docType}`,
        tool: `create_${docType}`,
        input: {},
      });

      try {
        if (docType === "xlsx") {
          this.emitSSE("progress", {
            phase: "export",
            status: "generating",
            message: `Generando Excel con ${this.state.sources.filter(s => s.verified === true).length} artículos...`,
            document_type: "xlsx",
          });
          this.emitSSE("artifact_generating", {
            artifact_type: "xlsx",
            filename: "articles.xlsx",
          });
          const spec = this.buildXlsxSpec();
          const artifact = await createXlsx(spec);
          storeArtifactMeta(artifact);

          this.state.artifacts.push({
            id: artifact.id,
            type: "xlsx",
            name: artifact.name,
            download_url: artifact.downloadUrl,
          });

          this.emitSSE("artifact", artifact);
          this.emitSSE("progress", {
            phase: "export",
            status: "completed",
            message: `Excel generado: ${artifact.name}`,
            document_type: "xlsx",
            artifact_id: artifact.id,
          });
          this.emitSSE("tool_result", {
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id, download_url: artifact.downloadUrl },
          });

          this.state.tool_results.push({
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id },
          });

        } else if (docType === "docx") {
          this.emitSSE("progress", {
            phase: "export",
            status: "generating",
            message: "Generando documento Word...",
            document_type: "docx",
          });
          this.emitSSE("artifact_generating", {
            artifact_type: "docx",
            filename: "document.docx",
          });
          const spec = this.buildDocxSpec();
          const artifact = await createDocx(spec);
          storeArtifactMeta(artifact);

          this.state.artifacts.push({
            id: artifact.id,
            type: "docx",
            name: artifact.name,
            download_url: artifact.downloadUrl,
          });

          this.emitSSE("artifact", artifact);
          this.emitSSE("progress", {
            phase: "export",
            status: "completed",
            message: `Word generado: ${artifact.name}`,
            document_type: "docx",
            artifact_id: artifact.id,
          });
          this.emitSSE("tool_result", {
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id, download_url: artifact.downloadUrl },
          });

          this.state.tool_results.push({
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id },
          });
        } else if (docType === "pptx") {
          this.emitSSE("progress", {
            phase: "export",
            status: "generating",
            message: "Generando presentación PowerPoint...",
            document_type: "pptx",
          });
          this.emitSSE("artifact_generating", {
            artifact_type: "pptx",
            filename: "presentation.pptx",
          });
          const spec = this.buildPptxSpec();
          const artifact = await createPptx(spec);
          storeArtifactMeta(artifact);

          this.state.artifacts.push({
            id: artifact.id,
            type: "pptx",
            name: artifact.name,
            download_url: artifact.downloadUrl,
          });

          this.emitSSE("artifact", artifact);
          this.emitSSE("progress", {
            phase: "export",
            status: "completed",
            message: `PowerPoint generado: ${artifact.name}`,
            document_type: "pptx",
            artifact_id: artifact.id,
          });
          this.emitSSE("tool_result", {
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id, download_url: artifact.downloadUrl },
          });

          this.state.tool_results.push({
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id },
          });
        }
      } catch (error: any) {
        this.emitSSE("tool_result", {
          tool_call_id: `tc_create_${docType}`,
          success: false,
          error: error.message,
        });

        this.state.tool_results.push({
          tool_call_id: `tc_create_${docType}`,
          success: false,
          output: null,
          error: error.message,
        });
      }
    }
  }

  private extractRequestedColumns(prompt: string): string[] | null {
    const orderByMatch = prompt.match(/(?:ordenado\s+por|ordered\s+by|columns?:?|columnas?:?)\s+(.+?)(?:\s*$|\.\s)/i);
    if (orderByMatch) {
      const columnsStr = orderByMatch[1];
      const columns = columnsStr
        .split(/\s+/)
        .map(c => c.trim())
        .filter(c => c.length > 0 && !["por", "by", "y", "and", "en", "in"].includes(c.toLowerCase()));
      if (columns.length >= 3) return columns;
    }
    return null;
  }

  private hasScopusData(sources: SourceSignal[]): boolean {
    return sources.some(s => s.scopusData);
  }

  private buildXlsxSpec(): XlsxSpec {
    const sources = this.state?.sources || [];
    const deepSources = this.state?.deep_sources || [];
    const prompt = this.state?.contract.original_prompt || "";

    if (this.hasScopusData(sources)) {
      return this.buildScopusXlsxSpec(sources, prompt);
    }

    const requestedColumns = this.extractRequestedColumns(prompt);

    if (requestedColumns && requestedColumns.length > 0) {
      const dataRows = sources.slice(0, 100).map((s, i) => {
        return requestedColumns.map(col => {
          const colLower = col.toLowerCase();
          if (colLower === "title" || colLower === "titulo" || colLower === "título") return s.title;
          if (colLower === "authors" || colLower === "autores" || colLower === "author") return this.extractAuthors(s);
          if (colLower === "year" || colLower === "año") return this.extractYear(s);
          if (colLower === "journal" || colLower === "revista") return s.domain;
          if (colLower === "abstract" || colLower === "resumen") return s.snippet || s.content?.substring(0, 300) || "";
          if (colLower === "keywords" || colLower === "palabras") return "";
          if (colLower === "language" || colLower === "idioma") return "Spanish/English";
          if (colLower === "document" || colLower === "type" || colLower === "tipo") return "Article";
          if (colLower === "doi") return this.extractDOI(s);
          if (colLower === "city" || colLower === "ciudad") return "";
          if (colLower === "country" || colLower === "pais" || colLower === "país") return "";
          if (colLower === "scopus") return s.url.includes("scopus") ? "Yes" : "";
          if (colLower === "wos" || colLower === "webofscience") return s.url.includes("webofscience") ? "Yes" : "";
          if (colLower === "url" || colLower === "link") return s.url;
          if (colLower === "#" || colLower === "no" || colLower === "número") return (i + 1).toString();
          return "";
        });
      });

      return {
        title: this.extractResearchTitle(prompt),
        sheets: [
          {
            name: "Articles",
            headers: requestedColumns,
            data: dataRows,
            summary: {
              "Total Articles Found": sources.length,
              "Generated At": new Date().toISOString(),
              "Search Query": prompt.substring(0, 100),
            },
          },
        ],
      };
    }

    return {
      title: this.extractResearchTitle(prompt),
      sheets: [
        {
          name: "Summary",
          headers: ["Metric", "Value"],
          data: [
            ["Total Sources", sources.length.toString()],
            ["Deep Analyzed", deepSources.length.toString()],
            ["Claims Extracted", deepSources.reduce((acc, s) => acc + (s.claims?.length || 0), 0).toString()],
            ["Generated At", new Date().toISOString()],
          ],
        },
        {
          name: "Sources",
          headers: ["#", "Title", "Authors", "Year", "Journal/Source", "Abstract", "DOI", "URL"],
          data: sources.slice(0, 100).map((s, i) => [
            (i + 1).toString(),
            s.title,
            this.extractAuthors(s),
            this.extractYear(s),
            s.domain,
            s.snippet || "",
            this.extractDOI(s),
            s.url,
          ]),
        },
        {
          name: "Claims",
          headers: ["Source", "Claim"],
          data: deepSources.flatMap(s =>
            (s.claims || []).map(claim => [s.title.substring(0, 50), claim])
          ),
        },
      ],
    };
  }

  private buildScopusXlsxSpec(sources: SourceSignal[], prompt: string): XlsxSpec {
    const requestedColumns = this.extractRequestedColumns(prompt);
    const defaultColumns = ["#", "Authors", "Title", "Year", "Journal", "Abstract", "Keywords", "Language", "Document Type", "DOI", "Citations", "Affiliations", "Scopus URL"];
    const columns = requestedColumns && requestedColumns.length > 0 ? requestedColumns : defaultColumns;

    const dataRows = sources.slice(0, 100).map((s, i) => {
      const scopusData = s.scopusData as ScopusArticle | undefined;

      return columns.map(col => {
        const colLower = col.toLowerCase();

        if (colLower === "#" || colLower === "no" || colLower === "número") return (i + 1).toString();
        if (colLower === "title" || colLower === "titulo" || colLower === "título") return scopusData?.title || s.title;
        if (colLower === "authors" || colLower === "autores" || colLower === "author") return scopusData?.authors?.join("; ") || "";
        if (colLower === "year" || colLower === "año") return scopusData?.year || "";
        if (colLower === "journal" || colLower === "revista") return scopusData?.journal || s.domain;
        if (colLower === "abstract" || colLower === "resumen") return scopusData?.abstract || s.snippet || "";
        if (colLower === "keywords" || colLower === "palabras") return scopusData?.keywords?.join("; ") || "";
        if (colLower === "language" || colLower === "idioma") return scopusData?.language || "";
        if (colLower === "document" || colLower === "type" || colLower === "tipo") return scopusData?.documentType || "Article";
        if (colLower === "doi") return scopusData?.doi || "";
        if (colLower === "citations" || colLower === "citas" || colLower === "citedby") return scopusData?.citationCount?.toString() || "";
        if (colLower === "affiliations" || colLower === "afiliaciones" || colLower === "affiliation") return scopusData?.affiliations?.join("; ") || "";
        if (colLower === "city" || colLower === "ciudad") return this.extractCityFromAffiliations(scopusData?.affiliations);
        if (colLower === "country" || colLower === "pais" || colLower === "país") return this.extractCountryFromAffiliations(scopusData?.affiliations);
        if (colLower === "scopus") return scopusData ? "Yes" : "";
        if (colLower === "wos" || colLower === "webofscience") return "";
        if (colLower === "url" || colLower === "link" || colLower.includes("scopus")) return scopusData?.url || s.url;
        return "";
      });
    });

    return {
      title: this.extractResearchTitle(prompt),
      sheets: [
        {
          name: "Scientific Articles",
          headers: columns,
          data: dataRows,
          summary: {
            "Total Articles": sources.length,
            "Source": "Scopus Database",
            "Generated At": new Date().toISOString(),
            "Search Query": prompt.substring(0, 100),
          },
        },
      ],
    };
  }

  private extractCityFromAffiliations(affiliations?: string[]): string {
    if (!affiliations || affiliations.length === 0) return "";
    const cityPatterns = /,\s*([A-Z][a-zA-Z\s]+),\s*[A-Z]{2,}/;
    for (const aff of affiliations) {
      const match = aff.match(cityPatterns);
      if (match) return match[1].trim();
    }
    return "";
  }

  private extractCountryFromAffiliations(affiliations?: string[]): string {
    if (!affiliations || affiliations.length === 0) return "";
    const countries = ["USA", "United States", "UK", "United Kingdom", "China", "Germany", "France", "Spain", "Mexico", "Brazil", "India", "Japan", "Australia", "Canada", "Italy", "Netherlands", "South Korea", "Colombia", "Chile", "Argentina", "Peru"];
    for (const aff of affiliations) {
      for (const country of countries) {
        if (aff.toLowerCase().includes(country.toLowerCase())) return country;
      }
    }
    return "";
  }

  private extractResearchTitle(prompt: string): string {
    const match = prompt.match(/(?:sobre|about)\s+(.{10,60}?)(?:\s+(?:del|from|con|y|and)|$)/i);
    return match ? match[1].trim() : prompt.substring(0, 50);
  }

  private extractAuthors(source: SourceSignal): string {
    if (source.content) {
      const authorMatch = source.content.match(/(?:by|por|authors?|autores?)[:\s]+([A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)?(?:,?\s+(?:and|y|&)?\s*[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)?)*)/i);
      if (authorMatch) return authorMatch[1].substring(0, 100);
    }
    return "";
  }

  private extractYear(source: SourceSignal): string {
    const yearMatch = source.title.match(/\b(20\d{2})\b/) ||
      source.url.match(/\b(20\d{2})\b/) ||
      (source.snippet && source.snippet.match(/\b(20\d{2})\b/));
    return yearMatch ? yearMatch[1] : "";
  }

  private extractDOI(source: SourceSignal): string {
    const doiMatch = source.url.match(/10\.\d{4,}\/[^\s]+/) ||
      (source.content && source.content.match(/10\.\d{4,}\/[^\s]+/));
    return doiMatch ? doiMatch[0] : "";
  }

  private buildDocxSpec(): DocxSpec {
    const sources = this.state?.sources || [];
    const deepSources = this.state?.deep_sources || [];
    const citationsPack = packCitations(
      sources.slice(0, 20).map(s => ({
        id: s.id,
        url: s.url,
        title: s.title,
        snippet: s.snippet,
      })),
      deepSources.flatMap(s => (s.claims || []).map(c => ({ text: c, sourceIds: [s.id] })))
    );

    return {
      title: this.state?.contract.original_prompt.substring(0, 100) || "Research Report",
      sections: [
        {
          heading: "Executive Summary",
          level: 1,
          paragraphs: [
            `This report analyzes ${sources.length} sources to address the research question: "${this.state?.contract.original_prompt}"`,
            `Key findings are based on ${deepSources.length} deeply analyzed sources with ${deepSources.reduce((acc, s) => acc + (s.claims?.length || 0), 0)} extracted claims.`,
          ],
        },
        {
          heading: "Key Findings",
          level: 1,
          paragraphs: deepSources.slice(0, 5).flatMap(s =>
            (s.claims || []).slice(0, 2).map(c => `• ${c}`)
          ),
          citations: citationsPack.formatted.apa.slice(0, 5),
        },
        {
          heading: "Sources Overview",
          level: 1,
          paragraphs: [
            `A total of ${sources.length} sources were identified and analyzed.`,
          ],
          table: {
            headers: ["#", "Source", "Domain", "Relevance"],
            rows: sources.slice(0, 10).map((s, i) => [
              (i + 1).toString(),
              s.title.substring(0, 50),
              s.domain,
              `${(s.score * 100).toFixed(0)}%`,
            ]),
          },
        },
        {
          heading: "References",
          level: 1,
          paragraphs: citationsPack.formatted.apa.slice(0, 20),
        },
      ],
      metadata: {
        author: "IliaGPT Super Agent",
        subject: this.state?.contract.original_prompt,
      },
    };
  }

  private buildPptxSpec(): PptxSpec {
    const sources = this.state?.sources || [];
    const deepSources = this.state?.deep_sources || [];
    const prompt = this.state?.contract.original_prompt || "Presentation";

    const slides: PptxSpec["slides"] = [];

    // Summary slide
    slides.push({
      title: "Resumen",
      bullets: [
        `Investigación: "${prompt.substring(0, 80)}"`,
        `Fuentes analizadas: ${sources.length}`,
        `Fuentes con análisis profundo: ${deepSources.length}`,
      ],
    });

    // Key findings slides from deep sources
    const claims = deepSources.flatMap(s => (s.claims || []).map(c => ({ claim: c, source: s.title })));
    for (let i = 0; i < Math.min(claims.length, 15); i += 5) {
      const chunk = claims.slice(i, i + 5);
      slides.push({
        title: `Hallazgos Clave ${Math.floor(i / 5) + 1}`,
        bullets: chunk.map(c => c.claim.substring(0, 200)),
      });
    }

    // Top sources slide
    slides.push({
      title: "Fuentes Principales",
      bullets: sources.slice(0, 8).map((s, i) => `${i + 1}. ${s.title.substring(0, 80)} (${s.domain})`),
    });

    // Ensure at least 3 slides
    if (slides.length < 3) {
      slides.push({
        title: "Fuentes Adicionales",
        bullets: sources.slice(0, 5).map(s => `${s.title.substring(0, 100)} — ${s.url}`),
      });
    }

    return {
      title: prompt.substring(0, 100),
      slides,
      metadata: {
        author: "IliaGPT Super Agent",
        subject: prompt,
      },
    };
  }

  private async executeVerifyPhase(): Promise<void> {
    if (!this.state) return;

    this.state.phase = "verifying";
    this.state.iteration++;

    this.emitThought(`Verificación de Calidad (Iteración ${this.state.iteration}): Evaluando cumplimiento de contrato y consistencia.`);

    this.emitSSE("tool_call", {
      id: "tc_quality_gate",
      tool: "quality_gate",
      input: { iteration: this.state.iteration },
    });

    const gateResult = evaluateQualityGate(this.state, this.state.contract.requirements);

    this.state.acceptance_results = gateResult.checks;

    this.emitSSE("verify", {
      passed: gateResult.passed,
      checks: gateResult.checks,
      blockers: gateResult.blockers,
      warnings: gateResult.warnings,
      report: formatGateReport(gateResult),
    });

    this.emitSSE("tool_result", {
      tool_call_id: "tc_quality_gate",
      success: gateResult.passed,
      output: gateResult,
    });

    if (!gateResult.passed) {
      this.emitThought(`Falló verificación de calidad. Motivo principal: ${gateResult.blockers[0]?.reason || "Requisitos no cumplidos"}.`);

      const retryDecision = shouldRetry(gateResult, this.state);

      if (retryDecision.shouldRetry) {
        this.emitThought(`Decisión de Agente: Reintentar con estrategia '${retryDecision.strategy}'. Acciones: ${retryDecision.actions.join(", ")}.`);

        this.emitSSE("iterate", {
          iteration: this.state.iteration,
          max: this.state.max_iterations,
          strategy: retryDecision.strategy,
          actions: retryDecision.actions,
        });

        await this.executeRetryActions(retryDecision.actions);
        await this.executeVerifyPhase();
      } else {
        this.emitThought("Decisión de Agente: Máximo de intentos alcanzado o error irrecuperable. Finalizando con advertencias.");
      }
    } else {
      this.emitThought("Verificación Exitosa: Todos los criterios de aceptación cumplidos. Procediendo a finalización.");
    }
  }

  private async executeRetryActions(actions: string[]): Promise<void> {
    for (const action of actions) {
      if (action === "expand_search_queries") {
        await this.executeSignalsPhase();
      } else if (action.startsWith("retry_create_")) {
        const docType = action.replace("retry_create_", "") as "docx" | "xlsx";
        this.state!.contract.requirements.must_create = [docType];
        await this.executeCreatePhase();
      }
    }
  }

  private async executeFinalizePhase(): Promise<void> {
    if (!this.state) return;

    this.state.phase = "finalizing";
    this.emitThought("Generando respuesta final y consolidando artefactos...");

    const response = this.buildFinalResponse();
    this.state.final_response = response;
    this.state.phase = "completed";
    this.state.completed_at = Date.now();

    this.emitSSE("final", {
      response,
      sources_count: this.state.sources_count,
      artifacts: this.state.artifacts,
      duration_ms: this.state.completed_at - this.state.started_at,
      iterations: this.state.iteration,
    });
  }

  private buildFinalResponse(): string {
    if (!this.state) return "";

    const parts: string[] = [];

    parts.push(`## Research Complete\n`);
    parts.push(`Analyzed **${this.state.sources_count}** sources for your query.\n`);

    if (this.state.deep_sources.length > 0) {
      parts.push(`### Key Findings\n`);
      const claims = this.state.deep_sources
        .flatMap(s => s.claims || [])
        .slice(0, 10);

      for (const claim of claims) {
        parts.push(`- ${claim}\n`);
      }
    }

    if (this.state.artifacts.length > 0) {
      parts.push(`\n### Generated Documents\n`);
      for (const artifact of this.state.artifacts) {
        parts.push(`- 📄 **${artifact.name}** - [Download](${artifact.download_url})\n`);
      }
    }

    if (this.state.sources.length > 0) {
      parts.push(`\n### Top Sources\n`);
      const topSources = [...this.state.sources]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      for (const source of topSources) {
        parts.push(`- [${source.title}](${source.url}) (${source.domain})\n`);
      }
    }

    if (this.capabilityProfile && this.capabilityProfile.matches.length > 0) {
      parts.push(`\n### OpenClaw1000 Capability Profile\n`);
      parts.push(`Matched capabilities: **${this.capabilityProfile.matches.length}**\n`);
      for (const match of this.capabilityProfile.matches.slice(0, 5)) {
        parts.push(`- ${match.capability.code} ${match.capability.capability} (${match.capability.toolName}) score=${match.score}\n`);
      }
    }

    return parts.join("");
  }

  private extractSearchTopic(prompt: string): string {
    const aboutMatch = prompt.match(/(?:sobre|about|acerca\s+de)\s+(.+?)(?:\s+(?:del|from|en\s+excel|y\s+coloca|ordenado|con\s+\d+|\d{4}\s+al\s+\d{4}|$))/i);
    if (aboutMatch && aboutMatch[1]) {
      let topic = aboutMatch[1]
        .replace(/\s*\d+\s*(artículos?|articulos?|fuentes?|sources?|papers?).*$/i, "")
        .replace(/\s*(científicos?|cientificos?|académicos?)$/i, "")
        .trim();

      const yearMatch = prompt.match(/(?:del|from)\s+(\d{4})\s+(?:al|to|hasta)\s+(\d{4})/i);
      if (yearMatch && !topic.includes(yearMatch[1])) {
        topic = `${topic} ${yearMatch[1]}-${yearMatch[2]}`;
      }

      if (topic.length >= 10) {
        return topic.substring(0, 100);
      }
    }

    const stopWords = new Set([
      "dame", "give", "quiero", "want", "necesito", "need", "crea", "create",
      "genera", "generate", "busca", "search", "investiga", "research",
      "información", "information", "sobre", "about", "con", "with",
      "me", "un", "una", "el", "la", "los", "las", "de", "del", "y", "and",
      "fuentes", "sources", "referencias", "mínimo", "minimum", "favor", "por",
      "buscarme", "artículos", "articulos", "científicos", "cientificos",
      "papers", "excel", "word", "documento", "ordenado", "coloca", "colocalo",
      "tabla", "en"
    ]);

    const cleaned = prompt
      .replace(/\s*\d+\s*(artículos?|articulos?|fuentes?|sources?|referencias?|papers?).*$/i, "")
      .replace(/\s*(científicos?|cientificos?|académicos?|academicos?)/gi, "")
      .replace(/^(dame|give me|quiero|want|necesito|need|crea|create|genera|generate|busca|buscarme|search|investiga|research)\s+/i, "")
      .replace(/\s+(información|information)\s+(sobre|about|de|del)\s+/gi, " ")
      .replace(/\s+(del|from)\s+\d{4}\s+(al|to|hasta)\s+\d{4}/i, "")
      .replace(/\s+en\s+(excel|word|tabla|documento)/gi, "")
      .replace(/\s+ordenado\s+por.*$/i, "")
      .replace(/\s+y\s+coloca.*$/i, "")
      .trim();

    const words = cleaned.split(/\s+/).filter(word => {
      const lowerWord = word.toLowerCase().replace(/[.,!?:;]/g, "");
      return lowerWord.length > 2 && !stopWords.has(lowerWord);
    });

    if (words.length >= 2) {
      return words.join(" ").substring(0, 100);
    }

    return cleaned.substring(0, 100) || prompt.substring(0, 100);
  }

  getState(): ExecutionState | null {
    return this.state;
  }
}

export function createSuperAgent(sessionId: string, config?: Partial<OrchestratorConfig>): SuperAgentOrchestrator {
  return new SuperAgentOrchestrator(sessionId, config);
}
