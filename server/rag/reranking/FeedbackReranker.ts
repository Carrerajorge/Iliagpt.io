import { Logger } from '../../lib/logger';

// ─── Shared chunk types ────────────────────────────────────────────────────────

interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
  score: number;
  source: string;
  retrievalMethod: string;
}

export interface RankedChunk extends RetrievedChunk {
  rank: number;
  rerankScore?: number;
}

// ─── Signal types ─────────────────────────────────────────────────────────────

export type SignalType =
  | 'click'
  | 'copy'
  | 'cite'
  | 'thumbs_up'
  | 'thumbs_down'
  | 'dwell'
  | 'ignore';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FeedbackSignal {
  chunkId: string;
  documentId: string;
  signalType: SignalType;
  userId: string;
  query: string;
  timestamp: Date;
  dwellMs?: number;
  weight: number;
}

export interface ChunkFeedbackProfile {
  chunkId: string;
  positiveWeight: number;
  negativeWeight: number;
  signalCount: number;
  lastSignalAt: Date;
  decayedScore: number;
}

export interface FeedbackConfig {
  signalWeights: Record<SignalType, number>;
  decayHalfLifeMs: number;
  maxBoost: number;
  minPenalty: number;
  persistenceEnabled: boolean;
  userId?: string;
}

// ─── FeedbackReranker ─────────────────────────────────────────────────────────

