import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Logger } from '../../lib/logger';
import {
  VectorMemoryStore,
  VectorRecord,
  SearchQuery,
} from './VectorMemoryStore';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export type EmotionType = 'positive' | 'neutral' | 'negative' | 'mixed';

export interface Episode {
  id: string;
  agentId: string;
  userId?: string;
  sessionId: string;
  content: string;
  summary: string;
  embedding?: number[];
  emotion: EmotionType;
  importance: number; // 0-1
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  expiresAt?: Date;
  tags: string[];
  context: Record<string, unknown>;
}

export interface DecayConfig {
  halfLifeHours: number; // default 168 (1 week)
  minImportance: number; // default 0.01
  reinforcementFactor: number; // default 1.5
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const EpisodeSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().min(1),
  userId: z.string().optional(),
  sessionId: z.string().min(1),
  content: z.string().min(1),
  summary: z.string(),
  embedding: z.array(z.number()).optional(),
  emotion: z.enum(['positive', 'neutral', 'negative', 'mixed']),
  importance: z.number().min(0).max(1),
  accessCount: z.number().int().min(0),
  lastAccessedAt: z.date(),
  createdAt: z.date(),
  expiresAt: z.date().optional(),
  tags: z.array(z.string()),
  context: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// In-memory episode registry (complements vector search)
// ---------------------------------------------------------------------------

const DEFAULT_DECAY: DecayConfig = {
  halfLifeHours: 168,
  minImportance: 0.01,
  reinforcementFactor: 1.5,
};

const EPISODE_NAMESPACE_PREFIX = 'episodic';

// ---------------------------------------------------------------------------
// EpisodicMemory
// ---------------------------------------------------------------------------

export class EpisodicMemory {
  private readonly agentId: string;
  private readonly store: VectorMemoryStore;
  private readonly decayConfig: DecayConfig;
  private readonly episodes: Map<string, Episode> = new Map();

  constructor(
    agentId: string,
    store: VectorMemoryStore,
    decayConfig?: Partial<DecayConfig>,
  ) {
    this.agentId = agentId;
    this.store = store;
    this.decayConfig = { ...DEFAULT_DECAY, ...decayConfig };
  }

  private get namespace(): string {
    return `${EPISODE_NAMESPACE_PREFIX}:${this.agentId}`;
  }

  // -------------------------------------------------------------------------
  // record
  // -------------------------------------------------------------------------

  async record(
    content: string,
    context: Omit<
      Episode,
      'id' | 'agentId' | 'createdAt' | 'accessCount' | 'lastAccessedAt'
    >,
  ): Promise<Episode> {
    const now = new Date();
    const id = randomUUID();

    const partialForImportance: Partial<Episode> = {
      emotion: context.emotion,
      tags: context.tags,
      expiresAt: context.expiresAt,
      context: context.context,
    };

    const episode: Episode = {
      id,
      agentId: this.agentId,
      userId: context.userId,
      sessionId: context.sessionId,
      content,
      summary: context.summary,
      embedding: context.embedding,
      emotion: context.emotion,
      importance: this._computeImportance(partialForImportance),
      accessCount: 0,
      lastAccessedAt: now,
      createdAt: now,
      expiresAt: context.expiresAt,
      tags: context.tags,
      context: context.context,
    };

    // Validate
    EpisodeSchema.parse(episode);

    this.episodes.set(id, episode);

    // Store in vector store
    const vectorRecord: VectorRecord = {
      id,
      vector: episode.embedding ?? this._fallbackEmbedding(content),
      payload: {
        content: episode.content,
        summary: episode.summary,
        emotion: episode.emotion,
        sessionId: episode.sessionId,
      },
      namespace: this.namespace,
      createdAt: now,
      metadata: {
        source: 'episodic',
        agentId: this.agentId,
        userId: episode.userId,
        tags: episode.tags,
        expiresAt: episode.expiresAt,
        accessCount: 0,
        lastAccessedAt: now,
      },
    };

    await this.store.upsert(vectorRecord);
    Logger.debug(`[EpisodicMemory] recorded episode id=${id} agentId=${this.agentId}`);

    return episode;
  }

