/**
 * Distributed Caching and Feature Flags
 * Tasks 39-45: Multi-level cache, feature flags, A/B testing
 */

import { EventEmitter } from 'events';
import { Logger } from './logger';
import crypto from 'crypto';

// ============================================================================
// Task 39: Multi-Level Distributed Cache
// ============================================================================

interface CacheLevel {
    name: string;
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, ttlMs: number) => Promise<void>;
    delete: (key: string) => Promise<void>;
    clear: () => Promise<void>;
}

class L1MemoryCache implements CacheLevel {
    name = 'L1-Memory';
    private cache: Map<string, { value: string; expiresAt: number }> = new Map();
    private maxSize: number;

    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
        setInterval(() => this.cleanup(), 30000).unref();
    }

    async get(key: string): Promise<string | null> {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return entry.value;
    }

    async set(key: string, value: string, ttlMs: number): Promise<void> {
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }
        this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    }

    async delete(key: string): Promise<void> {
        this.cache.delete(key);
    }

    async clear(): Promise<void> {
        this.cache.clear();
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) this.cache.delete(key);
        }
    }
}

class MultiLevelCache {
    private levels: CacheLevel[];
    private stats = { hits: new Map<string, number>(), misses: 0 };

    constructor(levels: CacheLevel[]) {
        this.levels = levels;
    }

    async get<T>(key: string): Promise<T | null> {
        for (let i = 0; i < this.levels.length; i++) {
            const level = this.levels[i];
            const value = await level.get(key);

            if (value !== null) {
                this.stats.hits.set(level.name, (this.stats.hits.get(level.name) ?? 0) + 1);

                // Backfill upper levels
                for (let j = 0; j < i; j++) {
                    const upperLevel = this.levels[j];
                    const ttl = this.getTTLForLevel(j);
                    await upperLevel.set(key, value, ttl).catch(() => { });
                }

                try {
                    return JSON.parse(value) as T;
                } catch {
                    return value as unknown as T;
                }
            }
        }

        this.stats.misses++;
        return null;
    }

    async set<T>(key: string, value: T, ttlMs: number = 60000): Promise<void> {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);

        await Promise.all(
            this.levels.map((level, i) =>
                level.set(key, serialized, this.getTTLForLevel(i, ttlMs)).catch(() => { })
            )
        );
    }

    async delete(key: string): Promise<void> {
        await Promise.all(this.levels.map(level => level.delete(key).catch(() => { })));
    }

    async clear(): Promise<void> {
        await Promise.all(this.levels.map(level => level.clear().catch(() => { })));
    }

    private getTTLForLevel(levelIndex: number, baseTtl: number = 60000): number {
        // Lower levels have longer TTLs
        return baseTtl * (levelIndex + 1);
    }

    getStats(): { hits: Record<string, number>; misses: number; hitRate: string } {
        const totalHits = Array.from(this.stats.hits.values()).reduce((a, b) => a + b, 0);
        const total = totalHits + this.stats.misses;

        return {
            hits: Object.fromEntries(this.stats.hits),
            misses: this.stats.misses,
            hitRate: total > 0 ? `${Math.round((totalHits / total) * 100)}%` : '0%',
        };
    }
}

// Default multi-level cache
export const multiLevelCache = new MultiLevelCache([
    new L1MemoryCache(5000),  // Fast, small
    // L2 would be Redis in production
]);

// ============================================================================
// Task 48: Distributed Feature Flags
// ============================================================================

interface FeatureFlag {
    name: string;
    enabled: boolean;
    rolloutPercentage: number;
    targetUsers?: string[];
    targetGroups?: string[];
    conditions?: {
        attribute: string;
        operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'in';
        value: any;
    }[];
    metadata?: Record<string, any>;
}

interface FeatureFlagContext {
    userId?: string;
    userGroups?: string[];
    attributes?: Record<string, any>;
}

