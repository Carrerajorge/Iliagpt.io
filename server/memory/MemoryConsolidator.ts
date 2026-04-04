/**
 * MemoryConsolidator — end-of-conversation memory extraction and compression.
 * Extracts facts, action items, and decisions. Resolves conflicts with existing memories.
 * Runs after each conversation and on a scheduled background pass.
 */

import { createLogger } from "../utils/logger";
import { pgVectorMemoryStore, MemoryType } from "./PgVectorMemoryStore";
import Anthropic from "@anthropic-ai/sdk";

const logger = createLogger("MemoryConsolidator");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationToConsolidate {
  conversationId: string;
  userId?: string;
  agentId?: string;
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: Date }>;
}

export interface ExtractedMemory {
  content: string;
  summary?: string;
  memoryType: MemoryType;
  importance: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface ConsolidationResult {
  conversationId: string;
  extractedMemories: ExtractedMemory[];
  actionItems: string[];
  keyDecisions: string[];
  factsLearned: string[];
  stored: number;
  skipped: number;
  summary: string;
}

// ─── Importance Scoring ───────────────────────────────────────────────────────

function scoreImportance(content: string, memoryType: MemoryType): number {
  let base = 0.5;

  // Boost for specific types
  const typeBoosts: Record<MemoryType, number> = {
    decision: 0.2,
    action_item: 0.25,
    fact: 0.1,
    preference: 0.15,
    entity: 0.05,
    skill: 0.15,
    ephemeral: -0.2,
  };
  base += typeBoosts[memoryType] ?? 0;

  // Boost for quantitative statements
  if (/\d+%|\d+\s*(million|billion|thousand|users|times)/i.test(content)) base += 0.1;

  // Boost for named entities
  if (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/.test(content)) base += 0.05;

  // Boost for urgent language
  if (/must|should|need to|important|critical|deadline|asap/i.test(content)) base += 0.15;

  // Penalty for vague statements
  if (/something|somehow|maybe|perhaps|possibly|might/i.test(content)) base -= 0.1;

  return Math.min(1, Math.max(0, base));
}

// ─── Pattern-Based Extraction (fallback without LLM) ─────────────────────────

function extractWithPatterns(messages: ConversationToConsolidate["messages"]): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];
  const allText = messages.map((m) => m.content).join("\n");

  // Action items
  const actionPatterns = [
    /(?:will|going to|need to|should|must)\s+([\w\s]{10,80})/gi,
    /TODO[:\s]+(.{10,80})/gi,
    /action(?:\s+item)?[:\s]+(.{10,80})/gi,
  ];

  for (const pattern of actionPatterns) {
    for (const m of [...allText.matchAll(pattern)]) {
      if (m[1]) {
        memories.push({
          content: m[1].trim(),
          memoryType: "action_item",
          importance: scoreImportance(m[1], "action_item"),
          tags: ["action_item"],
        });
      }
    }
  }

  // Decisions
  const decisionPatterns = [
    /decided to\s+([\w\s]{10,80})/gi,
    /decision[:\s]+(.{10,80})/gi,
    /we('ll| will| are going to)\s+([\w\s]{10,80})/gi,
  ];

  for (const pattern of decisionPatterns) {
    for (const m of [...allText.matchAll(pattern)]) {
      const text = m[2] ?? m[1];
      if (text) {
        memories.push({
          content: text.trim(),
          memoryType: "decision",
          importance: scoreImportance(text, "decision"),
          tags: ["decision"],
        });
      }
    }
  }

  // Facts with statistics
  const factPatterns = [
    /[\d.]+\s*%\s+(?:of\s+)?[\w\s]{5,50}/gi,
    /(?:according to|studies show|research indicates)\s+(.{20,100})/gi,
    /the\s+[\w]+\s+(?:is|are|was|were)\s+[\w\s]{10,60}[.!?]/gi,
  ];

  for (const pattern of factPatterns) {
    for (const m of [...allText.matchAll(pattern)]) {
      const text = m[1] ?? m[0];
      if (text) {
        memories.push({
          content: text.trim().slice(0, 200),
          memoryType: "fact",
          importance: scoreImportance(text, "fact"),
          tags: ["fact"],
        });
      }
    }
  }

  return memories.slice(0, 20);
}

