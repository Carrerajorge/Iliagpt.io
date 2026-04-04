/**
 * terminalRouter
 *
 * REST + SSE API for persistent terminal sessions.
 *
 * Routes:
 *   POST   /api/terminal/session              — Create session
 *   GET    /api/terminal/session              — List user's sessions
 *   GET    /api/terminal/session/:id          — Get session info
 *   DELETE /api/terminal/session/:id          — Close session
 *   POST   /api/terminal/session/:id/run      — Run a command (REST, sync)
 *   POST   /api/terminal/session/:id/stream   — Run a command (SSE stream)
 *   POST   /api/terminal/session/:id/cd       — Change working directory
 *   POST   /api/terminal/session/:id/env      — Set environment variable
 *   GET    /api/terminal/session/:id/watch    — SSE stream of output events
 *   GET    /api/terminal/info                 — Language availability info
 */

import { Router, type Request, type Response } from 'express';
import { z }                                    from 'zod';
import { Logger }                               from '../lib/logger';
import { terminalSessionManager }               from '../agentic/tools/TerminalSession';
import { codeExecutor }                         from '../agentic/tools/CodeExecutor';
import type { SupportedLanguage }               from '../agentic/tools/CodeExecutor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(req: Request): string {
  return (req as { user?: { claims?: { sub?: string } } }).user?.claims?.sub ?? 'anonymous';
}

function sseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function sendSse(res: Response, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function isOwner(req: Request, sessionUserId: string): boolean {
  const userId = getUserId(req);
  return userId === 'anonymous' || userId === sessionUserId;
}

// ─── Request schemas ──────────────────────────────────────────────────────────

const CreateSessionSchema = z.object({
  chatId: z.string().optional(),
  cwd   : z.string().optional(),
});

const RunCommandSchema = z.object({
  command  : z.string().min(1).max(10_000),
  timeoutMs: z.number().int().min(100).max(300_000).optional(),
  env      : z.record(z.string()).optional(),
});

const CdSchema = z.object({ path: z.string().min(1) });
const SetEnvSchema = z.object({
  key  : z.string().min(1),
  value: z.string(),
});

const RunCodeSchema = z.object({
  code            : z.string().min(1).max(100_000),
  language        : z.enum(['javascript', 'typescript', 'python', 'bash', 'ruby', 'go']).optional(),
  sessionId       : z.string().optional(),
  timeoutMs       : z.number().int().min(100).max(120_000).optional(),
  autoFix         : z.boolean().optional(),
  installPackages : z.array(z.string()).optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createTerminalRouter(): Router {
  const router = Router();

  // ── POST /api/terminal/session ─────────────────────────────────────────────

  router.post('/session', async (req: Request, res: Response) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const userId = getUserId(req);
    try {
      const session = await terminalSessionManager.create(
        userId,
        parsed.data.chatId ?? '',
        parsed.data.cwd,
      );
      res.status(201).json({
        sessionId  : session.id,
        cwd        : session.cwd,
        createdAt  : session.createdAt,
      });
    } catch (err) {
      Logger.error('[TerminalRouter] create session error', { error: (err as Error).message });
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  // ── GET /api/terminal/session ──────────────────────────────────────────────

  router.get('/session', (req: Request, res: Response) => {
    const userId  = getUserId(req);
    const sessions = terminalSessionManager.list(userId);
    res.json({ sessions });
  });

  // ── GET /api/terminal/session/:id ─────────────────────────────────────────

  router.get('/session/:id', (req: Request, res: Response) => {
    const session = terminalSessionManager.get(req.params['id']!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!isOwner(req, session.userId)) return res.status(403).json({ error: 'Forbidden' });
    res.json(session);
  });

  // ── DELETE /api/terminal/session/:id ──────────────────────────────────────

  router.delete('/session/:id', (req: Request, res: Response) => {
    const session = terminalSessionManager.get(req.params['id']!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!isOwner(req, session.userId)) return res.status(403).json({ error: 'Forbidden' });

    const closed = terminalSessionManager.close(req.params['id']!);
    res.json({ closed, sessionId: req.params['id'] });
  });

  // ── POST /api/terminal/session/:id/run ────────────────────────────────────
  // Synchronous command execution (waits for completion, returns result).

  router.post('/session/:id/run', async (req: Request, res: Response) => {
    const session = terminalSessionManager.get(req.params['id']!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!isOwner(req, session.userId)) return res.status(403).json({ error: 'Forbidden' });

    const parsed = RunCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const ctrl = new AbortController();
    req.on('close', () => ctrl.abort());

    try {
      const result = await terminalSessionManager.runCommand(
        req.params['id']!,
        parsed.data.command,
        {
          timeoutMs: parsed.data.timeoutMs,
          env      : parsed.data.env,
          signal   : ctrl.signal,
        },
      );
      res.json(result);
    } catch (err) {
      Logger.error('[TerminalRouter] run command error', { error: (err as Error).message });
      res.status(500).json({ error: 'Command execution failed' });
    }
  });

  // ── POST /api/terminal/session/:id/stream ─────────────────────────────────
  // SSE streaming command execution.

  router.post('/session/:id/stream', async (req: Request, res: Response) => {
    const session = terminalSessionManager.get(req.params['id']!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!isOwner(req, session.userId)) return res.status(403).json({ error: 'Forbidden' });

    const parsed = RunCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    sseHeaders(res);
    sendSse(res, { type: 'start', sessionId: req.params['id'], command: parsed.data.command });

    const ctrl = new AbortController();
    req.on('close', () => ctrl.abort());

    try {
      const result = await terminalSessionManager.runCommand(
        req.params['id']!,
        parsed.data.command,
        {
          timeoutMs: parsed.data.timeoutMs,
          env      : parsed.data.env,
          signal   : ctrl.signal,
          onChunk  : (stream, data) => {
            sendSse(res, { type: 'chunk', stream, data });
          },
        },
      );
      sendSse(res, { type: 'done', exitCode: result.exitCode, cwd: result.cwd, durationMs: result.durationMs, killed: result.killed });
    } catch (err) {
      sendSse(res, { type: 'error', message: (err as Error).message });
    } finally {
      res.end();
    }
  });

  // ── POST /api/terminal/session/:id/cd ─────────────────────────────────────

  router.post('/session/:id/cd', async (req: Request, res: Response) => {
    const session = terminalSessionManager.get(req.params['id']!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!isOwner(req, session.userId)) return res.status(403).json({ error: 'Forbidden' });

    const parsed = CdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const result = await terminalSessionManager.changeDir(req.params['id']!, parsed.data.path);
    if (!result.success) {
      return res.status(400).json({ error: `Directory not found: ${parsed.data.path}` });
    }
    res.json({ cwd: result.cwd });
  });

  // ── POST /api/terminal/session/:id/env ────────────────────────────────────

  router.post('/session/:id/env', (req: Request, res: Response) => {
    const session = terminalSessionManager.get(req.params['id']!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!isOwner(req, session.userId)) return res.status(403).json({ error: 'Forbidden' });

    const parsed = SetEnvSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    terminalSessionManager.setEnv(req.params['id']!, parsed.data.key, parsed.data.value);
    res.json({ set: true, key: parsed.data.key });
  });

  // ── GET /api/terminal/session/:id/watch ───────────────────────────────────
  // SSE stream of output events emitted by the session manager.

  router.get('/session/:id/watch', (req: Request, res: Response) => {
    const session = terminalSessionManager.get(req.params['id']!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!isOwner(req, session.userId)) return res.status(403).json({ error: 'Forbidden' });

    sseHeaders(res);
    const sessionId = req.params['id']!;

    const listener = (event: { sessionId: string; stream: string; chunk: string }) => {
      if (event.sessionId === sessionId) {
        sendSse(res, { type: 'output', stream: event.stream, chunk: event.chunk });
      }
    };

    terminalSessionManager.on('output', listener);
    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      terminalSessionManager.off('output', listener);
      res.end();
    });
  });

  // ── POST /api/terminal/code/run ────────────────────────────────────────────
  // Language-aware code execution (not tied to a terminal session).

  router.post('/code/run', async (req: Request, res: Response) => {
    const parsed = RunCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    try {
      const result = await codeExecutor.run(parsed.data.code, {
        language       : parsed.data.language as SupportedLanguage | undefined,
        sessionId      : parsed.data.sessionId,
        timeoutMs      : parsed.data.timeoutMs,
        autoFix        : parsed.data.autoFix,
        installPackages: parsed.data.installPackages,
      });
      res.json(result);
    } catch (err) {
      Logger.error('[TerminalRouter] code run error', { error: (err as Error).message });
      res.status(500).json({ error: 'Code execution failed' });
    }
  });

  // ── POST /api/terminal/code/stream ────────────────────────────────────────
  // SSE streaming code execution.

  router.post('/code/stream', async (req: Request, res: Response) => {
    const parsed = RunCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    sseHeaders(res);
    sendSse(res, { type: 'start', language: parsed.data.language ?? 'auto' });

    try {
      const result = await codeExecutor.run(parsed.data.code, {
        language       : parsed.data.language as SupportedLanguage | undefined,
        sessionId      : parsed.data.sessionId,
        timeoutMs      : parsed.data.timeoutMs,
        autoFix        : parsed.data.autoFix,
        installPackages: parsed.data.installPackages,
        onChunk        : chunk => sendSse(res, { type: 'chunk', data: chunk }),
      });
      sendSse(res, { type: 'done', ...result });
    } catch (err) {
      sendSse(res, { type: 'error', message: (err as Error).message });
    } finally {
      res.end();
    }
  });

  // ── GET /api/terminal/info ─────────────────────────────────────────────────

  router.get('/info', async (_req: Request, res: Response) => {
    const [availability, stats] = await Promise.all([
      codeExecutor.checkLanguageAvailability(),
      Promise.resolve(terminalSessionManager.stats()),
    ]);
    res.json({ languageAvailability: availability, sessions: stats });
  });

  return router;
}
