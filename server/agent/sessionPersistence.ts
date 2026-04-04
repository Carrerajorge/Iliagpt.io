import { db } from '../db';
import { agentSessionState } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

export interface AgentSessionSnapshot {
  runId: string;
  chatId: string;
  userId: string;
  status: "running" | "paused" | "completed" | "failed";
  currentIteration: number;
  maxIterations: number;
  plan: {
    intent: string;
    steps: Array<{ id: string; label: string; status: string }>;
    currentStepIndex: number;
  };
  toolProgress: Array<{
    toolName: string;
    iteration: number;
    success: boolean;
    durationMs: number;
    timestamp: number;
  }>;
  conversationSummary: string;
  conversationHistory: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: any[] }>;
  artifacts: Array<{ type: string; url: string; name: string }>;
  totalTokensUsed: number;
  lastActiveAt: number;
}

async function upsertSessionKey(sessionId: string, key: string, value: any): Promise<void> {
  const existing = await db.select()
    .from(agentSessionState)
    .where(and(
      eq(agentSessionState.sessionId, sessionId),
      eq(agentSessionState.key, key)
    ))
    .limit(1);

  if (existing.length > 0) {
    await db.update(agentSessionState)
      .set({ value, updatedAt: new Date() })
      .where(and(
        eq(agentSessionState.sessionId, sessionId),
        eq(agentSessionState.key, key)
      ));
  } else {
    await db.insert(agentSessionState).values({ sessionId, key, value });
  }
}

export class SessionPersistenceManager {
  async saveSession(snapshot: AgentSessionSnapshot): Promise<void> {
    const sessionId = snapshot.runId;
    const entries: Array<{ key: string; value: any }> = [
      { key: "status", value: snapshot.status },
      { key: "currentIteration", value: snapshot.currentIteration },
      { key: "maxIterations", value: snapshot.maxIterations },
      { key: "plan", value: snapshot.plan },
      { key: "toolProgress", value: snapshot.toolProgress },
      { key: "conversationSummary", value: snapshot.conversationSummary },
      { key: "conversationHistory", value: snapshot.conversationHistory },
      { key: "artifacts", value: snapshot.artifacts },
      { key: "totalTokensUsed", value: snapshot.totalTokensUsed },
      { key: "lastActiveAt", value: snapshot.lastActiveAt },
      { key: "chatId", value: snapshot.chatId },
      { key: "userId", value: snapshot.userId },
    ];

    try {
      await db.transaction(async (tx) => {
        for (const entry of entries) {
          const existing = await tx.select()
            .from(agentSessionState)
            .where(and(
              eq(agentSessionState.sessionId, sessionId),
              eq(agentSessionState.key, entry.key)
            ))
            .limit(1);

          if (existing.length > 0) {
            await tx.update(agentSessionState)
              .set({ value: entry.value, updatedAt: new Date() })
              .where(and(
                eq(agentSessionState.sessionId, sessionId),
                eq(agentSessionState.key, entry.key)
              ));
          } else {
            await tx.insert(agentSessionState).values({ sessionId, key: entry.key, value: entry.value });
          }
        }
      });
    } catch (txErr: any) {
      console.warn(`[SessionPersistence] Transaction failed, falling back to individual writes:`, txErr.message);
      for (const entry of entries) {
        try {
          await upsertSessionKey(sessionId, entry.key, entry.value);
        } catch (err: any) {
          console.error(`[SessionPersistence] Failed to save key "${entry.key}":`, err.message);
        }
      }
    }
    console.log(`[SessionPersistence] Saved session ${sessionId} (status: ${snapshot.status})`);
  }

