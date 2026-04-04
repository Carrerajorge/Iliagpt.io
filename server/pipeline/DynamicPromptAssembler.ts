/**
 * DynamicPromptAssembler
 *
 * Builds the final system prompt + message array sent to the LLM for each
 * turn.  Responsibilities:
 *
 *   1. Core system block     — baseline identity, output rules, safety guidelines
 *   2. User profile block    — language, expertise level, preferences
 *   3. Task-type block       — injected from ResponseStrategy.systemHint
 *   4. Tools manifest block  — compact JSON listing available tools
 *   5. Memory block          — retrieved long-term memories (if any)
 *   6. Token-budget guard    — trims history and blocks to stay within context
 *
 * Output: `{ systemPrompt: string, messages: ChatMessage[] }` ready for
 * llmGateway.chat().
 *
 * All operations are synchronous / O(n) string processing — no LLM calls.
 */

import { z }      from 'zod';
import { Logger } from '../lib/logger';
import type { ResponseStrategy }   from './ResponseStrategySelector';
import type { PreprocessedMessage } from './MessagePreprocessor';

// ─── Types ────────────────────────────────────────────────────────────────────

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant']);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatMessageSchema = z.object({
  role   : ChatRoleSchema,
  content: z.string(),
  name   : z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export interface UserProfile {
  userId?      : string;
  displayName? : string;
  /** BCP-47 language code, e.g. 'es', 'en', 'fr'. */
  language?    : string;
  /** Self-reported or inferred expertise 1–5. */
  expertiseLevel?: 1 | 2 | 3 | 4 | 5;
  /** User's preferred response format. */
  preferredFormat?: 'brief' | 'detailed' | 'bullets' | 'code-first';
  /** Any free-text instructions the user has set (e.g. "always use metric units"). */
  customInstructions?: string;
}

export interface ToolDescriptor {
  name       : string;
  description: string;
  /** Rough token cost estimate for one tool invocation. */
  tokenCost? : number;
}

export interface AssemblerInput {
  /** The current user message (preprocessed). */
  message       : PreprocessedMessage;
  /** Conversation history (oldest first). */
  history       : ChatMessage[];
  /** Strategy controlling format/tone. */
  strategy      : ResponseStrategy;
  /** Optional user profile. */
  userProfile?  : UserProfile;
  /** Tool descriptors available for this call. */
  tools?        : ToolDescriptor[];
  /** Long-term memory snippets to inject. */
  memories?     : string[];
  /** Absolute token budget for the whole context (history + system + user). */
  contextBudget?: number;
}

export interface AssemblerResult {
  systemPrompt    : string;
  messages        : ChatMessage[];
  /** Estimated token count of the assembled context. */
  estimatedTokens : number;
  /** Number of history turns trimmed to fit the budget. */
  trimmedTurns    : number;
  /** Breakdown of how the token budget was used. */
  tokenBreakdown  : {
    system   : number;
    history  : number;
    user     : number;
  };
  assemblyMs      : number;
}

// ─── Core system prompt ───────────────────────────────────────────────────────

const CORE_SYSTEM = `You are IliaGPT, a helpful, honest, and harmless AI assistant.

## Core principles
- Answer accurately and concisely.  Cite sources when you can.
- If you are not sure, say so — do not fabricate facts.
- Respect the user's language and expertise level.
- Follow all format instructions in subsequent blocks precisely.`;

// ─── Language-aware instruction ───────────────────────────────────────────────

function buildLanguageBlock(lang?: string): string {
  if (!lang || lang === 'unknown' || lang === 'en') return '';
  return `\n## Language\nRespond in the same language as the user's message (detected: ${lang}).`;
}

// ─── Expertise block ──────────────────────────────────────────────────────────

const EXPERTISE_LABELS: Record<number, string> = {
  1: 'complete beginner — use very simple language, no jargon',
  2: 'novice — avoid heavy technical terms; explain acronyms',
  3: 'intermediate — normal professional language is fine',
  4: 'advanced — technical depth welcome',
  5: 'expert — be precise and concise; skip basics',
};

function buildExpertiseBlock(level?: number): string {
  if (!level) return '';
  return `\n## Expertise level\nThe user is a ${EXPERTISE_LABELS[level] ?? EXPERTISE_LABELS[3]}.`;
}

// ─── Format block ─────────────────────────────────────────────────────────────