class FeatureFlagManager extends EventEmitter {
    private flags: Map<string, FeatureFlag> = new Map();
    private overrides: Map<string, Map<string, boolean>> = new Map(); // flagName -> userId -> enabled

    /**
     * Register a feature flag
     */
    register(flag: FeatureFlag): void {
        this.flags.set(flag.name, flag);
        Logger.info(`[FeatureFlags] Registered flag: ${flag.name} (${flag.enabled ? 'enabled' : 'disabled'}, ${flag.rolloutPercentage}%)`);
    }

    /**
     * Check if a feature is enabled for a context
     */
    isEnabled(flagName: string, context: FeatureFlagContext = {}): boolean {
        const flag = this.flags.get(flagName);
        if (!flag) return false;

        // Check user-specific override first
        if (context.userId) {
            const userOverrides = this.overrides.get(flagName);
            if (userOverrides?.has(context.userId)) {
                return userOverrides.get(context.userId)!;
            }
        }

        // If flag is globally disabled
        if (!flag.enabled) return false;

        // Check target users
        if (flag.targetUsers?.length && context.userId) {
            if (flag.targetUsers.includes(context.userId)) return true;
        }

        // Check target groups
        if (flag.targetGroups?.length && context.userGroups?.length) {
            const hasMatchingGroup = flag.targetGroups.some(g => context.userGroups!.includes(g));
            if (hasMatchingGroup) return true;
        }

        // Check conditions
        if (flag.conditions?.length && context.attributes) {
            const allConditionsMet = flag.conditions.every(cond =>
                this.evaluateCondition(cond, context.attributes!)
            );
            if (!allConditionsMet) return false;
        }

        // Percentage rollout
        if (flag.rolloutPercentage < 100) {
            const hash = this.hashUserToPercentage(context.userId ?? 'anonymous', flagName);
            return hash < flag.rolloutPercentage;
        }

        return true;
    }

    private evaluateCondition(
        condition: NonNullable<FeatureFlag['conditions']>[number],
        attributes: Record<string, any>
    ): boolean {
        const value = attributes[condition.attribute];
        if (value === undefined) return false;

        switch (condition.operator) {
            case 'eq': return value === condition.value;
            case 'neq': return value !== condition.value;
            case 'gt': return value > condition.value;
            case 'lt': return value < condition.value;
            case 'contains': return String(value).includes(String(condition.value));
            case 'in': return Array.isArray(condition.value) && condition.value.includes(value);
            default: return false;
        }
    }

    private hashUserToPercentage(userId: string, flagName: string): number {
        const hash = crypto.createHash('md5').update(`${userId}:${flagName}`).digest('hex');
        return parseInt(hash.slice(0, 8), 16) % 100;
    }

    /**
     * Set a user-specific override
     */
    setOverride(flagName: string, userId: string, enabled: boolean): void {
        if (!this.overrides.has(flagName)) {
            this.overrides.set(flagName, new Map());
        }
        this.overrides.get(flagName)!.set(userId, enabled);
        this.emit('override', { flagName, userId, enabled });
    }

    /**
     * Remove a user-specific override
     */
    removeOverride(flagName: string, userId: string): void {
        this.overrides.get(flagName)?.delete(userId);
    }

    /**
     * Update flag configuration
     */
    update(flagName: string, updates: Partial<FeatureFlag>): void {
        const flag = this.flags.get(flagName);
        if (!flag) return;

        Object.assign(flag, updates);
        this.emit('updated', { flagName, updates });
        Logger.info(`[FeatureFlags] Updated flag: ${flagName}`);
    }

    getAllFlags(): FeatureFlag[] {
        return Array.from(this.flags.values());
    }
}

export const featureFlags = new FeatureFlagManager();

// ============================================================================
// Task 49: A/B Testing Infrastructure
// ============================================================================

interface Experiment {
    name: string;
    variants: Array<{
        name: string;
        weight: number;
    }>;
    active: boolean;
    startDate: Date;
    endDate?: Date;
    targetPercentage: number;
    metrics: string[];
}

