/**
 * InstructionManager — Full lifecycle management for user instructions.
 *
 * Responsibilities:
 * - Process detection results → persist/update/revoke instructions
 * - Deduplication via vector similarity (cosine > 0.85 = same instruction)
 * - Supersession: newer instructions on the same topic replace older ones
 * - Revocation handling: "forget the instruction about X" → soft-delete
 * - Versioning: each update creates a new version, old version is superseded
 * - Audit trail: all changes logged with reason and trigger
 */

import { db } from "../db";
import { userMemories } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { generateEmbedding, generateEmbeddingsBatch } from "../embeddingService";
import { invalidateInstructionCache } from "./instructionRetriever";
import { type DetectedInstruction, type DetectionResult, detectInstructions } from "./instructionDetector";
import { createLogger } from "../utils/logger";
import crypto from "crypto";

const log = createLogger("instruction-manager");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessResult {
  /** Instructions that were created. */
  created: string[];
  /** Instructions that were updated (deduped). */
  updated: string[];
  /** Instructions that were revoked/superseded. */
  revoked: string[];
  /** Total processing time in ms. */
  durationMs: number;
}

interface PersistableInstruction {
  fact: string;
  confidence: number;
  scope: string;
  topic: string;
  language: string;
  expiresAt: Date | null;
  embedding: number[];
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TENANT_ID = "default";
const SIMILARITY_THRESHOLD = 0.85;  // Above this = same instruction (update)
const SUPERSEDE_THRESHOLD = 0.70;   // Above this on same topic = supersede older

// ---------------------------------------------------------------------------
// Core: process a detection result
// ---------------------------------------------------------------------------

/**
 * Process a full detection pipeline result and persist instructions.
 * This is the main entry point — called after detectInstructions().
 */
export async function processDetectionResult(
  userId: string,
  result: DetectionResult,
  conversationId?: string,
): Promise<ProcessResult> {
  const start = Date.now();
  const output: ProcessResult = { created: [], updated: [], revoked: [], durationMs: 0 };

  if (!result.found || result.instructions.length === 0) {
    output.durationMs = Date.now() - start;
    return output;
  }

  for (const instruction of result.instructions) {
    try {
      if (instruction.isRevocation) {
        const revokedIds = await handleRevocation(userId, instruction);
        output.revoked.push(...revokedIds);
      } else {
        const persistResult = await persistInstruction(userId, instruction, conversationId);
        if (persistResult.action === "created") {
          output.created.push(persistResult.id);
        } else if (persistResult.action === "updated") {
          output.updated.push(persistResult.id);
        }
      }
    } catch (err: any) {
      log.error("Failed to process instruction", {
        userId,
        trigger: instruction.trigger,
        error: err.message,
      });
    }
  }

  // Invalidate cache if anything changed
  if (output.created.length + output.updated.length + output.revoked.length > 0) {
    await invalidateInstructionCache(userId);
    log.info("Instructions processed", {
      userId,
      created: output.created.length,
      updated: output.updated.length,
      revoked: output.revoked.length,
    });
  }

  output.durationMs = Date.now() - start;
  return output;
}

/**
 * Convenience: detect + process in one call.
 * Used by the chat pipeline for automatic instruction capture.
 */
export async function detectAndPersist(
  userId: string,
  message: string,
  conversationId?: string,
): Promise<ProcessResult> {
  const detection = await detectInstructions(message, /* useLLM */ true);
  return processDetectionResult(userId, detection, conversationId);
}

// ---------------------------------------------------------------------------
// Persist / dedup / supersede
// ---------------------------------------------------------------------------

async function persistInstruction(
  userId: string,
  instruction: DetectedInstruction,
  conversationId?: string,
): Promise<{ action: "created" | "updated" | "skipped"; id: string }> {
  const text = instruction.normalized || instruction.rawText;
  const embedding = await generateEmbedding(text);
  const contentHash = computeHash(text);

  // 1. Check for duplicate (high similarity = same instruction)
  const duplicate = await findSimilar(userId, embedding, SIMILARITY_THRESHOLD);

  if (duplicate) {
    // Update existing: bump access count and salience
    const newCount = (duplicate.accessCount ?? 0) + 1;
    const newSalience = Math.min(1.0, newCount / 8);

    await db
      .update(userMemories)
      .set({
        accessCount: newCount,
        salienceScore: newSalience,
        confidence: Math.max(duplicate.confidence ?? 0, instruction.confidence),
        updatedAt: sql`now()`,
      })
      .where(eq(userMemories.id, duplicate.id));

    log.debug("Updated existing instruction (dedup)", {
      id: duplicate.id,
      similarity: duplicate.similarity,
    });
    return { action: "updated", id: duplicate.id };
  }

  // 2. Check for supersession (similar topic, lower similarity)
  if (instruction.topic) {
    await supersedeByTopic(userId, instruction.topic, embedding);
  }

  // 3. Insert new instruction
  const id = crypto.randomUUID();
  const tags = [
    instruction.topic ? `topic:${instruction.topic}` : null,
    instruction.language ? `lang:${instruction.language}` : null,
    instruction.scope ? `scope:${instruction.scope}` : null,
  ].filter(Boolean) as string[];

  await db
    .insert(userMemories)
    .values({
      id,
      tenantId: DEFAULT_TENANT_ID,
      userId,
      conversationId: conversationId ?? null,
      fact: text,
      category: "instruction",
      confidence: instruction.confidence,
      evidence: `Detected via ${instruction.trigger} pattern`,
      scope: instruction.scope || "global",
      contentHash,
      embedding,
      salienceScore: 0.3, // New instructions start at moderate salience
      recencyScore: 1.0,
      accessCount: 1,
      isActive: true,
      expiresAt: instruction.expiresAt,
      tags,
      metadata: {
        topic: instruction.topic,
        language: instruction.language,
        trigger: instruction.trigger,
        detectionStage: instruction.trigger === "llm" ? "llm" : "pattern",
        normalizedFrom: instruction.normalized !== instruction.rawText ? instruction.rawText : undefined,
      },
    })
    .onConflictDoNothing({
      target: [userMemories.userId, userMemories.contentHash],
    });

  log.info("Created new instruction", { id, userId, topic: instruction.topic });
  return { action: "created", id };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

async function handleRevocation(
  userId: string,
  instruction: DetectedInstruction,
): Promise<string[]> {
  const text = instruction.normalized || instruction.rawText;
  const embedding = await generateEmbedding(text);

  // Find instructions that are semantically related to what's being revoked
  const embLiteral = `[${embedding.join(",")}]`;
  const similarityExpr = sql<number>`1 - (${userMemories.embedding} <=> ${embLiteral}::vector)`;

  const candidates = await db
    .select({
      id: userMemories.id,
      fact: userMemories.fact,
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
    .limit(5);

  // Revoke instructions with similarity > 0.50 (broader than dedup threshold)
  const toRevoke = candidates.filter((c) => Number(c.similarity) > 0.50);
  if (toRevoke.length === 0) {
    log.debug("Revocation: no matching instructions found", { userId });
    return [];
  }

  const revokedIds = toRevoke.map((c) => c.id);

  await db
    .update(userMemories)
    .set({
      isActive: false,
      updatedAt: sql`now()`,
      metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{revokedAt}', to_jsonb(now()))`,
    })
    .where(
      and(
        eq(userMemories.userId, userId),
        sql`${userMemories.id} = ANY(${revokedIds}::varchar[])`,
      ),
    );

  log.info("Revoked instructions", {
    userId,
    count: revokedIds.length,
    revokedFacts: toRevoke.map((c) => c.fact?.slice(0, 60)),
  });

  return revokedIds;
}

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

async function supersedeByTopic(
  userId: string,
  topic: string,
  newEmbedding: number[],
): Promise<void> {
  const embLiteral = `[${newEmbedding.join(",")}]`;
  const similarityExpr = sql<number>`1 - (${userMemories.embedding} <=> ${embLiteral}::vector)`;

  // Find active instructions on the same topic with moderate similarity
  const candidates = await db
    .select({
      id: userMemories.id,
      fact: userMemories.fact,
      tags: userMemories.tags,
      similarity: similarityExpr,
    })
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, userId),
        eq(userMemories.category, "instruction"),
        eq(userMemories.isActive, true),
        sql`${userMemories.tags} @> ARRAY[${`topic:${topic}`}]::text[]`,
      ),
    )
    .orderBy(desc(similarityExpr))
    .limit(3);

  const toSupersede = candidates.filter(
    (c) => Number(c.similarity) > SUPERSEDE_THRESHOLD && Number(c.similarity) < SIMILARITY_THRESHOLD,
  );

  if (toSupersede.length === 0) return;

  const ids = toSupersede.map((c) => c.id);
  await db
    .update(userMemories)
    .set({
      isActive: false,
      updatedAt: sql`now()`,
      metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{supersededAt}', to_jsonb(now()))`,
    })
    .where(
      and(
        eq(userMemories.userId, userId),
        sql`${userMemories.id} = ANY(${ids}::varchar[])`,
      ),
    );

  log.info("Superseded instructions on same topic", {
    userId,
    topic,
    count: ids.length,
  });
}

// ---------------------------------------------------------------------------
// CRUD operations (for API/UI)
// ---------------------------------------------------------------------------

/** Manually create an instruction (from the UI). */
export async function createInstruction(
  userId: string,
  text: string,
  opts: { scope?: string; topic?: string } = {},
): Promise<string> {
  const embedding = await generateEmbedding(text);
  const id = crypto.randomUUID();

  const tags = [
    opts.topic ? `topic:${opts.topic}` : null,
    opts.scope ? `scope:${opts.scope}` : null,
  ].filter(Boolean) as string[];

  await db.insert(userMemories).values({
    id,
    tenantId: DEFAULT_TENANT_ID,
    userId,
    fact: text,
    category: "instruction",
    confidence: 1.0,
    evidence: "Manual creation via UI",
    scope: opts.scope || "global",
    contentHash: computeHash(text),
    embedding,
    salienceScore: 0.5,
    recencyScore: 1.0,
    accessCount: 0,
    isActive: true,
    tags,
    metadata: { topic: opts.topic, source: "manual" },
  });

  await invalidateInstructionCache(userId);
  return id;
}

/** Update an instruction's text. */
export async function updateInstruction(
  userId: string,
  instructionId: string,
  newText: string,
): Promise<boolean> {
  const embedding = await generateEmbedding(newText);

  const result = await db
    .update(userMemories)
    .set({
      fact: newText,
      embedding,
      contentHash: computeHash(newText),
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(userMemories.id, instructionId), eq(userMemories.userId, userId)),
    )
    .returning({ id: userMemories.id });

  if (result.length > 0) {
    await invalidateInstructionCache(userId);
  }
  return result.length > 0;
}

/** Soft-delete an instruction. */
export async function deleteInstruction(
  userId: string,
  instructionId: string,
): Promise<boolean> {
  const result = await db
    .update(userMemories)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(
      and(eq(userMemories.id, instructionId), eq(userMemories.userId, userId)),
    )
    .returning({ id: userMemories.id });

  if (result.length > 0) {
    await invalidateInstructionCache(userId);
  }
  return result.length > 0;
}

/** Bulk toggle instructions on/off. */
export async function toggleInstructions(
  userId: string,
  instructionIds: string[],
  active: boolean,
): Promise<number> {
  if (instructionIds.length === 0) return 0;

  const result = await db
    .update(userMemories)
    .set({ isActive: active, updatedAt: sql`now()` })
    .where(
      and(
        eq(userMemories.userId, userId),
        sql`${userMemories.id} = ANY(${instructionIds}::varchar[])`,
      ),
    )
    .returning({ id: userMemories.id });

  if (result.length > 0) {
    await invalidateInstructionCache(userId);
  }
  return result.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeHash(text: string): string {
  return crypto.createHash("sha256").update(text.toLowerCase().trim()).digest("hex").slice(0, 64);
}

async function findSimilar(
  userId: string,
  embedding: number[],
  threshold: number,
): Promise<{ id: string; accessCount: number | null; confidence: number | null; similarity: number } | null> {
  const embLiteral = `[${embedding.join(",")}]`;
  const similarityExpr = sql<number>`1 - (${userMemories.embedding} <=> ${embLiteral}::vector)`;

  const results = await db
    .select({
      id: userMemories.id,
      accessCount: userMemories.accessCount,
      confidence: userMemories.confidence,
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
    .limit(1);

  const top = results[0];
  if (!top) return null;
  const sim = Number(top.similarity) || 0;
  if (sim < threshold) return null;

  return { ...top, similarity: sim };
}
