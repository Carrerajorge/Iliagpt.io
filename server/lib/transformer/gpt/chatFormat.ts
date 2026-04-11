/**
 * Canonical chat message format — OpenAI GPT-4 technical report, §2.
 *
 * GPT-4 (and every modern product LLM that followed it) uses a
 * structured chat transcript with three roles:
 *
 *   • system     — instructions about behavior, tone, constraints.
 *                   Always the FIRST message if present; at most one
 *                   per conversation.
 *   • user       — the human's turn.
 *   • assistant  — the model's turn (or the placeholder where it
 *                   should generate next).
 *
 * The wire format used by OpenAI's chat models is a variant of
 * "ChatML" with `<|im_start|>role\ncontent<|im_end|>` delimiters. We
 * ship a tokenizer-agnostic version: callers provide a `tokenize`
 * callback and canonical role markers, and we render the flat token
 * sequence that goes into `gptGenerate`.
 *
 * This file is the single place that makes a "text completer" feel
 * like an "assistant". Without it, every product surface has to
 * re-invent prompt layout (and typically gets subtle details wrong —
 * the most common bug is forgetting the trailing assistant primer so
 * the model tries to imitate the USER role instead of the assistant).
 */

import {
  type BuiltInContextPrompt,
  type InContextMode,
  inContextModeOf,
} from "./inContextLearning";
import type { TokenizeFn } from "./taskTemplates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * Token-level separators for the ChatML-style transcript. Callers can
 * pin these to whichever tokenizer-specific ids their BPE uses — the
 * defaults below work with our test per-char stand-in.
 *
 * The canonical OpenAI layout is:
 *
 *   <|im_start|>system\n  You are a helpful assistant.\n  <|im_end|>
 *   <|im_start|>user\n    What is 2+2?\n                 <|im_end|>
 *   <|im_start|>assistant\n  4\n                         <|im_end|>
 *   <|im_start|>assistant\n                              ← primer for next turn
 */
export interface ChatMarkers {
  /** Token(s) opening a turn — default: "<|im_start|>". */
  imStart: number[];
  /** Token(s) closing a turn — default: "<|im_end|>". */
  imEnd: number[];
  /** Newline between role and content — default: "\n". */
  roleContentSep: number[];
  /** Token(s) for the role names ("system" / "user" / "assistant"). */
  roleTokens: Record<ChatRole, number[]>;
}

export interface BuildChatPromptOptions {
  /** Tokenizer callback. */
  tokenize: TokenizeFn;
  /** Turn-level markers. If omitted, defaults are derived from `tokenize`. */
  markers?: ChatMarkers;
  /**
   * Whether to append the trailing assistant primer `<|im_start|>assistant\n`.
   * Default true — almost every downstream use needs it because the
   * model is about to generate the next assistant turn. Set false when
   * you want the raw transcript (e.g., for measurement / logging).
   */
  addAssistantPrimer?: boolean;
}

export interface BuiltChatPrompt extends BuiltInContextPrompt {
  /** Which roles appeared in the transcript, in the order given. */
  roles: ChatRole[];
  /** How many user ↔ assistant exchanges preceded the current turn. */
  numTurns: number;
}

// ---------------------------------------------------------------------------
// Default markers
// ---------------------------------------------------------------------------

/**
 * Build the default chat markers from a tokenize callback. Encodes
 * every marker as its literal string via `tokenize` — works for any
 * tokenizer whose alphabet includes the marker characters.
 *
 * In production you'd use fixed BPE ids for `<|im_start|>` and
 * `<|im_end|>` (these are reserved tokens in the OpenAI vocab). Our
 * test tokenizer emits char codes, so the defaults below keep the
 * marker strings literal and the test can decode them back.
 */
