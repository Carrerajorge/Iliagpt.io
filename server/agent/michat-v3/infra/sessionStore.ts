/**
 * MICHAT v3.1 — Session Store for Scale
 * Interfaces + stubs para Redis/Postgres en producción
 */

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
}

export interface SessionData {
  messages: SessionMessage[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionData | null>;
  append(sessionId: string, msg: SessionMessage): Promise<void>;
  trim(sessionId: string, maxMessages: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
  exists(sessionId: string): Promise<boolean>;
}

export class InMemorySessionStore implements SessionStore {
  private store = new Map<string, SessionData>();
  private maxSessions = 10000;

  async get(id: string): Promise<SessionData | null> {
    return this.store.get(id) ?? null;
  }

  async append(id: string, msg: SessionMessage): Promise<void> {
    const now = Date.now();
    let session = this.store.get(id);
    
    if (!session) {
      if (this.store.size >= this.maxSessions) {
        const oldest = Array.from(this.store.entries())
          .sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
        if (oldest) this.store.delete(oldest[0]);
      }
      session = { messages: [], createdAt: now, updatedAt: now };
    }

    session.messages.push({ ...msg, timestamp: now });
    session.updatedAt = now;
    this.store.set(id, session);
  }

  async trim(id: string, maxMessages: number): Promise<void> {
    const session = this.store.get(id);
    if (!session) return;
    if (session.messages.length > maxMessages) {
      session.messages = session.messages.slice(-maxMessages);
      session.updatedAt = Date.now();
    }
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }

  getStats() {
    return {
      sessions: this.store.size,
      maxSessions: this.maxSessions,
    };
  }
}

export const globalSessionStore = new InMemorySessionStore();