  // -------------------------------------------------------------------------
  // recall
  // -------------------------------------------------------------------------

  async recall(
    query: string,
    options?: {
      topK?: number;
      minImportance?: number;
      userId?: string;
      tags?: string[];
    },
  ): Promise<Episode[]> {
    const topK = options?.topK ?? 10;
    const minImportance = options?.minImportance ?? this.decayConfig.minImportance;

    const searchQuery: SearchQuery = {
      text: query,
      namespace: this.namespace,
      topK: topK * 3, // over-fetch before filtering
      minScore: 0,
      hybridAlpha: 0.6,
    };

    const results = await this.store.search(searchQuery);
    const recalled: Episode[] = [];

    for (const result of results) {
      const episode = this.episodes.get(result.record.id);
      if (!episode) continue;

      // Apply decay before checking importance
      await this.decay(episode.id);
      const fresh = this.episodes.get(episode.id);
      if (!fresh) continue;

      if (fresh.importance < minImportance) continue;
      if (options?.userId && fresh.userId !== options.userId) continue;
      if (options?.tags && options.tags.length > 0) {
        const hasAll = options.tags.every((t) => fresh.tags.includes(t));
        if (!hasAll) continue;
      }

      // Update access tracking
      fresh.accessCount++;
      fresh.lastAccessedAt = new Date();
      this.episodes.set(fresh.id, fresh);

      recalled.push({ ...fresh });
      if (recalled.length >= topK) break;
    }

    Logger.debug(
      `[EpisodicMemory] recall query="${query}" found=${recalled.length}`,
    );
    return recalled;
  }

  // -------------------------------------------------------------------------
  // reinforce
  // -------------------------------------------------------------------------

  async reinforce(episodeId: string): Promise<void> {
    const episode = this.episodes.get(episodeId);
    if (!episode) {
      Logger.warn(`[EpisodicMemory] reinforce: episode not found id=${episodeId}`);
      return;
    }
    episode.importance = Math.min(
      1.0,
      episode.importance * this.decayConfig.reinforcementFactor,
    );
    episode.accessCount++;
    episode.lastAccessedAt = new Date();
    this.episodes.set(episodeId, episode);
    Logger.debug(
      `[EpisodicMemory] reinforced id=${episodeId} importance=${episode.importance.toFixed(4)}`,
    );
  }

  // -------------------------------------------------------------------------
  // decay (single episode)
  // -------------------------------------------------------------------------

  async decay(episodeId: string): Promise<void> {
    const episode = this.episodes.get(episodeId);
    if (!episode) return;
    const decayed = this._applyDecay(episode.importance, episode.createdAt);
    episode.importance = decayed;
    this.episodes.set(episodeId, episode);
  }

  // -------------------------------------------------------------------------
  // decayAll
  // -------------------------------------------------------------------------

  async decayAll(): Promise<number> {
    let pruned = 0;
    for (const [id, episode] of this.episodes) {
      const decayed = this._applyDecay(episode.importance, episode.createdAt);
      if (decayed < this.decayConfig.minImportance) {
        await this.forget(id);
        pruned++;
      } else {
        episode.importance = decayed;
        this.episodes.set(id, episode);
      }
    }
    Logger.info(`[EpisodicMemory] decayAll pruned=${pruned} agentId=${this.agentId}`);
    return pruned;
  }

  // -------------------------------------------------------------------------
  // summarizeSession
  // -------------------------------------------------------------------------