  async loadSession(runId: string): Promise<AgentSessionSnapshot | null> {
    try {
      const rows = await db.select()
        .from(agentSessionState)
        .where(eq(agentSessionState.sessionId, runId));

      if (rows.length === 0) return null;

      const data: Record<string, any> = {};
      for (const row of rows) {
        data[row.key] = row.value;
      }

      return {
        runId,
        chatId: data.chatId || "",
        userId: data.userId || "",
        status: data.status || "paused",
        currentIteration: data.currentIteration || 0,
        maxIterations: data.maxIterations || 25,
        plan: data.plan || { intent: "unknown", steps: [], currentStepIndex: 0 },
        toolProgress: data.toolProgress || [],
        conversationSummary: data.conversationSummary || "",
        conversationHistory: data.conversationHistory || [],
        artifacts: data.artifacts || [],
        totalTokensUsed: data.totalTokensUsed || 0,
        lastActiveAt: data.lastActiveAt || Date.now(),
      };
    } catch (err: any) {
      console.error(`[SessionPersistence] Failed to load session ${runId}:`, err.message);
      return null;
    }
  }

  async pauseSession(runId: string, snapshot: Partial<AgentSessionSnapshot>): Promise<boolean> {
    try {
      const current = await this.loadSession(runId);
      if (!current) return false;

      const updated: AgentSessionSnapshot = {
        ...current,
        ...snapshot,
        status: "paused",
        lastActiveAt: Date.now(),
      };

      await this.saveSession(updated);
      console.log(`[SessionPersistence] Paused session ${runId}`);
      return true;
    } catch (err: any) {
      console.error(`[SessionPersistence] Failed to pause session ${runId}:`, err.message);
      return false;
    }
  }

  async resumeSession(runId: string): Promise<AgentSessionSnapshot | null> {
    try {
      const session = await this.loadSession(runId);
      if (!session) return null;
      if (session.status !== "paused") {
        console.warn(`[SessionPersistence] Session ${runId} is not paused (status: ${session.status})`);
        return null;
      }

      session.status = "running";
      session.lastActiveAt = Date.now();
      await this.saveSession(session);
      console.log(`[SessionPersistence] Resumed session ${runId}`);
      return session;
    } catch (err: any) {
      console.error(`[SessionPersistence] Failed to resume session ${runId}:`, err.message);
      return null;
    }
  }

  async markCompleted(runId: string): Promise<void> {
    try {
      await upsertSessionKey(runId, "status", "completed");
    } catch (err: any) {
      console.error(`[SessionPersistence] Failed to mark completed ${runId}:`, err.message);
    }
  }

  async listPausedSessions(userId: string): Promise<Array<{ runId: string; lastActiveAt: number; plan: any }>> {
    try {
      const statusRows = await db.select()
        .from(agentSessionState)
        .where(eq(agentSessionState.key, "status"));

      const pausedIds = statusRows
        .filter(r => r.value === "paused")
        .map(r => r.sessionId);

      if (pausedIds.length === 0) return [];

      const results: Array<{ runId: string; lastActiveAt: number; plan: any }> = [];
      for (const sessionId of pausedIds) {
        const session = await this.loadSession(sessionId);
        if (session && session.userId === userId) {
          results.push({
            runId: session.runId,
            lastActiveAt: session.lastActiveAt,
            plan: session.plan,
          });
        }
      }
      return results.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    } catch (err: any) {
      console.error(`[SessionPersistence] Failed to list paused sessions:`, err.message);
      return [];
    }
  }

  async cleanExpiredSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const cutoff = Date.now() - maxAgeMs;
      const lastActiveRows = await db.select()
        .from(agentSessionState)
        .where(eq(agentSessionState.key, "lastActiveAt"));

      let cleaned = 0;
      for (const row of lastActiveRows) {
        const lastActive = typeof row.value === "number" ? row.value : 0;
        if (lastActive < cutoff) {
          await db.delete(agentSessionState)
            .where(eq(agentSessionState.sessionId, row.sessionId));
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[SessionPersistence] Cleaned ${cleaned} expired sessions`);
      }
      return cleaned;
    } catch (err: any) {
      console.error(`[SessionPersistence] Failed to clean expired sessions:`, err.message);
      return 0;
    }
  }
}

export const sessionPersistence = new SessionPersistenceManager();
