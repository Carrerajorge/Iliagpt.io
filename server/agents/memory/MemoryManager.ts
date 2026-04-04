import { EventEmitter } from "events";
import pino from "pino";
import { VectorMemoryStore, getVectorMemoryStore } from "./VectorMemoryStore.js";
import { EpisodicMemory } from "./EpisodicMemory.js";
import { SemanticMemory } from "./SemanticMemory.js";
import { ProceduralMemory } from "./ProceduralMemory.js";
import type { Episode, EpisodeEvent, EpisodeQuery } from "./EpisodicMemory.js";
import type { Entity, Relation, Triple } from "./SemanticMemory.js";
import type { Skill, SkillMatchResult } from "./ProceduralMemory.js";

const logger = pino({ name: "MemoryManager" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemorySearchResult {
  type: "episodic" | "semantic" | "procedural" | "vector";
  score: number;
  data: unknown;
  source: string;
}

export interface PrivacyPolicy {
  /** Whether this agent's episodic memory can be read by other agents */
  shareEpisodicWithAgents: boolean;
  /** Whether this agent's semantic memory can be read by other agents */
  shareSemanticWithAgents: boolean;
  /** Whether this agent's procedural memory (skills) can be shared */
  shareProceduralWithAgents: boolean;
  /** Specific agent IDs allowed to read any of the above (empty = allow all, if sharing enabled) */
  allowedAgentIds: string[];
  /** Whether memory can be exported */
  allowExport: boolean;
}

export interface ExportedMemory {
  agentId: string;
  exportedAt: number;
  episodicSummaries: ReturnType<EpisodicMemory["getStats"]>;
  semanticGraph: { entities: Entity[]; relations: Relation[] };
  skills: Skill[];
  vectorStats: unknown;
}

export interface MemoryManagerConfig {
  agentId: string;
  userId: string;
  privacyPolicy?: Partial<PrivacyPolicy>;
  consolidationIntervalMs?: number;
  maxEpisodesInMemory?: number;
}

const DEFAULT_PRIVACY: PrivacyPolicy = {
  shareEpisodicWithAgents: false,
  shareSemanticWithAgents: true,
  shareProceduralWithAgents: true,
  allowedAgentIds: [],
  allowExport: true,
};

// ─── MemoryManager ────────────────────────────────────────────────────────────

export class MemoryManager extends EventEmitter {
  readonly agentId: string;
  readonly userId: string;
  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly procedural: ProceduralMemory;
  readonly vectors: VectorMemoryStore;

  private privacyPolicy: PrivacyPolicy;
  private consolidationTimer?: NodeJS.Timeout;

  constructor(
    config: MemoryManagerConfig,
    vectorStore?: VectorMemoryStore
  ) {
    super();
    this.agentId = config.agentId;
    this.userId = config.userId;
    this.privacyPolicy = { ...DEFAULT_PRIVACY, ...(config.privacyPolicy ?? {}) };

    const store = vectorStore ?? getVectorMemoryStore();
    this.vectors = store;
    this.episodic = new EpisodicMemory(store, config.agentId);
    this.semantic = new SemanticMemory(store, config.agentId);
    this.procedural = new ProceduralMemory(store, config.agentId);

    // Schedule periodic memory consolidation
    const interval = config.consolidationIntervalMs ?? 30 * 60 * 1000; // 30 min
    if (interval > 0) {
      this.consolidationTimer = setInterval(
        () => this.consolidateAll().catch((err) =>
          logger.error({ err }, "[MemoryManager] Consolidation error")
        ),
        interval
      );
    }

    logger.info(
      { agentId: config.agentId, userId: config.userId },
      "[MemoryManager] Initialized"
    );
  }

  // ── Session management ────────────────────────────────────────────────────────

  async startSession(
    sessionId: string,
    title = "Untitled Session",
    context: Record<string, unknown> = {}
  ): Promise<Episode> {
    const episode = await this.episodic.startEpisode(
      this.userId,
      sessionId,
      title,
      context
    );
    this.emit("session:started", { sessionId, episodeId: episode.episodeId });
    return episode;
  }

  async endSession(sessionId: string): Promise<void> {
    const episode = this.episodic.getActiveEpisode(sessionId);
    if (episode) {
      await this.episodic.endEpisode(episode.episodeId, true);
      this.emit("session:ended", { sessionId, episodeId: episode.episodeId });
    }
  }

  async recordInteraction(
    sessionId: string,
    event: Omit<EpisodeEvent, "eventId" | "timestamp">
  ): Promise<void> {
    await this.episodic.recordEventForSession(sessionId, event);

    // Extract entities and relations from user messages and agent responses
    if (event.type === "user_message" || event.type === "agent_response") {
      await this.extractAndStoreKnowledge(event.content, sessionId);
    }
  }

  // ── Cross-memory search ───────────────────────────────────────────────────────

  async search(
    query: string,
    opts: {
      includeEpisodic?: boolean;
      includeSemantic?: boolean;
      includeProcedural?: boolean;
      includeVectors?: boolean;
      topK?: number;
      sessionId?: string;
    } = {}
  ): Promise<MemorySearchResult[]> {
    const {
      includeEpisodic = true,
      includeSemantic = true,
      includeProcedural = true,
      includeVectors = true,
      topK = 10,
    } = opts;

    const results: MemorySearchResult[] = [];

    // Parallel retrieval from all memory types
    const tasks: Promise<void>[] = [];

    if (includeEpisodic) {
      tasks.push(
        this.episodic
          .query({
            query,
            agentId: this.agentId,
            userId: this.userId,
            sessionId: opts.sessionId,
            topK: Math.ceil(topK / 2),
          })
          .then((episodes) => {
            for (const ep of episodes) {
              results.push({
                type: "episodic",
                score: ep.strength,
                data: ep,
                source: `episode:${ep.episodeId}`,
              });
            }
          })
          .catch((err) =>
            logger.error({ err }, "[MemoryManager] Episodic search error")
          )
      );
    }

    if (includeSemantic) {
      tasks.push(
        this.semantic
          .searchEntities({ label: query, topK: Math.ceil(topK / 2) })
          .then((entities) => {
            for (const e of entities) {
              results.push({
                type: "semantic",
                score: e.confidence,
                data: e,
                source: `entity:${e.entityId}`,
              });
            }
          })
          .catch((err) =>
            logger.error({ err }, "[MemoryManager] Semantic search error")
          )
      );
    }

    if (includeProcedural) {
      tasks.push(
        this.procedural
          .findRelevantSkills(query, Math.ceil(topK / 2))
          .then((matches: SkillMatchResult[]) => {
            for (const m of matches) {
              results.push({
                type: "procedural",
                score: m.relevanceScore,
                data: m.skill,
                source: `skill:${m.skill.skillId}`,
              });
            }
          })
          .catch((err) =>
            logger.error({ err }, "[MemoryManager] Procedural search error")
          )
      );
    }

    if (includeVectors) {
      tasks.push(
        this.vectors
          .query(query, {
            namespace: VectorMemoryStore.agentNamespace(this.agentId),
            topK,
          })
          .then((r) => {
            for (const rec of r.records) {
              results.push({
                type: "vector",
                score: rec.score ?? 0,
                data: rec,
                source: `vector:${rec.id}`,
              });
            }
          })
          .catch((err) =>
            logger.error({ err }, "[MemoryManager] Vector search error")
          )
      );
    }

    await Promise.all(tasks);

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  // ── Knowledge extraction ──────────────────────────────────────────────────────

  private async extractAndStoreKnowledge(
    text: string,
    _sessionId: string
  ): Promise<void> {
    // Simple keyword-based entity extraction
    // In production, this would use an NLP/LLM pipeline
    const entityPatterns: Array<{ pattern: RegExp; type: string }> = [
      { pattern: /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g, type: "person" },
      { pattern: /\b([A-Z]{2,}(?:\s[A-Z]{2,})*)\b/g, type: "organization" },
    ];

    for (const { pattern, type } of entityPatterns) {
      const matches = Array.from(text.matchAll(pattern));
      for (const match of matches.slice(0, 3)) {
        try {
          await this.semantic.upsertEntity(match[1], type, {}, { confidence: 0.5 });
        } catch {
          // Ignore extraction errors — best-effort only
        }
      }
    }

    // Also store the raw text in vector store for future retrieval
    await this.vectors.upsert({
      content: text.slice(0, 2000),
      namespace: VectorMemoryStore.agentNamespace(this.agentId),
      metadata: { type: "interaction", agentId: this.agentId, userId: this.userId },
      importance: 0.4,
    });
  }

  // ── Privacy controls ──────────────────────────────────────────────────────────

  updatePrivacyPolicy(policy: Partial<PrivacyPolicy>): void {
    this.privacyPolicy = { ...this.privacyPolicy, ...policy };
    logger.info({ agentId: this.agentId }, "[MemoryManager] Privacy policy updated");
    this.emit("privacy:updated", { agentId: this.agentId });
  }

  canShareWith(requestingAgentId: string): {
    episodic: boolean;
    semantic: boolean;
    procedural: boolean;
  } {
    const { allowedAgentIds } = this.privacyPolicy;
    const isAllowed =
      allowedAgentIds.length === 0 || allowedAgentIds.includes(requestingAgentId);

    return {
      episodic: isAllowed && this.privacyPolicy.shareEpisodicWithAgents,
      semantic: isAllowed && this.privacyPolicy.shareSemanticWithAgents,
      procedural: isAllowed && this.privacyPolicy.shareProceduralWithAgents,
    };
  }

  // ── Consolidation ─────────────────────────────────────────────────────────────

  async consolidateAll(): Promise<{
    vectorsMerged: number;
    episodesArchived: number;
  }> {
    logger.info({ agentId: this.agentId }, "[MemoryManager] Running consolidation");

    const vectorsMerged = await this.vectors.consolidate({
      namespace: VectorMemoryStore.agentNamespace(this.agentId),
      similarityThreshold: 0.92,
      staleAfterDays: 60,
    });

    // Archive old summarized episodes
    const oldEpisodes = await this.episodic.query({
      agentId: this.agentId,
      status: "summarized",
      untilTs: Date.now() - 30 * 86_400_000,
      topK: 100,
    });

    for (const ep of oldEpisodes) {
      // Already summarized + over 30 days = archive
      // (in a full implementation, would call endEpisode with archive flag)
      logger.debug({ episodeId: ep.episodeId }, "[MemoryManager] Archiving old episode");
    }

    this.emit("consolidation:complete", {
      vectorsMerged,
      episodesArchived: oldEpisodes.length,
    });

    return { vectorsMerged, episodesArchived: oldEpisodes.length };
  }

  // ── Export / Import ───────────────────────────────────────────────────────────

  async exportMemory(): Promise<ExportedMemory> {
    if (!this.privacyPolicy.allowExport) {
      throw new Error(`Memory export is disabled for agent '${this.agentId}'`);
    }

    const [semanticGraph, vectorStats] = await Promise.all([
      Promise.resolve(this.semantic.exportGraph()),
      this.vectors.getStats([VectorMemoryStore.agentNamespace(this.agentId)]),
    ]);

    const skills = Array.from({ length: 0 }); // would gather from procedural

    return {
      agentId: this.agentId,
      exportedAt: Date.now(),
      episodicSummaries: this.episodic.getStats(),
      semanticGraph,
      skills: skills as Skill[],
      vectorStats,
    };
  }

  // ── Combined stats ────────────────────────────────────────────────────────────

  async getStats() {
    const [vectorStats] = await Promise.all([
      this.vectors.getStats([VectorMemoryStore.agentNamespace(this.agentId)]),
    ]);

    return {
      agentId: this.agentId,
      episodic: this.episodic.getStats(),
      semantic: this.semantic.getStats(),
      procedural: this.procedural.getStats(),
      vectors: vectorStats,
    };
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = undefined;
    }
    this.removeAllListeners();
    logger.info({ agentId: this.agentId }, "[MemoryManager] Destroyed");
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const managers = new Map<string, MemoryManager>();

export function getMemoryManager(config: MemoryManagerConfig): MemoryManager {
  const key = `${config.agentId}:${config.userId}`;
  if (!managers.has(key)) {
    managers.set(key, new MemoryManager(config));
  }
  return managers.get(key)!;
}

export function destroyMemoryManager(agentId: string, userId: string): void {
  const key = `${agentId}:${userId}`;
  const manager = managers.get(key);
  if (manager) {
    manager.destroy();
    managers.delete(key);
  }
}
