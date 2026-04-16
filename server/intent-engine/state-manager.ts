import { SessionState, Constraints, ConversationTurn, TaskDomain } from './types';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY_TURNS = 20;

class StateManager {
  private sessions: Map<string, SessionState> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  getSession(sessionId: string): SessionState | null {
    const session = this.sessions.get(sessionId);
    
    if (session && new Date() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session || null;
  }

  createSession(sessionId: string, userId: string): SessionState {
    const now = new Date();
    const session: SessionState = {
      sessionId,
      userId,
      domain: 'general',
      constraints: this.getDefaultConstraints(),
      history: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS)
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  updateSession(sessionId: string, updates: Partial<SessionState>): SessionState | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const updatedSession: SessionState = {
      ...session,
      ...updates,
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    };

    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  updateConstraints(sessionId: string, constraints: Constraints): SessionState | null {
    return this.updateSession(sessionId, { 
      constraints,
      domain: constraints.domain 
    });
  }

  addTurn(sessionId: string, turn: ConversationTurn): SessionState | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const history = [...session.history, turn];
    
    const trimmedHistory = history.length > MAX_HISTORY_TURNS 
      ? history.slice(-MAX_HISTORY_TURNS)
      : history;

    return this.updateSession(sessionId, { history: trimmedHistory });
  }

  detectTopicChange(session: SessionState, newDomain: TaskDomain): boolean {
    if (session.domain === 'general') return false;
    if (newDomain === 'general') return false;
    
    return session.domain !== newDomain;
  }

  resetConstraints(sessionId: string): SessionState | null {
    return this.updateSession(sessionId, {
      constraints: this.getDefaultConstraints(),
      domain: 'general'
    });
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private getDefaultConstraints(): Constraints {
    return {
      domain: 'general',
      task: 'GENERAL_CHAT',
      n: null,
      mustKeep: [],
      mustNotUse: [],
      editableParts: [],
      tone: 'neutral',
      language: 'es',
      format: 'text'
    };
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now > session.expiresAt) {
          this.sessions.delete(sessionId);
        }
      }
    }, 5 * 60 * 1000);
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  getSessionStats(): { total: number; byDomain: Record<TaskDomain, number> } {
    const byDomain: Record<TaskDomain, number> = {
      marketing: 0,
      academic: 0,
      business: 0,
      technology: 0,
      legal: 0,
      medical: 0,
      education: 0,
      creative: 0,
      general: 0
    };

    for (const session of this.sessions.values()) {
      byDomain[session.domain]++;
    }

    return {
      total: this.sessions.size,
      byDomain
    };
  }
}

export const stateManager = new StateManager();
