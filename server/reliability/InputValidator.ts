/**
 * InputValidator — Zod-based request validation with sanitization and size limits.
 *
 * Features:
 *   - Validates chat message arrays: role enum, max content length 100 KB per message
 *   - Validates agentic spawn requests with allowed tool lists
 *   - Express middleware factory for route-level schema enforcement
 *   - Sanitizes strings: strips null bytes, normalizes Unicode, trims excess whitespace
 *   - Returns structured validation errors (field-level detail)
 */

import { z, type ZodSchema, type ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from '../lib/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_MESSAGE_BYTES   = 100_000;   // 100 KB per message content
const MAX_MESSAGES        = 200;       // max messages in a conversation
const MAX_SYSTEM_BYTES    = 10_000;    // 10 KB for system prompt
const MAX_TOTAL_REQ_BYTES = 4_000_000; // 4 MB total request body

// ─── Sanitization ─────────────────────────────────────────────────────────────

export function sanitizeString(s: string): string {
  return s
    .replace(/\0/g, '')           // strip null bytes (breaks many parsers)
    .normalize('NFC')             // canonical Unicode form
    .replace(/\r\n/g, '\n')      // normalize line endings
    .replace(/[\u200B-\u200D\uFEFF]/g, ''); // strip zero-width chars
}

function sanitizedString(max: number) {
  return z.string()
    .max(max, `Must be under ${max} characters`)
    .transform(sanitizeString);
}

// ─── Shared schemas ───────────────────────────────────────────────────────────

export const MessageSchema = z.object({
  role   : z.enum(['user', 'assistant', 'system', 'tool']),
  content: sanitizedString(MAX_MESSAGE_BYTES),
  name   : z.string().max(64).optional(),
  tool_calls: z.array(z.object({
    callId  : z.string().max(128),
    toolName: z.string().max(64),
    input   : z.unknown(),
  })).optional(),
  tool_call_id: z.string().max(128).optional(),
});

export const ChatStreamSchema = z.object({
  messages    : z.array(MessageSchema).min(1).max(MAX_MESSAGES),
  model       : z.string().max(80).optional(),
  systemPrompt: sanitizedString(MAX_SYSTEM_BYTES).optional(),
  chatId      : z.string().max(128).optional(),
  allowedTools: z.array(z.string().max(64)).max(50).optional(),
  temperature : z.number().min(0).max(2).optional(),
  maxTokens   : z.number().int().min(1).max(32_000).optional(),
  stream      : z.boolean().optional(),
});

export const SpawnTaskSchema = z.object({
  objective   : sanitizedString(2_000),
  instructions: sanitizedString(10_000).optional(),
  allowedTools: z.array(z.string().max(64)).max(50).optional(),
  priority    : z.enum(['low', 'normal', 'high', 'critical']).optional(),
  userId      : z.string().max(128).optional(),
  chatId      : z.string().max(128).optional(),
});

export const ToolInputSchema = z.object({
  toolName: z.string().max(64).regex(/^[a-z_][a-z0-9_]*$/, 'Tool name must be snake_case'),
  input   : z.record(z.unknown()),
  chatId  : z.string().max(128).optional(),
  userId  : z.string().max(128).optional(),
});

// ─── Middleware factory ────────────────────────────────────────────────────────

export type ValidatedBody<S extends ZodSchema> = z.infer<S>;

/**
 * Express middleware that validates `req.body` against a Zod schema.
 * On success, replaces `req.body` with the parsed (sanitized) output.
 * On failure, responds 400 with field-level errors.
 */
export function validateBody<S extends ZodSchema>(schema: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Enforce total request size
    const bodyStr = JSON.stringify(req.body);
    if (bodyStr.length > MAX_TOTAL_REQ_BYTES) {
      res.status(413).json({ error: 'validation', message: `Request body too large (max ${MAX_TOTAL_REQ_BYTES} bytes)` });
      return;
    }

    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = formatZodError(result.error);
      Logger.warn('[InputValidator] request validation failed', { path: req.path, issues });
      res.status(400).json({ error: 'validation', message: 'Invalid request body', issues });
      return;
    }

    req.body = result.data;
    next();
  };
}

// ─── Query param validation ───────────────────────────────────────────────────

export function validateQuery<S extends ZodSchema>(schema: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const issues = formatZodError(result.error);
      Logger.warn('[InputValidator] query validation failed', { path: req.path, issues });
      res.status(400).json({ error: 'validation', message: 'Invalid query parameters', issues });
      return;
    }
    req.query = result.data as typeof req.query;
    next();
  };
}

// ─── Format Zod errors ────────────────────────────────────────────────────────

export function formatZodError(err: ZodError): Array<{ field: string; message: string }> {
  return err.issues.map(issue => ({
    field  : issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

// ─── Standalone parse helpers (for non-Express use) ──────────────────────────

export function parseChatStream(body: unknown) {
  return ChatStreamSchema.safeParse(body);
}

export function parseSpawnTask(body: unknown) {
  return SpawnTaskSchema.safeParse(body);
}
