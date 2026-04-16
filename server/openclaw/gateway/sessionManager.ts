import type { SessionKey } from '../types';

interface Session {
  key: SessionKey;
  agentId: string;
  sessionId: string;
  userId: string;
  createdAt: number;
  lastActiveAt: number;
  metadata: Record<string, unknown>;
}

class OpenClawSessionManager {
  private sessions = new Map<string, Session>();

  parseSessionKey(key: string): { agentId: string; sessionId: string } | null {
    const parts = key.split(':');
    if (parts.length !== 3 || parts[0] !== 'agent') return null;
    return { agentId: parts[1], sessionId: parts[2] };
  }

  buildSessionKey(agentId: string, sessionId: string): SessionKey {
    return `agent:${agentId}:${sessionId}`;
  }

  getOrCreate(key: SessionKey, userId: string): Session {
    let session = this.sessions.get(key);
    if (!session) {
      const parsed = this.parseSessionKey(key);
      if (!parsed) throw new Error(`Invalid session key: ${key}`);
      session = {
        key,
        agentId: parsed.agentId,
        sessionId: parsed.sessionId,
        userId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      };
      this.sessions.set(key, session);
    }
    session.lastActiveAt = Date.now();
    return session;
  }

  get(key: string): Session | undefined {
    return this.sessions.get(key);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  remove(key: string): boolean {
    return this.sessions.delete(key);
  }
}

export const openclawSessionManager = new OpenClawSessionManager();