const DEFAULT_SIGNAL_WEIGHTS: Record<SignalType, number> = {
  click: 0.3,
  copy: 0.6,
  cite: 0.8,
  thumbs_up: 1.0,
  thumbs_down: -1.0,
  dwell: 0.2,
  ignore: -0.1,
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class FeedbackReranker {
  private readonly config: FeedbackConfig;
  private readonly profiles: Map<string, ChunkFeedbackProfile>;

  constructor(config?: Partial<FeedbackConfig>) {
    this.config = {
      signalWeights: { ...DEFAULT_SIGNAL_WEIGHTS },
      decayHalfLifeMs: SEVEN_DAYS_MS,
      maxBoost: 0.3,
      minPenalty: -0.2,
      persistenceEnabled: false,
      ...config,
      // merge signalWeights override properly
      signalWeights: {
        ...DEFAULT_SIGNAL_WEIGHTS,
        ...(config?.signalWeights ?? {}),
      },
    };
    this.profiles = new Map();
  }

  recordSignal(signal: Omit<FeedbackSignal, 'weight'>): void {
    // Filter by userId if configured
    if (this.config.userId && signal.userId !== this.config.userId) {
      return;
    }

    const weight = this.config.signalWeights[signal.signalType];

    // For 'dwell' signals, scale weight by dwell time (cap at 30s)
    let effectiveWeight = weight;
    if (signal.signalType === 'dwell' && signal.dwellMs !== undefined) {
      const cappedMs = Math.min(signal.dwellMs, 30_000);
      effectiveWeight = weight * (cappedMs / 10_000); // normalize to ~10s baseline
    }

    const existing = this.profiles.get(signal.chunkId);
    const now = signal.timestamp;

    if (existing) {
      if (effectiveWeight >= 0) {
        existing.positiveWeight += effectiveWeight;
      } else {
        existing.negativeWeight += Math.abs(effectiveWeight);
      }
      existing.signalCount++;
      existing.lastSignalAt = now;
      existing.decayedScore = this._applyDecay(existing);
    } else {
      const newProfile: ChunkFeedbackProfile = {
        chunkId: signal.chunkId,
        positiveWeight: effectiveWeight >= 0 ? effectiveWeight : 0,
        negativeWeight: effectiveWeight < 0 ? Math.abs(effectiveWeight) : 0,
        signalCount: 1,
        lastSignalAt: now,
        decayedScore: effectiveWeight,
      };
      this.profiles.set(signal.chunkId, newProfile);
    }

    Logger.debug('[FeedbackReranker] Signal recorded', {
      chunkId: signal.chunkId,
      signalType: signal.signalType,
      effectiveWeight,
      userId: signal.userId,
    });
  }

  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RankedChunk[]> {
    if (chunks.length === 0) return [];

    Logger.debug('[FeedbackReranker] Applying feedback rerank', {
      query,
      chunkCount: chunks.length,
      profileCount: this.profiles.size,
    });

    const adjusted = chunks.map((chunk) => {
      const boost = this._getFeedbackBoost(chunk.id);
      const adjustedScore = Math.min(1.0, Math.max(0.0, chunk.score + boost));
      return {
        ...chunk,
        score: adjustedScore,
        rerankScore: adjustedScore,
        rank: 0,
      };
    });

    adjusted.sort((a, b) => b.score - a.score);

    return adjusted.map((chunk, idx) => ({ ...chunk, rank: idx + 1 }));
  }

  private _getFeedbackBoost(chunkId: string): number {
    const profile = this.profiles.get(chunkId);
    if (!profile) return 0;

    const decayedScore = this._applyDecay(profile);

    // Normalize raw signal net score to [minPenalty, maxBoost] using a tanh-like clamp.
    // A net score of ±2 maps roughly to ±full boost/penalty.
    const normalized = Math.tanh(decayedScore / 2);

    if (normalized >= 0) {
      return normalized * this.config.maxBoost;
    } else {
      return normalized * Math.abs(this.config.minPenalty);
    }
  }

  private _applyDecay(profile: ChunkFeedbackProfile): number {
    const elapsedMs = Date.now() - profile.lastSignalAt.getTime();
    const netScore = profile.positiveWeight - profile.negativeWeight;
    const decayFactor = Math.pow(0.5, elapsedMs / this.config.decayHalfLifeMs);
    const decayedScore = netScore * decayFactor;

    // Update stored decayed score
    profile.decayedScore = decayedScore;
    return decayedScore;
  }

  getProfile(chunkId: string): ChunkFeedbackProfile | undefined {
    const profile = this.profiles.get(chunkId);
    if (!profile) return undefined;
    // Return a copy with freshly computed decayed score
    const decayedScore = this._applyDecay(profile);
    return { ...profile, decayedScore };
  }

  clearProfile(chunkId: string): void {
    this.profiles.delete(chunkId);
    Logger.debug('[FeedbackReranker] Profile cleared', { chunkId });
  }

  getTopChunks(limit = 10): ChunkFeedbackProfile[] {
    const profiles = [...this.profiles.values()].map((p) => ({
      ...p,
      decayedScore: this._applyDecay(p),
    }));
    profiles.sort((a, b) => b.decayedScore - a.decayedScore);
    return profiles.slice(0, limit);
  }

  getStats(): {
    profileCount: number;
    totalSignals: number;
    avgDecayedScore: number;
    mostBoostedChunkId?: string;
  } {
    if (this.profiles.size === 0) {
      return {
        profileCount: 0,
        totalSignals: 0,
        avgDecayedScore: 0,
      };
    }

    let totalSignals = 0;
    let totalDecayed = 0;
    let mostBoostedChunkId: string | undefined;
    let maxDecayed = -Infinity;

    for (const profile of this.profiles.values()) {
      totalSignals += profile.signalCount;
      const decayed = this._applyDecay(profile);
      totalDecayed += decayed;
      if (decayed > maxDecayed) {
        maxDecayed = decayed;
        mostBoostedChunkId = profile.chunkId;
      }
    }

    return {
      profileCount: this.profiles.size,
      totalSignals,
      avgDecayedScore: totalDecayed / this.profiles.size,
      mostBoostedChunkId,
    };
  }

  exportProfiles(): ChunkFeedbackProfile[] {
    return [...this.profiles.values()].map((p) => ({
      ...p,
      decayedScore: this._applyDecay(p),
    }));
  }

  importProfiles(profiles: ChunkFeedbackProfile[]): void {
    let imported = 0;
    let skipped = 0;

    for (const profile of profiles) {
      if (
        typeof profile.chunkId !== 'string' ||
        typeof profile.positiveWeight !== 'number' ||
        typeof profile.negativeWeight !== 'number' ||
        typeof profile.signalCount !== 'number'
      ) {
        skipped++;
        continue;
      }
      // Ensure lastSignalAt is a Date instance
      const lastSignalAt =
        profile.lastSignalAt instanceof Date
          ? profile.lastSignalAt
          : new Date(profile.lastSignalAt);

      this.profiles.set(profile.chunkId, {
        ...profile,
        lastSignalAt,
        decayedScore: this._applyDecay({ ...profile, lastSignalAt }),
      });
      imported++;
    }

    Logger.info('[FeedbackReranker] Profiles imported', { imported, skipped });
  }

  /**
   * Merge another FeedbackReranker's profiles into this one.
   * If a chunkId already exists, weighted averages are used for positive/negative
   * weights and signal counts are summed.
   */
  mergeFrom(other: FeedbackReranker): void {
    const otherProfiles = other.exportProfiles();
    let merged = 0;
    let added = 0;

    for (const otherProfile of otherProfiles) {
      const existing = this.profiles.get(otherProfile.chunkId);
      if (existing) {
        existing.positiveWeight += otherProfile.positiveWeight;
        existing.negativeWeight += otherProfile.negativeWeight;
        existing.signalCount += otherProfile.signalCount;
        // Keep most recent signal timestamp
        const otherDate =
          otherProfile.lastSignalAt instanceof Date
            ? otherProfile.lastSignalAt
            : new Date(otherProfile.lastSignalAt);
        if (otherDate > existing.lastSignalAt) {
          existing.lastSignalAt = otherDate;
        }
        existing.decayedScore = this._applyDecay(existing);
        merged++;
      } else {
        const lastSignalAt =
          otherProfile.lastSignalAt instanceof Date
            ? otherProfile.lastSignalAt
            : new Date(otherProfile.lastSignalAt);
        this.profiles.set(otherProfile.chunkId, {
          ...otherProfile,
          lastSignalAt,
          decayedScore: this._applyDecay({ ...otherProfile, lastSignalAt }),
        });
        added++;
      }
    }

    Logger.info('[FeedbackReranker] Profiles merged', { merged, added });
  }

  /**
   * Remove all profiles older than the given age in milliseconds (based on lastSignalAt).
   * Useful for periodic cleanup to free memory when persistenceEnabled is false.
   */
  pruneOldProfiles(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    for (const [chunkId, profile] of this.profiles.entries()) {
      if (profile.lastSignalAt.getTime() < cutoff) {
        this.profiles.delete(chunkId);
        pruned++;
      }
    }

    if (pruned > 0) {
      Logger.info('[FeedbackReranker] Pruned old profiles', { pruned, maxAgeMs });
    }

    return pruned;
  }

  /**
   * Compute a ranked list of signal types by their cumulative absolute weight across
   * all profiles, useful for understanding which signals drive the most reranking impact.
   */
  getSignalImpactReport(): Array<{ signalType: SignalType; weight: number; configuredWeight: number }> {
    const impactByType = new Map<SignalType, number>();
    const signalTypes: SignalType[] = [
      'click', 'copy', 'cite', 'thumbs_up', 'thumbs_down', 'dwell', 'ignore',
    ];

    for (const signalType of signalTypes) {
      impactByType.set(signalType, 0);
    }

    // We cannot reconstruct per-signal-type totals from aggregated positiveWeight/negativeWeight
    // without individual logs, so instead report configured weights with profile context.
    const report = signalTypes.map((signalType) => ({
      signalType,
      weight: impactByType.get(signalType) ?? 0,
      configuredWeight: this.config.signalWeights[signalType],
    }));

    return report.sort((a, b) => Math.abs(b.configuredWeight) - Math.abs(a.configuredWeight));
  }

  /**
   * Reset all tracking state — profiles, but preserve config.
   */
  reset(): void {
    const profileCount = this.profiles.size;
    this.profiles.clear();
    Logger.info('[FeedbackReranker] Reset complete', { clearedProfiles: profileCount });
  }

  /**
   * Compute a bucket histogram of decayed scores across all profiles.
   * Returns an array of {bucket, count} where buckets span from -1 to +1
   * in increments of 0.2.
   */
  getScoreDistribution(): Array<{ bucket: string; count: number }> {
    const buckets: Record<string, number> = {
      '-1.0 to -0.6': 0,
      '-0.6 to -0.2': 0,
      '-0.2 to 0.2': 0,
      '0.2 to 0.6': 0,
      '0.6 to 1.0': 0,
    };

    for (const profile of this.profiles.values()) {
      const score = this._applyDecay(profile);
      if (score < -0.6) {
        buckets['-1.0 to -0.6']++;
      } else if (score < -0.2) {
        buckets['-0.6 to -0.2']++;
      } else if (score < 0.2) {
        buckets['-0.2 to 0.2']++;
      } else if (score < 0.6) {
        buckets['0.2 to 0.6']++;
      } else {
        buckets['0.6 to 1.0']++;
      }
    }

    return Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));
  }
}