  async summarizeSession(sessionId: string): Promise<string> {
    const sessionEpisodes: Episode[] = [];
    for (const episode of this.episodes.values()) {
      if (episode.sessionId === sessionId) {
        sessionEpisodes.push(episode);
      }
    }

    if (sessionEpisodes.length === 0) return '';

    sessionEpisodes.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    const lines = sessionEpisodes.map((ep, idx) => {
      const ts = ep.createdAt.toISOString();
      return `[${idx + 1}] ${ts} (${ep.emotion}, importance=${ep.importance.toFixed(2)}): ${ep.summary || ep.content.slice(0, 200)}`;
    });

    const digest = [
      `Session ${sessionId} — ${sessionEpisodes.length} episodes`,
      `Emotions: ${this._countEmotions(sessionEpisodes)}`,
      `Avg importance: ${(sessionEpisodes.reduce((s, e) => s + e.importance, 0) / sessionEpisodes.length).toFixed(3)}`,
      '',
      ...lines,
    ].join('\n');

    Logger.debug(
      `[EpisodicMemory] summarizeSession sessionId=${sessionId} episodes=${sessionEpisodes.length}`,
    );
    return digest;
  }

  // -------------------------------------------------------------------------
  // forget
  // -------------------------------------------------------------------------

  async forget(episodeId: string): Promise<void> {
    this.episodes.delete(episodeId);
    await this.store.delete(episodeId, this.namespace);
    Logger.debug(`[EpisodicMemory] forgot episode id=${episodeId}`);
  }

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  getStats(): { total: number; avgImportance: number; oldestEpisode?: Date } {
    const all = [...this.episodes.values()];
    if (all.length === 0) return { total: 0, avgImportance: 0 };

    const avgImportance =
      all.reduce((sum, e) => sum + e.importance, 0) / all.length;

    const oldest = all.reduce((min, e) =>
      e.createdAt < min.createdAt ? e : min,
    );

    return {
      total: all.length,
      avgImportance: parseFloat(avgImportance.toFixed(4)),
      oldestEpisode: oldest.createdAt,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _computeImportance(episode: Partial<Episode>): number {
    let base = 0.3;

    // Emotion weight
    switch (episode.emotion) {
      case 'positive':
        base += 0.15;
        break;
      case 'negative':
        base += 0.2; // negative experiences tend to be more memorable
        break;
      case 'mixed':
        base += 0.1;
        break;
      default:
        break;
    }

    // Tags with "important" or "critical"
    const importantTagCount = (episode.tags ?? []).filter(
      (t) => t.includes('important') || t.includes('critical') || t.includes('urgent'),
    ).length;
    base += Math.min(0.2, importantTagCount * 0.1);

    // Context richness (more context keys = more important)
    const contextKeys = Object.keys(episode.context ?? {}).length;
    base += Math.min(0.1, contextKeys * 0.02);

    // ExpiresAt set means it's time-sensitive
    if (episode.expiresAt) base += 0.05;

    return Math.min(1.0, base);
  }

  private _applyDecay(importance: number, createdAt: Date): number {
    const elapsedHours = (Date.now() - createdAt.getTime()) / 3_600_000;
    const lambda = Math.log(2) / this.decayConfig.halfLifeHours;
    return importance * Math.exp(-lambda * elapsedHours);
  }

  private _fallbackEmbedding(text: string): number[] {
    // Deterministic hash-based pseudo-embedding for in-memory use without an LLM
    const dim = 1536;
    const vec = new Array<number>(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dim] += text.charCodeAt(i) / 255;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  private _countEmotions(episodes: Episode[]): string {
    const counts: Record<EmotionType, number> = {
      positive: 0,
      neutral: 0,
      negative: 0,
      mixed: 0,
    };
    for (const e of episodes) counts[e.emotion]++;
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
  }

  // Expose raw episode map for MemoryManager serialization
  getRawEpisodes(): Map<string, Episode> {
    return new Map(this.episodes);
  }

  loadEpisode(episode: Episode): void {
    this.episodes.set(episode.id, episode);
  }
}
