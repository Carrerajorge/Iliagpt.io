/**
 * connectorQueryPlanner.ts
 * ---------------------------------------------------------------------------
 * Query planning, caching, batching, and request deduplication for the
 * connector kernel.  Provides DAG-based dependency analysis with topological
 * sort, an LRU/LFU hybrid cache, connector-specific batch grouping, and
 * in-flight request deduplication via promise sharing.
 *
 * Standalone module — no imports from other kernel files.
 * All Map/Set iterators wrapped with Array.from().
 * ---------------------------------------------------------------------------
 */

import { createHash, randomUUID } from 'crypto';

/* ========================================================================= */
/*  TYPES & INTERFACES                                                       */
/* ========================================================================= */

export interface QueryStep {
  id: string;
  connectorId: string;
  operationId: string;
  params: Record<string, unknown>;
  dependsOn: string[];           // step IDs this step depends on
  priority: number;              // higher = execute sooner in same tier
  estimatedDurationMs: number;
  cacheable: boolean;
  cacheKeyOverride?: string;
  batchable: boolean;
  batchGroup?: string;
  metadata?: Record<string, unknown>;
}

export interface QueryPlan {
  id: string;
  steps: QueryStep[];
  executionTiers: string[][];    // topological tiers — steps in same tier run in parallel
  totalEstimatedMs: number;
  criticalPathMs: number;
  parallelism: number;           // max concurrent steps
  createdAt: number;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
  fromCache: boolean;
  fromBatch: boolean;
  executedAt: number;
}

export interface QueryPlanResult {
  planId: string;
  results: Map<string, StepResult>;
  totalDurationMs: number;
  cacheHits: number;
  cacheMisses: number;
  batchedSteps: number;
  deduplicatedSteps: number;
  success: boolean;
  failedSteps: string[];
}

export interface CostEstimation {
  totalSteps: number;
  parallelTiers: number;
  estimatedDurationMs: number;
  criticalPathMs: number;
  cacheableSteps: number;
  batchableSteps: number;
  estimatedCacheHitRate: number;
  estimatedSavingsMs: number;
}

export interface CacheStats {
  totalEntries: number;
  maxEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictionCount: number;
  totalSizeBytes: number;
  oldestEntryAge: number;
  newestEntryAge: number;
}

export interface ConnectorCacheStats {
  connectorId: string;
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface BatchGroup {
  groupId: string;
  connectorId: string;
  steps: QueryStep[];
  batchSize: number;
}

export interface BatchResult {
  groupId: string;
  connectorId: string;
  results: Map<string, unknown>;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface DeduplicationStats {
  totalRequests: number;
  deduplicatedCount: number;
  deduplicationRate: number;
  activeInFlight: number;
  expiredEntries: number;
}

/* ========================================================================= */
/*  QUERY PLANNER — DAG Analysis & Topological Sort                          */
/* ========================================================================= */

/**
 * Analyses a set of QuerySteps, builds a dependency DAG, performs
 * topological sort, identifies parallel execution tiers, and produces
 * a cost estimation.
 */
export class QueryPlanner {
  private planCount = 0;

  /**
   * Build a query plan from a set of steps.
   */
  buildPlan(steps: QueryStep[]): QueryPlan {
    this.planCount++;
    const id = `plan_${this.planCount}_${randomUUID().slice(0, 8)}`;

    // Validate: no duplicate IDs
    const idSet = new Set(steps.map((s) => s.id));
    if (idSet.size !== steps.length) {
      throw new Error('Duplicate step IDs detected');
    }

    // Validate: all dependencies exist
    for (const step of steps) {
      for (const dep of step.dependsOn) {
        if (!idSet.has(dep)) {
          throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
        }
      }
    }

    // Detect cycles
    this.detectCycles(steps);

    // Build topological tiers
    const tiers = this.topologicalTiers(steps);

    // Compute cost estimation
    const { totalEstimatedMs, criticalPathMs, parallelism } = this.estimateCost(steps, tiers);

    return {
      id,
      steps: [...steps],
      executionTiers: tiers,
      totalEstimatedMs,
      criticalPathMs,
      parallelism,
      createdAt: Date.now(),
    };
  }

