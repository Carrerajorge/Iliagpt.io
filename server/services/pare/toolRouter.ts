import { Intent, IntentCategory, Entity, EntityType, ToolCandidate } from "./types";

interface ToolCapability {
  toolName: string;
  description: string;
  inputTypes: EntityType[];
  outputTypes: string[];
  intentAffinity: Partial<Record<IntentCategory, number>>;
  keywords: string[];
  embedding: number[] | null;
}

type ToolCategory =
  | "Orchestration"
  | "Memory"
  | "Reasoning"
  | "Communication"
  | "Development"
  | "Document"
  | "Web"
  | "Generation"
  | "Data"
  | "Automation"
  | "Processing"
  | "API"
  | "Productivity"
  | "Security"
  | "Database"
  | "Monitoring"
  | "Utility"
  | "Diagram"
  | "AdvancedSystem";

const INTENT_TO_TOOLS: Record<IntentCategory, string[]> = {
  query: [
    "search_web", "web_search", "search_semantic", "memory_retrieve",
    "fetch_url", "browse_url", "file_read"
  ],
  command: [
    "shell", "shell_execute", "code_execute", "file_manage", "email_manage",
    "email_send", "calendar_manage", "calendar_event", "api_call", "http_request"
  ],
  creation: [
    "file_write", "doc_create", "document_create", "slides_create", "spreadsheet_create",
    "generate_text", "text_generate", "generate_image", "image_generate", "code_generate"
  ],
  analysis: [
    "data_analyze", "data_visualize", "summarize", "text_summarize", "reason",
    "vision_analyze", "verify", "analyze_problem", "file_read", "document_analyze",
    "read_file", "analyze_document"
  ],
  code: [
    "code_generate", "code_execute", "code_review", "code_analyze", "code_debug",
    "code_test", "code_refactor", "shell", "shell_execute", "git_manage", "git_operation"
  ],
  research: [
    "search_web", "web_search", "fetch_url", "browse_url", "research_deep",
    "summarize", "text_summarize", "memory_store", "verify"
  ],
  automation: [
    "schedule_cron", "cron_schedule", "schedule_once", "trigger_event",
    "workflow", "workflow_create", "queue_manage", "queue_message", "webhook_send"
  ],
  conversation: [
    "message", "message_compose", "clarify", "summarize", "text_summarize", "explain"
  ],
  clarification: [
    "clarify", "context_manage"
  ],
};

const ENTITY_TO_TOOLS: Record<EntityType, string[]> = {
  file_path: ["file_read", "file_write", "file_manage", "file_convert", "document_convert", "summarize", "text_summarize", "data_analyze"],
  url: ["fetch_url", "browse_url", "browser_navigate", "search_web", "web_search", "extract_content"],
  code_snippet: ["code_execute", "code_review", "code_analyze", "code_debug"],
  date_time: ["schedule_cron", "cron_schedule", "schedule_once", "calendar_manage", "calendar_event"],
  number: ["data_analyze", "statistics_compute", "spreadsheet_create"],
  person: ["email_manage", "email_send", "calendar_manage", "calendar_event"],
  organization: ["search_web", "web_search", "research_deep"],
  tool_reference: [],
  data_format: ["file_convert", "document_convert", "data_transform", "file_read", "json_parse", "csv_parse"],
  programming_language: ["code_generate", "code_execute", "code_review", "code_analyze"],
  action_verb: [],
  domain_term: ["search_web", "web_search", "research_deep", "search_semantic"],
};

const CATEGORY_TO_INTENTS: Record<ToolCategory, IntentCategory[]> = {
  Orchestration: ["command"],
  Memory: ["query", "research"],
  Reasoning: ["analysis", "query"],
  Communication: ["conversation"],
  Development: ["command", "code"],
  Document: ["creation", "command"],
  Web: ["research", "query"],
  Generation: ["creation"],
  Data: ["analysis"],
  Automation: ["automation"],
  Processing: ["analysis"],
  API: ["command", "automation"],
  Productivity: ["command", "creation"],
  Security: ["command", "analysis"],
  Database: ["command", "query"],
  Monitoring: ["analysis", "query"],
  Utility: ["command"],
  Diagram: ["creation"],
  AdvancedSystem: ["command", "code"],
};

const STOPWORDS = new Set([
  "de", "la", "el", "en", "y", "a", "para", "con", "que", "del", "los", "las", "un", "una",
  "the", "a", "an", "and", "or", "for", "with", "to", "of", "in", "is", "are", "be", "has"
]);

const TOOL_DEPENDENCIES: Record<string, string[]> = {
  code_execute: ["code_generate"],
  data_visualize: ["data_analyze"],
  email_send: ["text_generate"],
  slides_create: ["text_generate"],
  research_deep: ["web_search", "search_web"],
  verify: ["web_search", "search_web"],
  document_create: ["text_generate"],
};

export class ToolRouter {
  private similarityThreshold: number;
  private toolCapabilities: Map<string, ToolCapability> = new Map();
  private toolEmbeddings: Map<string, number[]> = new Map();
  private initialized: boolean = false;

