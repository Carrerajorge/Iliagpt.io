import { Router, Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../types/express";
import { conversationStateService } from "../services/conversationStateService";
import { z } from "zod";
import { ContextRetriever, RetrievedContext, RetrievalConfig } from "../lib/contextRetriever";
import { PromptBuilder, PromptBuildOptions } from "../lib/promptBuilder";
import { KeywordExtractor } from "../lib/keywordExtractor";
import { AutoSummarizer, SummaryResult } from "../lib/autoSummarizer";
import { IntentRouter, DetectedIntent, IntentType } from "../lib/intentRouter";
import { RAGRetriever } from "../lib/ragRetriever";

const router = Router();

const appendMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  chatMessageId: z.string().optional(),
  tokenCount: z.number().optional(),
  attachmentIds: z.array(z.string()).optional(),
  imageIds: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const addArtifactSchema = z.object({
  artifactType: z.string(),
  mimeType: z.string(),
  storageUrl: z.string(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  messageId: z.string().optional(),
  extractedText: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const addImageSchema = z.object({
  prompt: z.string(),
  imageUrl: z.string(),
  model: z.string(),
  mode: z.enum(["generate", "edit_last", "edit_specific"]).default("generate"),
  messageId: z.string().optional(),
  parentImageId: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  base64Preview: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const updateContextSchema = z.object({
  summary: z.string().optional(),
  entities: z.array(z.object({
    name: z.string(),
    type: z.string(),
    mentions: z.number().default(1),
    lastMentioned: z.string().optional(),
  })).optional(),
  userPreferences: z.record(z.string(), z.unknown()).optional(),
  topics: z.array(z.string()).optional(),
  sentiment: z.enum(["positive", "negative", "neutral"]).optional(),
});

router.get("/chats/:chatId/state", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const forceRefresh = req.query.refresh === "true";
    const userId = (req as AuthenticatedRequest).user?.id;

    // The frontend expects this endpoint to exist and to return a state object.
    // If no state exists yet, create it (idempotent) so the UI doesn't get stuck in a 404 loop.
    const state = forceRefresh
      ? await conversationStateService.getOrCreateState(chatId, userId)
      : (await conversationStateService.hydrateState(chatId, userId, { forceRefresh })) ||
        (await conversationStateService.getOrCreateState(chatId, userId));

    res.json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET state error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const userId = (req as AuthenticatedRequest).user?.id;

    const state = await conversationStateService.getOrCreateState(chatId, userId);
    res.status(201).json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST state error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/messages", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const validation = appendMessageSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { role, content, ...options } = validation.data;
    const state = await conversationStateService.appendMessage(chatId, role, content, options);

    res.status(201).json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST message error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/artifacts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const validation = addArtifactSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { artifactType, mimeType, storageUrl, fileName, fileSize, ...options } = validation.data;
    const state = await conversationStateService.addArtifact(
      chatId,
      artifactType,
      mimeType,
      storageUrl,
      fileName,
      fileSize,
      undefined,
      options
    );

    res.status(201).json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST artifact error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/images", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const validation = addImageSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { prompt, imageUrl, model, mode, ...options } = validation.data;
    const state = await conversationStateService.addImage(chatId, prompt, imageUrl, model, mode, options);

    res.status(201).json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST image error:", error.message);
    next(error);
  }
});

router.patch("/chats/:chatId/state/context", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const validation = updateContextSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const state = await conversationStateService.updateContext(chatId, validation.data);
    res.json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] PATCH context error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/snapshot", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const { description } = req.body;
    const authorId = (req as AuthenticatedRequest).user?.id;

    const version = await conversationStateService.createSnapshot(chatId, description, authorId);
    res.status(201).json({ version, chatId });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST snapshot error:", error.message);
    next(error);
  }
});

router.get("/chats/:chatId/state/versions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const versions = await conversationStateService.getVersionHistory(chatId);
    res.json({ versions });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET versions error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/restore/:version", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId, version } = req.params;
    const versionNum = parseInt(version, 10);

    if (isNaN(versionNum)) {
      return res.status(400).json({ error: "Invalid version number" });
    }

    const state = await conversationStateService.restoreToVersion(chatId, versionNum);
    if (!state) {
      return res.status(404).json({ error: "Version not found" });
    }

    res.json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST restore error:", error.message);
    next(error);
  }
});

