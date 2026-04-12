/**
 * chatResilienceMiddleware.ts
 *
 * Middleware global de resiliencia para el chat:
 *  - Error boundary que NUNCA deja pasar excepciones sin manejar
 *  - Headers de retry-after en errores recuperables
 *  - Logging estructurado con request IDs correlacionables
 *  - Graceful degradation cuando proveedores LLM fallan
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// ─── Tipos ───────────────────────────────────────────────────────────────

export interface ResilienceContext {
  requestId: string;
  startTime: number;
  phase: 'routing' | 'auth' | 'parsing' | 'llm_call' | 'streaming' | 'response' | 'complete';
}

// Extender Request con contexto de resiliencia
declare global {
  namespace Express {
    interface Request {
      resilience?: ResilienceContext;
    }
  }
}

type ErrorPhase = Extract<ResilienceContext['phase'], string>;

// ─── Categorización mejorada de errores ──────────────────────────────────

interface EnhancedCategorizedError {
  category: 'network' | 'timeout' | 'rate_limit' | 'llm_error' | 'auth' | 'validation' | 'internal' | 'upstream';
  userMessageEs: string;
  statusCode: number;
  retryAfterSeconds?: number;
  shouldLog: boolean;
  logLevel: 'error' | 'warn' | 'info';
}

function categorizeEnhanced(error: unknown, phase: ErrorPhase): EnhancedCategorizedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const msg = (err.message || '').toLowerCase();
  const code = (err as any).code || (err as any).statusCode;

  // Timeout
  if (msg.includes('timeout') || msg.includes('timed out') || code === 'ETIMEDOUT' || code === 408) {
    return {
      category: 'timeout',
      userMessageEs: 'La solicitud está tardando mucho. Reintentando...',
      statusCode: 504,
      retryAfterSeconds: 2,
      shouldLog: true,
      logLevel: 'warn',
    };
  }

  // Rate limit
  if (msg.includes('rate limit') || msg.includes('too many requests') || code === 429) {
    return {
      category: 'rate_limit',
      userMessageEs: 'Demasiadas solicitudes. Por favor espera unos segundos.',
      statusCode: 429,
      retryAfterSeconds: 5,
      shouldLog: true,
      logLevel: 'warn',
    };
  }

  // Red / conectividad (errores upstream hacia LLM)
  if (
    msg.includes('econnrefused') || msg.includes('enotfound') ||
    msg.includes('network') || msg.includes('fetch failed') ||
    msg.includes('socket hang up') || code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND'
  ) {
    return {
      category: 'upstream',
      userMessageEs: 'Problema de conexión con el servicio de IA. Reconectando...',
      statusCode: 503,
      retryAfterSeconds: 3,
      shouldLog: true,
      logLevel: 'error',
    };
  }

  // Errores específicos de LLM (OpenAI/Anthropic/etc)
  if (
    msg.includes('context_length_exceeded') || msg.includes('maximum context length') ||
    msg.includes('prompt too long') || msg.includes('token limit')
  ) {
    return {
      category: 'llm_error',
      userMessageEs: 'El mensaje es demasiado largo. Intenta acortarlo o iniciar una nueva conversación.',
      statusCode: 400,
      shouldLog: false,
      logLevel: 'info',
    };
  }

  if (
    msg.includes('content_filter') || msg.includes('content policy') ||
    msg.includes('moderation') || msg.includes('safety')
  ) {
    return {
      category: 'llm_error',
      userMessageEs: 'El contenido fue filtrado por políticas de seguridad.',
      statusCode: 400,
      shouldLog: false,
      logLevel: 'info',
    };
  }

  if (
    msg.includes('insufficient_quota') || msg.includes('billing') ||
    msg.includes('quota exceeded') || code === 402
  ) {
    return {
      category: 'llm_error',
      userMessageEs: 'No hay cuota disponible en este modelo. Intenta otro modelo.',
      statusCode: 402,
      shouldLog: true,
      logLevel: 'warn',
    };
  }

  // Auth
  if (msg.includes('unauthorized') || msg.includes('authentication') || code === 401 || code === 403) {
    return {
      category: 'auth',
      userMessageEs: 'Sesión expirada. Por favor inicia sesión nuevamente.',
      statusCode: 401,
      shouldLog: false,
      logLevel: 'info',
    };
  }

  // Validación
  if (msg.includes('invalid') || msg.includes('validation') || msg.includes('required') || code === 400) {
    return {
      category: 'validation',
      userMessageEs: 'La solicitud no es válida. Verifica los datos enviados.',
      statusCode: 400,
      shouldLog: false,
      logLevel: 'info',
    };
  }

  // Errores del servidor LLM (5xx desde proveedores)
  const upstreamStatus = (err as any)?.response?.status ?? (err as any)?.status ?? 0;
  if (upstreamStatus >= 500) {
    return {
      category: 'upstream',
      userMessageEs: 'El servicio de IA no está disponible ahora mismo. Reintento automático...',
      statusCode: 502,
      retryAfterSeconds: 5,
      shouldLog: true,
      logLevel: 'error',
    };
  }

  // Default: error interno pero siempre responder
  return {
    category: 'internal',
    userMessageEs: 'Ocurrió un error inesperado. No te preocupes, ya lo estamos solucionando.',
    statusCode: 500,
    shouldLog: true,
    logLevel: 'error',
  };
}

// ─── Middleware principal ───────────────────────────────────────────────

/**
 * Middleware que envuelve TODA la ruta del chat con:
 * 1. Request ID único y correlacionable
 * 2. Timing para monitoreo
 * 3. Catch-all que JAMÁS deja caer la respuesta
 */
