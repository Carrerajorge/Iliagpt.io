import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  gptSessions,
  type Gpt,
  type GptKnowledge,
  type GptSession,
  type InsertGptSession,
} from "@shared/schema";
import { createLogger } from "../utils/logger";

const log = createLogger("gpt-session-service");

export interface GptSessionContract {
  sessionId: string;
  gptId: string;
  configVersion: number;
  systemPrompt: string;
  enforcedModelId: string | null;
  modelFallbacks: string[];
  capabilities: {
    webBrowsing: boolean;
    codeInterpreter: boolean;
    imageGeneration: boolean;
    fileUpload: boolean;
    dataAnalysis: boolean;
  };
  toolPermissions: {
    mode: 'allowlist' | 'denylist';
    allowedTools: string[];
    actionsEnabled: boolean;
  };
  runtimePolicy?: {
    enforceModel: boolean;
    modelFallbacks: string[];
    maxTokensOverride?: number;
    temperatureOverride?: number;
    allowClientOverride: boolean;
  };
  knowledgeContext: string;
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface PromptSection {
  title: string;
  content?: string | null;
}

interface ResolvedGptRuntimeConfig {
  systemPrompt: string;
  capabilities: {
    webBrowsing: boolean;
    codeInterpreter: boolean;
    imageGeneration: boolean;
    fileUpload: boolean;
    dataAnalysis: boolean;
  };
  toolPermissions: {
    mode: 'allowlist' | 'denylist';
    tools: string[];
    actionsEnabled: boolean;
  };
  runtimePolicy: {
    enforceModel: boolean;
    modelFallbacks: string[];
    maxTokensOverride?: number;
    temperatureOverride?: number;
    allowClientOverride: boolean;
  };
  preferredModel: string | null;
  temperature: number;
  topP: number;
  maxTokens: number;
}

const DEFAULT_CAPABILITIES = {
  webBrowsing: false,
  codeInterpreter: false,
  imageGeneration: false,
  fileUpload: false,
  dataAnalysis: false,
};

const DEFAULT_TOOL_PERMISSIONS = {
  mode: 'allowlist' as const,
  tools: [] as string[],
  actionsEnabled: true,
};

const DEFAULT_RUNTIME_POLICY = {
  enforceModel: false,
  modelFallbacks: [] as string[],
  allowClientOverride: false,
};

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TOP_P = 1;
const DEFAULT_MAX_TOKENS = 4096;

function parseNumber(value: unknown, fallback: number): number;
function parseNumber(value: unknown, fallback: undefined): number | undefined;
function parseNumber(value: unknown, fallback: number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function toRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function normalizeCapabilities(value: unknown): ResolvedGptRuntimeConfig["capabilities"] {
  const source = toRecord(value) ?? {};
  return {
    webBrowsing: parseBoolean(source.webBrowsing, DEFAULT_CAPABILITIES.webBrowsing),
    codeInterpreter: parseBoolean(source.codeInterpreter, DEFAULT_CAPABILITIES.codeInterpreter),
    imageGeneration: parseBoolean(source.imageGeneration, DEFAULT_CAPABILITIES.imageGeneration),
    fileUpload: parseBoolean(source.fileUpload, DEFAULT_CAPABILITIES.fileUpload),
    dataAnalysis: parseBoolean(source.dataAnalysis, DEFAULT_CAPABILITIES.dataAnalysis),
  };
}

function normalizeToolPermissions(value: unknown): ResolvedGptRuntimeConfig["toolPermissions"] {
  const source = toRecord(value) ?? {};
  return {
    mode: source.mode === "denylist" ? "denylist" : DEFAULT_TOOL_PERMISSIONS.mode,
    tools: Array.isArray(source.tools) ? source.tools.filter((tool) => typeof tool === "string") : DEFAULT_TOOL_PERMISSIONS.tools,
    actionsEnabled: parseBoolean(source.actionsEnabled, DEFAULT_TOOL_PERMISSIONS.actionsEnabled),
  };
}

function normalizeRuntimePolicy(value: unknown): ResolvedGptRuntimeConfig["runtimePolicy"] {
  const source = toRecord(value) ?? {};
  return {
    enforceModel: parseBoolean(source.enforceModel, DEFAULT_RUNTIME_POLICY.enforceModel),
    modelFallbacks: Array.isArray(source.modelFallbacks) ? source.modelFallbacks.filter((name) => typeof name === "string") : DEFAULT_RUNTIME_POLICY.modelFallbacks,
    maxTokensOverride: parseNumber(source.maxTokensOverride, undefined),
    temperatureOverride: parseNumber(source.temperatureOverride, undefined),
    allowClientOverride: parseBoolean(source.allowClientOverride, DEFAULT_RUNTIME_POLICY.allowClientOverride),
  };
}

function buildRawKnowledgeContext(knowledgeItems: GptKnowledge[]): string {
  const activeItems = knowledgeItems.filter(k => k.isActive === "true" && k.extractedText);
  if (activeItems.length === 0) return "";

  const contextParts = activeItems.map(item => {
    const header = `=== Knowledge: ${item.fileName} ===`;
    const content = item.extractedText || "";
    return `${header}\n${content}`;
  });

  return contextParts.join("\n\n");
}

/**
 * Build knowledge context using semantic vector search against the user's query.
 * Falls back to raw text concatenation when embeddings are not available.
 */
export async function buildKnowledgeContextForQuery(
  gptId: string,
  userQuery: string,
  knowledgeItems: GptKnowledge[],
  maxChunks: number = 5,
): Promise<string> {
  try {
    const { generateEmbedding } = await import("../embeddingService");
    const queryEmbedding = await generateEmbedding(userQuery);

    // Vector search in ragChunks for this GPT's knowledge
    const results = await db.execute(sql`
      SELECT content, metadata,
             1 - (embedding <=> ${sql.raw(`'[${queryEmbedding.join(",")}]'::vector`)}) as similarity
      FROM rag_chunks
      WHERE source = 'gpt_knowledge' AND source_id = ${gptId} AND is_active = true
      ORDER BY embedding <=> ${sql.raw(`'[${queryEmbedding.join(",")}]'::vector`)}
      LIMIT ${maxChunks}
    `);

    const rows = (results as any).rows;
    if (!rows || rows.length === 0) {
      // No embeddings yet — fallback to raw text
      return buildRawKnowledgeContext(knowledgeItems);
    }

    const chunks = rows
      .filter((r: any) => r.similarity > 0.3)
      .map((r: any) => {
        const meta = r.metadata as any;
        return `[${meta?.fileName || "knowledge"}]: ${r.content}`;
      });

    if (chunks.length === 0) {
      // Similarity too low — fallback to raw text
      return buildRawKnowledgeContext(knowledgeItems);
    }

    return chunks.join("\n\n");
  } catch (error: any) {
    // Fallback to existing raw text approach if DB query or embeddings fail
    log.warn("Semantic knowledge retrieval failed, falling back to raw text", {
      gptId,
      error: error.message,
    });
    return buildRawKnowledgeContext(knowledgeItems);
  }
}

async function resolveGptRuntimeConfig(gpt: Gpt, configVersion: number): Promise<ResolvedGptRuntimeConfig> {
  const version = await storage.getGptVersionByNumber(gpt.id, configVersion);
  const definitionSnapshot = toRecord(version?.definitionSnapshot) ?? toRecord(gpt.definition);

  const capabilities = {
    ...DEFAULT_CAPABILITIES,
    ...normalizeCapabilities(gpt.capabilities),
    ...normalizeCapabilities(definitionSnapshot?.capabilities),
  };

  const runtimePolicy = {
    ...DEFAULT_RUNTIME_POLICY,
    ...normalizeRuntimePolicy(gpt.runtimePolicy),
    ...normalizeRuntimePolicy(definitionSnapshot?.policies),
  };

  const toolPermissions = {
    ...DEFAULT_TOOL_PERMISSIONS,
    ...normalizeToolPermissions(gpt.toolPermissions),
  };

  const baseTemperature = parseNumber(version?.temperature ?? gpt.temperature, parseNumber(gpt.temperature, DEFAULT_TEMPERATURE)!);
  const baseTopP = parseNumber(version?.topP ?? gpt.topP, parseNumber(gpt.topP, DEFAULT_TOP_P)!);
  const baseMaxTokens = parseNumber(
    version?.maxTokens ?? gpt.maxTokens,
    parseNumber(gpt.maxTokens, DEFAULT_MAX_TOKENS)!
  );

  return {
    systemPrompt: typeof definitionSnapshot?.instructions === "string" && definitionSnapshot.instructions.length > 0
      ? definitionSnapshot.instructions
      : gpt.systemPrompt,
    capabilities,
    toolPermissions,
    runtimePolicy,
    preferredModel: typeof definitionSnapshot?.model === "string" && definitionSnapshot.model.length > 0
      ? definitionSnapshot.model
      : gpt.recommendedModel || null,
    temperature: parseNumber(runtimePolicy.temperatureOverride, baseTemperature),
    topP: baseTopP,
    maxTokens: parseNumber(runtimePolicy.maxTokensOverride, baseMaxTokens),
  };
}

function mapDbSessionToContract(session: GptSession, runtimeConfig: ResolvedGptRuntimeConfig, knowledgeContext: string): GptSessionContract {
  const capabilities = runtimeConfig.capabilities;
  const runtimePolicy = runtimeConfig.runtimePolicy;

  return {
    sessionId: session.id,
    gptId: session.gptId,
    configVersion: session.configVersion,
    systemPrompt: runtimeConfig.systemPrompt,
    enforcedModelId: session.enforcedModelId || runtimeConfig.preferredModel,
    modelFallbacks: runtimePolicy.modelFallbacks || [],
    capabilities: {
      webBrowsing: capabilities.webBrowsing ?? false,
      codeInterpreter: capabilities.codeInterpreter ?? false,
      imageGeneration: capabilities.imageGeneration ?? false,
      fileUpload: capabilities.fileUpload ?? false,
      dataAnalysis: capabilities.dataAnalysis ?? false,
    },
    toolPermissions: {
      mode: runtimeConfig.toolPermissions.mode || 'allowlist',
      allowedTools: runtimeConfig.toolPermissions.tools || [],
      actionsEnabled: runtimeConfig.toolPermissions.actionsEnabled ?? true,
    },
    runtimePolicy: {
      enforceModel: runtimePolicy.enforceModel ?? false,
      modelFallbacks: runtimePolicy.modelFallbacks || [],
      maxTokensOverride: runtimePolicy.maxTokensOverride,
      temperatureOverride: runtimePolicy.temperatureOverride,
      allowClientOverride: runtimePolicy.allowClientOverride ?? false,
    },
    knowledgeContext,
    temperature: runtimeConfig.temperature,
    topP: runtimeConfig.topP,
    maxTokens: runtimeConfig.maxTokens,
  };
}

export async function createGptSession(chatId: string | null, gptId: string): Promise<GptSessionContract> {
  const gpt = await storage.getGpt(gptId);
  if (!gpt) {
    throw new Error(`GPT not found: ${gptId}`);
  }

  const knowledgeItems = await storage.getGptKnowledge(gptId);
  const knowledgeContext = buildRawKnowledgeContext(knowledgeItems);
  const knowledgeContextIds = knowledgeItems
    .filter(k => k.isActive === "true")
    .map(k => k.id);

  const configVersion = parseNumber(gpt.version, 1) || 1;
  const runtimeConfig = await resolveGptRuntimeConfig(gpt, configVersion);

  let enforcedModelId: string | null = null;
  if (runtimeConfig.runtimePolicy.enforceModel) {
    enforcedModelId = runtimeConfig.preferredModel || runtimeConfig.runtimePolicy.modelFallbacks[0] || DEFAULT_MODEL;
  }

  const sessionData: InsertGptSession = {
    chatId: chatId || null,
    gptId,
    configVersion,
    frozenSystemPrompt: runtimeConfig.systemPrompt,
    frozenCapabilities: {
      webBrowsing: runtimeConfig.capabilities.webBrowsing ?? false,
      codeInterpreter: runtimeConfig.capabilities.codeInterpreter ?? false,
      imageGeneration: runtimeConfig.capabilities.imageGeneration ?? false,
      fileUpload: runtimeConfig.capabilities.fileUpload ?? false,
      dataAnalysis: runtimeConfig.capabilities.dataAnalysis ?? false,
    },
    frozenToolPermissions: {
      mode: runtimeConfig.toolPermissions.mode || 'allowlist',
      tools: runtimeConfig.toolPermissions.tools || [],
      actionsEnabled: runtimeConfig.toolPermissions.actionsEnabled ?? true,
    },
    frozenRuntimePolicy: {
      enforceModel: runtimeConfig.runtimePolicy.enforceModel ?? false,
      modelFallbacks: runtimeConfig.runtimePolicy.modelFallbacks || [],
      maxTokensOverride: runtimeConfig.runtimePolicy.maxTokensOverride,
      temperatureOverride: runtimeConfig.runtimePolicy.temperatureOverride,
      allowClientOverride: runtimeConfig.runtimePolicy.allowClientOverride ?? false,
    },
    enforcedModelId,
    knowledgeContextIds,
  };

  const [insertedSession] = await db.insert(gptSessions).values(sessionData).returning();
  
  return mapDbSessionToContract(insertedSession, runtimeConfig, knowledgeContext);
}

export async function getOrCreateSession(chatId: string, gptId: string): Promise<GptSessionContract> {
  if (!chatId || chatId.trim() === "" || chatId.startsWith("pending-")) {
    return createGptSession(null, gptId);
  }

  const [existingSession] = await db
    .select()
    .from(gptSessions)
    .where(and(eq(gptSessions.chatId, chatId), eq(gptSessions.gptId, gptId)));

  if (existingSession) {
    const gpt = await storage.getGpt(gptId);
    if (!gpt) {
      throw new Error(`GPT not found: ${gptId}`);
    }

    const knowledgeItems = await storage.getGptKnowledge(gptId);
    const filteredKnowledgeItems = knowledgeItems.filter(k => existingSession.knowledgeContextIds?.includes(k.id));
    const knowledgeContext = buildRawKnowledgeContext(filteredKnowledgeItems);
    const runtimeConfig = await resolveGptRuntimeConfig(gpt, existingSession.configVersion);

    return mapDbSessionToContract(existingSession, runtimeConfig, knowledgeContext);
  }

  return createGptSession(chatId, gptId);
}

export function isToolAllowed(contract: GptSessionContract, toolName: string): boolean {
  const { mode, allowedTools, actionsEnabled } = contract.toolPermissions;

  if (!actionsEnabled) {
    return false;
  }

  if (mode === 'allowlist') {
    if (allowedTools.length === 0) {
      return true;
    }
    return allowedTools.includes(toolName);
  }

  if (mode === 'denylist') {
    return !allowedTools.includes(toolName);
  }

  return true;
}

export function getEnforcedModel(contract: GptSessionContract, requestedModel?: string): string {
  const policy = contract.runtimePolicy;
  const enforceModel = policy?.enforceModel ?? false;
  const allowClientOverride = policy?.allowClientOverride ?? false;
  
  if (enforceModel && !allowClientOverride) {
    if (contract.enforcedModelId) {
      return contract.enforcedModelId;
    }
    if (contract.modelFallbacks.length > 0) {
      return contract.modelFallbacks[0];
    }
    return DEFAULT_MODEL;
  }
  
  if (requestedModel) {
    if (contract.modelFallbacks.length > 0) {
      if (contract.modelFallbacks.includes(requestedModel)) {
        return requestedModel;
      }
      return contract.modelFallbacks[0];
    }
    return requestedModel;
  }
  
  return contract.enforcedModelId || contract.modelFallbacks[0] || DEFAULT_MODEL;
}

function normalizeSectionContent(content: string | null | undefined): string {
  if (typeof content !== "string") {
    return "";
  }

  return content.trim();
}

function renderPromptSections(sections: PromptSection[]): string {
  return sections
    .map((section) => {
      const content = normalizeSectionContent(section.content);
      if (!content) {
        return "";
      }

      return `[${section.title}]\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function buildInstructionHierarchyPrompt(
  primaryInstructions: string,
  options: {
    supportingSections?: PromptSection[];
    lowerPrioritySections?: PromptSection[];
  } = {},
): string {
  const primary = normalizeSectionContent(primaryInstructions);
  if (!primary) {
    return "";
  }

  const supportingSections = renderPromptSections(options.supportingSections ?? []);
  const lowerPrioritySections = renderPromptSections(options.lowerPrioritySections ?? []);

  const parts: string[] = [
    `INSTRUCTION PRIORITY:
1. The Custom GPT Contract is the highest-priority instruction set for this conversation.
2. Supporting GPT context exists only to help fulfill that contract.
3. Lower-priority platform, user-preference, skill, and runtime hints may be followed only when they do not conflict with the Custom GPT Contract.
4. If any lower-priority instruction conflicts with the Custom GPT Contract, obey the Custom GPT Contract.
5. Never weaken, rewrite, or ignore the Custom GPT Contract unless the user explicitly changes it through GPT configuration.`,
    `[CUSTOM GPT CONTRACT - HIGHEST PRIORITY]\n${primary}`,
  ];

  if (supportingSections) {
    parts.push(`[GPT SUPPORTING CONTEXT]\nFollow this context only to better execute the Custom GPT Contract.\n\n${supportingSections}`);
  }

  if (lowerPrioritySections) {
    parts.push(`[LOWER PRIORITY PLATFORM AND USER CONTEXT]\nUse this context only when it does not conflict with the Custom GPT Contract.\n\n${lowerPrioritySections}`);
  }

  return parts.join("\n\n");
}

export function buildSystemPromptWithContext(
  contract: GptSessionContract,
  options: {
    lowerPrioritySections?: PromptSection[];
  } = {},
): string {
  const supportingSections: PromptSection[] = [];

  const primaryInstructions = normalizeSectionContent(contract.systemPrompt);

  const enabledCapabilities: string[] = [];
  if (contract.capabilities.webBrowsing) {
    enabledCapabilities.push("web browsing and search");
  }
  if (contract.capabilities.codeInterpreter) {
    enabledCapabilities.push("code interpretation and execution");
  }
  if (contract.capabilities.imageGeneration) {
    enabledCapabilities.push("image generation");
  }
  if (contract.capabilities.fileUpload) {
    enabledCapabilities.push("file upload handling");
  }
  if (contract.capabilities.dataAnalysis) {
    enabledCapabilities.push("data analysis");
  }

  if (enabledCapabilities.length > 0) {
    supportingSections.push({
      title: "Enabled Capabilities",
      content: enabledCapabilities.join(", "),
    });
  }

  if (contract.knowledgeContext) {
    supportingSections.push({
      title: "Knowledge Base",
      content: contract.knowledgeContext,
    });
  }

  return buildInstructionHierarchyPrompt(primaryInstructions, {
    supportingSections,
    lowerPrioritySections: options.lowerPrioritySections,
  });
}

export async function getSessionByChatId(chatId: string): Promise<GptSession | null> {
  const [session] = await db
    .select()
    .from(gptSessions)
    .where(eq(gptSessions.chatId, chatId));
  
  return session || null;
}

export async function getSessionById(sessionId: string): Promise<GptSessionContract | null> {
  const [session] = await db
    .select()
    .from(gptSessions)
    .where(eq(gptSessions.id, sessionId))
    .limit(1);
  
  if (!session) return null;
  
  const gpt = await storage.getGpt(session.gptId);
  if (!gpt) return null;
  
  const knowledgeItems = await storage.getGptKnowledge(session.gptId);
  const knowledgeContext = buildRawKnowledgeContext(
    knowledgeItems.filter(k => session.knowledgeContextIds?.includes(k.id))
  );
  const runtimeConfig = await resolveGptRuntimeConfig(gpt, session.configVersion);

  return mapDbSessionToContract(session, runtimeConfig, knowledgeContext);
}

export async function deleteSessionByChatId(chatId: string): Promise<void> {
  await db.delete(gptSessions).where(eq(gptSessions.chatId, chatId));
}