  /**
   * Get a cost estimation without building a full plan.
   */
  estimatePlan(steps: QueryStep[], cacheHitRate: number = 0.3): CostEstimation {
    const tiers = this.topologicalTiers(steps);
    const { totalEstimatedMs, criticalPathMs, parallelism } = this.estimateCost(steps, tiers);

    const cacheableSteps = steps.filter((s) => s.cacheable).length;
    const batchableSteps = steps.filter((s) => s.batchable).length;
    const expectedCacheHits = Math.round(cacheableSteps * cacheHitRate);
    const avgStepDuration = steps.length > 0
      ? steps.reduce((sum, s) => sum + s.estimatedDurationMs, 0) / steps.length
      : 0;
    const estimatedSavingsMs = expectedCacheHits * avgStepDuration;

    return {
      totalSteps: steps.length,
      parallelTiers: tiers.length,
      estimatedDurationMs: totalEstimatedMs,
      criticalPathMs,
      cacheableSteps,
      batchableSteps,
      estimatedCacheHitRate: cacheHitRate,
      estimatedSavingsMs: Math.round(estimatedSavingsMs),
    };
  }

  /**
   * Extract the critical path (longest path) from the DAG.
   */
  getCriticalPath(steps: QueryStep[]): string[] {
    // Build adjacency list and in-degree
    const adj = new Map<string, string[]>();
    const stepMap = new Map<string, QueryStep>();
    for (const s of steps) {
      adj.set(s.id, []);
      stepMap.set(s.id, s);
    }
    for (const s of steps) {
      for (const dep of s.dependsOn) {
        const edges = adj.get(dep) ?? [];
        edges.push(s.id);
        adj.set(dep, edges);
      }
    }

    // Compute longest path using dynamic programming on topological order
    const sorted = this.topologicalSort(steps);
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();

    for (const id of sorted) {
      dist.set(id, stepMap.get(id)!.estimatedDurationMs);
      prev.set(id, null);
    }

    for (const id of sorted) {
      const currentDist = dist.get(id)!;
      const neighbors = adj.get(id) ?? [];
      for (const neighbor of neighbors) {
        const newDist = currentDist + stepMap.get(neighbor)!.estimatedDurationMs;
        if (newDist > (dist.get(neighbor) ?? 0)) {
          dist.set(neighbor, newDist);
          prev.set(neighbor, id);
        }
      }
    }

    // Find the node with the longest distance
    let maxDist = 0;
    let maxNode = sorted[0];
    for (const [id, d] of Array.from(dist.entries())) {
      if (d > maxDist) {
        maxDist = d;
        maxNode = id;
      }
    }

    // Trace back the path
    const path: string[] = [];
    let current: string | null = maxNode;
    while (current !== null) {
      path.unshift(current);
      current = prev.get(current) ?? null;
    }

    return path;
  }

  /**
   * Get total plans created.
   */
  getPlanCount(): number {
    return this.planCount;
  }

  /**
   * Find steps that have no dependents (leaf nodes).
   */
  getLeafSteps(steps: QueryStep[]): string[] {
    const hasDependents = new Set<string>();
    for (const s of steps) {
      for (const dep of s.dependsOn) {
        hasDependents.add(dep);
      }
    }
    return steps.filter((s) => !hasDependents.has(s.id)).map((s) => s.id);
  }

  /**
   * Find steps that have no dependencies (root nodes).
   */
  getRootSteps(steps: QueryStep[]): string[] {
    return steps.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
  }