export function defaultChatMarkers(tokenize: TokenizeFn): ChatMarkers {
  return {
    imStart: tokenize("<|im_start|>"),
    imEnd: tokenize("<|im_end|>"),
    roleContentSep: tokenize("\n"),
    roleTokens: {
      system: tokenize("system"),
      user: tokenize("user"),
      assistant: tokenize("assistant"),
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Render a list of chat messages into a flat token id sequence in the
 * canonical ChatML shape:
 *
 *   <|im_start|>system\n{system content}<|im_end|>
 *   <|im_start|>user\n{user content}<|im_end|>
 *   <|im_start|>assistant\n{assistant content}<|im_end|>
 *   <|im_start|>user\n{next user content}<|im_end|>
 *   <|im_start|>assistant\n               ← primer, empty
 *
 * Enforces the following structural invariants (validated at runtime):
 *
 *   1. If a `system` message is present, it must be the FIRST entry.
 *   2. At most one `system` message.
 *   3. After the (optional) system, roles must alternate
 *      user → assistant → user → ... The last non-primer message
 *      must be a `user` when `addAssistantPrimer` is true (the
 *      default), because the model is about to produce an assistant
 *      turn and responding to an assistant turn is undefined.
 *
 * Returns a `BuiltChatPrompt` which is a superset of
 * `BuiltInContextPrompt` so callers that already use in-context
 * learning can swap between the two without refactoring.
 */
export function buildChatPrompt(
  messages: ChatMessage[],
  options: BuildChatPromptOptions,
): BuiltChatPrompt {
  if (messages.length === 0) {
    throw new Error("buildChatPrompt: messages array is empty");
  }
  const { tokenize } = options;
  const markers = options.markers ?? defaultChatMarkers(tokenize);
  const addPrimer = options.addAssistantPrimer ?? true;

  // ── Structural validation ─────────────────────────────────────────
  validateChatStructure(messages, { addAssistantPrimer: addPrimer });

  // ── Render ────────────────────────────────────────────────────────
  const tokenIds: number[] = [];
  const roles: ChatRole[] = [];
  for (const msg of messages) {
    roles.push(msg.role);
    // <|im_start|>
    for (const t of markers.imStart) tokenIds.push(t);
    // role name
    for (const t of markers.roleTokens[msg.role]) tokenIds.push(t);
    // \n
    for (const t of markers.roleContentSep) tokenIds.push(t);
    // content
    for (const t of tokenize(msg.content)) tokenIds.push(t);
    // <|im_end|>
    for (const t of markers.imEnd) tokenIds.push(t);
  }

  // Trailing assistant primer: model will start its reply right here
  if (addPrimer) {
    for (const t of markers.imStart) tokenIds.push(t);
    for (const t of markers.roleTokens.assistant) tokenIds.push(t);
    for (const t of markers.roleContentSep) tokenIds.push(t);
  }

  return {
    tokenIds,
    mode: inContextModeOfChat(messages),
    numExamples: countAssistantTurns(messages),
    roles,
    numTurns: countUserTurns(messages),
  };
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

/**
 * Enforce the chat format's structural invariants. Throws on any
 * violation with a precise, actionable error message.
 */
export function validateChatStructure(
  messages: ChatMessage[],
  opts: { addAssistantPrimer?: boolean } = {},
): void {
  if (messages.length === 0) {
    throw new Error("validateChatStructure: empty message list");
  }

  // (1) system is always first
  const systemCount = messages.filter((m) => m.role === "system").length;
  if (systemCount > 1) {
    throw new Error(
      `validateChatStructure: at most one system message allowed, got ${systemCount}`,
    );
  }
  if (systemCount === 1 && messages[0].role !== "system") {
    throw new Error(
      `validateChatStructure: system message must be the first entry`,
    );
  }

  // (2) After system, roles must alternate user → assistant → user → ...
  const body = systemCount === 1 ? messages.slice(1) : messages;
  if (body.length === 0) {
    throw new Error(
      `validateChatStructure: transcript has only a system message — need at least one user turn`,
    );
  }
  for (let i = 0; i < body.length; i++) {
    const expected: ChatRole = i % 2 === 0 ? "user" : "assistant";
    if (body[i].role !== expected) {
      throw new Error(
        `validateChatStructure: at body position ${i} expected role "${expected}", got "${body[i].role}"`,
      );
    }
  }

  // (3) Primer mode: last body turn must be `user`
  if (opts.addAssistantPrimer ?? true) {
    const lastBody = body[body.length - 1];
    if (lastBody.role !== "user") {
      throw new Error(
        `validateChatStructure: addAssistantPrimer=true requires the last message to be a user turn, got "${lastBody.role}"`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

function countUserTurns(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

function countAssistantTurns(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "assistant").length;
}

/**
 * Derive an `InContextMode` tag from a chat transcript by treating
 * each (user → assistant) exchange that PRECEDES the final user query
 * as an in-context demonstration. Zero prior exchanges → zero-shot,
 * one → one-shot, more → few-shot.
 *
 * This lets a chat transcript interoperate with our existing
 * in-context learning utilities: the same model can be evaluated
 * under zero/one/few-shot "modes" by counting completed exchanges.
 */
export function inContextModeOfChat(messages: ChatMessage[]): InContextMode {
  const exchanges = countAssistantTurns(messages);
  return inContextModeOf(exchanges);
}
