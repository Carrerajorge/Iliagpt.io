import { z } from "zod";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { llmGateway } from "../../lib/llmGateway";
import { memoryStore, type ConversationMemory } from "../langgraph/memory";
import { 
  detectIntent as classifyIntent, 
  type IntentType, 
  type SpecializedAgent,
  type AttachmentSpec,
  IntentTypeSchema,
  SpecializedAgentSchema
} from "../requestSpec";
import { policyEngine, type PolicyCheckResult } from "../policyEngine";

export const DeliverableTypeEnum = z.enum([
  "document",
  "presentation",
  "spreadsheet",
  "code",
  "research",
  "image",
  "data_analysis",
  "text_response"
]);
export type DeliverableType = z.infer<typeof DeliverableTypeEnum>;

export const DeliverableSpecSchema = z.object({
  id: z.string().uuid(),
  type: DeliverableTypeEnum,
  format: z.string().optional(),
  requirements: z.array(z.string()).default([]),
  priority: z.number().int().min(1).max(10).default(5),
  estimatedComplexity: z.enum(["low", "medium", "high"]).default("medium"),
  metadata: z.record(z.any()).optional()
});
export type DeliverableSpec = z.infer<typeof DeliverableSpecSchema>;

export const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.number().optional(),
  metadata: z.record(z.any()).optional()
});
export type Message = z.infer<typeof MessageSchema>;

export const ConversationContextSchema = z.object({
  messages: z.array(MessageSchema).default([]),
  attachments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    storagePath: z.string().optional(),
    size: z.number().optional(),
    extractedContent: z.string().optional(),
    metadata: z.record(z.any()).optional()
  })).default([]),
  sessionId: z.string(),
  userId: z.string().optional(),
  chatId: z.string().optional(),
  runId: z.string().optional()
});
export type ConversationContext = z.infer<typeof ConversationContextSchema>;

export const MemoryFactSchema = z.object({
  key: z.string(),
  value: z.string(),
  source: z.enum(["user", "system", "inferred"]),
  confidence: z.number().min(0).max(1).default(1),
  timestamp: z.number()
});
export type MemoryFact = z.infer<typeof MemoryFactSchema>;

export const PreviousActionSchema = z.object({
  actionType: z.string(),
  toolName: z.string().optional(),
  summary: z.string(),
  success: z.boolean(),
  timestamp: z.number(),
  outputArtifact: z.string().optional()
});
export type PreviousAction = z.infer<typeof PreviousActionSchema>;

export const MemoryContextSchema = z.object({
  facts: z.array(MemoryFactSchema).default([]),
  previousActions: z.array(PreviousActionSchema).default([]),
  workingContext: z.record(z.any()).default({}),
  relevantTurns: z.number().default(0),
  lastAccessedAt: z.number()
});
export type MemoryContext = z.infer<typeof MemoryContextSchema>;

export const ComplexityLevelSchema = z.enum(["trivial", "simple", "moderate", "complex", "expert"]);
export type ComplexityLevel = z.infer<typeof ComplexityLevelSchema>;

