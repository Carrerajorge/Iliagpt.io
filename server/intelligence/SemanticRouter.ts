/**
 * SemanticRouter — Embedding-based semantic routing for user messages
 *
 * Routes incoming messages to specialized handlers using TF-IDF cosine
 * similarity against route description corpora. Supports multi-intent
 * detection, confidence thresholds, route-specific model optimizations,
 * and pluggable real-embedding providers for production upgrades.
 */

import { EventEmitter } from "events";
import { createHash } from "crypto";
import pino from "pino";
import { getClaudeAgentBackbone } from "../agentic/ClaudeAgentBackbone.js";

const logger = pino({ name: "SemanticRouter" });

// ─────────────────────────────────────────────────────────────────────────────
// Route Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type RouteId =
  | "general_chat"
  | "code_help"
  | "data_analysis"
  | "research"
  | "creative_writing"
  | "system_control"
  | "document_work";

export interface RouteOptimizations {
  /** Preferred model for this route */
  model: string;
  /** Preferred temperature */
  temperature: number;
  /** Max tokens to allocate */
  maxTokens: number;
  /** Whether extended thinking is beneficial for this route */
  useExtendedThinking: boolean;
  /** System prompt prefix to prepend for this route */
  systemPromptPrefix: string;
  /** Whether to use RAG retrieval */
  useRAG: boolean;
  /** Whether to enable web search */
  useWebSearch: boolean;
  /** Response streaming preferred */
  streaming: boolean;
}

export interface RouteDefinition {
  id: RouteId;
  name: string;
  description: string;
  /** Example phrases/queries that belong to this route (used for TF-IDF corpus) */
  examples: string[];
  /** Keywords with high signal for this route */
  keywords: string[];
  /** Routes this can be combined with in multi-intent scenarios */
  compatibleWith: RouteId[];
  optimizations: RouteOptimizations;
  /** Minimum confidence to use this route (0-1) */
  minConfidence: number;
}

