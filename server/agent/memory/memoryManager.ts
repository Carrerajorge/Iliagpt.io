import { episodicMemory, EpisodicMemory, type EpisodicEntry } from "./episodicMemory";
import { projectMemory, ProjectMemory, type ProjectMemoryEntry, type ProjectMemoryCategory } from "./projectMemory";

export interface MemoryQuery {
  sessionId?: string;
  userId?: string;
  category?: ProjectMemoryCategory;
  query?: string;
  minImportance?: number;
  limit?: number;
  includeEpisodic?: boolean;
  includeProject?: boolean;
}

export interface UnifiedMemoryResult {
  episodic: EpisodicEntry[];
  project: ProjectMemoryEntry[];
  totalCount: number;
}

export interface PrivacyControls {
  allowEpisodic: boolean;
  allowProjectPersistence: boolean;
  allowCrossSession: boolean;
  redactPatterns: RegExp[];
}

const DEFAULT_PRIVACY: PrivacyControls = {
  allowEpisodic: true,
  allowProjectPersistence: true,
  allowCrossSession: true,
  redactPatterns: [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    /\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9]{20,}\b/gi,
  ],
};

export class MemoryManager {
  private episodic: EpisodicMemory;
  private project: ProjectMemory;
  private privacyByUser: Map<string, PrivacyControls> = new Map();
  private decayTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    episodicInstance?: EpisodicMemory,
    projectInstance?: ProjectMemory,
  ) {
    this.episodic = episodicInstance ?? episodicMemory;
    this.project = projectInstance ?? projectMemory;
  }

  startMaintenanceCycles(decayIntervalMs: number = 300000, cleanupIntervalMs: number = 3600000): void {
    this.stopMaintenanceCycles();

    this.decayTimer = setInterval(() => {
      const forgotten = this.episodic.applyDecay();
      if (forgotten > 0) {
        console.log(`[MemoryManager] Decay cycle: ${forgotten} episodic entries forgotten`);
      }
    }, decayIntervalMs);

    this.cleanupTimer = setInterval(async () => {
      try {
        const cleaned = await this.project.cleanExpired();
        if (cleaned > 0) {
          console.log(`[MemoryManager] Cleanup cycle: ${cleaned} expired project memories removed`);
        }
      } catch (err) {
        console.error("[MemoryManager] Cleanup error:", err);
      }
    }, cleanupIntervalMs);
  }

  stopMaintenanceCycles(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  setPrivacy(userId: string, controls: Partial<PrivacyControls>): void {
    const current = this.privacyByUser.get(userId) ?? { ...DEFAULT_PRIVACY };
    this.privacyByUser.set(userId, { ...current, ...controls });
  }

  getPrivacy(userId?: string): PrivacyControls {
    if (!userId) return DEFAULT_PRIVACY;
    return this.privacyByUser.get(userId) ?? DEFAULT_PRIVACY;
  }

  recordEpisodic(params: {
    sessionId: string;
    userId?: string;
    type: EpisodicEntry["type"];
    content: string;
    context?: Record<string, any>;
    importance?: number;
  }): EpisodicEntry | null {
    const privacy = this.getPrivacy(params.userId);
    if (!privacy.allowEpisodic) return null;

    const content = this.redactContent(params.content, privacy);
    return this.episodic.record({ ...params, content });
  }

  async storeProjectKnowledge(params: {
    userId?: string;
    chatId?: string;
    category: ProjectMemoryCategory;
    key: string;
    value: any;
    importance?: number;
    ttlMs?: number;
  }): Promise<ProjectMemoryEntry | null> {
    const privacy = this.getPrivacy(params.userId);
    if (!privacy.allowProjectPersistence) return null;

    return this.project.store(params);
  }

  async retrieve(query: MemoryQuery): Promise<UnifiedMemoryResult> {
    const includeEpisodic = query.includeEpisodic ?? true;
    const includeProject = query.includeProject ?? true;
    const privacy = this.getPrivacy(query.userId);

    let episodicResults: EpisodicEntry[] = [];
    let projectResults: ProjectMemoryEntry[] = [];

    if (includeEpisodic && query.sessionId && privacy.allowEpisodic) {
      episodicResults = this.episodic.recall(query.sessionId, {
        minImportance: query.minImportance,
        limit: query.limit,
        query: query.query,
      });
    }

    if (includeProject && privacy.allowCrossSession) {
      projectResults = await this.project.recall({
        userId: query.userId,
        category: query.category,
        minImportance: query.minImportance,
        limit: query.limit,
      });

      if (query.query) {
        const q = query.query.toLowerCase();
        projectResults = projectResults.filter(
          (p) =>
            p.key.toLowerCase().includes(q) ||
            JSON.stringify(p.value).toLowerCase().includes(q)
        );
      }
    }

    return {
      episodic: episodicResults,
      project: projectResults,
      totalCount: episodicResults.length + projectResults.length,
    };
  }

  async consolidate(userId?: string): Promise<number> {
    const projectEntries = await this.project.recall({ userId });
    const grouped: Map<string, ProjectMemoryEntry[]> = new Map();

    for (const entry of projectEntries) {
      const groupKey = `${entry.category}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey)!.push(entry);
    }

    let mergedCount = 0;

    for (const [, entries] of grouped) {
      if (entries.length < 2) continue;

      const seen = new Map<string, ProjectMemoryEntry>();
      for (const entry of entries) {
        const valueStr = JSON.stringify(entry.value);
        const existing = seen.get(valueStr);
        if (existing) {
          if (entry.importance > existing.importance) {
            await this.project.forget({
              userId: existing.userId,
              category: existing.category,
              key: existing.key,
            });
          } else {
            await this.project.forget({
              userId: entry.userId,
              category: entry.category,
              key: entry.key,
            });
          }
          mergedCount++;
        } else {
          seen.set(valueStr, entry);
        }
      }
    }

    return mergedCount;
  }

  async forgetByUser(userId: string): Promise<void> {
    const entries = await this.project.recall({ userId });
    for (const entry of entries) {
      await this.project.forget({
        userId,
        category: entry.category,
        key: entry.key,
      });
    }
    this.privacyByUser.delete(userId);
  }

  clearSessionMemory(sessionId: string): void {
    this.episodic.clearSession(sessionId);
  }

  async getStats(userId?: string): Promise<{
    episodic: { totalEntries: number };
    project: { totalEntries: number; byCategory: Record<string, number> };
  }> {
    const projectStats = await this.project.getStats(userId);
    return {
      episodic: { totalEntries: this.episodic.getTotalEntries() },
      project: projectStats,
    };
  }

  private redactContent(content: string, privacy: PrivacyControls): string {
    let redacted = content;
    for (const pattern of privacy.redactPatterns) {
      redacted = redacted.replace(pattern, "[REDACTED]");
    }
    return redacted;
  }

  getEpisodic(): EpisodicMemory {
    return this.episodic;
  }

  getProject(): ProjectMemory {
    return this.project;
  }
}

export const memoryManager = new MemoryManager();