export const AnalysisResultSchema = z.object({
  id: z.string().uuid(),
  intent: IntentTypeSchema,
  intentConfidence: z.number().min(0).max(1),
  deliverables: z.array(DeliverableSpecSchema).default([]),
  complexity: ComplexityLevelSchema,
  suggestedAgents: z.array(SpecializedAgentSchema).min(1),
  primaryAgent: SpecializedAgentSchema,
  memoryContext: MemoryContextSchema.optional(),
  extractedEntities: z.record(z.any()).optional(),
  policyValidation: z.object({
    valid: z.boolean(),
    violations: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([])
  }).optional(),
  rawMessage: z.string(),
  analyzedAt: z.number(),
  metadata: z.record(z.any()).optional()
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  violations: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  blockedTools: z.array(z.string()).default([]),
  requiredConfirmations: z.array(z.string()).default([])
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

const INTENT_TO_DELIVERABLE: Record<IntentType, DeliverableType> = {
  chat: "text_response",
  research: "research",
  document_analysis: "text_response",
  document_generation: "document",
  data_analysis: "data_analysis",
  code_generation: "code",
  web_automation: "text_response",
  image_generation: "image",
  presentation_creation: "presentation",
  spreadsheet_creation: "spreadsheet",
  multi_step_task: "text_response",
  unknown: "text_response"
};

const INTENT_TO_AGENTS: Record<IntentType, SpecializedAgent[]> = {
  chat: ["content"],
  research: ["research", "browser"],
  document_analysis: ["document", "data"],
  document_generation: ["content", "document"],
  data_analysis: ["data", "code"],
  code_generation: ["code", "qa"],
  web_automation: ["browser", "research"],
  image_generation: ["content"],
  presentation_creation: ["content", "document"],
  spreadsheet_creation: ["data", "document"],
  multi_step_task: ["orchestrator"],
  unknown: ["content"]
};

const COMPLEXITY_KEYWORDS: Record<ComplexityLevel, RegExp[]> = {
  trivial: [/^(hi|hello|hey|thanks|ok|yes|no)$/i],
  simple: [
    /\b(what is|who is|define|explain briefly)\b/i,
    /\b(simple|quick|short)\b/i
  ],
  moderate: [
    /\b(analyze|summarize|compare|create|generate)\b/i,
    /\b(document|presentation|report)\b/i
  ],
  complex: [
    /\b(research|investigate|develop|implement|build)\b/i,
    /\b(comprehensive|detailed|in-depth|thorough)\b/i,
    /\b(multiple|several|various)\b.*\b(steps?|phases?|stages?)\b/i
  ],
  expert: [
    /\b(architect|design system|enterprise|production-grade)\b/i,
    /\b(security audit|performance optimization|scalability)\b/i
  ]
};

const LLM_ANALYSIS_PROMPT = `You are an expert intent analyzer for an AI assistant system. Analyze the user message and extract structured information.

Given the user message and conversation context, provide a JSON response with:
1. "intent": The primary intent (one of: chat, research, document_analysis, document_generation, data_analysis, code_generation, web_automation, image_generation, presentation_creation, spreadsheet_creation, multi_step_task)
2. "confidence": Confidence score from 0.0 to 1.0
3. "deliverables": Array of deliverable specifications with type, format, and requirements
4. "complexity": Complexity level (trivial, simple, moderate, complex, expert)
5. "entities": Extracted entities like topics, file types, quantities, deadlines
6. "suggestedTools": Array of tool names that might be needed

Respond ONLY with valid JSON, no markdown or explanation.`;

export type PromptAnalyzerEvent = 
  | "analysis_started"
  | "intent_detected"
  | "deliverables_extracted"
  | "memory_hydrated"
  | "policy_validated"
  | "analysis_completed"
  | "analysis_failed";

export interface PromptAnalyzerOptions {
  enableLLMAnalysis?: boolean;
  maxMemoryTurns?: number;
  policyStrictMode?: boolean;
  timeout?: number;
}

export class PromptAnalyzer extends EventEmitter {
  private options: Required<PromptAnalyzerOptions>;
  
  constructor(options: PromptAnalyzerOptions = {}) {
    super();
    this.options = {
      enableLLMAnalysis: options.enableLLMAnalysis ?? true,
      maxMemoryTurns: options.maxMemoryTurns ?? 10,
      policyStrictMode: options.policyStrictMode ?? false,
      timeout: options.timeout ?? 30000
    };
    this.setMaxListeners(50);
  }

  async analyze(
    message: string, 
    context: ConversationContext
  ): Promise<AnalysisResult> {
    const analysisId = randomUUID();
    const startTime = Date.now();
    
    this.emitEvent("analysis_started", { analysisId, message: message.slice(0, 100) });
    
    try {
      const validatedContext = ConversationContextSchema.parse(context);
      
      const hasAttachments = validatedContext.attachments.length > 0;
      const { intent, confidence } = classifyIntent(message, validatedContext.attachments as AttachmentSpec[]);
      
      this.emitEvent("intent_detected", { 
        analysisId, 
        intent, 
        confidence,
        method: "rule_based"
      });

      let enhancedIntent = intent;
      let enhancedConfidence = confidence;
      let extractedEntities: Record<string, any> = {};
      let llmDeliverables: DeliverableSpec[] = [];

      if (this.options.enableLLMAnalysis && confidence < 0.85) {
        try {
          const llmAnalysis = await this.performLLMAnalysis(message, validatedContext);
          if (llmAnalysis) {
            if (llmAnalysis.confidence > enhancedConfidence) {
              enhancedIntent = llmAnalysis.intent;
              enhancedConfidence = llmAnalysis.confidence;
            }
            extractedEntities = llmAnalysis.entities || {};
            llmDeliverables = llmAnalysis.deliverables || [];
            
            this.emitEvent("intent_detected", {
              analysisId,
              intent: enhancedIntent,
              confidence: enhancedConfidence,
              method: "llm_enhanced"
            });
          }
        } catch (llmError: any) {
          console.warn(`[PromptAnalyzer] LLM analysis failed, using rule-based: ${llmError.message}`);
        }
      }

      const deliverables = llmDeliverables.length > 0
        ? llmDeliverables
        : await this.extractDeliverables(message, enhancedIntent);
      const normalizedDeliverables = this.normalizeDeliverables(deliverables);
      const dedupedDeliverables = this.dedupeDeliverables(normalizedDeliverables);
      
      this.emitEvent("deliverables_extracted", {
        analysisId, 
        count: dedupedDeliverables.length,
        types: dedupedDeliverables.map(d => d.type)
      });

      const memoryContext = await this.hydrateMemory(
        validatedContext.sessionId, 
        validatedContext.runId
      );
      
      this.emitEvent("memory_hydrated", {
        analysisId,
        factsCount: memoryContext.facts.length,
        actionsCount: memoryContext.previousActions.length
      });

      const multiIntent = this.detectMultiIntent(message);
      const attachmentSummary = this.summarizeAttachments(validatedContext.attachments);
      const clarificationsNeeded = this.detectMissingRequirements(message, dedupedDeliverables);
      const complexity = this.assessComplexity(message, dedupedDeliverables, memoryContext, {
        attachmentCount: attachmentSummary.count,
        hasExtractedContent: attachmentSummary.hasExtractedContent,
        isMultiIntent: multiIntent.isMultiIntent
      });
      const suggestedAgents = this.determineSuggestedAgents(
        enhancedIntent,
        dedupedDeliverables,
        complexity,
        clarificationsNeeded.length > 0
      );
      const executionHints = this.buildExecutionHints({
        complexity,
        deliverables: dedupedDeliverables,
        hasAttachments: attachmentSummary.count > 0,
        clarificationsCount: clarificationsNeeded.length,
        multiIntent,
        memoryContext
      });

      const analysisResult: AnalysisResult = {
        id: analysisId,
        intent: enhancedIntent,
        intentConfidence: enhancedConfidence,
        deliverables: dedupedDeliverables,
        complexity,
        suggestedAgents,
        primaryAgent: suggestedAgents[0],
        memoryContext,
        extractedEntities,
        rawMessage: message,
        analyzedAt: Date.now(),
        metadata: {
          hasAttachments,
          attachmentCount: validatedContext.attachments.length,
          attachmentSummary,
          multiIntent,
          clarificationsNeeded,
          requiresClarification: clarificationsNeeded.length > 0,
          executionHints,
          deliverablesRawCount: deliverables.length,
          deliverablesDedupedCount: dedupedDeliverables.length,
          messageLength: message.length,
          analysisTimeMs: Date.now() - startTime
        }
      };

      const policyValidation = this.validateAgainstPolicy(analysisResult, validatedContext.userId);
      analysisResult.policyValidation = policyValidation;
      
      this.emitEvent("policy_validated", {
        analysisId,
        valid: policyValidation.valid,
        violationsCount: policyValidation.violations.length
      });

      this.emitEvent("analysis_completed", {
        analysisId,
        intent: enhancedIntent,
        confidence: enhancedConfidence,
        complexity,
        primaryAgent: analysisResult.primaryAgent,
        timeMs: Date.now() - startTime
      });

      return AnalysisResultSchema.parse(analysisResult);
      
    } catch (error: any) {
      this.emitEvent("analysis_failed", {
        analysisId,
        error: error.message,
        timeMs: Date.now() - startTime
      });
      throw error;
    }
  }

  async extractDeliverables(
    message: string,
    intent?: IntentType
  ): Promise<DeliverableSpec[]> {
    const deliverables: DeliverableSpec[] = [];
    const resolvedIntent = intent || classifyIntent(message, []).intent;
    const primaryType = INTENT_TO_DELIVERABLE[resolvedIntent];

    const documentPatterns = [
      { regex: /\b(word|docx?|documento?)\b/i, format: "docx" },
      { regex: /\b(pdf)\b/i, format: "pdf" },
      { regex: /\b(report|informe|carta|letter)\b/i, format: "docx" }
    ];
    
    const presentationPatterns = [
      { regex: /\b(pptx?|powerpoint|presentaci[oó]n|slides?|diapositivas?)\b/i, format: "pptx" }
    ];
    
    const spreadsheetPatterns = [
      { regex: /\b(xlsx?|excel|spreadsheet|hoja de c[aá]lculo)\b/i, format: "xlsx" },
      { regex: /\b(csv)\b/i, format: "csv" }
    ];
    
    const codePatterns = [
      { regex: /\b(python|py)\b/i, format: "python" },
      { regex: /\b(javascript|js|typescript|ts)\b/i, format: "javascript" },
      { regex: /\b(html|css)\b/i, format: "html" },
      { regex: /\b(sql)\b/i, format: "sql" }
    ];
    
    const imagePatterns = [
      { regex: /\b(imagen|image|foto|photo|ilustraci[oó]n|illustration)\b/i, format: "png" }
    ];

    const extractRequirements = (text: string): string[] => {
      const requirements: string[] = [];
      
      const pageMatch = text.match(/(\d+)\s*(p[aá]ginas?|pages?)/i);
      if (pageMatch) requirements.push(`pages: ${pageMatch[1]}`);
      
      const slideMatch = text.match(/(\d+)\s*(slides?|diapositivas?)/i);
      if (slideMatch) requirements.push(`slides: ${slideMatch[1]}`);
      
      const sectionMatch = text.match(/(\d+)\s*(secciones?|sections?)/i);
      if (sectionMatch) requirements.push(`sections: ${sectionMatch[1]}`);
      
      if (/\b(professional|profesional)\b/i.test(text)) requirements.push("style: professional");
      if (/\b(modern|moderno)\b/i.test(text)) requirements.push("style: modern");
      if (/\b(formal)\b/i.test(text)) requirements.push("style: formal");
      
      return requirements;
    };

    const addDeliverable = (type: DeliverableType, format: string, requirements: string[] = []) => {
      deliverables.push({
        id: randomUUID(),
        type,
        format,
        requirements: [...extractRequirements(message), ...requirements],
        priority: deliverables.length + 1,
        estimatedComplexity: this.estimateDeliverableComplexity(message, type)
      });
    };

    for (const pattern of documentPatterns) {
      if (pattern.regex.test(message)) {
        addDeliverable("document", pattern.format);
        break;
      }
    }

    for (const pattern of presentationPatterns) {
      if (pattern.regex.test(message)) {
        addDeliverable("presentation", pattern.format);
        break;
      }
    }

    for (const pattern of spreadsheetPatterns) {
      if (pattern.regex.test(message)) {
        addDeliverable("spreadsheet", pattern.format);
        break;
      }
    }

    for (const pattern of codePatterns) {
      if (pattern.regex.test(message)) {
        addDeliverable("code", pattern.format);
      }
    }

    for (const pattern of imagePatterns) {
      if (pattern.regex.test(message)) {
        addDeliverable("image", pattern.format);
        break;
      }
    }

    if (deliverables.length === 0 && primaryType !== "text_response") {
      addDeliverable(primaryType, this.getDefaultFormat(primaryType));
    }

    if (deliverables.length === 0) {
      addDeliverable("text_response", "markdown");
    }

    return deliverables;
  }

  async hydrateMemory(
    sessionId: string,
    runId?: string
  ): Promise<MemoryContext> {
    const now = Date.now();
    console.log(`[Memory] Retrieving memory for session ${sessionId}${runId ? ` (run: ${runId})` : ''}`);
    
    try {
      const memory = await memoryStore.get(sessionId);
      
      if (!memory) {
        console.log(`[Memory] No existing memory found for session ${sessionId}, starting fresh`);
        return {
          facts: [],
          previousActions: [],
          workingContext: {},
          relevantTurns: 0,
          lastAccessedAt: now
        };
      }

      const recentMessages = memory.messages.slice(-this.options.maxMemoryTurns);
      
      const facts: MemoryFact[] = [];
      const previousActions: PreviousAction[] = [];

      for (const msg of recentMessages) {
        if (msg.role === "user") {
          const topicMatch = msg.content.match(/(?:about|sobre|regarding)\s+([^.!?]+)/i);
          if (topicMatch) {
            facts.push({
              key: `topic_${facts.length}`,
              value: topicMatch[1].trim(),
              source: "user",
              confidence: 0.8,
              timestamp: msg.timestamp || now
            });
          }
        }

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tool of msg.toolCalls) {
            previousActions.push({
              actionType: "tool_execution",
              toolName: tool.name,
              summary: `Executed ${tool.name}`,
              success: !!tool.result,
              timestamp: msg.timestamp || now,
              outputArtifact: typeof tool.result === "string" ? tool.result.slice(0, 200) : undefined
            });
          }
        }
      }

      const workingContext: Record<string, any> = {
        ...memory.context,
        runId,
        messageCount: memory.messages.length,
        lastMessageTimestamp: memory.messages[memory.messages.length - 1]?.timestamp
      };

      const memoryContext = {
        facts: facts.slice(-20),
        previousActions: previousActions.slice(-10),
        workingContext,
        relevantTurns: recentMessages.length,
        lastAccessedAt: now
      };
      
      console.log(`[Memory] Retrieved ${memoryContext.facts.length} facts and ${memoryContext.previousActions.length} actions for session ${sessionId}`);
      
      return memoryContext;
      
    } catch (error: any) {
      console.error(`[Memory] Hydration failed for session ${sessionId}: ${error.message}`);
      return {
        facts: [],
        previousActions: [],
        workingContext: {},
        relevantTurns: 0,
        lastAccessedAt: now
      };
    }
  }

  async storeExecutionMemory(
    sessionId: string,
    runId: string,
    data: {
      userMessage: string;
      assistantResponse: string;
      intent: string;
      toolsUsed: string[];
      agentsUsed: string[];
      artifacts: Array<{ id: string; type: string; name: string }>;
      success: boolean;
    }
  ): Promise<void> {
    const now = Date.now();
    console.log(`[Memory] Storing facts for session ${sessionId} (run: ${runId})`);
    
    try {
      await memoryStore.addMessage(sessionId, "user", data.userMessage);
      
      const toolCallsData = data.toolsUsed.map(tool => ({
        name: tool,
        args: {},
        result: data.success ? "success" : "failed"
      }));
      
      await memoryStore.addMessage(
        sessionId, 
        "assistant", 
        data.assistantResponse,
        toolCallsData.length > 0 ? toolCallsData : undefined
      );
      
      const contextUpdate: Record<string, any> = {
        lastRunId: runId,
        lastIntent: data.intent,
        lastUpdated: now,
        totalRuns: 0
      };
      
      if (data.agentsUsed.length > 0) {
        contextUpdate.lastAgentsUsed = data.agentsUsed;
      }
      
      if (data.artifacts.length > 0) {
        const existingMemory = await memoryStore.get(sessionId);
        const existingArtifacts = existingMemory?.context?.artifacts || [];
        contextUpdate.artifacts = [
          ...existingArtifacts.slice(-20),
          ...data.artifacts.map(a => ({
            id: a.id,
            type: a.type,
            name: a.name,
            createdAt: now,
            runId
          }))
        ].slice(-25);
      }
      
      const existingMemory = await memoryStore.get(sessionId);
      contextUpdate.totalRuns = (existingMemory?.context?.totalRuns || 0) + 1;
      
      await memoryStore.updateContext(sessionId, contextUpdate);
      
      console.log(`[Memory] Stored execution data for session ${sessionId}: ${data.toolsUsed.length} tools, ${data.agentsUsed.length} agents, ${data.artifacts.length} artifacts`);
      
    } catch (error: any) {
      console.error(`[Memory] Failed to store execution memory for session ${sessionId}: ${error.message}`);
    }
  }

  validateAgainstPolicy(
    analysis: AnalysisResult,
    userId?: string
  ): ValidationResult {
    const violations: string[] = [];
    const warnings: string[] = [];
    const blockedTools: string[] = [];
    const requiredConfirmations: string[] = [];

    const userPlan = "free";
    const effectiveUserId = userId || "anonymous";

    const intentToToolMapping: Partial<Record<IntentType, string[]>> = {
      code_generation: ["execute_code", "shell_command"],
      web_automation: ["browse_url", "web_search"],
      image_generation: ["generate_image"],
      document_generation: ["generate_document"],
      data_analysis: ["analyze_spreadsheet"]
    };

    const requiredTools = intentToToolMapping[analysis.intent] || [];
    
    for (const toolName of requiredTools) {
      const policyResult = policyEngine.checkAccess({
        userId: effectiveUserId,
        userPlan,
        toolName,
        isConfirmed: false
      });

      if (!policyResult.allowed) {
        if (policyResult.requiresConfirmation) {
          requiredConfirmations.push(toolName);
          warnings.push(`Tool ${toolName} requires user confirmation`);
        } else {
          blockedTools.push(toolName);
          if (this.options.policyStrictMode) {
            violations.push(policyResult.reason || `Tool ${toolName} not allowed`);
          } else {
            warnings.push(policyResult.reason || `Tool ${toolName} may be restricted`);
          }
        }
      }
    }

    if (analysis.complexity === "expert" && userPlan === "free") {
      warnings.push("Expert-level tasks may have limited capabilities on free plan");
    }

    const deliverableTypes = analysis.deliverables.map(d => d.type);
    if (deliverableTypes.includes("image") && userPlan === "free") {
      warnings.push("Image generation is a premium feature");
    }

    return {
      valid: violations.length === 0,
      violations,
      warnings,
      blockedTools,
      requiredConfirmations
    };
  }

  private async performLLMAnalysis(
    message: string,
    context: ConversationContext
  ): Promise<{
    intent: IntentType;
    confidence: number;
    entities: Record<string, any>;
    deliverables: DeliverableSpec[];
  } | null> {
    try {
      const recentMessages = context.messages.slice(-5);
      const contextSummary = recentMessages
        .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
        .join("\n");

      const response = await llmGateway.chat([
        { role: "system", content: LLM_ANALYSIS_PROMPT },
        { 
          role: "user", 
          content: `Context:\n${contextSummary}\n\nUser message to analyze:\n${message}`
        }
      ], {
        provider: "gemini",
        temperature: 0.1,
        maxTokens: 1000,
        timeout: this.options.timeout
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      const intentValue = IntentTypeSchema.safeParse(parsed.intent);
      if (!intentValue.success) {
        return null;
      }

      const deliverables: DeliverableSpec[] = (parsed.deliverables || []).map((d: any) => ({
        id: randomUUID(),
        type: DeliverableTypeEnum.parse(d.type || "text_response"),
        format: d.format || undefined,
        requirements: Array.isArray(d.requirements) ? d.requirements : [],
        priority: 5,
        estimatedComplexity: "medium" as const
      })).filter((d: any) => DeliverableSpecSchema.safeParse(d).success);

      return {
        intent: intentValue.data,
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.7)),
        entities: parsed.entities || {},
        deliverables
      };
      
    } catch (error: any) {
      console.error(`[PromptAnalyzer] LLM analysis error: ${error.message}`);
      return null;
    }
  }

  private assessComplexity(
    message: string,
    deliverables: DeliverableSpec[],
    memoryContext: MemoryContext,
    signals?: {
      attachmentCount: number;
      hasExtractedContent: boolean;
      isMultiIntent: boolean;
    }
  ): ComplexityLevel {
    for (const [level, patterns] of Object.entries(COMPLEXITY_KEYWORDS) as [ComplexityLevel, RegExp[]][]) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          if (level === "trivial") return "trivial";
          if (level === "simple" && deliverables.length <= 1) return "simple";
          if (level === "moderate") return "moderate";
          if (level === "complex") return "complex";
          if (level === "expert") return "expert";
        }
      }
    }

    if (deliverables.length >= 3) return "complex";
    if (deliverables.length >= 2) return "moderate";
    
    const hasHighComplexityDeliverable = deliverables.some(
      d => d.estimatedComplexity === "high"
    );
    if (hasHighComplexityDeliverable) return "complex";

    if (memoryContext.previousActions.length > 5) return "moderate";
    if (signals?.isMultiIntent && message.length > 120) return "complex";
    if (signals?.attachmentCount && signals.attachmentCount > 0) return "moderate";
    if (signals?.hasExtractedContent && message.length > 200) return "moderate";

    if (message.length < 50) return "simple";
    if (message.length > 500) return "moderate";

    return "moderate";
  }

  private normalizeDeliverables(deliverables: DeliverableSpec[]): DeliverableSpec[] {
    return deliverables.map(deliverable => ({
      ...deliverable,
      format: deliverable.format || this.getDefaultFormat(deliverable.type),
      requirements: Array.from(new Set(deliverable.requirements || []))
    }));
  }

  private dedupeDeliverables(deliverables: DeliverableSpec[]): DeliverableSpec[] {
    const seen = new Set<string>();
    const result: DeliverableSpec[] = [];

    for (const deliverable of deliverables) {
      const key = `${deliverable.type}:${deliverable.format ?? "default"}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(deliverable);
      }
    }

    return result;
  }

  private detectMultiIntent(message: string): {
    isMultiIntent: boolean;
    segments: string[];
    separators: string[];
  } {
    const separatorRegex = /\s+(?:y|and|adem[aá]s|tambi[eé]n|also|plus)\s+|[;\n]+/gi;
    const separators = message.match(separatorRegex)?.map(s => s.trim()).filter(Boolean) || [];
    const segments = message
      .split(separatorRegex)
      .map(segment => segment.trim())
      .filter(segment => segment.length >= 12);

    return {
      isMultiIntent: segments.length >= 2,
      segments,
      separators
    };
  }

  private summarizeAttachments(attachments: AttachmentSpec[]): {
    count: number;
    totalSize: number;
    types: Record<string, number>;
    hasExtractedContent: boolean;
  } {
    const summary = {
      count: attachments.length,
      totalSize: 0,
      types: {} as Record<string, number>,
      hasExtractedContent: false
    };

    for (const attachment of attachments) {
      summary.totalSize += attachment.size || 0;
      summary.types[attachment.mimeType] = (summary.types[attachment.mimeType] || 0) + 1;
      if (attachment.extractedContent) {
        summary.hasExtractedContent = true;
      }
    }

    return summary;
  }

  private detectMissingRequirements(message: string, deliverables: DeliverableSpec[]): string[] {
    const clarifications: string[] = [];
    const hasLengthSignal = /\b(\d+\s*(p[aá]ginas?|pages?|slides?|diapositivas?|secciones?|sections?|filas|rows|columnas|columns))\b/i.test(message);
    const hasAudienceSignal = /\b(p[úu]blico|audiencia|cliente|stakeholders|directivos|equipo|team)\b/i.test(message);
    const hasLanguageSignal = /\b(espa[nñ]ol|ingl[eé]s|english|spanish)\b/i.test(message);

    for (const deliverable of deliverables) {
      if (["document", "presentation", "spreadsheet"].includes(deliverable.type) && !hasLengthSignal) {
        clarifications.push(`Define alcance/longitud para ${deliverable.type}`);
      }
      if (deliverable.type === "document" && !hasAudienceSignal) {
        clarifications.push("Indicar audiencia objetivo para el documento");
      }
      if (!hasLanguageSignal) {
        clarifications.push("Especificar idioma de salida");
      }
    }

    return Array.from(new Set(clarifications));
  }

  private buildExecutionHints(input: {
    complexity: ComplexityLevel;
    deliverables: DeliverableSpec[];
    hasAttachments: boolean;
    clarificationsCount: number;
    multiIntent: { isMultiIntent: boolean; segments: string[] };
    memoryContext: MemoryContext;
  }): Record<string, any> {
    const requiresDecomposition = input.multiIntent.isMultiIntent || input.deliverables.length > 1;
    const requiresVerification = ["moderate", "complex", "expert"].includes(input.complexity);
    const requiresTools = input.hasAttachments || input.deliverables.some(d => ["research", "data_analysis", "code"].includes(d.type));
    const requiresMemory = input.memoryContext.facts.length > 0 || input.memoryContext.previousActions.length > 0;
    const shouldClarify = input.clarificationsCount > 0;

    return {
      requiresDecomposition,
      requiresVerification,
      requiresTools,
      requiresMemory,
      shouldClarify,
      deliverableTypes: input.deliverables.map(d => d.type)
    };
  }

  private determineSuggestedAgents(
    intent: IntentType,
    deliverables: DeliverableSpec[],
    complexity: ComplexityLevel,
    needsClarification: boolean
  ): SpecializedAgent[] {
    const baseAgents = [...INTENT_TO_AGENTS[intent]];
    
    if (complexity === "complex" || complexity === "expert") {
      if (!baseAgents.includes("orchestrator")) {
        baseAgents.unshift("orchestrator");
      }
    }

    for (const deliverable of deliverables) {
      if (deliverable.type === "code" && !baseAgents.includes("code")) {
        baseAgents.push("code");
      }
      if (deliverable.type === "research" && !baseAgents.includes("research")) {
        baseAgents.push("research");
      }
      if (deliverable.type === "data_analysis" && !baseAgents.includes("data")) {
        baseAgents.push("data");
      }
      if (["document", "presentation", "spreadsheet"].includes(deliverable.type) && !baseAgents.includes("document")) {
        baseAgents.push("document");
      }
    }

    if (!baseAgents.includes("qa") && complexity !== "trivial" && complexity !== "simple") {
      baseAgents.push("qa");
    }

    if (needsClarification && !baseAgents.includes("communication")) {
      baseAgents.push("communication");
    }

    return baseAgents.slice(0, 5) as SpecializedAgent[];
  }

  private estimateDeliverableComplexity(
    message: string,
    type: DeliverableType
  ): "low" | "medium" | "high" {
    const highComplexityPatterns = [
      /\b(comprehensive|detailed|in-depth|thorough|extensive)\b/i,
      /\b(multiple|several|various|many)\b/i,
      /\d{2,}\s*(pages?|slides?|sections?)/i
    ];
    
    const lowComplexityPatterns = [
      /\b(simple|basic|quick|short|brief)\b/i,
      /\b(just|only)\b/i
    ];

    for (const pattern of highComplexityPatterns) {
      if (pattern.test(message)) return "high";
    }

    for (const pattern of lowComplexityPatterns) {
      if (pattern.test(message)) return "low";
    }

    const complexTypes: DeliverableType[] = ["research", "code", "data_analysis"];
    if (complexTypes.includes(type)) return "medium";

    return "medium";
  }

  private getDefaultFormat(type: DeliverableType): string {
    const defaults: Record<DeliverableType, string> = {
      document: "docx",
      presentation: "pptx",
      spreadsheet: "xlsx",
      code: "javascript",
      research: "markdown",
      image: "png",
      data_analysis: "json",
      text_response: "markdown"
    };
    return defaults[type] || "text";
  }

  private emitEvent(event: PromptAnalyzerEvent, data: Record<string, any>): void {
    const eventData = {
      event,
      timestamp: Date.now(),
      ...data
    };
    this.emit(event, eventData);
    this.emit("*", eventData);
  }

  getMetrics(): {
    options: Required<PromptAnalyzerOptions>;
  } {
    return {
      options: this.options
    };
  }
}

export const promptAnalyzer = new PromptAnalyzer();

export function createPromptAnalyzer(options?: PromptAnalyzerOptions): PromptAnalyzer {
  return new PromptAnalyzer(options);
}