export function chatResilienceMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.resilience = {
    requestId: randomUUID(),
    startTime: Date.now(),
    phase: 'routing',
  };

  // Inyectar header de request ID para debugging
  const originalEnd = (_res as any).end.bind(_res);
  (_res as any).end = function (chunk?: unknown) {
    if (!(_res as any).headersSent && req.resilience) {
      _res.setHeader('X-Request-Id', req.resilience.requestId);
    }
    return originalEnd(chunk);
  };

  next();
}

/**
 * Error boundary handler — se usa como:
 *   router.post('/chat', asyncHandler, chatErrorHandler);
 *
 * GARANTÍA: Siempre responde al cliente. Nunca deja la petición colgada.
 */
export function chatErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const ctx = req.resilience || { requestId: `fallback-${Date.now()}`, startTime: Date.now(), phase: 'unknown' as ErrorPhase };
  const elapsed = Date.now() - ctx.startTime;
  const categorized = categorizeEnhanced(error, ctx.phase);

  // Loggear según severidad
  const logFn = console[categorized.logLevel] || console.error;
  if (categorized.shouldLog) {
    logFn(
      `[ChatResilience] ${categorized.category.toUpperCase()} [${ctx.requestId}]` +
      ` phase=${ctx.phase} elapsed=${elapsed}ms` +
      ` error=${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Si ya se envió respuesta, no hacer nada más
  if (res.headersSent) {
    console.warn(`[ChatResilience] Headers ya enviados para ${ctx.requestId} — no se puede enviar error`);
    return;
  }

  // Headers de resiliencia
  res.setHeader('X-Request-Id', ctx.requestId);
  res.setHeader('X-Error-Category', categorized.category);

  if (categorized.retryAfterSeconds) {
    res.setHeader('Retry-After', String(categorized.retryAfterSeconds));
  }

  // Responder SIEMPRE con JSON estructurado
  res.status(categorized.statusCode).json({
    success: false,
    error: categorized.userMessageEs,
    category: categorized.category,
    requestId: ctx.requestId,
    retryable: categorized.retryAfterSeconds !== undefined,
    retryAfter: categorized.retryAfterSeconds,
    elapsedMs: elapsed,
    // Debug info solo en desarrollo
    ...(process.env.NODE_ENV !== 'production' && {
      debug: {
        originalError: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        phase: ctx.phase,
      },
    }),
  });
}

/**
 * Wrapper para rutas de streaming SSE.
 * Garantiza que si falla el pipeline de streaming, se envíe
 * un evento de error SSE antes de cerrar.
 *
 * Uso:
 *   router.post('/chat/stream', async (req, res) => {
 *     await withStreamErrorBoundary(req, res, async () => { ... });
 *   });
 */
export async function withStreamErrorBoundary<T>(
  req: Request,
  res: Response,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const ctx = req.resilience || { requestId: `stream-${Date.now()}`, startTime: Date.now(), phase: 'streaming' as ErrorPhase };
    const categorized = categorizeEnhanced(error, ctx.phase);

    console.error(
      `[StreamBoundary] ${categorized.category} [${ctx.requestId}]:`,
      error instanceof Error ? error.message : String(error)
    );

    // Enviar evento de error SSE si el stream está abierto
    if (!res.headersSent) {
      applySseHeaders(res);
    }

    try {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: categorized.userMessageEs,
        category: categorized.category,
        retryable: categorized.retryAfterSeconds !== undefined,
        requestId: ctx.requestId,
      })}\n\n`);

      res.write('data: [STREAM_ERROR]\n\n');
    } catch (writeErr) {
      console.error('[StreamBoundary] No se pudo escribir error en stream:', writeErr);
    }

    throw error; // Re-lanzar para que el handler externo también lo capture
  }
}

function applySseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}