router.get("/chats/:chatId/state/latest-image", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const image = await conversationStateService.getLatestImage(chatId);

    if (!image) {
      return res.status(404).json({ error: "No images found" });
    }

    res.json(image);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET latest-image error:", error.message);
    next(error);
  }
});

router.get("/images/:imageId/chain", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { imageId } = req.params;
    const chain = await conversationStateService.getImageEditChain(imageId);
    res.json({ chain });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET image chain error:", error.message);
    next(error);
  }
});

router.delete("/chats/:chatId/state", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    await conversationStateService.deleteState(chatId);
    res.status(204).send();
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] DELETE state error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/analyze-intent", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }
    const intent = await conversationStateService.analyzeIntent(chatId, message);
    res.json({ intent });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST analyze-intent error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const { query, options } = req.body;
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }
    const results = await conversationStateService.searchContext(chatId, query, options);
    res.json({ results });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST search error:", error.message);
    next(error);
  }
});

router.get("/chats/:chatId/facts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facts = await conversationStateService.getMemoryFacts(req.params.chatId);
    res.json({ facts });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET facts error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/facts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fact = await conversationStateService.addMemoryFact(req.params.chatId, req.body);
    res.status(201).json({ fact });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST facts error:", error.message);
    next(error);
  }
});

router.patch("/facts/:factId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fact = await conversationStateService.updateMemoryFact(req.params.factId, req.body);
    if (!fact) {
      return res.status(404).json({ error: "Fact not found" });
    }
    res.json({ fact });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] PATCH facts error:", error.message);
    next(error);
  }
});

router.delete("/facts/:factId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await conversationStateService.deleteMemoryFact(req.params.factId);
    res.status(204).send();
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] DELETE facts error:", error.message);
    next(error);
  }
});

router.get("/chats/:chatId/summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await conversationStateService.getSummary(req.params.chatId);
    res.json({ summary });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET summary error:", error.message);
    next(error);
  }
});

router.put("/chats/:chatId/summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await conversationStateService.updateSummary(req.params.chatId, req.body);
    res.json({ summary });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] PUT summary error:", error.message);
    next(error);
  }
});

router.get("/cache-stats", async (_req: Request, res: Response) => {
  const stats = conversationStateService.getCacheStats();
  res.json(stats);
});

const processTurnSchema = z.object({
  message: z.string().min(1),
  requestId: z.string().optional(),
  options: z.object({
    language: z.enum(["es", "en"]).optional(),
    maxContextTokens: z.number().optional(),
  }).optional(),
});

const retrieveContextSchema = z.object({
  query: z.string().min(1),
  intent: z.object({
    type: z.string().optional(),
    confidence: z.number().optional(),
    requiresRAG: z.boolean().optional(),
    ragQuery: z.string().nullable().optional(),
    artifactReferences: z.array(z.any()).optional(),
    imageReferences: z.array(z.any()).optional(),
    imageEditParams: z.any().nullable().optional(),
  }).optional(),
  config: z.object({
    ragTopK: z.number().optional(),
    ragMinScore: z.number().optional(),
    recencyWindowSize: z.number().optional(),
    enableRunningSummary: z.boolean().optional(),
    maxFactsToInclude: z.number().optional(),
  }).optional(),
});