function buildFormatBlock(preferred?: UserProfile['preferredFormat'], hint?: string): string {
  const parts: string[] = ['\n## Format'];
  if (hint) parts.push(hint);
  if (preferred === 'brief')     parts.push('Keep responses brief and to the point.');
  if (preferred === 'detailed')  parts.push('Provide thorough explanations.');
  if (preferred === 'bullets')   parts.push('Use bullet points where applicable.');
  if (preferred === 'code-first')parts.push('Lead with code examples; follow with explanation.');
  return parts.length > 1 ? parts.join('\n') : '';
}

// ─── Tools manifest ───────────────────────────────────────────────────────────

function buildToolsBlock(tools?: ToolDescriptor[]): string {
  if (!tools?.length) return '';
  const compact = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  return `\n## Available tools\n${compact}`;
}

// ─── Memory block ─────────────────────────────────────────────────────────────

function buildMemoryBlock(memories?: string[]): string {
  if (!memories?.length) return '';
  const items = memories.slice(0, 5).map((m, i) => `${i + 1}. ${m}`).join('\n');
  return `\n## Relevant context from memory\n${items}`;
}

// ─── Custom instructions ──────────────────────────────────────────────────────

function buildCustomBlock(instructions?: string): string {
  if (!instructions?.trim()) return '';
  return `\n## User preferences\n${instructions.trim()}`;
}

// ─── Token estimation ─────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  // 1 token ≈ 4 chars (English); slightly less for code
  return Math.ceil(text.length / 4);
}

// ─── History trimmer ──────────────────────────────────────────────────────────

function trimHistory(
  history: ChatMessage[],
  budget: number,
  systemTokens: number,
  userTokens: number,
): { trimmed: ChatMessage[]; droppedTurns: number } {
  const available = budget - systemTokens - userTokens - 200; // 200 token headroom
  if (available <= 0) return { trimmed: [], droppedTurns: history.length };

  let total = 0;
  const kept: ChatMessage[] = [];

  // Walk from newest to oldest; keep turns that fit
  for (let i = history.length - 1; i >= 0; i--) {
    const msg    = history[i]!;
    const tokens = estimateTokens(msg.content);
    if (total + tokens > available) break;
    kept.unshift(msg);
    total += tokens;
  }

  return {
    trimmed     : kept,
    droppedTurns: history.length - kept.length,
  };
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class DynamicPromptAssembler {
  /**
   * Assemble the full prompt context for one LLM call.
   */
  assemble(input: AssemblerInput): AssemblerResult {
    const start        = Date.now();
    const contextBudget = input.contextBudget ?? 12_000;

    // ── 1. Build system prompt ──────────────────────────────────────────────
    const blocks: string[] = [CORE_SYSTEM];

    blocks.push(buildLanguageBlock(input.message.meta.language));
    blocks.push(buildExpertiseBlock(input.userProfile?.expertiseLevel));
    blocks.push(buildFormatBlock(
      input.userProfile?.preferredFormat,
      input.strategy.systemHint,
    ));
    blocks.push(buildToolsBlock(input.tools));
    blocks.push(buildMemoryBlock(input.memories));
    blocks.push(buildCustomBlock(input.userProfile?.customInstructions));

    const systemPrompt   = blocks.filter(Boolean).join('').trim();
    const systemTokens   = estimateTokens(systemPrompt);

    // ── 2. User message ─────────────────────────────────────────────────────
    const userContent  = input.message.normalized;
    const userTokens   = estimateTokens(userContent);

    // ── 3. Trim history ─────────────────────────────────────────────────────
    const { trimmed: trimmedHistory, droppedTurns } = trimHistory(
      input.history,
      contextBudget,
      systemTokens,
      userTokens,
    );
    const historyTokens = trimmedHistory.reduce(
      (sum, m) => sum + estimateTokens(m.content), 0,
    );

    // ── 4. Build messages array ─────────────────────────────────────────────
    const messages: ChatMessage[] = [
      ...trimmedHistory,
      { role: 'user', content: userContent },
    ];

    const estimatedTokens = systemTokens + historyTokens + userTokens;
    const assemblyMs = Date.now() - start;

    if (droppedTurns > 0) {
      Logger.debug('[DynamicPromptAssembler] trimmed history to fit budget', {
        droppedTurns, contextBudget, estimatedTokens,
      });
    }

    Logger.debug('[DynamicPromptAssembler] prompt assembled', {
      strategy      : input.strategy.name,
      systemTokens,
      historyTurns  : trimmedHistory.length,
      userTokens,
      estimatedTokens,
      assemblyMs,
    });

    return {
      systemPrompt,
      messages,
      estimatedTokens,
      trimmedTurns: droppedTurns,
      tokenBreakdown: {
        system : systemTokens,
        history: historyTokens,
        user   : userTokens,
      },
      assemblyMs,
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const dynamicPromptAssembler = new DynamicPromptAssembler();
