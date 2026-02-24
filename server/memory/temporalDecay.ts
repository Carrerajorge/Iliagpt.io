export type TemporalDecayConfig = {
    enabled: boolean;
    halfLifeDays: number;
};

export const DEFAULT_TEMPORAL_DECAY_CONFIG: TemporalDecayConfig = {
    enabled: true,
    halfLifeDays: 30,
};

export function toDecayLambda(halfLifeDays: number): number {
    if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
        return 0;
    }
    return Math.LN2 / halfLifeDays;
}

export function calculateTemporalDecayMultiplier(ageInDays: number, halfLifeDays: number): number {
    const lambda = toDecayLambda(halfLifeDays);
    const clampedAge = Math.max(0, ageInDays);
    if (lambda <= 0 || !Number.isFinite(clampedAge)) {
        return 1;
    }
    return Math.exp(-lambda * clampedAge);
}

export function applyTemporalDecayToScore(score: number, ageInDays: number, halfLifeDays: number): number {
    return score * calculateTemporalDecayMultiplier(ageInDays, halfLifeDays);
}

export function ageInDaysFromTimestamp(timestamp: Date, nowMs: number = Date.now()): number {
    const ageMs = Math.max(0, nowMs - timestamp.getTime());
    return ageMs / (24 * 60 * 60 * 1000);
}

export function applyTemporalDecayToResults<
    T extends { score: number; timestamp?: Date | number | string }
>(results: T[], config: Partial<TemporalDecayConfig> = {}): T[] {
    const { enabled = DEFAULT_TEMPORAL_DECAY_CONFIG.enabled, halfLifeDays = DEFAULT_TEMPORAL_DECAY_CONFIG.halfLifeDays } = config;

    if (!enabled) return [...results];

    const nowMs = Date.now();
    return results.map(entry => {
        if (!entry.timestamp) return entry;

        let tsDate: Date;
        if (entry.timestamp instanceof Date) {
            tsDate = entry.timestamp;
        } else {
            tsDate = new Date(entry.timestamp);
        }

        if (isNaN(tsDate.getTime())) return entry;

        const decayedScore = applyTemporalDecayToScore(entry.score, ageInDaysFromTimestamp(tsDate, nowMs), halfLifeDays);
        return {
            ...entry,
            score: decayedScore,
        };
    });
}
