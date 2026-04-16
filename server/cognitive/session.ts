/**
 * Cognitive Middleware — multi-turn session layer (Turn H).
 *
 * `CognitiveMiddleware.run()` is a single-turn primitive: one
 * request in, one response out. Real conversations have MANY
 * turns, and the user experience depends on the middleware
 * keeping track of:
 *
 *   • The conversation id (so memory stores scope their recall)
 *   • The user id (for rate limits + persistence + memory)
 *   • Previous turns (turn count, last response, error history)
 *   • Session-scoped overrides (preferred provider, custom system
 *     prompt, tools that apply only in this conversation)
 *
 * `CognitiveSession` wraps a middleware instance with per-
 * conversation state so consumers can do:
 *
 *     const session = mw.startSession({ userId, conversationId });
 *     await session.continue("hola");
 *     await session.continue("¿puedes resumir lo anterior?");
 *     for await (const event of session.continueStream("¿en inglés?")) {
 *       …
 *     }
 *
 * The session does NOT persist across process restarts — it's a
 * short-lived in-memory handle. Long-term conversation state lives
 * in the memory store + run repository (Turn C + Turn G). The
 * session only caches:
 *
 *   • turnCount
 *   • lastRequest / lastResponse snapshots
 *   • accumulated error codes across turns
 *
 * Hard guarantees:
 *
 *   1. **Never throws.** A session delegates to the underlying
 *      middleware which already has the "never throws" contract.
 *      Session-level state mutations are all synchronous and
 *      atomic per turn.
 *
 *   2. **Turn-ordered by construction.** Every `continue` call is
 *      serialized through a private promise chain so two
 *      concurrent `continue` calls on the same session don't
 *      race each other's state updates. Callers can still issue
 *      many sessions in parallel for many users — isolation is
 *      per-session, not per-middleware.
 *
 *   3. **Immutable snapshots.** `session.snapshot()` returns a
 *      frozen view of the current state so callers can log or
 *      inspect without accidentally mutating the live session.
 */

import type { CognitiveMiddleware } from "./cognitiveMiddleware";
import type {
  CognitiveRequest,
  CognitiveResponse,
  CognitiveStreamEvent,
  CognitiveIntent,
} from "./types";

// ---------------------------------------------------------------------------
// Shape contracts
// ---------------------------------------------------------------------------

export interface CognitiveSessionOptions {
  /** Stable user id — forwarded to every turn. Required. */
  userId: string;
  /**
   * Optional conversation id. When omitted, the session
   * generates one of the form `sess_${userId}_${ms}`. Consumers
   * that want to continue an existing conversation pass their
   * own id.
   */
  conversationId?: string;
  /**
   * Optional preferred provider override — applied to every turn
   * unless the caller overrides it on a specific `continue` call.
   */
  preferredProvider?: string;
  /** Optional default intent hint for every turn. */
  intentHint?: CognitiveIntent;
  /** Optional per-turn max tokens. */
  maxTokens?: number;
  /** Optional per-turn temperature. */
  temperature?: number;
}

export interface CognitiveSessionSnapshot {
  userId: string;
  conversationId: string;
  turnCount: number;
  lastUserMessage: string | null;
  lastResponseText: string | null;
  lastOk: boolean | null;
  /** Accumulated across every turn. Cleared via clearErrors(). */
  errorHistory: string[];
  /** Unix ms when the session was created. */
  createdAt: number;
  /** Unix ms of the most recent completed turn. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export class CognitiveSession {
  readonly userId: string;
  readonly conversationId: string;
  readonly createdAt: number;

  private readonly middleware: CognitiveMiddleware;
  private readonly options: CognitiveSessionOptions;

  private turnCount = 0;
  private lastUserMessage: string | null = null;
  private lastResponseText: string | null = null;
  private lastOk: boolean | null = null;
  private errorHistory: string[] = [];
  private updatedAt: number;

  /**
   * Serialization chain so two concurrent `continue` calls on the
   * same session run in order instead of racing state updates.
   * Each call chains `.then(() => doTurn())` onto this promise
   * and also reassigns it so the next call queues behind.
   */
  private turnChain: Promise<unknown> = Promise.resolve();

