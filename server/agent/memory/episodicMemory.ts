import { randomUUID } from "crypto";

export interface EpisodicEntry {
  id: string;
  sessionId: string;
  userId?: string;
  type: "interaction" | "discovery" | "error" | "decision" | "observation";
  content: string;
  context: Record<string, any>;
  importance: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  decayRate: number;
}

interface EpisodicMemoryOptions {
  maxEntriesPerSession?: number;
  defaultDecayRate?: number;
  importanceThreshold?: number;
  decayIntervalMs?: number;
}

export class EpisodicMemory {
  private entries: Map<string, EpisodicEntry> = new Map();
  private sessionIndex: Map<string, Set<string>> = new Map();
  private readonly maxEntriesPerSession: number;
  private readonly defaultDecayRate: number;
  private readonly importanceThreshold: number;
  private readonly decayIntervalMs: number;

  constructor(options: EpisodicMemoryOptions = {}) {
    this.maxEntriesPerSession = options.maxEntriesPerSession ?? 200;
    this.defaultDecayRate = options.defaultDecayRate ?? 0.01;
    this.importanceThreshold = options.importanceThreshold ?? 0.1;
    this.decayIntervalMs = options.decayIntervalMs ?? 60000;
  }

  record(params: {
    sessionId: string;
    userId?: string;
    type: EpisodicEntry["type"];
    content: string;
    context?: Record<string, any>;
    importance?: number;
    decayRate?: number;
  }): EpisodicEntry {
    const entry: EpisodicEntry = {
      id: randomUUID(),
      sessionId: params.sessionId,
      userId: params.userId,
      type: params.type,
      content: params.content,
      context: params.context ?? {},
      importance: params.importance ?? this.scoreImportance(params.type, params.content),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      decayRate: params.decayRate ?? this.defaultDecayRate,
    };

    this.entries.set(entry.id, entry);

    if (!this.sessionIndex.has(params.sessionId)) {
      this.sessionIndex.set(params.sessionId, new Set());
    }
    this.sessionIndex.get(params.sessionId)!.add(entry.id);

    this.enforceSessionLimit(params.sessionId);

    return entry;
  }

  recall(sessionId: string, options?: {
    type?: EpisodicEntry["type"];
    minImportance?: number;
    limit?: number;
    query?: string;
  }): EpisodicEntry[] {
    const ids = this.sessionIndex.get(sessionId);
    if (!ids) return [];

    let results: EpisodicEntry[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;

      const effectiveImportance = this.getEffectiveImportance(entry);
      if (effectiveImportance < (options?.minImportance ?? 0)) continue;
      if (options?.type && entry.type !== options.type) continue;
      if (options?.query && !entry.content.toLowerCase().includes(options.query.toLowerCase())) continue;

      entry.lastAccessedAt = Date.now();
      entry.accessCount++;
      results.push({ ...entry, importance: effectiveImportance });
    }

    results.sort((a, b) => b.importance - a.importance);
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  recallRecent(sessionId: string, count: number = 10): EpisodicEntry[] {
    const ids = this.sessionIndex.get(sessionId);
    if (!ids) return [];

    const entries: EpisodicEntry[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) entries.push(entry);
    }

    return entries
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, count);
  }

  applyDecay(): number {
    let forgotten = 0;
    const now = Date.now();

    for (const [id, entry] of this.entries) {
      const ageMs = now - entry.createdAt;
      const ageHours = ageMs / 3600000;
      const decayFactor = Math.exp(-entry.decayRate * ageHours);
      const accessBoost = Math.min(entry.accessCount * 0.05, 0.3);
      const effectiveImportance = (entry.importance * decayFactor) + accessBoost;

      if (effectiveImportance < this.importanceThreshold) {
        this.entries.delete(id);
        const sessionIds = this.sessionIndex.get(entry.sessionId);
        if (sessionIds) {
          sessionIds.delete(id);
          if (sessionIds.size === 0) this.sessionIndex.delete(entry.sessionId);
        }
        forgotten++;
      }
    }

    return forgotten;
  }

  private getEffectiveImportance(entry: EpisodicEntry): number {
    const ageMs = Date.now() - entry.createdAt;
    const ageHours = ageMs / 3600000;
    const decayFactor = Math.exp(-entry.decayRate * ageHours);
    const accessBoost = Math.min(entry.accessCount * 0.05, 0.3);
    return (entry.importance * decayFactor) + accessBoost;
  }

  private scoreImportance(type: EpisodicEntry["type"], content: string): number {
    const typeWeights: Record<EpisodicEntry["type"], number> = {
      error: 0.9,
      decision: 0.8,
      discovery: 0.7,
      observation: 0.5,
      interaction: 0.4,
    };

    let score = typeWeights[type] ?? 0.5;

    if (content.length > 200) score += 0.05;
    if (content.includes("important") || content.includes("critical")) score += 0.1;
    if (content.includes("remember") || content.includes("note")) score += 0.1;

    return Math.min(score, 1.0);
  }

  private enforceSessionLimit(sessionId: string): void {
    const ids = this.sessionIndex.get(sessionId);
    if (!ids || ids.size <= this.maxEntriesPerSession) return;

    const entries: EpisodicEntry[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) entries.push(entry);
    }

    entries.sort((a, b) => this.getEffectiveImportance(a) - this.getEffectiveImportance(b));

    const toRemove = entries.slice(0, ids.size - this.maxEntriesPerSession);
    for (const entry of toRemove) {
      this.entries.delete(entry.id);
      ids.delete(entry.id);
    }
  }

  getSessionStats(sessionId: string): {
    totalEntries: number;
    byType: Record<string, number>;
    avgImportance: number;
  } {
    const ids = this.sessionIndex.get(sessionId);
    if (!ids || ids.size === 0) {
      return { totalEntries: 0, byType: {}, avgImportance: 0 };
    }

    const byType: Record<string, number> = {};
    let totalImportance = 0;
    let count = 0;

    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      totalImportance += this.getEffectiveImportance(entry);
      count++;
    }

    return {
      totalEntries: count,
      byType,
      avgImportance: count > 0 ? totalImportance / count : 0,
    };
  }

  clearSession(sessionId: string): void {
    const ids = this.sessionIndex.get(sessionId);
    if (!ids) return;
    for (const id of ids) {
      this.entries.delete(id);
    }
    this.sessionIndex.delete(sessionId);
  }

  getTotalEntries(): number {
    return this.entries.size;
  }
}

export const episodicMemory = new EpisodicMemory();