interface ExperimentAssignment {
    experimentName: string;
    variantName: string;
    userId: string;
    assignedAt: Date;
}

class ABTestingManager extends EventEmitter {
    private experiments: Map<string, Experiment> = new Map();
    private assignments: Map<string, ExperimentAssignment> = new Map(); // `${experiment}:${userId}` -> assignment
    private conversions: Map<string, Map<string, number>> = new Map(); // experiment -> variant -> count

    /**
     * Create an experiment
     */
    createExperiment(experiment: Experiment): void {
        this.experiments.set(experiment.name, experiment);
        this.conversions.set(experiment.name, new Map());
        Logger.info(`[ABTesting] Created experiment: ${experiment.name} (${experiment.variants.length} variants)`);
    }

    /**
     * Get the variant for a user
     */
    getVariant(experimentName: string, userId: string): string | null {
        const experiment = this.experiments.get(experimentName);
        if (!experiment || !experiment.active) return null;

        // Check if already assigned
        const assignmentKey = `${experimentName}:${userId}`;
        const existing = this.assignments.get(assignmentKey);
        if (existing) return existing.variantName;

        // Check if user should be in experiment
        const hash = this.hashUser(userId, experimentName);
        if (hash >= experiment.targetPercentage) return null;

        // Assign variant based on weights
        const variant = this.selectVariant(experiment.variants, userId, experimentName);

        this.assignments.set(assignmentKey, {
            experimentName,
            variantName: variant,
            userId,
            assignedAt: new Date(),
        });

        this.emit('assigned', { experimentName, variantName: variant, userId });
        return variant;
    }

    private selectVariant(
        variants: Experiment['variants'],
        userId: string,
        experimentName: string
    ): string {
        const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
        const hash = this.hashUser(userId, `${experimentName}:variant`) % totalWeight;

        let cumulative = 0;
        for (const variant of variants) {
            cumulative += variant.weight;
            if (hash < cumulative) return variant.name;
        }

        return variants[variants.length - 1].name;
    }

    private hashUser(userId: string, seed: string): number {
        const hash = crypto.createHash('md5').update(`${userId}:${seed}`).digest('hex');
        return parseInt(hash.slice(0, 8), 16) % 100;
    }

    /**
     * Record a conversion for a metric
     */
    recordConversion(experimentName: string, variantName: string, metric: string): void {
        const experiment = this.experiments.get(experimentName);
        if (!experiment) return;

        const variantConversions = this.conversions.get(experimentName);
        if (!variantConversions) return;

        const key = `${variantName}:${metric}`;
        variantConversions.set(key, (variantConversions.get(key) ?? 0) + 1);

        this.emit('conversion', { experimentName, variantName, metric });
    }

    /**
     * Get experiment results
     */
    getResults(experimentName: string): Record<string, Record<string, number>> | null {
        const conversions = this.conversions.get(experimentName);
        if (!conversions) return null;

        const results: Record<string, Record<string, number>> = {};

        for (const [key, count] of conversions) {
            const [variant, metric] = key.split(':');
            if (!results[variant]) results[variant] = {};
            results[variant][metric] = count;
        }

        return results;
    }

    /**
     * Stop an experiment
     */
    stopExperiment(experimentName: string): void {
        const experiment = this.experiments.get(experimentName);
        if (experiment) {
            experiment.active = false;
            experiment.endDate = new Date();
            this.emit('stopped', { experimentName });
            Logger.info(`[ABTesting] Stopped experiment: ${experimentName}`);
        }
    }

    getAllExperiments(): Experiment[] {
        return Array.from(this.experiments.values());
    }
}

export const abTesting = new ABTestingManager();

// ============================================================================
// Exports
// ============================================================================

export {
    L1MemoryCache,
    MultiLevelCache,
    FeatureFlagManager,
    ABTestingManager,
};

export type {
    CacheLevel,
    FeatureFlag,
    FeatureFlagContext,
    Experiment,
    ExperimentAssignment,
};
