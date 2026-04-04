import { EventEmitter } from 'events';

// ─── Core Types ───────────────────────────────────────────────────────────────

export interface KnowledgeNode {
  id: string;
  content: string;
  embedding: number[];           // Dense vector representation
  metadata: Record<string, unknown>;
  shardId: number;
  connections: EdgeRef[];        // Outgoing edges
  createdAt: number;
  updatedAt: number;
}

export interface EdgeRef {
  targetId: string;
  weight: number;                // 0–1 edge weight / similarity
  label: string;                 // e.g. 'related_to', 'derived_from', 'contradicts'
}

export interface Shard {
  shardId: number;
  nodeIds: Set<string>;
  vectorIndex: Map<string, number[]>; // nodeId → embedding
}

export interface SearchResult {
  nodeId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  shardId: number;
}

export interface GraphTraversalResult {
  visited: string[];
  edges: Array<{ from: string; to: string; label: string; weight: number }>;
  depth: number;
}

export interface HybridSearchResult {
  semantic: SearchResult[];
  graph: GraphTraversalResult;
  merged: SearchResult[];        // De-duplicated, re-ranked
}

export interface QueryCacheEntry {
  key: string;
  results: SearchResult[];
  cachedAt: number;
  ttlMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SHARD_COUNT = 8;
const EMBEDDING_DIM = 384;          // Default embedding dimensionality
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 256;
const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

// ─── Math Utilities ──────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/** FNV-1a hash → shard bucket */
function fnv1aHash(id: string, buckets: number): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    // Force unsigned 32-bit multiplication
    hash = (Math.imul(hash, FNV_PRIME) >>> 0);
  }
  return hash % buckets;
}

// ─── DistributedKnowledgeGraph ────────────────────────────────────────────────

export class DistributedKnowledgeGraph extends EventEmitter {
  private readonly shardCount: number;
  private readonly shards = new Map<number, Shard>();
  private readonly nodes = new Map<string, KnowledgeNode>();
  private readonly queryCache = new Map<string, QueryCacheEntry>();

  constructor(shardCount: number = DEFAULT_SHARD_COUNT) {
    super();
    this.shardCount = shardCount;
    this.initializeShards();
  }

  private initializeShards(): void {
    for (let i = 0; i < this.shardCount; i++) {
      this.shards.set(i, {
        shardId: i,
        nodeIds: new Set(),
        vectorIndex: new Map(),
      });
    }
  }

  // ─── Insert / Update / Delete ──────────────────────────────────────────────

  insert(node: Omit<KnowledgeNode, 'shardId' | 'createdAt' | 'updatedAt'>): KnowledgeNode {
    const shardId = this.assignShard(node.id);
    const now = Date.now();

    const fullNode: KnowledgeNode = {
      ...node,
      embedding: this.normaliseEmbedding(node.embedding),
      shardId,
      createdAt: now,
      updatedAt: now,
    };

    this.nodes.set(node.id, fullNode);
    const shard = this.shards.get(shardId)!;
    shard.nodeIds.add(node.id);
    shard.vectorIndex.set(node.id, fullNode.embedding);

    this.invalidateCache();
    this.emit('node_inserted', { nodeId: node.id, shardId });
    return fullNode;
  }

  update(id: string, patch: Partial<Pick<KnowledgeNode, 'content' | 'embedding' | 'metadata' | 'connections'>>): KnowledgeNode | null {
    const existing = this.nodes.get(id);
    if (!existing) return null;

    const updated: KnowledgeNode = {
      ...existing,
      ...patch,
      embedding: patch.embedding ? this.normaliseEmbedding(patch.embedding) : existing.embedding,
      updatedAt: Date.now(),
    };

    this.nodes.set(id, updated);

    // Update shard vector index if embedding changed
    if (patch.embedding) {
      const shard = this.shards.get(existing.shardId)!;
      shard.vectorIndex.set(id, updated.embedding);
    }

    this.invalidateCache();
    this.emit('node_updated', { nodeId: id, shardId: existing.shardId });
    return updated;
  }

  delete(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    this.nodes.delete(id);
    const shard = this.shards.get(node.shardId)!;
    shard.nodeIds.delete(id);
    shard.vectorIndex.delete(id);

    // Remove dangling edges in other nodes
    for (const [, other] of this.nodes) {
      if (other.connections.some((e) => e.targetId === id)) {
        const patched = { ...other, connections: other.connections.filter((e) => e.targetId !== id) };
        this.nodes.set(other.id, patched);
      }
    }

    this.invalidateCache();
    this.emit('node_deleted', { nodeId: id, shardId: node.shardId });
    return true;
  }