const buildPromptSchema = z.object({
  message: z.string().min(1),
  context: z.any().optional(),
  intent: z.any().optional(),
  options: z.object({
    includeSystemContext: z.boolean().optional(),
    language: z.enum(["es", "en"]).optional(),
    citationFormat: z.enum(["numbered", "bracketed"]).optional(),
    maxContextTokens: z.number().optional(),
  }).optional(),
});

const extractKeywordsSchema = z.object({
  text: z.string().min(1),
  maxKeywords: z.number().optional(),
});

const summarizeSchema = z.object({
  force: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),
});

const telemetryStore = new Map<string, { queries: Array<{ timeMs: number; chunksRetrieved: number; timestamp: number }> }>();

router.post("/chats/:chatId/process-turn", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const startTime = performance.now();

    const validation = processTurnSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { message, requestId, options } = validation.data;
    const userId = (req as AuthenticatedRequest).user?.id;

    let wasIdempotent = false;
    if (requestId) {
      const existing = await conversationStateService.hydrateState(chatId, userId);
      if (existing?.messages?.some(m => (m as Record<string, any>).requestId === requestId)) {
        wasIdempotent = true;
      }
    }

    const state = await conversationStateService.getOrCreateState(chatId, userId);

    const conversationState = {
      artifacts: (state.artifacts || []).map(a => ({ artifactId: a.id, ...a })),
      images: (state.images || []).map(img => ({ imageId: img.id, ...img })),
    };
    const intent = IntentRouter.detectIntent(message, conversationState);

    const ragRetriever = new RAGRetriever(chatId);
    const contextRetriever = new ContextRetriever(ragRetriever, options?.maxContextTokens ? { ragTopK: 5 } : {});
    const context = await contextRetriever.retrieve(state, message, intent);

    const promptBuilder = new PromptBuilder(options?.maxContextTokens || 4000);
    const prompt = promptBuilder.build(message, context, intent, {
      language: options?.language || "es",
    });

    const processingTimeMs = performance.now() - startTime;

    if (!telemetryStore.has(chatId)) {
      telemetryStore.set(chatId, { queries: [] });
    }
    const telemetry = telemetryStore.get(chatId)!;
    telemetry.queries.push({
      timeMs: processingTimeMs,
      chunksRetrieved: context.relevantChunks.length,
      timestamp: Date.now(),
    });
    if (telemetry.queries.length > 100) {
      telemetry.queries = telemetry.queries.slice(-100);
    }

    res.json({
      intent,
      context,
      prompt,
      wasIdempotent,
      processingTimeMs,
    });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST process-turn error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/retrieve-context", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const startTime = performance.now();

    const validation = retrieveContextSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { query, intent: partialIntent, config } = validation.data;
    const userId = (req as AuthenticatedRequest).user?.id;

    const state = await conversationStateService.getOrCreateState(chatId, userId);

    const defaultIntent: DetectedIntent = {
      type: IntentType.CONTINUE_CONVERSATION,
      confidence: 0.5,
      artifactReferences: [],
      imageReferences: [],
      requiresRAG: true,
      ragQuery: query,
      imageEditParams: null,
    };
    const intent = { ...defaultIntent, ...partialIntent } as DetectedIntent;

    const ragRetriever = new RAGRetriever(chatId);
    const contextRetriever = new ContextRetriever(ragRetriever, config as Partial<RetrievalConfig>);
    const context = await contextRetriever.retrieve(state, query, intent);

    const timeMs = performance.now() - startTime;

    res.json({ context, timeMs });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST retrieve-context error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/build-prompt", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;

    const validation = buildPromptSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { message, context: providedContext, intent: providedIntent, options } = validation.data;
    const userId = (req as AuthenticatedRequest).user?.id;

    let context: RetrievedContext;
    let intent: DetectedIntent;

    if (providedContext && providedIntent) {
      context = providedContext as RetrievedContext;
      intent = providedIntent as DetectedIntent;
    } else {
      const state = await conversationStateService.getOrCreateState(chatId, userId);

      const conversationState = {
        artifacts: (state.artifacts || []).map(a => ({ artifactId: a.id, ...a })),
        images: (state.images || []).map(img => ({ imageId: img.id, ...img })),
      };
      intent = providedIntent as DetectedIntent || IntentRouter.detectIntent(message, conversationState);

      if (!providedContext) {
        const ragRetriever = new RAGRetriever(chatId);
        const contextRetriever = new ContextRetriever(ragRetriever);
        context = await contextRetriever.retrieve(state, message, intent);
      } else {
        context = providedContext as RetrievedContext;
      }
    }

    const promptBuilder = new PromptBuilder(options?.maxContextTokens || 4000);
    const prompt = promptBuilder.build(message, context, intent, options as PromptBuildOptions);

    res.json({ prompt });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST build-prompt error:", error.message);
    next(error);
  }
});

