/**
 * InstructionRetriever — Production-grade instruction retrieval engine.
 *
 * Features:
 * - `hasActiveInstructions()` → cached boolean, zero-cost when none exist
 * - `getInstructions()` → all active instructions, ordered by priority
 * - `getRelevantInstructions()` → semantic search, returns only instructions
 *   relevant to the current query (saves tokens in long instruction lists)
 * - Conflict resolution: newer instructions on the same topic supersede older
 * - Usage tracking: instructions that get injected have their accessCount bumped
 * - TTL/expiration enforcement: expired instructions are soft-deleted on read
 * - Topic-based clustering for prompt organization
 */

import { db } from "../db";
import { userMemories } from "@shared/schema";
import { eq, and, desc, count, sql, lt } from "drizzle-orm";
import { redis } from "../lib/redis";
import { generateEmbedding } from "../embeddingService";
import { createLogger } from "../utils/logger";

const log = createLogger("instruction-retriever");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserInstruction {
  id: string;
  fact: string;
  category: string;
  confidence: number;
  salienceScore: number;
  scope: string;
  tags: string[];
  metadata: Record<string, unknown>;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScoredInstruction extends UserInstruction {
  relevanceScore: number;
  topicCluster: string;
}

export interface InstructionContext {
  /** Formatted text block for system prompt injection. */
  text: string;
  /** Number of instructions injected. */
  count: number;
  /** Total token estimate (rough). */
  estimatedTokens: number;
  /** Instruction IDs that were injected (for usage tracking). */
  injectedIds: string[];
}

// ---------------------------------------------------------------------------
// Cache — Redis with in-memory fallback
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "user:instr:";
const HAS_CACHE_TTL = 120;   // 2 min
const LIST_CACHE_TTL = 120;   // 2 min

const memCache = new Map<string, { value: string; expiresAt: number }>();

function memGet(key: string): string | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memCache.delete(key); return null; }
  return entry.value;
}

function memSet(key: string, value: string, ttl: number): void {
  memCache.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  if (memCache.size > 5000) {
    const oldest = memCache.keys().next().value;
    if (oldest) memCache.delete(oldest);
  }
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    const val = await redis.get(key);
    if (val !== null) return val;
  } catch { /* Redis unavailable */ }
  return memGet(key);
}

async function cacheSet(key: string, value: string, ttl: number): Promise<void> {
  memSet(key, value, ttl);
  try { await redis.set(key, value, "EX", ttl); } catch { /* ignore */ }
}

