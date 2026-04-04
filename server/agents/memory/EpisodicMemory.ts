import { randomUUID } from "crypto";
import pino from "pino";
import { VectorMemoryStore, type VectorRecord } from "./VectorMemoryStore.js";

const logger = pino({ name: "EpisodicMemory" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type EpisodeStatus = "active" | "summarized" | "archived";

export interface Episode {
  episodeId: string;
  agentId: string;
  userId: string;
  sessionId: string;
  /** Human-readable title derived from the episode content */
  title: string;
  /** Short summary of what happened */
  summary?: string;
  /** Full sequence of events */
  events: EpisodeEvent[];
  context: Record<string, unknown>;
  status: EpisodeStatus;
  startedAt: number;
  endedAt?: number;
  /** Decay weight: 0-1, decays over time, boosted by reinforcement */
  strength: number;
  /** Tags for retrieval */
  tags: string[];
  /** Linked episode IDs (e.g. follow-ups, continuations) */
  linkedEpisodes: string[];
}

export type EventType =
  | "user_message"
  | "agent_response"
  | "tool_call"
  | "tool_result"
  | "error"
  | "plan_step"
  | "observation"
  | "decision"
  | "feedback";

export interface EpisodeEvent {
  eventId: string;
  type: EventType;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  /** actor: "user" | "agent" | "system" | toolId */
  actor: string;
  /** Optional importance override for this specific event */
  importance?: number;
}

export interface EpisodeQuery {
  agentId?: string;
  userId?: string;
  sessionId?: string;
  query?: string;
  tags?: string[];
  sinceTs?: number;
  untilTs?: number;
  status?: EpisodeStatus;
  topK?: number;
  minStrength?: number;
}

export interface EpisodeSummary {
  episodeId: string;
  title: string;
  summary: string;
  startedAt: number;
  endedAt?: number;
  strength: number;
  tags: string[];
  eventCount: number;
}

// ─── Decay & reinforcement ────────────────────────────────────────────────────

const DECAY_HALF_LIFE_DAYS = 14; // episodes halve in strength every 14 days
const REINFORCEMENT_BOOST = 0.15; // accessing an episode boosts its strength

function decayStrength(strength: number, ageMs: number): number {
  const ageDays = ageMs / 86_400_000;
  const decayFactor = Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
  return strength * decayFactor;
}

// ─── EpisodicMemory ───────────────────────────────────────────────────────────

export class EpisodicMemory {
  private episodes = new Map<string, Episode>();
  /** Active episode per (agentId + sessionId) */
  private activeEpisodeIndex = new Map<string, string>();

  constructor(
    private readonly vectorStore: VectorMemoryStore,
    private readonly defaultAgentId: string
  ) {
    logger.info({ agentId: defaultAgentId }, "[EpisodicMemory] Initialized");
  }

  // ── Episode management ────────────────────────────────────────────────────────

  async startEpisode(
    userId: string,
    sessionId: string,
    title: string,
    context: Record<string, unknown> = {}
  ): Promise<Episode> {
    const episodeId = randomUUID();
    const episode: Episode = {
      episodeId,
      agentId: this.defaultAgentId,
      userId,
      sessionId,
      title,
      events: [],
      context,
      status: "active",
      startedAt: Date.now(),
      strength: 1.0,
      tags: [],
      linkedEpisodes: [],
    };

    this.episodes.set(episodeId, episode);
    this.activeEpisodeIndex.set(
      this.episodeKey(this.defaultAgentId, sessionId),
      episodeId
    );

    logger.info({ episodeId, userId, sessionId }, "[EpisodicMemory] Episode started");
    return episode;
  }

  async endEpisode(episodeId: string, summarize = true): Promise<Episode> {
    const episode = this.episodes.get(episodeId);
    if (!episode) throw new Error(`Episode '${episodeId}' not found`);

    const updated: Episode = {
      ...episode,
      status: summarize ? "summarized" : "archived",
      endedAt: Date.now(),
    };

    if (summarize && episode.events.length > 0) {
      updated.summary = this.generateSummary(episode);
      updated.tags = this.extractTags(episode);

      // Persist summary to vector store for semantic retrieval
      await this.vectorStore.upsert(
        {
          id: `episode:${episodeId}`,
          content: `${updated.title}\n${updated.summary}`,
          metadata: {
            episodeId,
            agentId: episode.agentId,
            userId: episode.userId,
            sessionId: episode.sessionId,
            tags: updated.tags,
            startedAt: episode.startedAt,
            endedAt: updated.endedAt,
            eventCount: episode.events.length,
          },
          namespace: VectorMemoryStore.agentNamespace(episode.agentId),
          importance: this.computeEpisodeImportance(episode),
        }
      );
    }

    this.episodes.set(episodeId, updated);

    // Remove from active index
    const key = this.episodeKey(episode.agentId, episode.sessionId);
    if (this.activeEpisodeIndex.get(key) === episodeId) {
      this.activeEpisodeIndex.delete(key);
    }

    logger.info(
      { episodeId, eventsCount: episode.events.length },
      "[EpisodicMemory] Episode ended"
    );
    return updated;
  }

  // ── Event recording ───────────────────────────────────────────────────────────

  async recordEvent(
    episodeId: string,
    event: Omit<EpisodeEvent, "eventId" | "timestamp">
  ): Promise<EpisodeEvent> {
    const episode = this.episodes.get(episodeId);
    if (!episode) throw new Error(`Episode '${episodeId}' not found`);
    if (episode.status !== "active") {
      throw new Error(
        `Cannot record event: episode '${episodeId}' is ${episode.status}`
      );
    }

    const fullEvent: EpisodeEvent = {
      ...event,
      eventId: randomUUID(),
      timestamp: Date.now(),
    };

    const updated: Episode = {
      ...episode,
      events: [...episode.events, fullEvent],
    };
    this.episodes.set(episodeId, updated);

    return fullEvent;
  }

  async recordEventForSession(
    sessionId: string,
    event: Omit<EpisodeEvent, "eventId" | "timestamp">
  ): Promise<EpisodeEvent | null> {
    const episodeId = this.activeEpisodeIndex.get(
      this.episodeKey(this.defaultAgentId, sessionId)
    );
    if (!episodeId) return null;
    return this.recordEvent(episodeId, event);
  }

  // ── Retrieval ─────────────────────────────────────────────────────────────────

  async query(opts: EpisodeQuery): Promise<Episode[]> {
    const {
      agentId = this.defaultAgentId,
      userId,
      sessionId,
      query,
      tags,
      sinceTs,
      untilTs,
      status,
      topK = 10,
      minStrength = 0.01,
    } = opts;

    let results: Episode[] = [];

    if (query) {
      // Semantic search via vector store
      const queryResult = await this.vectorStore.query(query, {
        namespace: VectorMemoryStore.agentNamespace(agentId),
        topK: topK * 2,
        filters: userId ? { userId } : undefined,
      });

      const episodeIds = queryResult.records
        .map((r) => String(r.metadata.episodeId))
        .filter(Boolean);

      results = episodeIds
        .map((id) => this.episodes.get(id))
        .filter((ep): ep is Episode => ep !== undefined);
    } else {
      // Filter in-memory
      results = Array.from(this.episodes.values());
    }

    // Apply filters
    if (agentId) results = results.filter((e) => e.agentId === agentId);
    if (userId) results = results.filter((e) => e.userId === userId);
    if (sessionId) results = results.filter((e) => e.sessionId === sessionId);
    if (status) results = results.filter((e) => e.status === status);
    if (sinceTs) results = results.filter((e) => e.startedAt >= sinceTs);
    if (untilTs) results = results.filter((e) => e.startedAt <= untilTs);
    if (tags?.length) {
      results = results.filter((e) => tags.every((t) => e.tags.includes(t)));
    }

    // Apply decay and filter by strength
    const now = Date.now();
    results = results.map((ep) => ({
      ...ep,
      strength: decayStrength(ep.strength, now - ep.startedAt),
    }));
    results = results.filter((ep) => ep.strength >= minStrength);

    // Reinforce retrieved episodes
    for (const ep of results) {
      this.reinforce(ep.episodeId);
    }

    return results
      .sort((a, b) => b.strength - a.strength)
      .slice(0, topK);
  }

  getActiveEpisode(sessionId: string): Episode | null {
    const key = this.episodeKey(this.defaultAgentId, sessionId);
    const id = this.activeEpisodeIndex.get(key);
    if (!id) return null;
    return this.episodes.get(id) ?? null;
  }

  getEpisode(episodeId: string): Episode | null {
    return this.episodes.get(episodeId) ?? null;
  }

  // ── Summarization ─────────────────────────────────────────────────────────────

  summarizeEpisode(episodeId: string): EpisodeSummary | null {
    const ep = this.episodes.get(episodeId);
    if (!ep) return null;

    return {
      episodeId: ep.episodeId,
      title: ep.title,
      summary: ep.summary ?? this.generateSummary(ep),
      startedAt: ep.startedAt,
      endedAt: ep.endedAt,
      strength: decayStrength(ep.strength, Date.now() - ep.startedAt),
      tags: ep.tags,
      eventCount: ep.events.length,
    };
  }

  private generateSummary(episode: Episode): string {
    const userMsgs = episode.events
      .filter((e) => e.type === "user_message")
      .map((e) => e.content.slice(0, 100));

    const agentMsgs = episode.events
      .filter((e) => e.type === "agent_response")
      .map((e) => e.content.slice(0, 100));

    const toolsUsed = [
      ...new Set(
        episode.events
          .filter((e) => e.type === "tool_call")
          .map((e) => String(e.metadata?.toolId ?? "unknown"))
      ),
    ];

    const errors = episode.events
      .filter((e) => e.type === "error")
      .map((e) => e.content.slice(0, 80));

    const parts: string[] = [
      `Episode: ${episode.title}`,
      userMsgs.length > 0 ? `User requests: ${userMsgs.slice(0, 3).join("; ")}` : "",
      agentMsgs.length > 0 ? `Agent responses: ${agentMsgs.slice(0, 2).join("; ")}` : "",
      toolsUsed.length > 0 ? `Tools used: ${toolsUsed.join(", ")}` : "",
      errors.length > 0 ? `Errors: ${errors.join("; ")}` : "",
    ].filter(Boolean);

    return parts.join(". ");
  }

  private extractTags(episode: Episode): string[] {
    const tags = new Set<string>();

    for (const event of episode.events) {
      if (event.type === "tool_call" && event.metadata?.toolId) {
        tags.add(`tool:${event.metadata.toolId}`);
      }
      if (event.metadata?.tags) {
        (event.metadata.tags as string[]).forEach((t) => tags.add(t));
      }
    }

    // Extract keywords from title
    episode.title
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .forEach((w) => tags.add(w));

    return Array.from(tags).slice(0, 20);
  }

  private computeEpisodeImportance(episode: Episode): number {
    const duration = (episode.endedAt ?? Date.now()) - episode.startedAt;
    const durationScore = Math.min(1, duration / 3_600_000); // max at 1 hour
    const eventScore = Math.min(1, episode.events.length / 20);
    const errorPenalty = episode.events.filter((e) => e.type === "error").length * 0.05;

    return Math.max(0, Math.min(1, (durationScore + eventScore) / 2 - errorPenalty));
  }

  // ── Reinforcement ─────────────────────────────────────────────────────────────

  private reinforce(episodeId: string): void {
    const ep = this.episodes.get(episodeId);
    if (!ep) return;
    this.episodes.set(episodeId, {
      ...ep,
      strength: Math.min(1, ep.strength + REINFORCEMENT_BOOST),
    });
  }

  // ── Link episodes ─────────────────────────────────────────────────────────────

  linkEpisodes(episodeId: string, linkedId: string): void {
    const ep = this.episodes.get(episodeId);
    if (!ep) return;
    if (!ep.linkedEpisodes.includes(linkedId)) {
      this.episodes.set(episodeId, {
        ...ep,
        linkedEpisodes: [...ep.linkedEpisodes, linkedId],
      });
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  getStats() {
    const all = Array.from(this.episodes.values());
    return {
      total: all.length,
      active: all.filter((e) => e.status === "active").length,
      summarized: all.filter((e) => e.status === "summarized").length,
      archived: all.filter((e) => e.status === "archived").length,
      totalEvents: all.reduce((s, e) => s + e.events.length, 0),
    };
  }

  private episodeKey(agentId: string, sessionId: string): string {
    return `${agentId}:${sessionId}`;
  }
}