// ─── LLM-Based Extraction ─────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function extractWithLLM(messages: ConversationToConsolidate["messages"]): Promise<{
  memories: ExtractedMemory[];
  summary: string;
  actionItems: string[];
  keyDecisions: string[];
}> {
  const transcript = messages
    .slice(-30) // last 30 messages max
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1_500,
    messages: [
      {
        role: "user",
        content: `Analyze this conversation and extract key information to remember.

CONVERSATION:
${transcript}

Return a JSON object with these fields:
{
  "summary": "2-3 sentence summary of the conversation",
  "facts": ["fact 1", "fact 2", ...],
  "actionItems": ["action 1", "action 2", ...],
  "decisions": ["decision 1", "decision 2", ...],
  "preferences": ["preference 1", ...],
  "entities": ["entity 1", ...]
}

Extract only genuinely important, specific information worth remembering in future conversations. Omit small talk and generic exchanges.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch?.[1] ?? jsonMatch?.[0] ?? "{}";

  let parsed: {
    summary?: string;
    facts?: string[];
    actionItems?: string[];
    decisions?: string[];
    preferences?: string[];
    entities?: string[];
  } = {};

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.warn("LLM returned invalid JSON for consolidation");
  }

  const memories: ExtractedMemory[] = [];

  for (const fact of parsed.facts ?? []) {
    memories.push({ content: fact, memoryType: "fact", importance: scoreImportance(fact, "fact"), tags: ["fact"] });
  }
  for (const decision of parsed.decisions ?? []) {
    memories.push({ content: decision, memoryType: "decision", importance: scoreImportance(decision, "decision"), tags: ["decision"] });
  }
  for (const pref of parsed.preferences ?? []) {
    memories.push({ content: pref, memoryType: "preference", importance: scoreImportance(pref, "preference"), tags: ["preference"] });
  }
  for (const entity of parsed.entities ?? []) {
    memories.push({ content: entity, memoryType: "entity", importance: scoreImportance(entity, "entity"), tags: ["entity"] });
  }

  return {
    memories,
    summary: parsed.summary ?? "",
    actionItems: parsed.actionItems ?? [],
    keyDecisions: parsed.decisions ?? [],
  };
}

// ─── Conflict Resolution ──────────────────────────────────────────────────────

async function checkForConflicts(
  newMemory: ExtractedMemory,
  userId: string | undefined
): Promise<{ conflict: boolean; existingId?: string }> {
  if (!userId) return { conflict: false };

  const existing = await pgVectorMemoryStore.search({
    query: newMemory.content,
    userId,
    memoryType: newMemory.memoryType,
    limit: 3,
    minSimilarity: 0.85,
  });

  if (existing.length > 0) {
    return { conflict: true, existingId: existing[0]!.id };
  }

  return { conflict: false };
}

// ─── MemoryConsolidator ───────────────────────────────────────────────────────

export class MemoryConsolidator {
  private useLLM: boolean;

  constructor(opts: { useLLM?: boolean } = {}) {
    this.useLLM = opts.useLLM ?? !!process.env.ANTHROPIC_API_KEY;
  }

  async consolidate(conversation: ConversationToConsolidate): Promise<ConsolidationResult> {
    logger.info(`Consolidating conversation ${conversation.conversationId}`);

    let memories: ExtractedMemory[];
    let summary = "";
    let actionItems: string[] = [];
    let keyDecisions: string[] = [];

    if (this.useLLM && conversation.messages.length >= 4) {
      try {
        const llmResult = await extractWithLLM(conversation.messages);
        memories = llmResult.memories;
        summary = llmResult.summary;
        actionItems = llmResult.actionItems;
        keyDecisions = llmResult.keyDecisions;
        logger.debug(`LLM extraction: ${memories.length} memories`);
      } catch (err) {
        logger.warn(`LLM extraction failed, using patterns: ${(err as Error).message}`);
        memories = extractWithPatterns(conversation.messages);
      }
    } else {
      memories = extractWithPatterns(conversation.messages);
    }

    let stored = 0;
    let skipped = 0;

    for (const memory of memories) {
      if (memory.importance < 0.3) {
        skipped++;
        continue;
      }

      const { conflict } = await checkForConflicts(memory, conversation.userId);
      if (conflict) {
        skipped++;
        continue;
      }

      try {
        await pgVectorMemoryStore.store({
          content: memory.content,
          summary: memory.summary,
          memoryType: memory.memoryType,
          importance: memory.importance,
          userId: conversation.userId,
          conversationId: conversation.conversationId,
          agentId: conversation.agentId,
          tags: [...(memory.tags ?? []), "consolidated"],
          metadata: { ...memory.metadata, conversationId: conversation.conversationId },
        });
        stored++;
      } catch (err) {
        logger.warn(`Failed to store memory: ${(err as Error).message}`);
        skipped++;
      }
    }

    logger.info(`Consolidation complete: ${stored} stored, ${skipped} skipped`);

    return {
      conversationId: conversation.conversationId,
      extractedMemories: memories,
      actionItems,
      keyDecisions,
      factsLearned: memories.filter((m) => m.memoryType === "fact").map((m) => m.content),
      stored,
      skipped,
      summary,
    };
  }

  async runBatchConsolidation(conversations: ConversationToConsolidate[]): Promise<ConsolidationResult[]> {
    const results: ConsolidationResult[] = [];

    for (const conv of conversations) {
      try {
        results.push(await this.consolidate(conv));
      } catch (err) {
        logger.warn(`Failed to consolidate ${conv.conversationId}: ${(err as Error).message}`);
      }
    }

    return results;
  }
}

export const memoryConsolidator = new MemoryConsolidator();
