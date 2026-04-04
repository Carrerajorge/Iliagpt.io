import pino from 'pino';

const logger = pino({ name: 'DistributedKnowledgeGraph', level: process.env.LOG_LEVEL ?? 'info' });

export interface KnowledgeNode {
  id: string;
  type: 'concept' | 'entity' | 'relation' | 'fact';
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  nodeId: string; // which mesh node owns this shard
  version: number;
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  weight: number;
  metadata: Record<string, unknown>;
}

interface RemoteShardClient {
  nodeId: string;
  nodeUrl: string;
  addNode: (node: KnowledgeNode) => Promise<void>;
  getNode: (id: string) => Promise<KnowledgeNode | null>;
}

const SHARD_HASH_BUCKETS = 64;

export class DistributedKnowledgeGraph {
  public localNodes: Map<string, KnowledgeNode> = new Map();
  private localEdges: Map<string, KnowledgeEdge> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map(); // nodeId -> Set<nodeId>

  private readonly meshNodeId: string;
  private remoteShards: Map<string, RemoteShardClient> = new Map(); // shardOwner -> client

  constructor(meshNodeId: string) {
    this.meshNodeId = meshNodeId;
    logger.info({ meshNodeId }, 'DistributedKnowledgeGraph initialized');
  }

  registerShard(nodeId: string, nodeUrl: string): void {
    this.remoteShards.set(nodeId, {
      nodeId,
      nodeUrl,
      addNode: async (node: KnowledgeNode) => {
        const response = await fetch(`${nodeUrl}/kg/nodes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(node),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`Remote addNode failed: ${response.status}`);
      },
      getNode: async (id: string) => {
        const response = await fetch(`${nodeUrl}/kg/nodes/${encodeURIComponent(id)}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Remote getNode failed: ${response.status}`);
        return response.json() as Promise<KnowledgeNode>;
      },
    });
    logger.info({ shardNodeId: nodeId, nodeUrl }, 'Remote shard registered');
  }

  shardKey(id: string): string {
    // Consistent hash: FNV-1a inspired, maps id -> bucket -> node
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    const bucket = hash % SHARD_HASH_BUCKETS;

    // Map bucket to a known shard node. If only local node is known, always local.
    const allShards = [this.meshNodeId, ...Array.from(this.remoteShards.keys())].sort();
    const ownerIndex = bucket % allShards.length;
    return allShards[ownerIndex];
  }

  async addNode(node: KnowledgeNode): Promise<void> {
    const owner = this.shardKey(node.id);

    if (owner === this.meshNodeId) {
      const existing = this.localNodes.get(node.id);
      if (!existing || node.version > existing.version) {
        this.localNodes.set(node.id, { ...node, nodeId: this.meshNodeId });
        logger.debug({ id: node.id, type: node.type, version: node.version }, 'KnowledgeNode stored locally');
      } else {
        logger.debug({ id: node.id, existingVersion: existing.version, incomingVersion: node.version }, 'Skipped stale node (version conflict)');
      }
      return;
    }

    const shard = this.remoteShards.get(owner);
    if (!shard) {
      // Partition tolerance: fall back to local storage
      logger.warn({ id: node.id, owner }, 'Shard unavailable, storing node locally as fallback');
      this.localNodes.set(node.id, { ...node, nodeId: this.meshNodeId });
      return;
    }

    try {
      await shard.addNode({ ...node, nodeId: owner });
      logger.debug({ id: node.id, owner }, 'KnowledgeNode stored on remote shard');
    } catch (err) {
      logger.warn({ id: node.id, owner, err }, 'Remote shard write failed, falling back to local storage');
      this.localNodes.set(node.id, { ...node, nodeId: this.meshNodeId });
    }
  }

  async getNode(id: string): Promise<KnowledgeNode | null> {
    // Check local first for speed
    const local = this.localNodes.get(id);
    if (local) return local;

    const owner = this.shardKey(id);
    if (owner === this.meshNodeId) return null;

    const shard = this.remoteShards.get(owner);
    if (!shard) {
      logger.warn({ id, owner }, 'Shard unavailable for getNode, returning null');
      return null;
    }

    try {
      return await shard.getNode(id);
    } catch (err) {
      logger.warn({ id, owner, err }, 'Remote getNode failed, falling back to local search');
      return this.localNodes.get(id) ?? null;
    }
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private simpleEmbedding(text: string): number[] {
    // Deterministic character-frequency embedding (128-dim) for local similarity search
    // when no real embedding is available.
    const vec = new Array<number>(128).fill(0);
    const normalized = text.toLowerCase();
    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.charCodeAt(i) % 128;
      vec[code] += 1;
    }
    // L2 normalize
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? vec.map((v) => v / norm) : vec;
  }

  async query(text: string, limit = 10): Promise<KnowledgeNode[]> {
    const queryEmbedding = this.simpleEmbedding(text);
    const queryTerms = text.toLowerCase().split(/\s+/);

    const scored: { node: KnowledgeNode; score: number }[] = [];

    for (const node of this.localNodes.values()) {
      let score: number;

      if (node.embedding && node.embedding.length > 0) {
        // Use real embedding if available
        score = this.cosineSimilarity(queryEmbedding, node.embedding);
      } else {
        // Fall back to character-frequency similarity
        const nodeEmbedding = this.simpleEmbedding(node.content);
        score = this.cosineSimilarity(queryEmbedding, nodeEmbedding);

        // Boost for exact term matches
        const contentLower = node.content.toLowerCase();
        const termBoost = queryTerms.filter((t) => contentLower.includes(t)).length / queryTerms.length;
        score = score * 0.6 + termBoost * 0.4;
      }

      scored.push({ node, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit).map((s) => s.node);

    logger.debug({ query: text, results: results.length, limit }, 'KnowledgeGraph query executed');
    return results;
  }

  async addEdge(edge: KnowledgeEdge): Promise<void> {
    this.localEdges.set(edge.id, edge);

    // Update adjacency list
    if (!this.adjacencyList.has(edge.from)) this.adjacencyList.set(edge.from, new Set());
    if (!this.adjacencyList.has(edge.to)) this.adjacencyList.set(edge.to, new Set());
    this.adjacencyList.get(edge.from)!.add(edge.to);

    logger.debug({ edgeId: edge.id, from: edge.from, to: edge.to, relation: edge.relation }, 'KnowledgeEdge added');
  }

  async traverse(fromId: string, maxDepth = 3): Promise<KnowledgeNode[]> {
    const visited = new Set<string>();
    const results: KnowledgeNode[] = [];

    const dfs = async (currentId: string, depth: number): Promise<void> => {
      if (depth > maxDepth || visited.has(currentId)) return;
      visited.add(currentId);

      const node = await this.getNode(currentId);
      if (node) results.push(node);

      const neighbors = this.adjacencyList.get(currentId);
      if (!neighbors) return;

      for (const neighborId of neighbors) {
        await dfs(neighborId, depth + 1);
      }
    };

    await dfs(fromId, 0);
    logger.debug({ fromId, maxDepth, visited: visited.size, found: results.length }, 'Graph traversal complete');
    return results;
  }

  merge(remoteNodes: KnowledgeNode[]): void {
    let updated = 0;
    let skipped = 0;

    for (const remoteNode of remoteNodes) {
      const existing = this.localNodes.get(remoteNode.id);

      // Last-write-wins by version number
      if (!existing || remoteNode.version > existing.version) {
        this.localNodes.set(remoteNode.id, remoteNode);
        updated++;
      } else {
        skipped++;
      }
    }

    logger.info({ updated, skipped, total: remoteNodes.length }, 'KnowledgeGraph merge complete');
  }

  getLocalStats(): {
    nodeCount: number;
    edgeCount: number;
    typeBreakdown: Record<string, number>;
    meshNodeId: string;
  } {
    const typeBreakdown: Record<string, number> = {};

    for (const node of this.localNodes.values()) {
      typeBreakdown[node.type] = (typeBreakdown[node.type] ?? 0) + 1;
    }

    return {
      nodeCount: this.localNodes.size,
      edgeCount: this.localEdges.size,
      typeBreakdown,
      meshNodeId: this.meshNodeId,
    };
  }

  getEdgesFrom(nodeId: string): KnowledgeEdge[] {
    return Array.from(this.localEdges.values()).filter((e) => e.from === nodeId);
  }

  getEdgesTo(nodeId: string): KnowledgeEdge[] {
    return Array.from(this.localEdges.values()).filter((e) => e.to === nodeId);
  }

  exportLocalShard(): KnowledgeNode[] {
    return Array.from(this.localNodes.values());
  }
}