  constructor(config: { similarityThreshold?: number } = {}) {
    this.similarityThreshold = config.similarityThreshold ?? 0.5;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { toolRegistry } = await import("../toolRegistry");
      const tools = toolRegistry.getTools();

      for (const tool of tools) {
        const capability: ToolCapability = {
          toolName: tool.name,
          description: tool.description,
          inputTypes: [],
          outputTypes: [],
          intentAffinity: this.computeIntentAffinity(tool.name, tool.category as ToolCategory),
          keywords: this.extractKeywords(tool.description),
          embedding: null,
        };

        this.toolCapabilities.set(tool.name, capability);
      }

      this.initialized = true;
      console.log(`[ToolRouter] Initialized ${this.toolCapabilities.size} tool capabilities`);
    } catch (error) {
      console.warn("[ToolRouter] Failed to initialize from registry:", error);
      this.initialized = true;
    }
  }

  async route(
    prompt: string,
    intents: Intent[],
    entities: Entity[],
    maxCandidates: number = 5
  ): Promise<ToolCandidate[]> {
    await this.initialize();

    const candidates: Map<string, ToolCandidate> = new Map();

    const intentScores = this.scoreByIntent(intents);
    const entityScores = this.scoreByEntities(entities);
    const semanticScores = await this.scoreBySemantics(prompt);
    const keywordScores = this.scoreByKeywords(prompt);

    const allTools = new Set([
      ...Object.keys(intentScores),
      ...Object.keys(entityScores),
      ...Object.keys(semanticScores),
      ...Object.keys(keywordScores),
    ]);

    const intentWeight = 0.35;
    const entityWeight = 0.25;
    const semanticWeight = 0.25;
    const keywordWeight = 0.15;

    for (const toolName of allTools) {
      const combinedScore =
        (intentScores[toolName] ?? 0) * intentWeight +
        (entityScores[toolName] ?? 0) * entityWeight +
        (semanticScores[toolName] ?? 0) * semanticWeight +
        (keywordScores[toolName] ?? 0) * keywordWeight;

      if (combinedScore > 0.1) {
        candidates.set(toolName, {
          toolName,
          relevanceScore: combinedScore,
          capabilityMatch: semanticScores[toolName] ?? 0,
          requiredParams: {},
          optionalParams: {},
          dependencies: this.getDependencies(toolName),
        });
      }
    }

    const sorted = Array.from(candidates.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );

    return sorted.slice(0, maxCandidates);
  }

  private scoreByIntent(intents: Intent[]): Record<string, number> {
    const scores: Record<string, number> = {};

    for (const intent of intents) {
      const tools = INTENT_TO_TOOLS[intent.category] ?? [];
      for (const tool of tools) {
        if (scores[tool] === undefined) {
          scores[tool] = 0;
        }
        scores[tool] += intent.confidence;
      }
    }

    if (Object.keys(scores).length > 0) {
      const maxScore = Math.max(...Object.values(scores));
      if (maxScore > 0) {
        for (const tool of Object.keys(scores)) {
          scores[tool] = scores[tool] / maxScore;
        }
      }
    }

    return scores;
  }

  private scoreByEntities(entities: Entity[]): Record<string, number> {
    const scores: Record<string, number> = {};

    for (const entity of entities) {
      const tools = ENTITY_TO_TOOLS[entity.type] ?? [];
      for (const tool of tools) {
        if (scores[tool] === undefined) {
          scores[tool] = 0;
        }
        scores[tool] += entity.confidence;
      }
    }

    if (Object.keys(scores).length > 0) {
      const maxScore = Math.max(...Object.values(scores));
      if (maxScore > 0) {
        for (const tool of Object.keys(scores)) {
          scores[tool] = scores[tool] / maxScore;
        }
      }
    }

    return scores;
  }

  private async scoreBySemantics(prompt: string): Promise<Record<string, number>> {
    const scores: Record<string, number> = {};

    if (this.toolEmbeddings.size === 0) {
      return scores;
    }

    try {
      const { generateEmbedding } = await import("../../lib/embeddings");
      const promptEmbedding = await generateEmbedding(prompt);

      for (const [toolName, toolEmbedding] of this.toolEmbeddings) {
        const similarity = this.cosineSimilarity(promptEmbedding, toolEmbedding);
        const normalizedSim = (similarity + 1) / 2;

        if (normalizedSim > this.similarityThreshold) {
          scores[toolName] = normalizedSim;
        }
      }
    } catch {
      return scores;
    }

    return scores;
  }

  private scoreByKeywords(prompt: string): Record<string, number> {
    const scores: Record<string, number> = {};
    const promptLower = prompt.toLowerCase();

    for (const [toolName, capability] of this.toolCapabilities) {
      if (capability.keywords.length === 0) continue;

      let matches = 0;
      for (const keyword of capability.keywords) {
        if (promptLower.includes(keyword.toLowerCase())) {
          matches++;
        }
      }

      if (matches > 0) {
        scores[toolName] = Math.min(matches / capability.keywords.length, 1.0);
      }
    }

    return scores;
  }

  private computeIntentAffinity(
    toolName: string,
    category?: ToolCategory
  ): Partial<Record<IntentCategory, number>> {
    const affinity: Partial<Record<IntentCategory, number>> = {};

    for (const [intentCat, tools] of Object.entries(INTENT_TO_TOOLS)) {
      if (tools.includes(toolName)) {
        affinity[intentCat as IntentCategory] = 1.0;
      } else if (category) {
        const relatedIntents = CATEGORY_TO_INTENTS[category] ?? [];
        if (relatedIntents.includes(intentCat as IntentCategory)) {
          affinity[intentCat as IntentCategory] = 0.5;
        }
      }
    }

    return affinity;
  }

  private extractKeywords(description: string): string[] {
    const words = description.toLowerCase().split(/\s+/);
    const keywords: string[] = [];

    for (const word of words) {
      const cleaned = word.replace(/[^a-záéíóúñü]/gi, "");
      if (cleaned.length > 3 && !STOPWORDS.has(cleaned)) {
        keywords.push(cleaned);
      }
    }

    return [...new Set(keywords)];
  }

  private getDependencies(toolName: string): string[] {
    return TOOL_DEPENDENCIES[toolName] ?? [];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }
}