const ROUTE_DEFINITIONS: RouteDefinition[] = [
  {
    id: "general_chat",
    name: "General Chat",
    description: "Casual conversation, questions about Claude, help requests, greetings",
    examples: [
      "Hello, how are you?",
      "What can you help me with?",
      "Tell me something interesting",
      "I have a question",
      "Can you explain this concept to me?",
      "What do you think about this?",
      "I need some advice",
      "Help me understand",
      "What is your opinion on",
      "Can you recommend",
    ],
    keywords: ["hello", "hi", "help", "question", "explain", "tell", "think", "opinion", "advice", "recommend", "what", "how", "why", "can you"],
    compatibleWith: ["research", "document_work"],
    optimizations: {
      model: "claude-haiku-4-5",
      temperature: 0.7,
      maxTokens: 2048,
      useExtendedThinking: false,
      systemPromptPrefix: "",
      useRAG: false,
      useWebSearch: false,
      streaming: true,
    },
    minConfidence: 0.2,
  },
  {
    id: "code_help",
    name: "Code Help",
    description: "Programming assistance, debugging, code review, architecture, algorithms",
    examples: [
      "Fix this bug in my code",
      "How do I implement this function?",
      "Review my TypeScript code",
      "Debug this error message",
      "Write unit tests for this",
      "Refactor this class",
      "What's the best algorithm for",
      "Help me with this SQL query",
      "How do I set up this API",
      "Convert this Python to JavaScript",
      "Explain this code snippet",
      "Optimize this function performance",
    ],
    keywords: ["code", "function", "bug", "error", "implement", "debug", "test", "refactor", "algorithm", "api", "sql", "typescript", "javascript", "python", "class", "method", "variable", "async", "await"],
    compatibleWith: ["data_analysis", "system_control"],
    optimizations: {
      model: "claude-sonnet-4-6",
      temperature: 0.2,
      maxTokens: 8192,
      useExtendedThinking: true,
      systemPromptPrefix: "You are an expert software engineer. Provide precise, working code solutions.",
      useRAG: true,
      useWebSearch: false,
      streaming: true,
    },
    minConfidence: 0.4,
  },
  {
    id: "data_analysis",
    name: "Data Analysis",
    description: "Analyzing datasets, statistics, charts, CSV/JSON processing, insights from data",
    examples: [
      "Analyze this CSV file",
      "What are the trends in this data?",
      "Calculate the average and median",
      "Create a chart showing this",
      "Find anomalies in this dataset",
      "Summarize these metrics",
      "What's the correlation between",
      "Query this data for",
      "Process this JSON dataset",
      "Show me the distribution of",
      "Compare these two datasets",
    ],
    keywords: ["data", "csv", "json", "analysis", "chart", "graph", "statistics", "average", "median", "trend", "correlation", "anomaly", "dataset", "metric", "distribution", "query", "aggregate", "column", "row"],
    compatibleWith: ["code_help", "research"],
    optimizations: {
      model: "claude-sonnet-4-6",
      temperature: 0.1,
      maxTokens: 4096,
      useExtendedThinking: true,
      systemPromptPrefix: "You are a data analyst. Provide precise statistical analysis and clear visualizations.",
      useRAG: false,
      useWebSearch: false,
      streaming: false,
    },
    minConfidence: 0.45,
  },
  {
    id: "research",
    name: "Research",
    description: "Web research, fact-finding, literature review, topic deep-dives, summarizing sources",
    examples: [
      "Research the latest developments in",
      "What is the current state of",
      "Summarize recent papers about",
      "Find information about",
      "What are the best sources on",
      "Give me an overview of",
      "Compare different approaches to",
      "What do experts say about",
      "Investigate this topic",
      "Do a literature review on",
      "Search for studies about",
    ],
    keywords: ["research", "find", "search", "investigate", "study", "literature", "source", "paper", "article", "overview", "latest", "recent", "current", "information", "fact", "evidence"],
    compatibleWith: ["general_chat", "document_work", "data_analysis"],
    optimizations: {
      model: "claude-sonnet-4-6",
      temperature: 0.3,
      maxTokens: 6144,
      useExtendedThinking: true,
      systemPromptPrefix: "You are a thorough research assistant. Provide well-sourced, comprehensive information.",
      useRAG: true,
      useWebSearch: true,
      streaming: true,
    },
    minConfidence: 0.35,
  },
  {
    id: "creative_writing",
    name: "Creative Writing",
    description: "Writing stories, poems, scripts, creative content generation, brainstorming ideas",
    examples: [
      "Write a short story about",
      "Create a poem for",
      "Help me brainstorm ideas for",
      "Write a blog post about",
      "Draft an email to",
      "Come up with taglines for",
      "Write a product description",
      "Create a script for",
      "Generate marketing copy",
      "Write song lyrics about",
      "Give me creative names for",
    ],
    keywords: ["write", "create", "generate", "story", "poem", "blog", "email", "draft", "brainstorm", "ideas", "creative", "script", "copy", "marketing", "tagline", "lyrics", "fiction"],
    compatibleWith: ["general_chat"],
    optimizations: {
      model: "claude-sonnet-4-6",
      temperature: 0.85,
      maxTokens: 4096,
      useExtendedThinking: false,
      systemPromptPrefix: "You are a creative writing assistant with a rich vocabulary and imaginative approach.",
      useRAG: false,
      useWebSearch: false,
      streaming: true,
    },
    minConfidence: 0.35,
  },
  {
    id: "system_control",
    name: "System Control",
    description: "Controlling app features, managing settings, scheduling tasks, system configuration",
    examples: [
      "Schedule a task to run daily",
      "Set up a recurring reminder",
      "Configure the system settings",
      "Enable this feature",
      "Disable notifications",
      "Set the model to",
      "Change the temperature setting",
      "Start monitoring this",
      "Create an automated workflow",
      "Update my preferences",
    ],
    keywords: ["schedule", "configure", "settings", "enable", "disable", "set", "start", "stop", "create", "delete", "update", "preferences", "automated", "workflow", "system", "task", "recurring", "monitor"],
    compatibleWith: ["code_help"],
    optimizations: {
      model: "claude-haiku-4-5",
      temperature: 0.1,
      maxTokens: 1024,
      useExtendedThinking: false,
      systemPromptPrefix: "You are a system assistant. Extract structured commands and parameters precisely.",
      useRAG: false,
      useWebSearch: false,
      streaming: false,
    },
    minConfidence: 0.5,
  },
  {
    id: "document_work",
    name: "Document Work",
    description: "Processing documents, summarizing, extracting information, editing, formatting",
    examples: [
      "Summarize this document",
      "Extract key points from",
      "Review and edit this text",
      "Format this as a report",
      "Convert this to markdown",
      "Find action items in this",
      "Translate this document",
      "Create a table of contents",
      "Proofread this text",
      "Rewrite this in formal tone",
      "Extract all dates and names from",
    ],
    keywords: ["document", "summarize", "extract", "review", "edit", "format", "convert", "translate", "proofread", "rewrite", "table", "report", "text", "paragraph", "section", "heading"],
    compatibleWith: ["general_chat", "research"],
    optimizations: {
      model: "claude-sonnet-4-6",
      temperature: 0.2,
      maxTokens: 8192,
      useExtendedThinking: false,
      systemPromptPrefix: "You are a document processing assistant. Be precise and preserve important details.",
      useRAG: false,
      useWebSearch: false,
      streaming: true,
    },
    minConfidence: 0.4,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TF-IDF Semantic Similarity Engine
// ─────────────────────────────────────────────────────────────────────────────

type TFIDFVector = Map<string, number>;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function buildTFIDF(documents: string[]): TFIDFVector[] {
  const tokenizedDocs = documents.map(tokenize);
  const N = tokenizedDocs.length;

  // Document frequency: how many docs contain each term
  const df = new Map<string, number>();
  for (const tokens of tokenizedDocs) {
    for (const token of new Set(tokens)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  return tokenizedDocs.map((tokens) => {
    // Term frequency in this doc
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // TF-IDF vector
    const vector: TFIDFVector = new Map();
    for (const [term, count] of tf) {
      const tfScore = count / tokens.length;
      const idfScore = Math.log((N + 1) / ((df.get(term) ?? 0) + 1)) + 1;
      vector.set(term, tfScore * idfScore);
    }
    return vector;
  });
}

function vectorize(text: string, idfMap: Map<string, number>, docCount: number): TFIDFVector {
  const tokens = tokenize(text);
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  const vector: TFIDFVector = new Map();
  for (const [term, count] of tf) {
    const tfScore = count / tokens.length;
    const docFreq = idfMap.get(term) ?? 0;
    const idfScore = Math.log((docCount + 1) / (docFreq + 1)) + 1;
    vector.set(term, tfScore * idfScore);
  }
  return vector;
}

function cosineSimilarity(a: TFIDFVector, b: TFIDFVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, aVal] of a) {
    const bVal = b.get(term) ?? 0;
    dot += aVal * bVal;
    normA += aVal * aVal;
  }
  for (const bVal of b.values()) {
    normB += bVal * bVal;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Scoring and Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteScore {
  routeId: RouteId;
  confidence: number;
  matchedKeywords: string[];
  semanticScore: number;
  keywordScore: number;
}

export interface RoutingResult {
  /** Primary route selected */
  primaryRoute: RouteId;
  /** All route scores sorted by confidence */
  scores: RouteScore[];
  /** Additional routes detected for multi-intent messages */
  secondaryRoutes: RouteId[];
  /** Whether multiple intents were detected */
  isMultiIntent: boolean;
  /** Combined optimizations (primary wins conflicts) */
  optimizations: RouteOptimizations;
  /** Confidence of primary route (0-1) */
  confidence: number;
  /** Whether routing fell back to general_chat due to low confidence */
  isFallback: boolean;
  /** Detected intent description */
  intentSummary: string;
  /** Processing time in ms */
  routingTimeMs: number;
  /** Cache hit */
  cached: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pluggable Embedding Provider
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SemanticRouter Main Class
// ─────────────────────────────────────────────────────────────────────────────

export class SemanticRouter extends EventEmitter {
  private routeCorpusVectors: Map<RouteId, TFIDFVector[]> = new Map();
  private routeIdfMap: Map<string, number> = new Map();
  private docCount = 0;
  private cache = new Map<string, { result: RoutingResult; cachedAt: number }>();
  private cacheMaxSize = 500;
  private cacheTtlMs = 5 * 60 * 1000; // 5 minutes
  private routingHistory: Array<{ message: string; result: RoutingResult; timestamp: Date }> = [];
  private maxHistorySize = 200;
  private embeddingProvider?: EmbeddingProvider;
  private backbone: ReturnType<typeof getClaudeAgentBackbone>;

  // Tuning constants
  private readonly SEMANTIC_WEIGHT = 0.55;
  private readonly KEYWORD_WEIGHT = 0.35;
  private readonly CONTEXT_WEIGHT = 0.10;
  private readonly MULTI_INTENT_THRESHOLD = 0.65; // secondary route must score >= 65% of primary
  private readonly FALLBACK_THRESHOLD = 0.25;

  constructor(embeddingProvider?: EmbeddingProvider) {
    super();
    this.embeddingProvider = embeddingProvider;
    this.backbone = getClaudeAgentBackbone();
    this.buildIndex();
    logger.info({ routes: ROUTE_DEFINITIONS.length }, "SemanticRouter initialized");
  }

  // ─── Index Building ────────────────────────────────────────────────────────

  private buildIndex(): void {
    // Collect all documents for global IDF
    const allDocuments: string[] = [];
    const routeDocMap: Map<RouteId, string[]> = new Map();

    for (const route of ROUTE_DEFINITIONS) {
      const docs = [
        ...route.examples,
        route.description,
        route.keywords.join(" "),
        route.name,
      ];
      routeDocMap.set(route.id, docs);
      allDocuments.push(...docs);
    }

    this.docCount = allDocuments.length;

    // Build global IDF
    const df = new Map<string, number>();
    for (const doc of allDocuments) {
      for (const token of new Set(tokenize(doc))) {
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }
    this.routeIdfMap = df;

    // Build per-route TF-IDF vectors
    for (const route of ROUTE_DEFINITIONS) {
      const docs = routeDocMap.get(route.id)!;
      const vectors = buildTFIDF(docs);
      this.routeCorpusVectors.set(route.id, vectors);
    }

    logger.debug({ docCount: this.docCount, terms: this.routeIdfMap.size }, "TF-IDF index built");
  }

  // ─── Core Routing Logic ────────────────────────────────────────────────────

  async route(
    message: string,
    conversationContext?: string[]
  ): Promise<RoutingResult> {
    const startMs = Date.now();
    const cacheKey = this.cacheKey(message, conversationContext);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return { ...cached.result, cached: true };
    }

    // Score all routes
    const scores = this.scoreRoutes(message, conversationContext);

    // Sort by confidence
    scores.sort((a, b) => b.confidence - a.confidence);

    const topScore = scores[0];
    const isFallback = topScore.confidence < this.FALLBACK_THRESHOLD;
    const primaryRoute = isFallback ? "general_chat" : topScore.routeId;

    // Detect secondary routes (multi-intent)
    const secondaryRoutes = this.detectSecondaryRoutes(scores, primaryRoute);

    // Get optimizations
    const primaryDef = ROUTE_DEFINITIONS.find((r) => r.id === primaryRoute)!;
    const optimizations = this.mergeOptimizations(primaryDef, secondaryRoutes);

    // Generate intent summary
    const intentSummary = this.buildIntentSummary(primaryRoute, secondaryRoutes, topScore.confidence);

    const result: RoutingResult = {
      primaryRoute,
      scores,
      secondaryRoutes,
      isMultiIntent: secondaryRoutes.length > 0,
      optimizations,
      confidence: isFallback ? 0 : topScore.confidence,
      isFallback,
      intentSummary,
      routingTimeMs: Date.now() - startMs,
      cached: false,
    };

    // Cache result
    this.setCache(cacheKey, result);

    // Record history
    this.recordHistory(message, result);

    logger.debug(
      { primaryRoute, confidence: result.confidence, multiIntent: result.isMultiIntent },
      "Message routed"
    );
    this.emit("message:routed", result);

    return result;
  }

  private scoreRoutes(message: string, context?: string[]): RouteScore[] {
    const contextText = context?.join(" ") ?? "";
    const queryVector = vectorize(message, this.routeIdfMap, this.docCount);
    const queryTokens = new Set(tokenize(message));

    return ROUTE_DEFINITIONS.map((route): RouteScore => {
      // 1. Semantic similarity: max cosine similarity against route corpus vectors
      const corpusVectors = this.routeCorpusVectors.get(route.id) ?? [];
      let maxSemantic = 0;
      for (const docVec of corpusVectors) {
        const sim = cosineSimilarity(queryVector, docVec);
        if (sim > maxSemantic) maxSemantic = sim;
      }

      // 2. Keyword overlap score
      const matchedKeywords = route.keywords.filter((kw) => {
        const kwTokens = kw.split(" ");
        return kwTokens.every((t) => queryTokens.has(t));
      });
      const keywordScore = Math.min(matchedKeywords.length / Math.max(route.keywords.length * 0.2, 1), 1);

      // 3. Context signal (if conversation history provided)
      let contextScore = 0;
      if (contextText) {
        const contextVector = vectorize(contextText, this.routeIdfMap, this.docCount);
        contextScore = cosineSimilarity(contextVector, queryVector) * 0.3;
        // Context bonus: if context was already in this route, boost
        const ctxTokens = new Set(tokenize(contextText));
        const ctxKeywordMatch = route.keywords.filter((kw) => ctxTokens.has(kw)).length;
        contextScore += ctxKeywordMatch / route.keywords.length * 0.2;
      }

      const confidence =
        maxSemantic * this.SEMANTIC_WEIGHT +
        keywordScore * this.KEYWORD_WEIGHT +
        contextScore * this.CONTEXT_WEIGHT;

      return {
        routeId: route.id,
        confidence: Math.min(confidence, 1),
        matchedKeywords,
        semanticScore: maxSemantic,
        keywordScore,
      };
    });
  }

  private detectSecondaryRoutes(scores: RouteScore[], primaryRoute: RouteId): RouteId[] {
    const primaryDef = ROUTE_DEFINITIONS.find((r) => r.id === primaryRoute);
    if (!primaryDef) return [];

    const primaryScore = scores.find((s) => s.routeId === primaryRoute)?.confidence ?? 0;
    const threshold = primaryScore * this.MULTI_INTENT_THRESHOLD;

    return scores
      .filter((s) => {
        if (s.routeId === primaryRoute) return false;
        if (s.confidence < threshold) return false;
        if (s.confidence < 0.3) return false;
        // Must be compatible with primary route
        return primaryDef.compatibleWith.includes(s.routeId);
      })
      .slice(0, 2) // max 2 secondary routes
      .map((s) => s.routeId);
  }

  private mergeOptimizations(
    primary: RouteDefinition,
    secondaryRoutes: RouteId[]
  ): RouteOptimizations {
    const base = { ...primary.optimizations };

    for (const secId of secondaryRoutes) {
      const secDef = ROUTE_DEFINITIONS.find((r) => r.id === secId);
      if (!secDef) continue;
      const sec = secDef.optimizations;

      // Merge: take the more capable/permissive option
      if (sec.maxTokens > base.maxTokens) base.maxTokens = sec.maxTokens;
      if (sec.useRAG) base.useRAG = true;
      if (sec.useWebSearch) base.useWebSearch = true;
      if (sec.useExtendedThinking) base.useExtendedThinking = true;

      // Upgrade model if secondary needs a more capable one
      const modelRank = { "claude-haiku-4-5": 0, "claude-sonnet-4-6": 1, "claude-opus-4-6": 2 };
      if ((modelRank[sec.model as keyof typeof modelRank] ?? 0) > (modelRank[base.model as keyof typeof modelRank] ?? 0)) {
        base.model = sec.model;
      }

      // Append system prompt prefix if different
      if (sec.systemPromptPrefix && sec.systemPromptPrefix !== base.systemPromptPrefix) {
        base.systemPromptPrefix = base.systemPromptPrefix
          ? `${base.systemPromptPrefix}\n\nAlso: ${sec.systemPromptPrefix}`
          : sec.systemPromptPrefix;
      }
    }

    return base;
  }

  private buildIntentSummary(primary: RouteId, secondary: RouteId[], confidence: number): string {
    const primaryDef = ROUTE_DEFINITIONS.find((r) => r.id === primary);
    if (!primaryDef) return "General inquiry";

    const confLabel = confidence > 0.7 ? "clearly" : confidence > 0.4 ? "likely" : "possibly";
    let summary = `${confLabel} ${primaryDef.name.toLowerCase()}`;

    if (secondary.length > 0) {
      const secNames = secondary.map((id) => ROUTE_DEFINITIONS.find((r) => r.id === id)?.name ?? id);
      summary += ` with ${secNames.join(" and ")} elements`;
    }

    return summary;
  }

  // ─── Advanced Routing with LLM Disambiguation ──────────────────────────────

  /**
   * Uses LLM to resolve ambiguous routing when confidence is below a threshold.
   * More expensive but more accurate for edge cases.
   */
  async routeWithLLMDisambiguation(
    message: string,
    conversationContext?: string[],
    ambiguityThreshold = 0.45
  ): Promise<RoutingResult> {
    const fastResult = await this.route(message, conversationContext);

    if (fastResult.confidence >= ambiguityThreshold || fastResult.isFallback) {
      return fastResult;
    }

    // Ambiguous — use LLM to decide
    const routeOptions = ROUTE_DEFINITIONS.map((r) => `- ${r.id}: ${r.description}`).join("\n");

    const response = await this.backbone.generateResponse({
      messages: [
        {
          role: "user",
          content: `Classify this user message into one or more routing categories:

Message: "${message}"
${conversationContext?.length ? `\nRecent context: ${conversationContext.slice(-3).join(" | ")}` : ""}

Available routes:
${routeOptions}

Return JSON only: { "primary": "route_id", "secondary": ["route_id"] | [], "reasoning": "brief explanation" }`,
        },
      ],
      model: "claude-haiku-4-5",
      maxTokens: 256,
      systemPrompt: "You are a message routing classifier. Return valid JSON only.",
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fastResult;
      const parsed = JSON.parse(jsonMatch[0]);

      const primaryRoute = (parsed.primary as RouteId) ?? fastResult.primaryRoute;
      const secondaryRoutes = ((parsed.secondary as RouteId[]) ?? []).filter(
        (r) => r !== primaryRoute && ROUTE_DEFINITIONS.some((d) => d.id === r)
      );

      const primaryDef = ROUTE_DEFINITIONS.find((r) => r.id === primaryRoute);
      if (!primaryDef) return fastResult;

      return {
        ...fastResult,
        primaryRoute,
        secondaryRoutes,
        isMultiIntent: secondaryRoutes.length > 0,
        optimizations: this.mergeOptimizations(primaryDef, secondaryRoutes),
        confidence: 0.75, // LLM disambiguation is high confidence
        isFallback: false,
        intentSummary: parsed.reasoning ?? fastResult.intentSummary,
      };
    } catch {
      return fastResult;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private cacheKey(message: string, context?: string[]): string {
    const payload = message + (context?.join("|") ?? "");
    return createHash("sha256").update(payload).digest("hex").slice(0, 16);
  }

  private setCache(key: string, result: RoutingResult): void {
    if (this.cache.size >= this.cacheMaxSize) {
      // Evict oldest entry
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(key, { result, cachedAt: Date.now() });
  }

  private recordHistory(message: string, result: RoutingResult): void {
    this.routingHistory.unshift({ message, result, timestamp: new Date() });
    if (this.routingHistory.length > this.maxHistorySize) {
      this.routingHistory.splice(this.maxHistorySize);
    }
  }

  // ─── Public Utilities ──────────────────────────────────────────────────────

  /** Plug in a real embedding provider for production-grade similarity */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
    logger.info("Real embedding provider registered");
  }

  getRouteDefinition(routeId: RouteId): RouteDefinition | undefined {
    return ROUTE_DEFINITIONS.find((r) => r.id === routeId);
  }

  getRoutingHistory(limit = 50): typeof this.routingHistory {
    return this.routingHistory.slice(0, limit);
  }

  getRouteStats(): Record<RouteId, { count: number; avgConfidence: number }> {
    const stats: Partial<Record<RouteId, { count: number; totalConf: number }>> = {};
    for (const entry of this.routingHistory) {
      const r = entry.result.primaryRoute;
      if (!stats[r]) stats[r] = { count: 0, totalConf: 0 };
      stats[r]!.count++;
      stats[r]!.totalConf += entry.result.confidence;
    }
    return Object.fromEntries(
      Object.entries(stats).map(([r, s]) => [r, { count: s!.count, avgConfidence: s!.totalConf / s!.count }])
    ) as Record<RouteId, { count: number; avgConfidence: number }>;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance: SemanticRouter | null = null;

export function getSemanticRouter(embeddingProvider?: EmbeddingProvider): SemanticRouter {
  if (!_instance) _instance = new SemanticRouter(embeddingProvider);
  return _instance;
}