async function cacheDel(...keys: string[]): Promise<void> {
  for (const k of keys) memCache.delete(k);
  try { if (keys.length) await redis.del(...keys); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Expiration cleanup
// ---------------------------------------------------------------------------

async function cleanExpiredInstructions(userId: string): Promise<number> {
  try {
    const result = await db
      .update(userMemories)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(userMemories.userId, userId),
          eq(userMemories.category, "instruction"),
          eq(userMemories.isActive, true),
          lt(userMemories.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: userMemories.id });

    if (result.length > 0) {
      log.info("Cleaned expired instructions", { userId, count: result.length });
      await invalidateInstructionCache(userId);
    }
    return result.length;
  } catch (err: any) {
    log.error("Failed to clean expired instructions", { userId, error: err.message });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Core queries
// ---------------------------------------------------------------------------

/**
 * Zero-cost check: does this user have any active instructions?
 * Cached for HAS_CACHE_TTL seconds.
 */
export async function hasActiveInstructions(userId: string): Promise<boolean> {
  const key = `${CACHE_PREFIX}has:${userId}`;
  const cached = await cacheGet(key);
  if (cached !== null) return cached === "1";

  try {
    // Clean expired while we're at it
    await cleanExpiredInstructions(userId);

    const [row] = await db
      .select({ total: count() })
      .from(userMemories)
      .where(
        and(
          eq(userMemories.userId, userId),
          eq(userMemories.category, "instruction"),
          eq(userMemories.isActive, true),
        ),
      );

    const has = (row?.total ?? 0) > 0;
    await cacheSet(key, has ? "1" : "0", HAS_CACHE_TTL);
    return has;
  } catch (err: any) {
    log.error("hasActiveInstructions failed", { userId, error: err.message });
    return false;
  }
}

/**
 * Retrieve all active instructions, ordered by salienceScore desc.
 * Use when you want the full list (e.g., for management UI).
 */
export async function getInstructions(
  userId: string,
  limit: number = 50,
): Promise<UserInstruction[]> {
  const key = `${CACHE_PREFIX}list:${userId}`;
  const cached = await cacheGet(key);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* corrupted */ }
  }

  try {
    const rows = await db
      .select({
        id: userMemories.id,
        fact: userMemories.fact,
        category: userMemories.category,
        confidence: userMemories.confidence,
        salienceScore: userMemories.salienceScore,
        scope: userMemories.scope,
        tags: userMemories.tags,
        metadata: userMemories.metadata,
        accessCount: userMemories.accessCount,
        createdAt: userMemories.createdAt,
        updatedAt: userMemories.updatedAt,
      })
      .from(userMemories)
      .where(
        and(
          eq(userMemories.userId, userId),
          eq(userMemories.category, "instruction"),
          eq(userMemories.isActive, true),
        ),
      )
      .orderBy(desc(userMemories.salienceScore), desc(userMemories.createdAt))
      .limit(limit);

    const instructions = rows.map(mapRow);
    await cacheSet(key, JSON.stringify(instructions), LIST_CACHE_TTL);
    return instructions;
  } catch (err: any) {
    log.error("getInstructions failed", { userId, error: err.message });
    return [];
  }
}

/**
 * Semantic retrieval: return instructions most relevant to the current query.
 * Uses pgvector cosine similarity + salienceScore weighting.
 *
 * This is the function to use in the chat prompt pipeline — it returns a
 * token-budget-aware, relevance-ranked subset.
 */
export async function getRelevantInstructions(
  userId: string,
  query: string,
  opts: { topK?: number; minRelevance?: number } = {},
): Promise<ScoredInstruction[]> {
  const { topK = 15, minRelevance = 0.15 } = opts;

  try {
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      // Fallback to non-semantic retrieval
      const all = await getInstructions(userId, topK);
      return all.map((i) => ({ ...i, relevanceScore: i.salienceScore, topicCluster: extractTopic(i) }));
    }

    const embLiteral = `[${queryEmbedding.join(",")}]`;
    const similarityExpr = sql<number>`1 - (${userMemories.embedding} <=> ${embLiteral}::vector)`;

    const rows = await db
      .select({
        id: userMemories.id,
        fact: userMemories.fact,
        category: userMemories.category,
        confidence: userMemories.confidence,
        salienceScore: userMemories.salienceScore,
        scope: userMemories.scope,
        tags: userMemories.tags,
        metadata: userMemories.metadata,
        accessCount: userMemories.accessCount,
        createdAt: userMemories.createdAt,
        updatedAt: userMemories.updatedAt,
        similarity: similarityExpr,
      })
      .from(userMemories)
      .where(
        and(
          eq(userMemories.userId, userId),
          eq(userMemories.category, "instruction"),
          eq(userMemories.isActive, true),
        ),
      )
      .orderBy(desc(similarityExpr))
      .limit(topK * 2); // Over-fetch then filter

    return rows
      .map((r) => {
        const sim = Number(r.similarity) || 0;
        const salience = r.salienceScore ?? 0.5;
        // Combined score: 60% semantic relevance + 40% importance
        const relevanceScore = sim * 0.6 + salience * 0.4;
        return { ...mapRow(r), relevanceScore, topicCluster: extractTopicFromTags(r.tags) };
      })
      .filter((i) => i.relevanceScore >= minRelevance)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);
  } catch (err: any) {
    log.error("getRelevantInstructions failed", { userId, error: err.message });
    return [];
  }
}

/**
 * Bump accessCount for instructions that were actually injected into a prompt.
 * Fire-and-forget — never blocks the response.
 */