  // ─── Semantic Search ──────────────────────────────────────────────────────

  semanticSearch(queryEmbedding: number[], topK: number, shardHint?: number[]): SearchResult[] {
    const cacheKey = this.cacheKey('semantic', queryEmbedding, topK, shardHint);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const normQuery = this.normaliseEmbedding(queryEmbedding);
    const targetShards = shardHint ?? [...this.shards.keys()];
    const allResults: SearchResult[] = [];

    // Fan-out query to relevant shards
    for (const shardId of targetShards) {
      const shard = this.shards.get(shardId);
      if (!shard) continue;

      const shardResults = this.searchShard(shard, normQuery, topK);
      allResults.push(...shardResults);
    }

    // Merge and re-rank
    allResults.sort((a, b) => b.score - a.score);
    const topResults = allResults.slice(0, topK);

    this.setCache(cacheKey, topResults);
    this.emit('semantic_search', { topK, shards: targetShards.length, results: topResults.length });
    return topResults;
  }

  private searchShard(shard: Shard, normQuery: number[], topK: number): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [nodeId, embedding] of shard.vectorIndex) {
      const score = cosineSimilarity(normQuery, embedding);
      if (score > 0) {
        const node = this.nodes.get(nodeId)!;
        results.push({
          nodeId,
          content: node.content,
          score,
          metadata: node.metadata,
          shardId: shard.shardId,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  // ─── Graph Traversal ──────────────────────────────────────────────────────

  graphTraversal(
    startId: string,
    maxDepth: number,
    mode: 'bfs' | 'dfs' = 'bfs',
    edgeFilter?: (edge: EdgeRef) => boolean,
  ): GraphTraversalResult {
    const visited: string[] = [];
    const edges: GraphTraversalResult['edges'] = [];
    const seen = new Set<string>();

    if (!this.nodes.has(startId)) {
      return { visited: [], edges: [], depth: 0 };
    }

    if (mode === 'bfs') {
      this.bfs(startId, maxDepth, seen, visited, edges, edgeFilter);
    } else {
      this.dfs(startId, maxDepth, 0, seen, visited, edges, edgeFilter);
    }

    return { visited, edges, depth: maxDepth };
  }

  private bfs(
    startId: string,
    maxDepth: number,
    seen: Set<string>,
    visited: string[],
    edges: GraphTraversalResult['edges'],
    edgeFilter?: (edge: EdgeRef) => boolean,
  ): void {
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    seen.add(startId);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      visited.push(id);
      if (depth >= maxDepth) continue;

      const node = this.nodes.get(id);
      if (!node) continue;

      for (const edge of node.connections) {
        if (!edgeFilter || edgeFilter(edge)) {
          edges.push({ from: id, to: edge.targetId, label: edge.label, weight: edge.weight });
          if (!seen.has(edge.targetId) && this.nodes.has(edge.targetId)) {
            seen.add(edge.targetId);
            queue.push({ id: edge.targetId, depth: depth + 1 });
          }
        }
      }
    }
  }

  private dfs(
    id: string,
    maxDepth: number,
    currentDepth: number,
    seen: Set<string>,
    visited: string[],
    edges: GraphTraversalResult['edges'],
    edgeFilter?: (edge: EdgeRef) => boolean,
  ): void {
    seen.add(id);
    visited.push(id);
    if (currentDepth >= maxDepth) return;

    const node = this.nodes.get(id);
    if (!node) return;

    for (const edge of node.connections) {
      if ((!edgeFilter || edgeFilter(edge)) && !seen.has(edge.targetId) && this.nodes.has(edge.targetId)) {
        edges.push({ from: id, to: edge.targetId, label: edge.label, weight: edge.weight });
        this.dfs(edge.targetId, maxDepth, currentDepth + 1, seen, visited, edges, edgeFilter);
      }
    }
  }

  // ─── Hybrid Search ────────────────────────────────────────────────────────

  hybridSearch(
    queryEmbedding: number[],
    startId: string,
    topK: number,
    traversalDepth = 2,
  ): HybridSearchResult {
    const semantic = this.semanticSearch(queryEmbedding, topK * 2);
    const graph = this.graphTraversal(startId, traversalDepth);

    // Merge: boost graph-adjacent nodes that also appear in semantic results
    const graphIds = new Set(graph.visited);
    const merged = semantic
      .map((r) => ({
        ...r,
        score: graphIds.has(r.nodeId) ? r.score * 1.25 : r.score, // graph-proximity boost
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    this.emit('hybrid_search', {
      semanticCount: semantic.length,
      graphVisited: graph.visited.length,
      mergedCount: merged.length,
    });

    return { semantic: semantic.slice(0, topK), graph, merged };
  }

  // ─── Edge Management ─────────────────────────────────────────────────────

  addEdge(fromId: string, edge: EdgeRef): boolean {
    const node = this.nodes.get(fromId);
    if (!node || !this.nodes.has(edge.targetId)) return false;

    // Avoid duplicate edges
    const exists = node.connections.some((e) => e.targetId === edge.targetId && e.label === edge.label);
    if (!exists) {
      node.connections.push(edge);
      node.updatedAt = Date.now();
    }
    return true;
  }

  removeEdge(fromId: string, toId: string, label?: string): boolean {
    const node = this.nodes.get(fromId);
    if (!node) return false;

    const before = node.connections.length;
    node.connections = node.connections.filter(
      (e) => !(e.targetId === toId && (label === undefined || e.label === label)),
    );
    return node.connections.length < before;
  }

  // ─── Shard Rebalancing ────────────────────────────────────────────────────

  rebalance(): { moved: number; shardLoads: Record<number, number> } {
    // Recompute shard assignments using consistent hashing
    let moved = 0;
    const all = [...this.nodes.values()];

    // Clear shard indices
    for (const shard of this.shards.values()) {
      shard.nodeIds.clear();
      shard.vectorIndex.clear();
    }

    for (const node of all) {
      const newShardId = this.assignShard(node.id);
      if (newShardId !== node.shardId) {
        node.shardId = newShardId;
        moved++;
      }
      const shard = this.shards.get(newShardId)!;
      shard.nodeIds.add(node.id);
      shard.vectorIndex.set(node.id, node.embedding);
    }

    this.invalidateCache();
    const shardLoads: Record<number, number> = {};
    for (const [id, shard] of this.shards) shardLoads[id] = shard.nodeIds.size;

    this.emit('rebalanced', { moved, shardLoads });
    return { moved, shardLoads };
  }

  // ─── Cache ───────────────────────────────────────────────────────────────

  private getFromCache(key: string): SearchResult[] | null {
    const entry = this.queryCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.queryCache.delete(key);
      return null;
    }
    return entry.results;
  }

  private setCache(key: string, results: SearchResult[]): void {
    if (this.queryCache.size >= CACHE_MAX_ENTRIES) {
      // Evict oldest
      const oldest = [...this.queryCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
      if (oldest) this.queryCache.delete(oldest[0]);
    }
    this.queryCache.set(key, { key, results, cachedAt: Date.now(), ttlMs: CACHE_TTL_MS });
  }

  private invalidateCache(): void {
    this.queryCache.clear();
  }

  private cacheKey(prefix: string, embedding: number[], topK: number, hint?: number[]): string {
    // Quantise embedding to 2 decimal places for cache key stability
    const quantised = embedding.slice(0, 16).map((v) => v.toFixed(2)).join(',');
    return `${prefix}:${quantised}:k=${topK}:shards=${hint?.join('-') ?? 'all'}`;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private assignShard(id: string): number {
    return fnv1aHash(id, this.shardCount);
  }

  private normaliseEmbedding(embedding: number[]): number[] {
    if (embedding.length === 0) return [];
    let norm = 0;
    for (const v of embedding) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return embedding.slice();
    return embedding.map((v) => v / norm);
  }

  // ─── Accessors ───────────────────────────────────────────────────────────

  getNode(id: string): KnowledgeNode | undefined {
    return this.nodes.get(id);
  }

  getShardStats(): Array<{ shardId: number; nodeCount: number }> {
    return [...this.shards.entries()].map(([shardId, shard]) => ({
      shardId,
      nodeCount: shard.nodeIds.size,
    }));
  }

  totalNodes(): number {
    return this.nodes.size;
  }

  totalEdges(): number {
    let count = 0;
    for (const node of this.nodes.values()) count += node.connections.length;
    return count;
  }

  /** Return a zero-vector of the expected embedding dimension */
  static zeroEmbedding(dim = EMBEDDING_DIM): number[] {
    return new Array(dim).fill(0);
  }

  /** Generate a deterministic pseudo-random unit vector for testing */
  static mockEmbedding(seed: string, dim = EMBEDDING_DIM): number[] {
    const vec: number[] = [];
    let h = FNV_OFFSET;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = (Math.imul(h, FNV_PRIME) >>> 0);
    }
    for (let i = 0; i < dim; i++) {
      h = (Math.imul(h ^ i, FNV_PRIME) >>> 0);
      vec.push((h / 0xffffffff) * 2 - 1);
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return vec.map((v) => v / norm);
  }
}