router.get("/chats/:chatId/telemetry", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;

    const telemetry = telemetryStore.get(chatId);
    if (!telemetry || telemetry.queries.length === 0) {
      return res.json({
        stats: {
          avgTimeMs: 0,
          totalQueries: 0,
          avgChunks: 0,
        },
        recentQueries: [],
      });
    }

    const queries = telemetry.queries;
    const totalQueries = queries.length;
    const avgTimeMs = queries.reduce((sum, q) => sum + q.timeMs, 0) / totalQueries;
    const avgChunks = queries.reduce((sum, q) => sum + q.chunksRetrieved, 0) / totalQueries;

    const recentQueries = queries.slice(-10).map(q => ({
      timeMs: Math.round(q.timeMs * 100) / 100,
      chunksRetrieved: q.chunksRetrieved,
      timestamp: new Date(q.timestamp).toISOString(),
    }));

    res.json({
      stats: {
        avgTimeMs: Math.round(avgTimeMs * 100) / 100,
        totalQueries,
        avgChunks: Math.round(avgChunks * 100) / 100,
      },
      recentQueries,
    });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET telemetry error:", error.message);
    next(error);
  }
});

router.post("/extract-keywords", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = extractKeywordsSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { text, maxKeywords } = validation.data;

    const keywords = KeywordExtractor.extract(text, maxKeywords || 10);
    const entities = KeywordExtractor.extractEntities(text);

    res.json({
      keywords,
      entities: entities.map(e => ({ text: e.text, type: e.type })),
    });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST extract-keywords error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/summarize", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;

    const validation = summarizeSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { force, language } = validation.data;
    const userId = (req as AuthenticatedRequest).user?.id;

    const state = await conversationStateService.getOrCreateState(chatId, userId);
    const messages = state.messages || [];

    if (messages.length === 0) {
      return res.json({
        summary: null,
        wasTriggered: false,
      });
    }

    const summarizer = new AutoSummarizer({ summaryLanguage: language || "es" });

    const currentTurn = messages.length;
    const existingSummary = state.context?.summary || undefined;
    const lastSummarizedTurn = (state.context as Record<string, any>)?.lastSummarizedTurn || 0;

    const shouldTrigger = force || summarizer.shouldSummarize(currentTurn, lastSummarizedTurn);

    if (!shouldTrigger) {
      return res.json({
        summary: existingSummary ? {
          summary: existingSummary,
          tokenCount: Math.ceil((existingSummary as string).length / 4),
          mainTopics: state.context?.topics || [],
          keyEntities: (state.context?.entities || []).map((e: any) => e.name),
          lastSummarizedTurn,
        } : null,
        wasTriggered: false,
      });
    }

    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const summary = await summarizer.summarize(formattedMessages, existingSummary, language);

    await conversationStateService.updateContext(chatId, {
      summary: summary.summary,
      topics: summary.mainTopics,
      entities: summary.keyEntities.map(name => ({
        name,
        type: "extracted",
        mentions: 1,
      })),
    });

    res.json({
      summary,
      wasTriggered: true,
    });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST summarize error:", error.message);
    next(error);
  }
});

export default router;