  /**
   * Get the dependency depth (longest chain) for each step.
   */
  getStepDepths(steps: QueryStep[]): Map<string, number> {
    const depths = new Map<string, number>();
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    const computeDepth = (id: string, visited: Set<string>): number => {
      if (depths.has(id)) return depths.get(id)!;
      if (visited.has(id)) throw new Error(`Cycle detected at step "${id}"`);
      visited.add(id);

      const step = stepMap.get(id)!;
      if (step.dependsOn.length === 0) {
        depths.set(id, 0);
        return 0;
      }

      let maxDepth = 0;
      for (const dep of step.dependsOn) {
        const d = computeDepth(dep, visited);
        maxDepth = Math.max(maxDepth, d + 1);
      }

      depths.set(id, maxDepth);
      return maxDepth;
    };

    for (const s of steps) {
      computeDepth(s.id, new Set<string>());
    }

    return depths;
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  /**
   * Topological sort using Kahn's algorithm.
   */
  private topologicalSort(steps: QueryStep[]): string[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const s of steps) {
      inDegree.set(s.id, 0);
      adj.set(s.id, []);
    }

    for (const s of steps) {
      for (const dep of s.dependsOn) {
        const edges = adj.get(dep)!;
        edges.push(s.id);
        inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of Array.from(inDegree.entries())) {
      if (deg === 0) queue.push(id);
    }

    // Sort queue by priority (higher first)
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    queue.sort((a, b) => (stepMap.get(b)?.priority ?? 0) - (stepMap.get(a)?.priority ?? 0));

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const neighbor of adj.get(current) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
          queue.sort((a, b) => (stepMap.get(b)?.priority ?? 0) - (stepMap.get(a)?.priority ?? 0));
        }
      }
    }

    if (sorted.length !== steps.length) {
      throw new Error('Cycle detected in step dependencies');
    }

    return sorted;
  }

  /**
   * Group steps into tiers where all steps in the same tier can run in parallel.
   */
  private topologicalTiers(steps: QueryStep[]): string[][] {
    if (steps.length === 0) return [];

    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const s of steps) {
      inDegree.set(s.id, 0);
      adj.set(s.id, []);
    }

    for (const s of steps) {
      for (const dep of s.dependsOn) {
        const edges = adj.get(dep)!;
        edges.push(s.id);
        inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
      }
    }

    const tiers: string[][] = [];
    let currentTier = Array.from(inDegree.entries())
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);

    while (currentTier.length > 0) {
      // Sort by priority within tier
      const stepMap = new Map(steps.map((s) => [s.id, s]));
      currentTier.sort((a, b) => (stepMap.get(b)?.priority ?? 0) - (stepMap.get(a)?.priority ?? 0));
      tiers.push([...currentTier]);

      const nextTier: string[] = [];
      for (const id of currentTier) {
        for (const neighbor of adj.get(id) ?? []) {
          const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) {
            nextTier.push(neighbor);
          }
        }
      }

      currentTier = nextTier;
    }

    return tiers;
  }

  /**
   * Detect cycles using DFS.
   */
  private detectCycles(steps: QueryStep[]): void {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const s of steps) {
      color.set(s.id, WHITE);
      adj.set(s.id, []);
    }

    // Build forward adjacency from dependencies
    for (const s of steps) {
      for (const dep of s.dependsOn) {
        const edges = adj.get(dep) ?? [];
        edges.push(s.id);
        adj.set(dep, edges);
      }
    }

    const dfs = (id: string): void => {
      color.set(id, GRAY);
      for (const neighbor of adj.get(id) ?? []) {
        if (color.get(neighbor) === GRAY) {
          throw new Error(`Cycle detected: ${id} → ${neighbor}`);
        }
        if (color.get(neighbor) === WHITE) {
          dfs(neighbor);
        }
      }
      color.set(id, BLACK);
    };

    for (const s of steps) {
      if (color.get(s.id) === WHITE) {
        dfs(s.id);
      }
    }
  }

  /**
   * Estimate execution cost.
   */
  private estimateCost(
    steps: QueryStep[],
    tiers: string[][],
  ): { totalEstimatedMs: number; criticalPathMs: number; parallelism: number } {
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    // Total estimated = sum of all step durations (sequential)
    const totalEstimatedMs = steps.reduce((sum, s) => sum + s.estimatedDurationMs, 0);

    // Critical path = sum of max durations per tier
    let criticalPathMs = 0;
    for (const tier of tiers) {
      const maxInTier = Math.max(...tier.map((id) => stepMap.get(id)?.estimatedDurationMs ?? 0));
      criticalPathMs += maxInTier;
    }

    // Max parallelism = largest tier
    const parallelism = tiers.length > 0 ? Math.max(...tiers.map((t) => t.length)) : 0;

    return { totalEstimatedMs, criticalPathMs, parallelism };
  }
}

