/**
 * chatEnhancer.ts
 *
 * Wraps the existing chat send logic to add agentic routing, intent detection,
 * message/response interception, and SSE stream parsing.
 *
 * Key features:
 *  - detectAgenticIntent: classifies a message as agentic or normal
 *  - send: resolves endpoint, builds headers, returns routing metadata
 *  - streamResponse: async generator over SSE events with interceptor chain
 *  - addMessageInterceptor / addResponseInterceptor: pluggable middleware
 *  - buildAgentStepsFromEvents: converts raw SSE events → AgentStep[]
 *  - estimateThinkingMode: heuristic to suggest a ThinkingMode
 *
 * Singleton export: chatEnhancer
 */

import type { AgenticStreamEvent } from '@/lib/agentic/agenticStreamParser';
import { AgenticStreamParser } from '@/lib/agentic/agenticStreamParser';
import type { AgentStep } from '@/stores/agent-store';
import type { ThinkingMode } from './AgenticChatProvider';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface EnhancedSendOptions {
  chatId: string;
  text: string;
  files?: File[];
  thinkingMode?: ThinkingMode;
  forceAgentic?: boolean;
  forceNormal?: boolean;
}

export interface EnhancedSendResult {
  requestId: string;
  endpoint: 'agentic' | 'normal';
  chatId: string;
  resolvedUrl: string;
  body: string;
  headers: Record<string, string>;
}

export type MessageInterceptor = (text: string) => Promise<string>;
export type ResponseInterceptor = (event: AgenticStreamEvent) => void;

interface ChatEnhancerOptions {
  agenticEndpoint?: string;
  normalEndpoint?: string;
}

// ─── Intent detection patterns ────────────────────────────────────────────────

/** Slash commands that always route to the agentic endpoint */
const AGENTIC_SLASH_COMMANDS = [
  '/code',
  '/search',
  '/analyze',
  '/browse',
  '/run',
  '/create',
  '/terminal',
];

/** Free-text keywords that strongly signal an agentic task */
const AGENTIC_KEYWORDS: RegExp[] = [
  /\bwrite a script\b/i,
  /\bexecute\b/i,
  /\brun this\b/i,
  /\bcreate a file\b/i,
  /\bsearch the web\b/i,
  /\bbrowse to\b/i,
  /\bopen terminal\b/i,
  /\bopen a terminal\b/i,
  /\bread the file\b/i,
  /\bwrite to\b/i,
  /\bsave as\b/i,
  /\bdelete the\b/i,
  /\bgenerate a\b/i,
  /\bdownload\b/i,
  /\bscrape\b/i,
  /\bfetch\b/i,
  /\bautomatically\b/i,
];

/** Multi-step/chained task indicators */
const MULTI_STEP_PATTERNS: RegExp[] = [
  /\bthen\b.*\bthen\b/i,
  /\bafter that\b/i,
  /\bfirst[^.]*then\b/i,
  /\bstep by step\b/i,
  /\bstep \d+\b/i,
  /\bnext[,;]?\s+(?:then|also)\b/i,
  /\bfinally\b.*\balso\b/i,
];

