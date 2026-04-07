/**
 * streamingWiring
 *
 * End-to-end SSE plumbing that bridges AgenticLoop events to the HTTP
 * response stream in a format the frontend already understands.
 *
 * Event envelope:
 *   data: {"type":"...", ...}\n\n
 *
 * Event types emitted to the client:
 *   run_start          — loop started
 *   text_delta         — partial assistant text
 *   thinking           — reasoning token (if model supports it)
 *   tool_call_start    — a tool is about to run (name + input)
 *   tool_call_result   — a tool finished (name + output + success)
 *   artifact           — a file / document was created
 *   task_spawned       — a background task was launched
 *   run_complete       — loop finished, final answer attached
 *   error              — recoverable or fatal error
 *   heartbeat          — keep-alive ping (every 20 s)
 */

import type { Response } from 'express';
import { Logger }        from '../lib/logger';
import type { AgenticEvent } from '../agentic/core/AgenticLoop';

// ─── SSE helpers ──────────────────────────────────────────────────────────────

export function sseHeaders(res: Response): void {
  res.setHeader('Content-Type',    'text/event-stream');
  res.setHeader('Cache-Control',   'no-cache');
  res.setHeader('Connection',      'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

export function sendSse(res: Response, event: Record<string, unknown>): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ─── SSE session ──────────────────────────────────────────────────────────────

export interface SseSession {
  res       : Response;
  runId     : string;
  heartbeat : ReturnType<typeof setInterval>;
  abortCtrl : AbortController;
  closed    : boolean;
  close     : () => void;
}

/**
 * Create a managed SSE session.  The caller is responsible for wiring the
 * close handler to the AgenticLoop abort.
 */
export function createSseSession(res: Response, runId: string): SseSession {
  sseHeaders(res);
  const abortCtrl = new AbortController();

  const heartbeat = setInterval(() => {
    if (session.closed) return clearInterval(session.heartbeat);
    res.write(': heartbeat\n\n');
  }, 20_000);

  const session: SseSession = {
    res,
    runId,
    heartbeat,
    abortCtrl,
    closed: false,
    close: () => {
      if (session.closed) return;
      session.closed = true;
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };

  res.on('close', () => {
    abortCtrl.abort();
    session.close();
  });

  return session;
}

// ─── Event bridge ─────────────────────────────────────────────────────────────

/**
 * Wire an AgenticLoop's EventEmitter to an SSE session.
 * Maps internal AgenticEvent types → frontend-visible SSE events.
 */
export function bridgeAgenticEvents(
  emitter  : { on: (ev: string, fn: (e: AgenticEvent) => void) => void },
  session  : SseSession,
): void {
  emitter.on('event', (event: AgenticEvent) => {
    if (session.closed) return;

    switch (event.type) {
      case 'turn_start':
        // Don't flood the client with turn markers — log only
        Logger.debug('[StreamWiring] turn', { turn: event.turn });
        break;

      case 'content_delta':
        sendSse(session.res, {
          type   : 'text_delta',
          runId  : session.runId,
          delta  : event.delta,
          // snapshot is large — only send delta
        });
        break;

      case 'thinking':
        sendSse(session.res, {
          type  : 'thinking',
          runId : session.runId,
          delta : (event as unknown as { delta: string }).delta ?? '',
        });
        break;

      case 'tool_call':
        sendSse(session.res, {
          type    : 'tool_call_start',
          runId   : session.runId,
          toolName: event.toolName,
          callId  : event.callId,
          input   : event.input,
        });
        if (isDocumentArtifactTool(event.toolName)) {
          const inp = event.input as { title?: string; format?: string; type?: string } | undefined;
          sendSse(session.res, {
            type     : 'artifact',
            runId    : session.runId,
            kind     : 'document',
            title    : inp?.title ?? 'document',
            format   : inp?.type ?? inp?.format ?? 'document',
            callId   : event.callId,
          });
        }
        if (event.toolName === 'spawn_task') {
          sendSse(session.res, {
            type  : 'task_spawned',
            runId : session.runId,
            callId: event.callId,
          });
        }
        break;

      case 'tool_result':
        sendSse(session.res, {
          type      : 'tool_call_result',
          runId     : session.runId,
          toolName  : event.toolName,
          callId    : event.callId,
          success   : event.success,
          output    : summariseOutput(event.output),
          durationMs: event.durationMs,
        });
        if (isDocumentArtifactTool(event.toolName) && event.success) {
          const out = event.output as unknown;
          const artifact = extractArtifactDetails(out);
          if (artifact.filePath || artifact.downloadUrl) {
            sendSse(session.res, {
              type    : 'artifact',
              runId   : session.runId,
              kind    : 'document',
              filePath: artifact.filePath,
              downloadUrl: artifact.downloadUrl,
              callId  : event.callId,
            });
          }
        }
        break;

      case 'loop_done':
        // run_complete sent by caller after loop.run() resolves
        break;

      case 'error':
        sendSse(session.res, {
          type     : 'error',
          runId    : session.runId,
          message  : event.message,
          retryable: (event as unknown as { retryable?: boolean }).retryable ?? false,
        });
        break;

      default:
        // Forward any unknown events as-is
        sendSse(session.res, { ...(event as Record<string, unknown>), runId: session.runId });
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate large outputs before sending them over SSE. */
function summariseOutput(output: unknown): unknown {
  if (typeof output === 'string' && output.length > 2000) {
    return output.slice(0, 2000) + '…(truncated)';
  }
  if (typeof output === 'object' && output !== null) {
    const s = JSON.stringify(output);
    if (s.length > 2000) return s.slice(0, 2000) + '…(truncated)';
  }
  return output;
}

function isDocumentArtifactTool(toolName: string): boolean {
  return toolName === 'create_document'
    || toolName === 'create_presentation'
    || toolName === 'create_spreadsheet'
    || toolName === 'generate_document';
}

function extractArtifactDetails(output: unknown): { filePath: string | null; downloadUrl: string | null } {
  if (typeof output === 'string') {
    const m = output.match(/Document created:\s*(\S+)/);
    return { filePath: m?.[1] ?? null, downloadUrl: null };
  }
  if (typeof output === 'object' && output !== null) {
    const o = output as Record<string, unknown>;
    const filePath =
      typeof o['filePath'] === 'string' ? o['filePath'] :
      typeof o['path'] === 'string' ? o['path'] :
      typeof o['artifactPath'] === 'string' ? o['artifactPath'] :
      null;
    const downloadUrl =
      typeof o['downloadUrl'] === 'string' ? o['downloadUrl'] :
      typeof o['url'] === 'string' ? o['url'] :
      null;
    if (filePath || downloadUrl) {
      return { filePath, downloadUrl };
    }
    if (typeof o['output'] === 'string') return extractArtifactDetails(o['output']);
  }
  return { filePath: null, downloadUrl: null };
}

// ─── Backpressure guard ───────────────────────────────────────────────────────

/**
 * Check whether the response socket is still writable.
 * The AgenticLoop can check this to short-circuit when the client disconnected.
 */
export function isSessionAlive(session: SseSession): boolean {
  return !session.closed && !session.res.writableEnded;
}
