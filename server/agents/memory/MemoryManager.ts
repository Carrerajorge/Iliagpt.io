import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { Logger } from '../../lib/logger';
import {
  VectorMemoryStore,
  VectorStoreConfig,
  VectorRecord,
  SearchQuery,
} from './VectorMemoryStore';
import {
  EpisodicMemory,
  Episode,
  DecayConfig,
} from './EpisodicMemory';
import {
  SemanticMemory,
  Entity,
  Relationship,
} from './SemanticMemory';
import {
  ProceduralMemory,
  Procedure,
  ExecutionRecord,
} from './ProceduralMemory';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface MemoryConfig {
  episodic?: Partial<DecayConfig>;
  vectorStore: VectorStoreConfig;
  agentId: string;
  userId?: string;
}

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'vector';

export interface MemoryQuery {
  text: string;
  types?: MemoryType[];
  topK?: number;
  minScore?: number;
  userId?: string;
  tags?: string[];
  contextWindow?: number; // ms — episodic recency filter
}

export interface MemoryResult {
  type: MemoryType;
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface ConsolidationJob {
  id: string;
  status: 'running' | 'complete' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  itemsProcessed: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Snapshot types (for export/import)
// ---------------------------------------------------------------------------

interface EpisodicSnapshot {
  episodes: Episode[];
}

interface SemanticSnapshot {
  entities: Entity[];
  relationships: Relationship[];
}

interface ProceduralSnapshot {
  procedures: Procedure[];
  executionRecords: { procedureId: string; records: ExecutionRecord[] }[];
}

interface FullSnapshot {
  version: string;
  agentId: string;
  exportedAt: string;
  episodic: EpisodicSnapshot;
  semantic: SemanticSnapshot;
  procedural: ProceduralSnapshot;
}

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

const AUTO_CONSOLIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const VECTOR_PRUNE_KEEP_TOP_N = 5000;
const SNAPSHOT_VERSION = '1.0';

export class MemoryManager extends EventEmitter {
  public readonly episodic: EpisodicMemory;
  public readonly semantic: SemanticMemory;
  public readonly procedural: ProceduralMemory;
  public readonly vector: VectorMemoryStore;

  private readonly config: MemoryConfig;
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor(config: MemoryConfig) {
    super();
    this.config = config;

    this.vector = VectorMemoryStore.create(config.vectorStore);
    this.episodic = new EpisodicMemory(
      config.agentId,
      this.vector,
      config.episodic,
    );
    this.semantic = new SemanticMemory();
    this.procedural = new ProceduralMemory();
  }

  // -------------------------------------------------------------------------
  // initialize
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    Logger.info(`[MemoryManager] initializing agentId=${this.config.agentId}`);

    const healthy = await this.vector.healthCheck();
    if (!healthy) {
      Logger.error('[MemoryManager] vector store health check failed');
      throw new Error('Vector store is unhealthy during MemoryManager.initialize()');
    }

    // Schedule automatic consolidation
    this.consolidationTimer = setInterval(async () => {
      try {
        await this.consolidate();
      } catch (err) {
        Logger.error(
          `[MemoryManager] auto-consolidation failed: ${String(err)}`,
        );
      }
    }, AUTO_CONSOLIDATION_INTERVAL_MS);

    this.initialized = true;
    Logger.info('[MemoryManager] initialized successfully');
  }

  // -------------------------------------------------------------------------
  // query — fan-out across requested memory types
  // -------------------------------------------------------------------------

  async query(q: MemoryQuery): Promise<MemoryResult[]> {
    const types = q.types ?? ['episodic', 'semantic', 'procedural', 'vector'];
    const topK = q.topK ?? 10;
    const minScore = q.minScore ?? 0;

    const resultBuckets: MemoryResult[][] = await Promise.all(
      types.map((type) => this._queryType(type, q, topK)),
    );

    // Flatten + deduplicate by id (keep highest score)
    const seen = new Map<string, MemoryResult>();
    for (const bucket of resultBuckets) {
      for (const result of bucket) {
        const existing = seen.get(result.id);
        if (!existing || result.score > existing.score) {
          seen.set(result.id, result);
        }
      }
    }

    const merged = [...seen.values()]
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    this.emit('memory:queried', { query: q, resultCount: merged.length });
    Logger.debug(
      `[MemoryManager] query="${q.text}" types=${types.join(',')} results=${merged.length}`,
    );
    return merged;
  }

  // -------------------------------------------------------------------------
  // remember — stores to episodic + vector simultaneously
  // -------------------------------------------------------------------------

  async remember(
    content: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    const sessionId =
      typeof context['sessionId'] === 'string'
        ? context['sessionId']
        : randomUUID();

    const userId =
      typeof context['userId'] === 'string'
        ? context['userId']
        : this.config.userId;

    const tags = Array.isArray(context['tags'])
      ? (context['tags'] as string[])
      : [];

    const emotion = (['positive', 'neutral', 'negative', 'mixed'] as const).includes(
      context['emotion'] as 'positive' | 'neutral' | 'negative' | 'mixed',
    )
      ? (context['emotion'] as 'positive' | 'neutral' | 'negative' | 'mixed')
      : 'neutral';

    // Store episodic
    const episode = await this.episodic.record(content, {
      userId,
      sessionId,
      summary: typeof context['summary'] === 'string' ? context['summary'] : content.slice(0, 120),
      emotion,
      tags,
      expiresAt:
        context['expiresAt'] instanceof Date
          ? context['expiresAt']
          : undefined,
      context,
    });

    // Also store a raw vector record in the agent's general namespace
    const vectorRecord: VectorRecord = {
      id: `vm:${episode.id}`,
      vector: episode.embedding ?? this._zeroVector(),
      payload: {
        content,
        episodeId: episode.id,
        type: 'memory',
      },
      namespace: this.config.vectorStore.namespace,
      createdAt: new Date(),
      metadata: {
        source: 'remember',
        agentId: this.config.agentId,
        userId,
        tags,
      },
    };
    await this.vector.upsert(vectorRecord);

    this.emit('memory:stored', {
      type: 'episodic',
      id: episode.id,
      agentId: this.config.agentId,
    });
    Logger.debug(
      `[MemoryManager] remembered content (${content.length} chars) agentId=${this.config.agentId}`,
    );
  }

  // -------------------------------------------------------------------------
  // learn — adds to semantic memory
  // -------------------------------------------------------------------------

  learn(
    entityInput: Omit<Entity, 'id' | 'createdAt' | 'updatedAt' | 'version'>,
    relationships?: Omit<Relationship, 'id' | 'createdAt'>[],
  ): void {
    const entity = this.semantic.addEntity(entityInput);

    if (relationships && relationships.length > 0) {
      for (const rel of relationships) {
        const fromId =
          rel.fromEntityId === '__new__' ? entity.id : rel.fromEntityId;
        const toId = rel.toEntityId === '__new__' ? entity.id : rel.toEntityId;
        try {
          this.semantic.addRelationship({ ...rel, fromEntityId: fromId, toEntityId: toId });
        } catch (err) {
          Logger.warn(`[MemoryManager] learn: skipping relationship — ${String(err)}`);
        }
      }
    }

    Logger.debug(
      `[MemoryManager] learned entity id=${entity.id} type=${entity.type} name=${entity.name}`,
    );
  }

  // -------------------------------------------------------------------------
  // learnProcedure
  // -------------------------------------------------------------------------

  learnProcedure(
    proc: Omit<
      Procedure,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'version'
      | 'successRate'
      | 'executionCount'
      | 'avgDurationMs'
    >,
  ): Procedure {
    return this.procedural.register(proc);
  }

  // -------------------------------------------------------------------------
  // consolidate
  // -------------------------------------------------------------------------

  async consolidate(): Promise<ConsolidationJob> {
    const jobId = randomUUID();
    const startedAt = new Date();
    let itemsProcessed = 0;
    const summaryParts: string[] = [];

    const job: ConsolidationJob = {
      id: jobId,
      status: 'running',
      startedAt,
      itemsProcessed: 0,
      summary: '',
    };

    this.emit('consolidation:start', { jobId });
    Logger.info(`[MemoryManager] consolidation started jobId=${jobId}`);

    try {
      // 1. Episodic decay — prune episodes below minImportance
      const prunedEpisodes = await this.episodic.decayAll();
      summaryParts.push(`episodic: pruned ${prunedEpisodes} episodes`);
      itemsProcessed += prunedEpisodes;

      // 2. Vector store pruning
      const prunedVectors = await this.vector.pruneByImportance(
        this.config.vectorStore.namespace,
        VECTOR_PRUNE_KEEP_TOP_N,
      );
      summaryParts.push(`vector: pruned ${prunedVectors} records`);
      itemsProcessed += prunedVectors;

      // 3. Semantic inference — run inference on all entities
      let inferredTriples = 0;
      for (const entity of this.semantic.getRawEntities().values()) {
        const triples = this.semantic.infer(entity.id);
        if (triples.length > 0) {
          this.semantic.fromTriples(triples, this.config.agentId);
          inferredTriples += triples.length;
          itemsProcessed += triples.length;
        }
      }
      summaryParts.push(`semantic: inferred ${inferredTriples} triples`);

      // 4. Deprecate procedures with very low success rates that have been run enough
      let deprecatedProcs = 0;
      for (const proc of this.procedural.listProcedures({ isActive: true })) {
        if (proc.executionCount >= 20 && proc.successRate < 0.05) {
          this.procedural.deprecate(proc.id);
          deprecatedProcs++;
          itemsProcessed++;
        }
      }
      summaryParts.push(`procedural: deprecated ${deprecatedProcs} procedures`);

      const completedAt = new Date();
      const finalJob: ConsolidationJob = {
        ...job,
        status: 'complete',
        completedAt,
        itemsProcessed,
        summary: summaryParts.join('; '),
      };

      this.emit('consolidation:complete', finalJob);
      Logger.info(
        `[MemoryManager] consolidation complete jobId=${jobId} items=${itemsProcessed} duration=${completedAt.getTime() - startedAt.getTime()}ms`,
      );
      return finalJob;
    } catch (err) {
      const failedJob: ConsolidationJob = {
        ...job,
        status: 'failed',
        completedAt: new Date(),
        itemsProcessed,
        summary: `Failed: ${String(err)}`,
      };
      Logger.error(`[MemoryManager] consolidation failed jobId=${jobId}: ${String(err)}`);
      this.emit('consolidation:complete', failedJob);
      return failedJob;
    }
  }

  // -------------------------------------------------------------------------
  // exportSnapshot
  // -------------------------------------------------------------------------

  exportSnapshot(): Record<string, unknown> {
    const episodicRaw = this.episodic.getRawEpisodes();
    const semanticEntities = [...this.semantic.getRawEntities().values()];
    const semanticRelationships = [...this.semantic.getRawRelationships().values()];
    const procedures = [...this.procedural.getRawProcedures().values()];
    const executionRecords: { procedureId: string; records: ExecutionRecord[] }[] = [];

    for (const proc of procedures) {
      const recs = this.procedural.getExecutionHistory(proc.id, 500);
      if (recs.length > 0) {
        executionRecords.push({ procedureId: proc.id, records: recs });
      }
    }

    const snapshot: FullSnapshot = {
      version: SNAPSHOT_VERSION,
      agentId: this.config.agentId,
      exportedAt: new Date().toISOString(),
      episodic: {
        episodes: [...episodicRaw.values()],
      },
      semantic: {
        entities: semanticEntities,
        relationships: semanticRelationships,
      },
      procedural: {
        procedures,
        executionRecords,
      },
    };

    Logger.info(
      `[MemoryManager] exportSnapshot agentId=${this.config.agentId} episodes=${snapshot.episodic.episodes.length} entities=${semanticEntities.length} procedures=${procedures.length}`,
    );
    return snapshot as unknown as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // importSnapshot
  // -------------------------------------------------------------------------

  async importSnapshot(snapshot: Record<string, unknown>): Promise<void> {
    const s = snapshot as unknown as FullSnapshot;

    if (!s.version || !s.agentId) {
      throw new Error('[MemoryManager] importSnapshot: invalid snapshot format');
    }

    Logger.info(
      `[MemoryManager] importSnapshot from agentId=${s.agentId} version=${s.version}`,
    );

    // Load episodes
    if (s.episodic?.episodes) {
      for (const ep of s.episodic.episodes) {
        // Rehydrate Date objects (they may be serialized as strings)
        const episode: Episode = {
          ...ep,
          createdAt: new Date(ep.createdAt),
          lastAccessedAt: new Date(ep.lastAccessedAt),
          expiresAt: ep.expiresAt ? new Date(ep.expiresAt) : undefined,
        };
        this.episodic.loadEpisode(episode);
        // Re-index in vector store
        await this.vector.upsert({
          id: episode.id,
          vector: episode.embedding ?? this._zeroVector(),
          payload: {
            content: episode.content,
            summary: episode.summary,
            emotion: episode.emotion,
          },
          namespace: `episodic:${this.config.agentId}`,
          createdAt: episode.createdAt,
          metadata: {
            source: 'episodic',
            agentId: this.config.agentId,
            userId: episode.userId,
            tags: episode.tags,
            expiresAt: episode.expiresAt,
          },
        });
      }
    }

    // Load semantic
    if (s.semantic?.entities) {
      for (const entity of s.semantic.entities) {
        this.semantic.loadEntity({
          ...entity,
          createdAt: new Date(entity.createdAt),
          updatedAt: new Date(entity.updatedAt),
        });
      }
    }
    if (s.semantic?.relationships) {
      for (const rel of s.semantic.relationships) {
        this.semantic.loadRelationship({
          ...rel,
          createdAt: new Date(rel.createdAt),
        });
      }
    }

    // Load procedural
    if (s.procedural?.procedures) {
      for (const proc of s.procedural.procedures) {
        this.procedural.loadProcedure({
          ...proc,
          createdAt: new Date(proc.createdAt),
          updatedAt: new Date(proc.updatedAt),
          lastExecutedAt: proc.lastExecutedAt
            ? new Date(proc.lastExecutedAt)
            : undefined,
        });
      }
    }
    if (s.procedural?.executionRecords) {
      for (const group of s.procedural.executionRecords) {
        for (const rec of group.records) {
          this.procedural.loadExecutionRecord({
            ...rec,
            startedAt: new Date(rec.startedAt),
            completedAt: rec.completedAt ? new Date(rec.completedAt) : undefined,
          });
        }
      }
    }

    Logger.info('[MemoryManager] importSnapshot complete');
  }

  // -------------------------------------------------------------------------
  // getHealthReport
  // -------------------------------------------------------------------------

  async getHealthReport(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    episodic: object;
    vector: object;
    semantic: object;
    procedural: object;
  }> {
    const vectorHealthy = await this.vector.healthCheck();
    const vectorCount = await this.vector.count(this.config.vectorStore.namespace);
    const episodicStats = this.episodic.getStats();
    const semanticStats = this.semantic.getStats();
    const proceduralStats = this.procedural.getStats();

    const vectorReport = {
      healthy: vectorHealthy,
      namespace: this.config.vectorStore.namespace,
      backend: this.config.vectorStore.backend,
      recordCount: vectorCount,
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!vectorHealthy) status = 'unhealthy';
    else if (episodicStats.avgImportance < 0.05 && episodicStats.total > 0)
      status = 'degraded';

    return {
      status,
      episodic: episodicStats,
      vector: vectorReport,
      semantic: semanticStats,
      procedural: proceduralStats,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  destroy(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
    this.removeAllListeners();
    Logger.info(`[MemoryManager] destroyed agentId=${this.config.agentId}`);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _queryType(
    type: MemoryType,
    q: MemoryQuery,
    topK: number,
  ): Promise<MemoryResult[]> {
    try {
      switch (type) {
        case 'episodic':
          return await this._queryEpisodic(q, topK);
        case 'semantic':
          return this._querySemantic(q, topK);
        case 'procedural':
          return this._queryProcedural(q, topK);
        case 'vector':
          return await this._queryVector(q, topK);
        default:
          return [];
      }
    } catch (err) {
      Logger.warn(`[MemoryManager] _queryType type=${type} error: ${String(err)}`);
      return [];
    }
  }

  private async _queryEpisodic(
    q: MemoryQuery,
    topK: number,
  ): Promise<MemoryResult[]> {
    const episodes = await this.episodic.recall(q.text, {
      topK,
      userId: q.userId,
      tags: q.tags,
    });

    // Apply contextWindow filter
    const cutoff = q.contextWindow ? Date.now() - q.contextWindow : 0;

    return episodes
      .filter((ep) => (cutoff > 0 ? ep.createdAt.getTime() >= cutoff : true))
      .map((ep) => ({
        type: 'episodic' as const,
        id: ep.id,
        content: ep.content,
        score: ep.importance,
        metadata: {
          emotion: ep.emotion,
          sessionId: ep.sessionId,
          tags: ep.tags,
          createdAt: ep.createdAt.toISOString(),
          accessCount: ep.accessCount,
        },
      }));
  }

  private _querySemantic(
    q: MemoryQuery,
    topK: number,
  ): MemoryResult[] {
    const entities = this.semantic.findEntities({
      name: q.text,
      minConfidence: q.minScore,
    });

    return entities.slice(0, topK).map((entity) => ({
      type: 'semantic' as const,
      id: entity.id,
      content: `${entity.type}: ${entity.name} — ${JSON.stringify(entity.attributes)}`,
      score: entity.confidence,
      metadata: {
        type: entity.type,
        name: entity.name,
        sources: entity.sources,
        version: entity.version,
        updatedAt: entity.updatedAt.toISOString(),
      },
    }));
  }

  private _queryProcedural(
    q: MemoryQuery,
    topK: number,
  ): MemoryResult[] {
    const procedures = this.procedural.recall(q.text).slice(0, topK);
    return procedures
      .filter((p) => (q.minScore !== undefined ? p.successRate >= q.minScore : true))
      .map((proc) => ({
        type: 'procedural' as const,
        id: proc.id,
        content: `${proc.name}: ${proc.description}`,
        score: proc.successRate,
        metadata: {
          triggers: proc.triggers,
          successRate: proc.successRate,
          executionCount: proc.executionCount,
          avgDurationMs: proc.avgDurationMs,
          tags: proc.tags,
          isActive: proc.isActive,
        },
      }));
  }

  private async _queryVector(
    q: MemoryQuery,
    topK: number,
  ): Promise<MemoryResult[]> {
    const searchQuery: SearchQuery = {
      text: q.text,
      namespace: this.config.vectorStore.namespace,
      topK,
      minScore: q.minScore ?? 0,
      hybridAlpha: 0.5,
    };

    if (q.tags && q.tags.length > 0) {
      searchQuery.filter = { 'metadata.tags': q.tags };
    }

    const results = await this.vector.search(searchQuery);
    return results.map((r) => ({
      type: 'vector' as const,
      id: r.record.id,
      content:
        typeof r.record.payload['content'] === 'string'
          ? r.record.payload['content']
          : JSON.stringify(r.record.payload),
      score: r.score,
      metadata: {
        namespace: r.record.namespace,
        tags: r.record.metadata.tags,
        source: r.record.metadata.source,
        createdAt: r.record.createdAt.toISOString(),
      },
    }));
  }

  private _zeroVector(): number[] {
    const dim = this.config.vectorStore.dimension ?? 1536;
    return new Array<number>(dim).fill(0);
  }
}
