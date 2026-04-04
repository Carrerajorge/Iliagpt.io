/**
 * ConversationMemoryGraph
 *
 * Builds an in-memory knowledge graph from the live conversation.
 *
 * Nodes  — entities: people, projects, files, concepts, URLs, dates
 * Edges  — typed relationships: works_on, depends_on, causes, solves,
 *           mentioned_with, references, contradicts
 *
 * The graph is updated after every user message and every assistant response.
 * Callers can query the graph for context enrichment and disambiguation.
 *
 * Persistence: graph state is serialised to a plain JSON Map per userId;
 * in production swap `persist()` / `load()` for a real store (Redis, DB).
 */

import { randomUUID }   from 'crypto';
import { Logger }       from '../lib/logger';
import { llmGateway }   from '../lib/llmGateway';

// ─── Graph types ──────────────────────────────────────────────────────────────

export type EntityType =
  | 'person' | 'project' | 'file' | 'concept' | 'url'
  | 'date' | 'organization' | 'technology' | 'error' | 'unknown';

export type RelationType =
  | 'works_on' | 'depends_on' | 'causes' | 'solves'
  | 'mentioned_with' | 'references' | 'contradicts' | 'related_to'
  | 'created_by' | 'part_of';

export interface GraphNode {
  id          : string;
  label       : string;          // Canonical name
  type        : EntityType;
  aliases     : string[];        // Alternative spellings / abbreviations
  firstSeenAt : number;          // Turn index
  lastSeenAt  : number;
  mentionCount: number;
  metadata    : Record<string, unknown>;
}

export interface GraphEdge {
  id       : string;
  fromId   : string;
  toId     : string;
  relation : RelationType;
  weight   : number;             // Increments with each co-mention
  firstSeen: number;
}

export interface GraphQuery {
  node?    : string;             // Label or alias to look up
  relation?: RelationType;
  maxDepth?: number;             // BFS depth for neighbours
}

export interface GraphQueryResult {
  node?      : GraphNode;
  neighbours : GraphNode[];
  edges      : GraphEdge[];
}

// ─── LLM entity extraction ────────────────────────────────────────────────────

interface ExtractedEntity {
  label   : string;
  type    : EntityType;
  aliases?: string[];
}

interface ExtractedRelation {
  from    : string;
  to      : string;
  relation: RelationType;
}

interface ExtractionResult {
  entities  : ExtractedEntity[];
  relations : ExtractedRelation[];
}

async function extractEntitiesAndRelations(
  text     : string,
  requestId: string,
  model    : string,
): Promise<ExtractionResult> {
  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `Extract entities and relationships from text.
Return JSON: {"entities":[{"label":"...","type":"person|project|file|concept|url|date|organization|technology|error|unknown","aliases":["..."]}],
"relations":[{"from":"entity_label","to":"entity_label","relation":"works_on|depends_on|causes|solves|mentioned_with|references|contradicts|related_to|created_by|part_of"}]}
Keep entities specific and meaningful. Skip pronouns and articles.`,
      },
      { role: 'user', content: text.slice(0, 1000) },
    ],
    { model, requestId, temperature: 0.1, maxTokens: 500 },
  );

  try {
    const match  = res.content.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as ExtractionResult : null;
    return parsed ?? { entities: [], relations: [] };
  } catch {
    return { entities: [], relations: [] };
  }
}

// ─── ConversationMemoryGraph ──────────────────────────────────────────────────

class ConversationMemoryGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  /** Map from lowercase label/alias → node id. */
  private readonly index = new Map<string, string>();

  private turnIndex = 0;

  // ── Node management ─────────────────────────────────────────────────────────

  private upsertNode(entity: ExtractedEntity): GraphNode {
    const key = entity.label.toLowerCase();
    const existingId = this.index.get(key);

    if (existingId) {
      const node = this.nodes.get(existingId)!;
      node.mentionCount++;
      node.lastSeenAt = this.turnIndex;
      for (const alias of (entity.aliases ?? [])) {
        node.aliases.push(alias);
        this.index.set(alias.toLowerCase(), node.id);
      }
      return node;
    }

    const node: GraphNode = {
      id          : randomUUID(),
      label       : entity.label,
      type        : entity.type,
      aliases     : entity.aliases ?? [],
      firstSeenAt : this.turnIndex,
      lastSeenAt  : this.turnIndex,
      mentionCount: 1,
      metadata    : {},
    };
    this.nodes.set(node.id, node);
    this.index.set(key, node.id);
    for (const alias of node.aliases) {
      this.index.set(alias.toLowerCase(), node.id);
    }
    return node;
  }

  private upsertEdge(fromId: string, toId: string, relation: RelationType): void {
    const key = `${fromId}:${relation}:${toId}`;
    const existing = this.edges.get(key);
    if (existing) {
      existing.weight++;
      return;
    }
    this.edges.set(key, {
      id      : randomUUID(),
      fromId,
      toId,
      relation,
      weight  : 1,
      firstSeen: this.turnIndex,
    });
  }

  private lookupNode(label: string): GraphNode | undefined {
    const id = this.index.get(label.toLowerCase());
    return id ? this.nodes.get(id) : undefined;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Process a new turn (user message or assistant response) and update the graph.
   */
  async processTurn(
    text     : string,
    role     : 'user' | 'assistant',
    opts     : { requestId?: string; model?: string } = {},
  ): Promise<{ nodesAdded: number; edgesAdded: number }> {
    const requestId = opts.requestId ?? randomUUID();
    const model     = opts.model     ?? 'auto';

    const { entities, relations } = await extractEntitiesAndRelations(
      text, `${requestId}-extract`, model,
    );

    const nodesBefore = this.nodes.size;
    const edgesBefore = this.edges.size;

    // Upsert all entities
    const upserted: GraphNode[] = [];
    for (const e of entities) {
      upserted.push(this.upsertNode(e));
    }

    // Add explicit relations
    for (const rel of relations) {
      const from = this.lookupNode(rel.from);
      const to   = this.lookupNode(rel.to);
      if (from && to) this.upsertEdge(from.id, to.id, rel.relation);
    }

    // Add co-mention edges for entities appearing in the same turn
    for (let i = 0; i < upserted.length; i++) {
      for (let j = i + 1; j < upserted.length; j++) {
        this.upsertEdge(upserted[i]!.id, upserted[j]!.id, 'mentioned_with');
      }
    }

    this.turnIndex++;

    const nodesAdded = this.nodes.size - nodesBefore;
    const edgesAdded = this.edges.size - edgesBefore;

    Logger.debug('[ConversationMemoryGraph] turn processed', {
      role, nodesAdded, edgesAdded, totalNodes: this.nodes.size,
    });

    return { nodesAdded, edgesAdded };
  }

  /**
   * Look up a node and its neighbours up to `maxDepth` hops.
   */
  query(input: GraphQuery): GraphQueryResult {
    const node = input.node ? this.lookupNode(input.node) : undefined;
    if (!node) return { neighbours: [], edges: [] };

    const depth     = input.maxDepth ?? 1;
    const visited   = new Set<string>([node.id]);
    const frontier  = [node.id];
    const resultEdges: GraphEdge[] = [];
    const resultNodes = new Map<string, GraphNode>();

    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const edge of this.edges.values()) {
          if (input.relation && edge.relation !== input.relation) continue;
          if (edge.fromId === id && !visited.has(edge.toId)) {
            visited.add(edge.toId);
            next.push(edge.toId);
            resultEdges.push(edge);
            const n = this.nodes.get(edge.toId);
            if (n) resultNodes.set(n.id, n);
          }
          if (edge.toId === id && !visited.has(edge.fromId)) {
            visited.add(edge.fromId);
            next.push(edge.fromId);
            resultEdges.push(edge);
            const n = this.nodes.get(edge.fromId);
            if (n) resultNodes.set(n.id, n);
          }
        }
      }
      frontier.length = 0;
      frontier.push(...next);
    }

    return {
      node,
      neighbours: [...resultNodes.values()],
      edges     : resultEdges,
    };
  }

  /**
   * Return the top N most-mentioned entities (useful for building context).
   */
  topEntities(n = 10, type?: EntityType): GraphNode[] {
    return [...this.nodes.values()]
      .filter(node => !type || node.type === type)
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, n);
  }

  /**
   * Build a compact context snippet for prompt injection.
   * "Known entities: UserAuth (project, 5 mentions), React (technology, 3 mentions)…"
   */
  buildContextSnippet(maxEntities = 8): string {
    const top = this.topEntities(maxEntities);
    if (top.length === 0) return '';
    const items = top.map(n => `${n.label} (${n.type}, ${n.mentionCount}×)`).join(', ');
    return `Known entities: ${items}.`;
  }

  /** Serialise graph state (for persistence). */
  serialise(): string {
    return JSON.stringify({
      nodes     : [...this.nodes.entries()],
      edges     : [...this.edges.entries()],
      index     : [...this.index.entries()],
      turnIndex : this.turnIndex,
    });
  }

  /** Restore graph state from serialised form. */
  deserialise(raw: string): void {
    const data = JSON.parse(raw) as {
      nodes: [string, GraphNode][];
      edges: [string, GraphEdge][];
      index: [string, string][];
      turnIndex: number;
    };
    this.nodes.clear();
    this.edges.clear();
    this.index.clear();
    data.nodes.forEach(([k, v]) => this.nodes.set(k, v));
    data.edges.forEach(([k, v]) => this.edges.set(k, v));
    data.index.forEach(([k, v]) => this.index.set(k, v));
    this.turnIndex = data.turnIndex;
  }

  get stats() {
    return { nodes: this.nodes.size, edges: this.edges.size, turns: this.turnIndex };
  }
}

// ─── Per-session graph store ──────────────────────────────────────────────────

class ConversationMemoryGraphStore {
  private readonly graphs = new Map<string, ConversationMemoryGraph>();

  for(sessionId: string): ConversationMemoryGraph {
    if (!this.graphs.has(sessionId)) {
      this.graphs.set(sessionId, new ConversationMemoryGraph());
    }
    return this.graphs.get(sessionId)!;
  }

  clear(sessionId: string): void { this.graphs.delete(sessionId); }
  activeSessions(): number       { return this.graphs.size; }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const memoryGraphStore = new ConversationMemoryGraphStore();

export { ConversationMemoryGraph };
