import { db } from '../../db';
import { agentSessionState } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  timestamp: number;
}

export interface AgentSession {
  id: string;
  userId: string;
  chatId: string;
  messages: SessionMessage[];
  status: 'active' | 'paused' | 'completed' | 'failed';
  toolsUsed: string[];
  iterations: number;
  totalTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionSummary {
  id: string;
  chatId: string;
  status: AgentSession['status'];
  iterations: number;
  totalTokens: number;
  messageCount: number;
  updatedAt: Date;
}

const SESSIONS_DIR = path.join(process.cwd(), 'data', 'claw-sessions');
const COMPACT_THRESHOLD = 100;
const COMPACT_KEEP_RECENT = 20;

async function upsertKeys(tx: any, sessionId: string, payload: Record<string, any>): Promise<void> {
  for (const [key, value] of Object.entries(payload)) {
    const existing = await tx.select().from(agentSessionState)
      .where(and(eq(agentSessionState.sessionId, sessionId), eq(agentSessionState.key, key))).limit(1);
    if (existing.length > 0) {
      await tx.update(agentSessionState).set({ value, updatedAt: new Date() })
        .where(and(eq(agentSessionState.sessionId, sessionId), eq(agentSessionState.key, key)));
    } else {
      await tx.insert(agentSessionState).values({ sessionId, key, value });
    }
  }
}

export class ClawSessionManager {
  async save(session: AgentSession): Promise<void> {
    session.updatedAt = new Date();
    const payload: Record<string, any> = {
      userId: session.userId, chatId: session.chatId, messages: session.messages,
      status: session.status, toolsUsed: session.toolsUsed, iterations: session.iterations,
      totalTokens: session.totalTokens, createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
    try {
      await db.transaction(async (tx) => upsertKeys(tx, session.id, payload));
    } catch (err: any) {
      console.error(`[ClawSessionManager] DB save failed for ${session.id}:`, err.message);
    }
    this.writeJsonlBackup(session);
  }

  async load(sessionId: string): Promise<AgentSession | null> {
    try {
      const rows = await db.select().from(agentSessionState)
        .where(eq(agentSessionState.sessionId, sessionId));
      if (rows.length === 0) return null;
      const d: Record<string, any> = {};
      for (const row of rows) d[row.key] = row.value;
      return {
        id: sessionId, userId: d.userId ?? '', chatId: d.chatId ?? '',
        messages: d.messages ?? [], status: d.status ?? 'paused',
        toolsUsed: d.toolsUsed ?? [], iterations: d.iterations ?? 0,
        totalTokens: d.totalTokens ?? 0,
        createdAt: d.createdAt ? new Date(d.createdAt) : new Date(),
        updatedAt: d.updatedAt ? new Date(d.updatedAt) : new Date(),
      };
    } catch (err: any) {
      console.error(`[ClawSessionManager] Failed to load ${sessionId}:`, err.message);
      return null;
    }
  }

  async resume(sessionId: string): Promise<AgentSession> {
    const session = await this.load(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'completed' || session.status === 'failed') {
      throw new Error(`Cannot resume session with status "${session.status}"`);
    }
    session.status = 'active';
    await this.save(session);
    return session;
  }

  async list(userId: string): Promise<SessionSummary[]> {
    try {
      const userRows = await db.select().from(agentSessionState)
        .where(eq(agentSessionState.key, 'userId'));
      const sids = userRows.filter((r) => r.value === userId).map((r) => r.sessionId);
      if (sids.length === 0) return [];
      const summaries: SessionSummary[] = [];
      for (const sid of sids) {
        const s = await this.load(sid);
        if (!s) continue;
        summaries.push({
          id: s.id, chatId: s.chatId, status: s.status, iterations: s.iterations,
          totalTokens: s.totalTokens, messageCount: s.messages.length, updatedAt: s.updatedAt,
        });
      }
      return summaries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    } catch (err: any) {
      console.error(`[ClawSessionManager] Failed to list sessions:`, err.message);
      return [];
    }
  }

  async compact(sessionId: string): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.messages.length <= COMPACT_THRESHOLD) return;

    const older = session.messages.slice(0, -COMPACT_KEEP_RECENT);
    const recent = session.messages.slice(-COMPACT_KEEP_RECENT);
    const tools = [...new Set(older.filter((m) => m.role === 'tool').map((m) => m.toolCallId ?? 'unknown'))];
    const userTurns = older.filter((m) => m.role === 'user').length;
    const assistantTurns = older.filter((m) => m.role === 'assistant').length;
    const summary = `[Compacted ${older.length} messages] ${userTurns} user turns, ` +
      `${assistantTurns} assistant turns. Tools: ${tools.slice(0, 10).join(', ') || 'none'}.`;

    session.messages = [{ role: 'system', content: summary, timestamp: Date.now() }, ...recent];
    await this.save(session);
  }

  private writeJsonlBackup(session: AgentSession): void {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      const line = JSON.stringify({
        sessionId: session.id, chatId: session.chatId, status: session.status,
        iterations: session.iterations, totalTokens: session.totalTokens,
        messageCount: session.messages.length, toolsUsed: session.toolsUsed,
        timestamp: new Date().toISOString(),
      });
      fs.appendFileSync(path.join(SESSIONS_DIR, `${session.userId}.jsonl`), line + '\n', 'utf-8');
    } catch (err: any) {
      console.warn(`[ClawSessionManager] JSONL backup failed:`, err.message);
    }
  }
}

export const clawSessionManager = new ClawSessionManager();
