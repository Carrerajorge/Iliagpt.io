import { semanticMemoryStore, SemanticMemoryStore } from "./SemanticMemoryStore";
import { userMemoryStore, UserMemoryStore } from "./UserMemoryStore";

export interface SessionData {
    sessionId: string;
    context: Record<string, any>;
    lastAccessed: number; // timestamp
}

/**
 * Enterprise Memory Manager
 *
 * Orchestrates 3 layers of memory:
 * 1. SessionMemory (In-process, TTL session)
 * 2. EpisodicMemory (Long-term interactions/preferences, TTL 7d or permanent)
 * 3. KnowledgeMemory (Semantic vector store, permanent)
 */
export class MemoryManager {
    // 1. Session Memory (In-process, temporary)
    private sessionStore = new Map<string, SessionData>();
    private readonly SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour TTL by default

    /** Initialize the memory subsystems if necessary */
    async initialize(): Promise<void> {
        await semanticMemoryStore.initialize();
    }

    // ==========================================
    // 1. Session Layer
    // ==========================================

    public getSession(sessionId: string): SessionData {
        const now = Date.now();
        let session = this.sessionStore.get(sessionId);

        // Evict expired
        if (session && (now - session.lastAccessed > this.SESSION_TTL_MS)) {
            this.sessionStore.delete(sessionId);
            session = undefined;
        }

        if (!session) {
            session = { sessionId, context: {}, lastAccessed: now };
            this.sessionStore.set(sessionId, session);
        } else {
            session.lastAccessed = now;
        }

        return session;
    }

    public updateSession(sessionId: string, data: Record<string, any>): void {
        const session = this.getSession(sessionId);
        session.context = { ...session.context, ...data };
    }

    public clearSession(sessionId: string): void {
        this.sessionStore.delete(sessionId);
    }

    // ==========================================
    // 2. Episodic Layer (User Preferences/Facts)
    // ==========================================

    public get episodic(): UserMemoryStore {
        return userMemoryStore;
    }

    /**
     * Remember user episodic facts or preferences.
     * Can set a 7-day TTL if it's transient episodic data.
     */
    public async rememberEpisodic(
        userId: string,
        key: string,
        value: string,
        ttlDays?: number
    ) {
        let expiresAt: Date | undefined;
        if (ttlDays) {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + ttlDays);
        }

        return this.episodic.remember(userId, key, value, "fact", { expiresAt });
    }

    // ==========================================
    // 3. Knowledge Layer (Semantic Vector Store)
    // ==========================================

    public get knowledge(): SemanticMemoryStore {
        return semanticMemoryStore;
    }

    /**
     * Search knowledge base
     */
    public async searchKnowledge(userId: string, query: string, limit = 5) {
        return this.knowledge.search(userId, query, { limit, minSimilarity: 0.7 });
    }
}

export const memoryManager = new MemoryManager();