  constructor(
    middleware: CognitiveMiddleware,
    options: CognitiveSessionOptions,
  ) {
    if (!options.userId) {
      throw new Error("CognitiveSession: options.userId is required");
    }
    this.middleware = middleware;
    this.options = options;
    this.userId = options.userId;
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
    this.conversationId =
      options.conversationId ?? `sess_${options.userId}_${this.createdAt}`;
  }

  /**
   * Run one conversational turn. Builds a full `CognitiveRequest`
   * from the session defaults + the user's message + any per-
   * call overrides, delegates to `middleware.run`, and updates
   * the session state atomically.
   *
   * Per-call options OVERRIDE the session defaults (not merge) —
   * the common case is "I want this one turn to target a
   * different provider" and merge semantics would be confusing.
   */
  async continue(
    message: string,
    overrides: Partial<CognitiveRequest> = {},
  ): Promise<CognitiveResponse> {
    // Chain through turnChain so concurrent callers are serialized.
    const thisTurn = this.turnChain.then(async () => {
      const request: CognitiveRequest = {
        userId: this.userId,
        conversationId: this.conversationId,
        message,
        preferredProvider:
          overrides.preferredProvider ?? this.options.preferredProvider,
        intentHint: overrides.intentHint ?? this.options.intentHint,
        maxTokens: overrides.maxTokens ?? this.options.maxTokens,
        temperature: overrides.temperature ?? this.options.temperature,
        signal: overrides.signal,
      };
      const response = await this.middleware.run(request);
      this.recordTurn(message, response);
      return response;
    });
    this.turnChain = thisTurn.catch(() => undefined);
    return thisTurn;
  }

  /**
   * Streaming sibling of `continue`. Wraps the middleware's
   * `runStream` and yields the same events. Session state is
   * updated after the terminal `done` event.
   *
   * Note: concurrent stream calls are NOT serialized — a stream
   * is a long-lived operation and blocking would deadlock. The
   * caller is responsible for not running two streams against
   * the same session simultaneously if they care about state
   * ordering.
   */
  async *continueStream(
    message: string,
    overrides: Partial<CognitiveRequest> = {},
  ): AsyncGenerator<CognitiveStreamEvent, void, void> {
    const request: CognitiveRequest = {
      userId: this.userId,
      conversationId: this.conversationId,
      message,
      preferredProvider:
        overrides.preferredProvider ?? this.options.preferredProvider,
      intentHint: overrides.intentHint ?? this.options.intentHint,
      maxTokens: overrides.maxTokens ?? this.options.maxTokens,
      temperature: overrides.temperature ?? this.options.temperature,
      signal: overrides.signal,
    };
    for await (const event of this.middleware.runStream(request)) {
      if (event.kind === "done") {
        this.recordTurn(message, event.response);
      }
      yield event;
    }
  }

  /**
   * Return an immutable snapshot of the current session state.
   * Safe to log or pass to untrusted consumers.
   */
  snapshot(): CognitiveSessionSnapshot {
    return Object.freeze({
      userId: this.userId,
      conversationId: this.conversationId,
      turnCount: this.turnCount,
      lastUserMessage: this.lastUserMessage,
      lastResponseText: this.lastResponseText,
      lastOk: this.lastOk,
      errorHistory: [...this.errorHistory],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }

  /** Clear accumulated error history. Does NOT reset turnCount. */
  clearErrors(): void {
    this.errorHistory = [];
  }

  // ---------------------------------------------------------------------
  // Internal: atomic state mutation
  // ---------------------------------------------------------------------

  private recordTurn(userMessage: string, response: CognitiveResponse): void {
    this.turnCount++;
    this.lastUserMessage = userMessage;
    this.lastResponseText = response.text;
    this.lastOk = response.ok;
    this.updatedAt = Date.now();
    for (const e of response.errors) {
      this.errorHistory.push(`turn:${this.turnCount}:${e}`);
    }
  }
}