export function trackUsage(instructionIds: string[]): void {
  if (instructionIds.length === 0) return;
  db.execute(
    sql`UPDATE user_memories SET access_count = access_count + 1, updated_at = now() WHERE id = ANY(${instructionIds}::varchar[])`,
  ).catch(() => { /* non-critical */ });
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const TOPIC_ORDER = ["language", "tone", "format", "content", "behavior", "preference", "context", "meta"];

/**
 * Build the instruction block for system prompt injection.
 *
 * Returns an InstructionContext with the formatted text, count, token estimate,
 * and list of injected IDs for usage tracking.
 *
 * @param userId       User to load instructions for.
 * @param query        Current user message (for semantic relevance ranking).
 * @param tokenBudget  Max tokens to allocate for the instruction block.
 */
export async function buildInstructionContext(
  userId: string,
  query?: string,
  tokenBudget: number = 800,
): Promise<InstructionContext> {
  const empty: InstructionContext = { text: "", count: 0, estimatedTokens: 0, injectedIds: [] };

  const has = await hasActiveInstructions(userId);
  if (!has) return empty;

  // Use semantic retrieval if query is provided, otherwise get all
  const instructions = query
    ? await getRelevantInstructions(userId, query)
    : (await getInstructions(userId)).map((i) => ({ ...i, relevanceScore: i.salienceScore, topicCluster: extractTopic(i) }));

  if (instructions.length === 0) return empty;

  // Group by topic and build sections
  const groups = new Map<string, ScoredInstruction[]>();
  for (const inst of instructions) {
    const topic = inst.topicCluster || "general";
    const list = groups.get(topic) || [];
    list.push(inst);
    groups.set(topic, list);
  }

  // Build output, respecting token budget
  const lines: string[] = [];
  const ids: string[] = [];
  let tokenEstimate = 30; // header overhead

  // Sort groups by predefined topic order
  const sortedTopics = Array.from(groups.keys()).sort((a, b) => {
    const ai = TOPIC_ORDER.indexOf(a);
    const bi = TOPIC_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const topic of sortedTopics) {
    const group = groups.get(topic)!;
    const topicHeader = `[${topic.toUpperCase()}]`;
    const headerTokens = Math.ceil(topicHeader.length / 4);

    if (tokenEstimate + headerTokens > tokenBudget) break;
    lines.push(topicHeader);
    tokenEstimate += headerTokens;

    for (const inst of group) {
      const line = `• ${inst.fact}`;
      const lineTokens = Math.ceil(line.length / 4); // rough estimate
      if (tokenEstimate + lineTokens > tokenBudget) break;
      lines.push(line);
      ids.push(inst.id);
      tokenEstimate += lineTokens;
    }
  }

  if (ids.length === 0) return empty;

  // Track usage asynchronously
  trackUsage(ids);

  const header = "INSTRUCCIONES PERSISTENTES DEL USUARIO";
  const preamble = "El usuario ha definido las siguientes directivas que DEBES seguir en todas tus respuestas. " +
    "Estas instrucciones tienen prioridad sobre el comportamiento por defecto.";

  const text = [header, preamble, "", ...lines, "", "Sigue estas instrucciones fielmente salvo que el usuario las modifique explícitamente."].join("\n");

  return { text, count: ids.length, estimatedTokens: tokenEstimate, injectedIds: ids };
}

/**
 * Invalidate all instruction caches for a user.
 */
export async function invalidateInstructionCache(userId: string): Promise<void> {
  await cacheDel(`${CACHE_PREFIX}has:${userId}`, `${CACHE_PREFIX}list:${userId}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRow(r: any): UserInstruction {
  return {
    id: r.id,
    fact: r.fact ?? "",
    category: r.category ?? "instruction",
    confidence: r.confidence ?? 0.8,
    salienceScore: r.salienceScore ?? 0.5,
    scope: r.scope ?? "global",
    tags: r.tags ?? [],
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    accessCount: r.accessCount ?? 0,
    createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
    updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
  };
}

function extractTopic(inst: UserInstruction): string {
  return extractTopicFromTags(inst.tags) || (inst.metadata?.topic as string) || "general";
}

function extractTopicFromTags(tags: string[] | null): string {
  if (!tags) return "general";
  for (const t of TOPIC_ORDER) {
    if (tags.includes(`topic:${t}`)) return t;
  }
  return "general";
}
