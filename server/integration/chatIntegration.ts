/**
 * chatIntegration
 *
 * Middleware that intercepts POST /api/chat/stream and routes the request
 * to the AgenticLoop when the message requires agentic handling, or falls
 * through to the existing chatAiRouter otherwise.
 *
 * Agentic heuristics (score ≥ AGENTIC_THRESHOLD triggers agent mode):
 *   +2  explicit "run", "execute", "write a file", "create a file"
 *   +2  code block in the message (```)
 *   +2  multi-step language: "and then", "after that", "first ... then"
 *   +1  "search for", "look up", "find information"
 *   +1  "download", "fetch", "open the url"
 *   +1  question length > 300 chars (implies complexity)
 *   +1  prior turns contain tool results (conversation is already agentic)
 *
 * The client can also force agent mode by passing `"agentic": true` in the
 * request body, or opt out with `"agentic": false`.
 */

import type { Request, Response, NextFunction, Express } from 'express';
import { randomUUID }  from 'crypto';
import { Logger }      from '../lib/logger';
import { AgenticLoop } from '../agentic/core/AgenticLoop';
import { globalToolRegistry } from '../agentic/toolCalling/ToolRegistry';
import { resolveModel }       from './modelWiring';
import {
  createSseSession,
  bridgeAgenticEvents,
  sendSse,
} from './streamingWiring';
import type { AgentMessage } from '../agentic/toolCalling/UniversalToolCaller';

// ─── Triage ───────────────────────────────────────────────────────────────────

const AGENTIC_THRESHOLD = 2;

const HIGH_WEIGHT_PATTERNS: RegExp[] = [
  /\b(run|execute|compile|install|deploy)\s+(this|the|a|my)?\s*(code|script|program|command)/i,
  /\b(write|create|generate|make)\s+(a\s+)?(file|folder|directory|document|spreadsheet|pdf|image)/i,
  /```[\s\S]{5,}/,                          // code block present
  /\b(first[\s\S]{1,60}then|and\s+then|after\s+that|next\s+step)/i,  // multi-step
];

const LOW_WEIGHT_PATTERNS: RegExp[] = [
  /\b(search|look\s+up|find\s+information\s+about|google)\b/i,
  /\b(fetch|download|open|load)\s+(the\s+)?(url|page|website|link|http)/i,
  /\b(remember|store|save)\s+(this|that|my)/i,
];

export function scoreAgenticNeed(
  userMessage: string,
  history    : AgentMessage[],
): number {
  let score = 0;

  for (const re of HIGH_WEIGHT_PATTERNS) {
    if (re.test(userMessage)) score += 2;
  }
  for (const re of LOW_WEIGHT_PATTERNS) {
    if (re.test(userMessage)) score += 1;
  }
  if (userMessage.length > 300) score += 1;

  // Boost if conversation already has tool results
  const hasToolResults = history.some(m =>
    m.role === 'assistant' && (
      (typeof m.content === 'string' && m.content.includes('tool_use')) ||
      Array.isArray(m.content)
    )
  );
  if (hasToolResults) score += 1;

  return score;
}

// ─── Message parsing ──────────────────────────────────────────────────────────

interface ChatStreamBody {
  messages     : AgentMessage[];
  model?       : string;
  systemPrompt?: string;
  agentic?     : boolean;          // explicit override
  allowedTools?: string[];
  chatId?      : string;
  maxTurns?    : number;
  temperature? : number;
}

function parseBody(raw: unknown): ChatStreamBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;

  if (!Array.isArray(b['messages']) || b['messages'].length === 0) return null;

  return {
    messages     : b['messages'] as AgentMessage[],
    model        : typeof b['model'] === 'string' ? b['model'] : undefined,
    systemPrompt : typeof b['systemPrompt'] === 'string' ? b['systemPrompt'] : undefined,
    agentic      : typeof b['agentic'] === 'boolean' ? b['agentic'] : undefined,
    allowedTools : Array.isArray(b['allowedTools']) ? b['allowedTools'] as string[] : undefined,
    chatId       : typeof b['chatId'] === 'string' ? b['chatId'] : undefined,
    maxTurns     : typeof b['maxTurns'] === 'number' ? b['maxTurns'] : undefined,
    temperature  : typeof b['temperature'] === 'number' ? b['temperature'] : undefined,
  };
}

// ─── User ID helper ───────────────────────────────────────────────────────────

function getUserId(req: Request): string {
  return (req as { user?: { claims?: { sub?: string } } }).user?.claims?.sub ?? 'anonymous';
}

// ─── Agentic handler ──────────────────────────────────────────────────────────

async function handleAgentically(
  req : Request,
  res : Response,
  body: ChatStreamBody,
): Promise<void> {
  const userId = getUserId(req);
  const runId  = randomUUID();
  const model  = resolveModel(body.model);

  Logger.info('[ChatIntegration] routing to AgenticLoop', { runId, userId, model });

  const session = createSseSession(res, runId);
  sendSse(res, { type: 'run_start', runId, model });

  const loop = new AgenticLoop();
  bridgeAgenticEvents(loop, session);

  // Configure tool permissions if allowedTools specified
  const registry = globalToolRegistry;
  if (body.allowedTools?.length) {
    registry.setProfile({
      deniedTools: registry
        .list()
        .map(t => t.name)
        .filter(n => !body.allowedTools!.includes(n)),
    });
  }

  try {
    const finalAnswer = await loop.run(body.messages, {
      model,
      systemPrompt: body.systemPrompt,
      maxTurns    : body.maxTurns ?? 15,
      temperature : body.temperature,
      userId,
      chatId      : body.chatId ?? '',
      runId,
      signal      : session.abortCtrl.signal,
      toolRegistry: registry,
    });

    sendSse(res, { type: 'run_complete', runId, finalAnswer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error('[ChatIntegration] agentic loop error', { runId, error: msg });
    sendSse(res, { type: 'error', runId, message: msg });
  } finally {
    session.close();
  }
}

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Returns an Express middleware that intercepts POST /api/chat/stream.
 * If the request is determined to be agentic, it is handled here and
 * `next()` is never called.  Otherwise the request falls through to the
 * existing chatAiRouter handler.
 */
export function createAgenticInterceptor() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only intercept the stream endpoint
    if (req.method !== 'POST') return next();

    const body = parseBody(req.body);
    if (!body) return next();

    // Explicit opt-out
    if (body.agentic === false) return next();

    // Explicit opt-in
    if (body.agentic === true) {
      await handleAgentically(req, res, body);
      return;
    }

    // Auto-detect via heuristic
    const lastUser = [...body.messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const score    = scoreAgenticNeed(userText, body.messages);

    Logger.debug('[ChatIntegration] triage', { score, threshold: AGENTIC_THRESHOLD });

    if (score >= AGENTIC_THRESHOLD) {
      await handleAgentically(req, res, body);
      return;
    }

    // Pass through to existing handler
    return next();
  };
}

/**
 * Register the interceptor on the Express app BEFORE the chatAiRouter
 * handles the same path.
 */
export function registerChatInterceptor(app: Express): void {
  app.post('/api/chat/stream', createAgenticInterceptor());
  Logger.info('[ChatIntegration] agentic interceptor registered on POST /api/chat/stream');
}