/** Code-related patterns */
const CODE_PATTERNS: RegExp[] = [
  /```[\s\S]{10,}/,           // fenced code block with content
  /\bimplement\b/i,
  /\brefactor\b/i,
  /\bdebug\b/i,
  /\bfix the bug\b/i,
  /\badd a function\b/i,
  /\bwrite.*\bfunction\b/i,
  /\bwrite.*\bclass\b/i,
  /\bwrite.*\bmodule\b/i,
  /\bcompile\b/i,
  /\bbuild.*\bproject\b/i,
];

/** File operation patterns */
const FILE_PATTERNS: RegExp[] = [
  /\bread.*\bfile\b/i,
  /\bwrite to.*\bfile\b/i,
  /\bcreate a.*\bfile\b/i,
  /\bopen.*\bfile\b/i,
  /\bupload\b/i,
  /\bsave.*\bas\b/i,
  /\bexport.*\bfile\b/i,
  /\blist.*\bfiles\b/i,
];

// ─── ChatEnhancer class ───────────────────────────────────────────────────────

export class ChatEnhancer {
  private readonly agenticEndpoint: string;
  private readonly normalEndpoint: string;
  private messageInterceptors: MessageInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];

  constructor({ agenticEndpoint, normalEndpoint }: ChatEnhancerOptions = {}) {
    this.agenticEndpoint = agenticEndpoint ?? '/api/chat/stream';
    this.normalEndpoint = normalEndpoint ?? '/api/chat/stream';
  }

  // ── Intent detection ──────────────────────────────────────────────────────

  /**
   * detectAgenticIntent
   *
   * Returns true when the message text suggests a tool-using, multi-step,
   * or file/web-interacting task that should be routed to the agentic endpoint.
   */
  detectAgenticIntent(text: string): boolean {
    const trimmed = text.trimStart();

    // Slash commands
    if (AGENTIC_SLASH_COMMANDS.some((cmd) => trimmed.toLowerCase().startsWith(cmd))) {
      return true;
    }

    // Keyword patterns
    if (AGENTIC_KEYWORDS.some((re) => re.test(text))) return true;

    // Multi-step chaining
    if (MULTI_STEP_PATTERNS.some((re) => re.test(text))) return true;

    // Code-related
    if (CODE_PATTERNS.some((re) => re.test(text))) return true;

    // File operations
    if (FILE_PATTERNS.some((re) => re.test(text))) return true;

    return false;
  }

  // ── Thinking mode estimator ───────────────────────────────────────────────

  /**
   * estimateThinkingMode
   *
   * Heuristically suggests a ThinkingMode based on the complexity of the
   * input message. Not authoritative — use as a default suggestion only.
   */
  estimateThinkingMode(text: string): ThinkingMode {
    const words = text.split(/\s+/).filter(Boolean).length;
    const hasCode = /```|`[^`]+`/.test(text);
    const hasMultiStep = MULTI_STEP_PATTERNS.some((re) => re.test(text));
    const hasQuestion = /\?/.test(text);
    const hasDeepQuestion =
      /\bwhy\b|\bhow does\b|\bexplain\b|\bcompare\b|\banalyze\b|\bdeep dive\b/i.test(text);
    const hasCreativeHint =
      /\bcreative\b|\boriginal\b|\bimagine\b|\bnovel\b|\binvent\b|\bbrainstorm\b/i.test(text);

    if (hasCreativeHint) return 'creative';
    if (hasDeepQuestion || (words > 80 && hasCode)) return 'deep';
    if (hasMultiStep || (words > 40 && hasQuestion) || hasCode) return 'balanced';
    return 'fast';
  }

  // ── Main send ─────────────────────────────────────────────────────────────

  /**
   * send
   *
   * Processes message interceptors, detects routing endpoint, builds the
   * request body and headers, and returns routing metadata.
   *
   * Does NOT actually perform the HTTP fetch — call streamResponse with the
   * returned EnhancedSendResult to open the SSE stream.
   */
  async send(options: EnhancedSendOptions): Promise<EnhancedSendResult> {
    const { chatId, files, thinkingMode, forceAgentic, forceNormal } = options;
    let { text } = options;

    // Run message interceptors in sequence
    for (const interceptor of this.messageInterceptors) {
      text = await interceptor(text);
    }

    // Resolve endpoint
    let isAgentic: boolean;
    if (forceAgentic) {
      isAgentic = true;
    } else if (forceNormal) {
      isAgentic = false;
    } else {
      isAgentic = this.detectAgenticIntent(text);
    }

    const resolvedUrl = isAgentic ? this.agenticEndpoint : this.normalEndpoint;
    const requestId = this.generateRequestId();
    const resolvedThinkingMode = thinkingMode ?? (isAgentic ? this.estimateThinkingMode(text) : 'fast');

    // Build body
    const bodyObject: Record<string, unknown> = {
      messages: [{ role: 'user', content: text }],
      chatId,
      thinkingMode: resolvedThinkingMode,
      agentic: isAgentic,
    };

    if (files && files.length > 0) {
      bodyObject.hasFiles = true;
      bodyObject.fileCount = files.length;
    }

    const body = JSON.stringify(bodyObject);

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    };

    if (isAgentic) {
      headers['X-Agentic'] = 'true';
      headers['X-Thinking-Mode'] = resolvedThinkingMode;
    }

    return {
      requestId,
      endpoint: isAgentic ? 'agentic' : 'normal',
      chatId,
      resolvedUrl,
      body,
      headers,
    };
  }

  // ── Stream response ───────────────────────────────────────────────────────

  /**
   * streamResponse
   *
   * Opens a POST SSE stream to the resolved endpoint and yields parsed
   * AgenticStreamEvent objects. Calls all registered response interceptors
   * for each event.
   *
   * Handles:
   *  - `data: [DONE]` → terminates the generator
   *  - HTTP error responses → throws with status code message
   *  - Network errors → re-throws
   */
  async *streamResponse(
    result: EnhancedSendResult,
    signal?: AbortSignal
  ): AsyncGenerator<AgenticStreamEvent> {
    const response = await fetch(result.resolvedUrl, {
      method: 'POST',
      headers: result.headers,
      body: result.body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`Stream request failed: HTTP ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null — SSE stream unavailable.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the incomplete last line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // SSE comment or blank

          if (trimmed === 'data: [DONE]') {
            return; // Stream complete
          }

          if (trimmed.startsWith('data: ')) {
            const rawData = trimmed.slice(6);
            const event = this.parseSSEData(rawData);
            if (event) {
              // Fire response interceptors
              for (const interceptor of this.responseInterceptors) {
                try {
                  interceptor(event);
                } catch {
                  // Interceptors must not crash the stream
                }
              }
              yield event;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Interceptors ──────────────────────────────────────────────────────────

  /**
   * addMessageInterceptor
   *
   * Registers a function that transforms the message text before sending.
   * Returns an unsubscribe function.
   */
  addMessageInterceptor(fn: MessageInterceptor): () => void {
    this.messageInterceptors.push(fn);
    return () => {
      this.messageInterceptors = this.messageInterceptors.filter((f) => f !== fn);
    };
  }

  /**
   * addResponseInterceptor
   *
   * Registers a function called for every streamed AgenticStreamEvent.
   * Returns an unsubscribe function.
   */
  addResponseInterceptor(fn: ResponseInterceptor): () => void {
    this.responseInterceptors.push(fn);
    return () => {
      this.responseInterceptors = this.responseInterceptors.filter((f) => f !== fn);
    };
  }

  // ── AgentStep accumulation ────────────────────────────────────────────────

  /**
   * buildAgentStepsFromEvents
   *
   * Processes a list of AgenticStreamEvents and returns an array of AgentStep
   * objects compatible with the existing AgentStore.AgentStep shape.
   *
   * Matches tool_call_start events with tool_call_end events by toolCallId.
   */
  buildAgentStepsFromEvents(events: AgenticStreamEvent[]): AgentStep[] {
    const stepsMap = new Map<string, AgentStep>();
    let stepIndex = 0;

    for (const event of events) {
      switch (event.type) {
        case 'tool_call_start': {
          const id = event.toolCallId ?? `step_${stepIndex}`;
          if (!stepsMap.has(id)) {
            stepsMap.set(id, {
              stepIndex: stepIndex++,
              toolName: event.toolName ?? 'unknown',
              status: 'running',
              startedAt: new Date().toISOString(),
            });
          }
          break;
        }

        case 'tool_call_end': {
          const id = event.toolCallId ?? '';
          const existing = stepsMap.get(id);
          if (existing) {
            stepsMap.set(id, {
              ...existing,
              status: event.error ? 'failed' : 'succeeded',
              output: event.result ?? undefined,
              error: event.error ?? undefined,
              completedAt: new Date().toISOString(),
            });
          }
          break;
        }

        case 'tool_call_delta': {
          const id = event.toolCallId ?? '';
          const existing = stepsMap.get(id);
          if (existing && existing.status === 'pending') {
            stepsMap.set(id, { ...existing, status: 'running' });
          }
          break;
        }

        default:
          break;
      }
    }

    return Array.from(stepsMap.values()).sort((a, b) => a.stepIndex - b.stepIndex);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private generateRequestId(): string {
    // Use crypto.randomUUID when available (all modern browsers)
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback for environments without randomUUID
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private parseSSEData(rawData: string): AgenticStreamEvent | null {
    try {
      const parsed: unknown = JSON.parse(rawData);
      if (typeof parsed !== 'object' || parsed === null) return null;

      // Delegate to AgenticStreamParser if it provides a static parseEvent
      if (typeof AgenticStreamParser.parseEvent === 'function') {
        return AgenticStreamParser.parseEvent(parsed);
      }

      // Fallback: treat the raw object as an AgenticStreamEvent if it has `type`
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.type === 'string') {
        return obj as unknown as AgenticStreamEvent;
      }

      return null;
    } catch {
      return null;
    }
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

/**
 * chatEnhancer
 *
 * Application-wide singleton. Import this directly rather than instantiating
 * ChatEnhancer yourself unless you need isolated interceptor chains.
 *
 * @example
 * import { chatEnhancer } from '@/integration/chatEnhancer';
 *
 * const result = await chatEnhancer.send({ chatId, text });
 * for await (const event of chatEnhancer.streamResponse(result)) {
 *   // handle event
 * }
 */
export const chatEnhancer = new ChatEnhancer({});