/* ========================================================================= */
/*  QUERY CACHE — LRU/LFU Hybrid                                            */
/* ========================================================================= */

interface CacheEntry {
  key: string;
  value: unknown;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  ttlMs: number;
  sizeBytes: number;
  connectorId: string;
  operationId: string;
}

/**
 * LRU/LFU hybrid cache with TTL, max 1000 entries, and size tracking.
 * Eviction: score = 0.7 * recency + 0.3 * frequency (lower = evict first).
 */
export class QueryCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;

  constructor(maxEntries: number = 1000, defaultTtlMs: number = 300_000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Generate a cache key for a step.
   */
  generateKey(step: QueryStep): string {
    if (step.cacheKeyOverride) return step.cacheKeyOverride;
    const payload = JSON.stringify({
      connectorId: step.connectorId,
      operationId: step.operationId,
      params: step.params,
    });
    return createHash('sha256').update(payload).digest('hex').slice(0, 32);
  }

  /**
   * Look up a cache entry.
   */
  get(key: string): unknown | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.missCount++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > entry.ttlMs) {
      this.entries.delete(key);
      this.missCount++;
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    entry.accessCount++;
    this.hitCount++;
    return entry.value;
  }

  /**
   * Store a value in the cache.
   */
  set(
    key: string,
    value: unknown,
    connectorId: string,
    operationId: string,
    ttlMs?: number,
  ): void {
    // Evict if at capacity
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.evictOne();
    }

    const sizeBytes = this.estimateSize(value);
    this.entries.set(key, {
      key,
      value,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
      ttlMs: ttlMs ?? this.defaultTtlMs,
      sizeBytes,
      connectorId,
      operationId,
    });
  }

  /**
   * Check if a key exists (without updating access stats).
   */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > entry.ttlMs) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Remove a specific entry.
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * Invalidate all entries for a connector.
   */
  invalidateConnector(connectorId: string): number {
    let count = 0;
    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (entry.connectorId === connectorId) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Invalidate entries matching a connector + operation.
   */
  invalidateOperation(connectorId: string, operationId: string): number {
    let count = 0;
    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (entry.connectorId === connectorId && entry.operationId === operationId) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Prune expired entries.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (now - entry.createdAt > entry.ttlMs) {
        this.entries.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const entries = Array.from(this.entries.values());
    const now = Date.now();
    const totalSize = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
    const ages = entries.map((e) => now - e.createdAt);

    return {
      totalEntries: this.entries.size,
      maxEntries: this.maxEntries,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: (this.hitCount + this.missCount) > 0
        ? this.hitCount / (this.hitCount + this.missCount)
        : 0,
      evictionCount: this.evictionCount,
      totalSizeBytes: totalSize,
      oldestEntryAge: ages.length > 0 ? Math.max(...ages) : 0,
      newestEntryAge: ages.length > 0 ? Math.min(...ages) : 0,
    };
  }

  /**
   * Get per-connector cache statistics.
   */
  getConnectorStats(): ConnectorCacheStats[] {
    const grouped = new Map<string, { entries: number; hits: number; misses: number }>();

    for (const [, entry] of Array.from(this.entries.entries())) {
      const stat = grouped.get(entry.connectorId) ?? { entries: 0, hits: 0, misses: 0 };
      stat.entries++;
      grouped.set(entry.connectorId, stat);
    }

    return Array.from(grouped.entries()).map(([connectorId, stat]) => ({
      connectorId,
      entries: stat.entries,
      hits: stat.hits,
      misses: stat.misses,
      hitRate: (stat.hits + stat.misses) > 0 ? stat.hits / (stat.hits + stat.misses) : 0,
    }));
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }

  /**
   * Get current entry count.
   */
  size(): number {
    return this.entries.size;
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  /**
   * Evict one entry using LRU/LFU hybrid scoring.
   * Score = 0.7 * recencyScore + 0.3 * frequencyScore
   * Lower score = evicted first.
   */
  private evictOne(): void {
    if (this.entries.size === 0) return;

    const now = Date.now();
    const entries = Array.from(this.entries.values());

    // Compute max access count for normalization
    const maxAccessCount = Math.max(1, ...entries.map((e) => e.accessCount));
    // Compute max age for normalization
    const maxAge = Math.max(1, ...entries.map((e) => now - e.lastAccessedAt));

    let lowestScore = Infinity;
    let evictKey: string | null = null;

    for (const entry of entries) {
      const age = now - entry.lastAccessedAt;
      const recencyScore = 1 - (age / maxAge); // higher = more recent
      const frequencyScore = entry.accessCount / maxAccessCount; // higher = more accessed
      const score = 0.7 * recencyScore + 0.3 * frequencyScore;

      if (score < lowestScore) {
        lowestScore = score;
        evictKey = entry.key;
      }
    }

    if (evictKey) {
      this.entries.delete(evictKey);
      this.evictionCount++;
    }
  }

  /**
   * Rough size estimation (JSON serialization length as proxy).
   */
  private estimateSize(value: unknown): number {
    try {
      return JSON.stringify(value).length * 2; // UTF-16 chars ≈ 2 bytes each
    } catch {
      return 1024; // fallback
    }
  }
}

/* ========================================================================= */
/*  BATCH OPTIMIZER                                                          */
/* ========================================================================= */

/**
 * Groups batchable steps by connector and batch group, determines optimal
 * batch sizes, and provides a batch execution framework.
 */
export class BatchOptimizer {
  /** connectorId → max batch size */
  private readonly connectorMaxBatch = new Map<string, number>();
  /** Default max batch size */
  private readonly defaultMaxBatch = 50;
  /** Total batches created */
  private batchCount = 0;
  /** Total items batched */
  private itemsBatched = 0;

  /**
   * Set the maximum batch size for a connector.
   */
  setMaxBatchSize(connectorId: string, maxSize: number): void {
    this.connectorMaxBatch.set(connectorId, Math.max(1, maxSize));
  }

  /**
   * Get the max batch size for a connector.
   */
  getMaxBatchSize(connectorId: string): number {
    return this.connectorMaxBatch.get(connectorId) ?? this.defaultMaxBatch;
  }

  /**
   * Group batchable steps into batch groups.
   */
  createBatchGroups(steps: QueryStep[]): BatchGroup[] {
    const batchableSteps = steps.filter((s) => s.batchable);
    if (batchableSteps.length === 0) return [];

    // Group by connectorId + batchGroup (or operationId if no batchGroup)
    const grouped = new Map<string, QueryStep[]>();
    for (const step of batchableSteps) {
      const groupKey = `${step.connectorId}:${step.batchGroup ?? step.operationId}`;
      const existing = grouped.get(groupKey) ?? [];
      existing.push(step);
      grouped.set(groupKey, existing);
    }

    const result: BatchGroup[] = [];
    for (const [, groupSteps] of Array.from(grouped.entries())) {
      if (groupSteps.length < 2) continue; // Not worth batching single items

      const connectorId = groupSteps[0].connectorId;
      const maxBatch = this.getMaxBatchSize(connectorId);

      // Split into chunks of maxBatch
      for (let i = 0; i < groupSteps.length; i += maxBatch) {
        const chunk = groupSteps.slice(i, i + maxBatch);
        this.batchCount++;
        this.itemsBatched += chunk.length;

        result.push({
          groupId: `batch_${this.batchCount}`,
          connectorId,
          steps: chunk,
          batchSize: chunk.length,
        });
      }
    }

    return result;
  }

  /**
   * Determine the optimal batch size based on historical performance.
   * Uses a simple heuristic: start with max batch size, reduce if error rate is high.
   */
  computeOptimalBatchSize(
    connectorId: string,
    historicalResults: BatchResult[],
  ): number {
    const max = this.getMaxBatchSize(connectorId);
    if (historicalResults.length === 0) return max;

    const connectorResults = historicalResults.filter((r) => r.connectorId === connectorId);
    if (connectorResults.length === 0) return max;

    const successRate = connectorResults.filter((r) => r.success).length / connectorResults.length;

    // If success rate is high (>95%), use max
    if (successRate > 0.95) return max;
    // If moderate (>80%), use 75% of max
    if (successRate > 0.80) return Math.max(1, Math.floor(max * 0.75));
    // If low (>50%), use 50% of max
    if (successRate > 0.50) return Math.max(1, Math.floor(max * 0.5));
    // Very low: use small batches
    return Math.max(1, Math.floor(max * 0.25));
  }

  /**
   * Get batch statistics.
   */
  getStats(): { totalBatches: number; totalItemsBatched: number } {
    return {
      totalBatches: this.batchCount,
      totalItemsBatched: this.itemsBatched,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.batchCount = 0;
    this.itemsBatched = 0;
  }

  /**
   * Get all configured connectors.
   */
  getConfiguredConnectors(): string[] {
    return Array.from(this.connectorMaxBatch.keys());
  }

  /**
   * Clear all configuration.
   */
  clear(): void {
    this.connectorMaxBatch.clear();
    this.batchCount = 0;
    this.itemsBatched = 0;
  }
}

/* ========================================================================= */
/*  REQUEST DEDUPLICATOR                                                     */
/* ========================================================================= */

interface InFlightEntry {
  key: string;
  promise: Promise<unknown>;
  createdAt: number;
  expiresAt: number;
  refCount: number;
}

/**
 * Deduplicates in-flight requests using promise sharing.
 * If two steps have the same dedup key, the second one shares the
 * first one's promise instead of making a duplicate request.
 * Entries expire after 30 seconds.
 */
export class RequestDeduplicator {
  private readonly inFlight = new Map<string, InFlightEntry>();
  private readonly defaultExpiryMs = 30_000;
  private totalRequests = 0;
  private deduplicatedCount = 0;
  private expiredCount = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodic cleanup of expired entries
    this.cleanupTimer = setInterval(() => this.cleanup(), 10_000);
    // Allow Node to exit even if timer is active
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Generate a dedup key for a step.
   */
  generateKey(step: QueryStep): string {
    const payload = JSON.stringify({
      connectorId: step.connectorId,
      operationId: step.operationId,
      params: step.params,
    });
    return `dedup_${createHash('md5').update(payload).digest('hex')}`;
  }

  /**
   * Execute a function with deduplication. If the same key is already
   * in-flight, return the existing promise.
   */
  async deduplicate<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Check for existing in-flight request
    const existing = this.inFlight.get(key);
    if (existing && Date.now() < existing.expiresAt) {
      this.deduplicatedCount++;
      existing.refCount++;
      return existing.promise as Promise<T>;
    }

    // Remove expired entry if exists
    if (existing) {
      this.inFlight.delete(key);
    }

    // Create new in-flight entry
    const promise = fn().finally(() => {
      // Remove from in-flight after completion
      const entry = this.inFlight.get(key);
      if (entry && entry.promise === promise) {
        this.inFlight.delete(key);
      }
    });

    this.inFlight.set(key, {
      key,
      promise,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.defaultExpiryMs,
      refCount: 1,
    });

    return promise as Promise<T>;
  }

  /**
   * Check if a key is currently in-flight.
   */
  isInFlight(key: string): boolean {
    const entry = this.inFlight.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) {
      this.inFlight.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get deduplication statistics.
   */
  getStats(): DeduplicationStats {
    return {
      totalRequests: this.totalRequests,
      deduplicatedCount: this.deduplicatedCount,
      deduplicationRate:
        this.totalRequests > 0 ? this.deduplicatedCount / this.totalRequests : 0,
      activeInFlight: this.inFlight.size,
      expiredEntries: this.expiredCount,
    };
  }

  /**
   * Get all in-flight keys.
   */
  getInFlightKeys(): string[] {
    return Array.from(this.inFlight.keys());
  }

  /**
   * Force-cancel all in-flight entries.
   */
  cancelAll(): void {
    this.inFlight.clear();
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.totalRequests = 0;
    this.deduplicatedCount = 0;
    this.expiredCount = 0;
  }

  /**
   * Destroy the deduplicator (clear timer).
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.inFlight.clear();
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.inFlight.entries())) {
      if (now >= entry.expiresAt) {
        this.inFlight.delete(key);
        this.expiredCount++;
      }
    }
  }
}

/* ========================================================================= */
/*  EXECUTION OPTIMIZER — Unified Orchestrator                               */
/* ========================================================================= */

export interface ExecutionCallbacks {
  executeStep: (step: QueryStep, batchPeers?: QueryStep[]) => Promise<unknown>;
  onStepComplete?: (result: StepResult) => void;
  onPlanComplete?: (result: QueryPlanResult) => void;
}

/**
 * Orchestrates query planning, caching, batching, and deduplication into
 * a single execute() call.
 */
export class ExecutionOptimizer {
  private readonly planner: QueryPlanner;
  private readonly cache: QueryCache;
  private readonly batchOptimizer: BatchOptimizer;
  private readonly deduplicator: RequestDeduplicator;
  private executionCount = 0;

  constructor(
    planner?: QueryPlanner,
    cache?: QueryCache,
    batchOptimizer?: BatchOptimizer,
    deduplicator?: RequestDeduplicator,
  ) {
    this.planner = planner ?? new QueryPlanner();
    this.cache = cache ?? new QueryCache();
    this.batchOptimizer = batchOptimizer ?? new BatchOptimizer();
    this.deduplicator = deduplicator ?? new RequestDeduplicator();
  }

  /**
   * Execute a set of steps with full optimization.
   */
  async execute(steps: QueryStep[], callbacks: ExecutionCallbacks): Promise<QueryPlanResult> {
    this.executionCount++;
    const startTime = Date.now();

    // Build plan
    const plan = this.planner.buildPlan(steps);

    const results = new Map<string, StepResult>();
    let cacheHits = 0;
    let cacheMisses = 0;
    let batchedSteps = 0;
    let deduplicatedSteps = 0;
    const failedSteps: string[] = [];

    // Execute tier by tier
    for (const tier of plan.executionTiers) {
      // Identify batch groups in this tier
      const tierSteps = tier.map((id) => steps.find((s) => s.id === id)!);
      const batchGroups = this.batchOptimizer.createBatchGroups(tierSteps);
      const batchedStepIds = new Set<string>();
      for (const bg of batchGroups) {
        for (const s of bg.steps) {
          batchedStepIds.add(s.id);
        }
      }
      batchedSteps += batchedStepIds.size;

      // Execute non-batched steps in parallel
      const nonBatchedSteps = tierSteps.filter((s) => !batchedStepIds.has(s.id));

      const tierPromises: Promise<void>[] = [];

      // Non-batched step execution
      for (const step of nonBatchedSteps) {
        tierPromises.push(
          (async () => {
            const stepStart = Date.now();

            // Check cache first
            if (step.cacheable) {
              const cacheKey = this.cache.generateKey(step);
              const cached = this.cache.get(cacheKey);
              if (cached !== undefined) {
                cacheHits++;
                const result: StepResult = {
                  stepId: step.id,
                  success: true,
                  data: cached,
                  durationMs: Date.now() - stepStart,
                  fromCache: true,
                  fromBatch: false,
                  executedAt: Date.now(),
                };
                results.set(step.id, result);
                callbacks.onStepComplete?.(result);
                return;
              }
              cacheMisses++;
            }

            // Deduplication
            const dedupKey = this.deduplicator.generateKey(step);
            const isDedup = this.deduplicator.isInFlight(dedupKey);

            try {
              const data = await this.deduplicator.deduplicate(dedupKey, () =>
                callbacks.executeStep(step),
              );

              if (isDedup) deduplicatedSteps++;

              // Store in cache if cacheable
              if (step.cacheable) {
                const cacheKey = this.cache.generateKey(step);
                this.cache.set(cacheKey, data, step.connectorId, step.operationId);
              }

              const result: StepResult = {
                stepId: step.id,
                success: true,
                data,
                durationMs: Date.now() - stepStart,
                fromCache: false,
                fromBatch: false,
                executedAt: Date.now(),
              };
              results.set(step.id, result);
              callbacks.onStepComplete?.(result);
            } catch (err: unknown) {
              const result: StepResult = {
                stepId: step.id,
                success: false,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - stepStart,
                fromCache: false,
                fromBatch: false,
                executedAt: Date.now(),
              };
              results.set(step.id, result);
              failedSteps.push(step.id);
              callbacks.onStepComplete?.(result);
            }
          })(),
        );
      }

      // Batch step execution
      for (const batchGroup of batchGroups) {
        tierPromises.push(
          (async () => {
            const batchStart = Date.now();
            try {
              // Execute the first step in the batch, passing peers for batch info
              const data = await callbacks.executeStep(batchGroup.steps[0], batchGroup.steps);
              const batchResults = data as Record<string, unknown> | undefined;

              for (const step of batchGroup.steps) {
                const stepData = batchResults?.[step.id] ?? data;
                const result: StepResult = {
                  stepId: step.id,
                  success: true,
                  data: stepData,
                  durationMs: Date.now() - batchStart,
                  fromCache: false,
                  fromBatch: true,
                  executedAt: Date.now(),
                };
                results.set(step.id, result);

                // Cache individual results
                if (step.cacheable) {
                  const cacheKey = this.cache.generateKey(step);
                  this.cache.set(cacheKey, stepData, step.connectorId, step.operationId);
                }

                callbacks.onStepComplete?.(result);
              }
            } catch (err: unknown) {
              for (const step of batchGroup.steps) {
                const result: StepResult = {
                  stepId: step.id,
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                  durationMs: Date.now() - batchStart,
                  fromCache: false,
                  fromBatch: true,
                  executedAt: Date.now(),
                };
                results.set(step.id, result);
                failedSteps.push(step.id);
                callbacks.onStepComplete?.(result);
              }
            }
          })(),
        );
      }

      // Wait for all steps in this tier to complete
      await Promise.all(tierPromises);
    }

    const planResult: QueryPlanResult = {
      planId: plan.id,
      results,
      totalDurationMs: Date.now() - startTime,
      cacheHits,
      cacheMisses,
      batchedSteps,
      deduplicatedSteps,
      success: failedSteps.length === 0,
      failedSteps,
    };

    callbacks.onPlanComplete?.(planResult);
    return planResult;
  }

  /**
   * Get component references.
   */
  getComponents(): {
    planner: QueryPlanner;
    cache: QueryCache;
    batchOptimizer: BatchOptimizer;
    deduplicator: RequestDeduplicator;
  } {
    return {
      planner: this.planner,
      cache: this.cache,
      batchOptimizer: this.batchOptimizer,
      deduplicator: this.deduplicator,
    };
  }

  /**
   * Get execution count.
   */
  getExecutionCount(): number {
    return this.executionCount;
  }

  /**
   * Get aggregated statistics from all components.
   */
  getStats(): {
    executions: number;
    plans: number;
    cache: CacheStats;
    batches: { totalBatches: number; totalItemsBatched: number };
    dedup: DeduplicationStats;
  } {
    return {
      executions: this.executionCount,
      plans: this.planner.getPlanCount(),
      cache: this.cache.getStats(),
      batches: this.batchOptimizer.getStats(),
      dedup: this.deduplicator.getStats(),
    };
  }

  /**
   * Invalidate cache for a connector.
   */
  invalidateCache(connectorId: string): number {
    return this.cache.invalidateConnector(connectorId);
  }

  /**
   * Clear all state.
   */
  clearAll(): void {
    this.cache.clear();
    this.batchOptimizer.resetStats();
    this.deduplicator.cancelAll();
    this.deduplicator.resetStats();
  }

  /**
   * Destroy (clean up timers).
   */
  destroy(): void {
    this.deduplicator.destroy();
  }
}

/* ========================================================================= */
/*  SINGLETON EXPORTS                                                        */
/* ========================================================================= */

export const executionOptimizer = new ExecutionOptimizer();

// Also export individual classes for custom instantiation
export { QueryPlanner as QueryPlannerClass };
export { QueryCache as QueryCacheClass };
export { BatchOptimizer as BatchOptimizerClass };
export { RequestDeduplicator as RequestDeduplicatorClass };
