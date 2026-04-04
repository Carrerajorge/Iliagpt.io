/**
 * ConversationMemoryGraph — real-time knowledge graph built from conversation.
 * Nodes: named entities (people, places, concepts, technologies).
 * Edges: typed relationships extracted by LLM.
 * Persists per-user via pgVectorMemoryStore. Queryable by entity or relationship.
 */

import { EventEmitter } from "events";
import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";

const logger = createLogger("ConversationMemoryGraph");

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityType = "person" | "organization" | "place" | "technology" | "concept" | "event" | "product" | "unknown";

export interface GraphNode {
  id: string;
  label: string;                        // normalized entity name
  type: EntityType;
  aliases: string[];                    // alternative mentions
  mentions: number;
  firstSeen: Date;
  lastSeen: Date;
  attributes: Record<string, string>;   // key facts about this entity
  conversationIds: string[];
}

export type RelationshipType =
  | "is_a" | "part_of" | "created_by" | "uses" | "related_to"
  | "works_at" | "located_in" | "opposed_to" | "depends_on"
  | "caused_by" | "leads_to" | "similar_to" | "mentioned_with";

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: RelationshipType;
  confidence: number;                   // 0.0-1.0
  evidence: string;                     // sentence that established this
  createdAt: Date;
}

export interface GraphQueryResult {
  entity: GraphNode;
  related: Array<{
    node: GraphNode;
    edge: GraphEdge;
    direction: "outgoing" | "incoming";
  }>;
  facts: string[];
}

export interface ExtractionResult {
  entities: Array<{ label: string; type: EntityType; attributes?: Record<string, string> }>;
  relationships: Array<{ source: string; target: string; relationship: RelationshipType; confidence: number; evidence: string }>;
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeLabel(label: string): string {
  return label.toLowerCase().trim().replace(/\s+/g, " ");
}

function makeNodeId(label: string): string {
  return `node_${normalizeLabel(label).replace(/[^a-z0-9]/g, "_")}`;
}

function makeEdgeId(sourceId: string, targetId: string, rel: string): string {
  return `edge_${sourceId}_${rel}_${targetId}`;
}

// ─── LLM Extraction ───────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function extractFromText(text: string): Promise<ExtractionResult> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Extract entities and relationships from this text for a knowledge graph.

Text: "${text.slice(0, 2000)}"

Return JSON only:
{
  "entities": [{"label": "string", "type": "person|organization|place|technology|concept|event|product|unknown", "attributes": {"key": "value"}}],
  "relationships": [{"source": "entity_label", "target": "entity_label", "relationship": "is_a|part_of|created_by|uses|related_to|works_at|located_in|opposed_to|depends_on|caused_by|leads_to|similar_to|mentioned_with", "confidence": 0.0-1.0, "evidence": "sentence"}]
}

Only include entities mentioned explicitly. Skip pronouns and generic nouns.`,
        },
      ],
    });

    const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as ExtractionResult;

    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
    };
  } catch (err) {
    logger.warn(`Entity extraction failed: ${(err as Error).message}`);
    return { entities: [], relationships: [] };
  }
}

// Heuristic fallback: regex-based entity detection
function extractEntitiesHeuristic(text: string): Array<{ label: string; type: EntityType }> {
  const entities: Array<{ label: string; type: EntityType }> = [];

  // Capitalized multi-word phrases (likely named entities)
  const namedEntityPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
  for (const match of text.matchAll(namedEntityPattern)) {
    const label = match[1]!;
    if (label.split(" ").length === 1 && label.length < 4) continue; // skip short single words

    let type: EntityType = "unknown";
    if (/\b(Inc|Corp|Ltd|LLC|Company|University|Institute|Foundation)\b/.test(label)) type = "organization";
    else if (/\b(City|Country|Street|Avenue|Mountain|River|Lake)\b/.test(label)) type = "place";

    entities.push({ label, type });
  }

  // Technology keywords
  const techPattern = /\b(React|Node\.?js|Python|TypeScript|JavaScript|PostgreSQL|Redis|Docker|Kubernetes|AWS|GCP|Azure|GraphQL|REST|API|AI|ML|LLM|GPT|Claude)\b/gi;
  for (const match of text.matchAll(techPattern)) {
    entities.push({ label: match[0], type: "technology" });
  }

  return entities;
}

// ─── ConversationMemoryGraph ──────────────────────────────────────────────────

export class ConversationMemoryGraph extends EventEmitter {
  private nodes = new Map<string, GraphNode>();          // nodeId -> GraphNode
  private edges = new Map<string, GraphEdge>();          // edgeId -> GraphEdge
  private labelIndex = new Map<string, string>();        // normalized label -> nodeId
  private userGraphs = new Map<string, Set<string>>();   // userId -> Set<nodeId>

  // ── Node Management ──────────────────────────────────────────────────────

  private upsertNode(
    label: string,
    type: EntityType,
    conversationId: string,
    attributes: Record<string, string> = {}
  ): GraphNode {
    const normalized = normalizeLabel(label);
    const existingId = this.labelIndex.get(normalized);

    if (existingId) {
      const node = this.nodes.get(existingId)!;
      node.mentions++;
      node.lastSeen = new Date();
      if (!node.conversationIds.includes(conversationId)) {
        node.conversationIds.push(conversationId);
      }
      Object.assign(node.attributes, attributes);
      return node;
    }

    const id = makeNodeId(normalized);
    const node: GraphNode = {
      id,
      label,
      type,
      aliases: [label],
      mentions: 1,
      firstSeen: new Date(),
      lastSeen: new Date(),
      attributes,
      conversationIds: [conversationId],
    };

    this.nodes.set(id, node);
    this.labelIndex.set(normalized, id);
    this.emit("nodeAdded", node);
    return node;
  }

  private upsertEdge(
    sourceLabel: string,
    targetLabel: string,
    relationship: RelationshipType,
    confidence: number,
    evidence: string
  ): GraphEdge | null {
    const sourceId = this.labelIndex.get(normalizeLabel(sourceLabel));
    const targetId = this.labelIndex.get(normalizeLabel(targetLabel));
    if (!sourceId || !targetId) return null;

    const edgeId = makeEdgeId(sourceId, targetId, relationship);
    const existing = this.edges.get(edgeId);

    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      return existing;
    }

    const edge: GraphEdge = {
      id: edgeId,
      sourceId,
      targetId,
      relationship,
      confidence,
      evidence,
      createdAt: new Date(),
    };

    this.edges.set(edgeId, edge);
    this.emit("edgeAdded", edge);
    return edge;
  }

  // ── Ingestion ────────────────────────────────────────────────────────────

  /**
   * Process a conversation message and update the graph.
   * Uses LLM extraction if API key available, falls back to heuristics.
   */
  async ingestMessage(
    text: string,
    conversationId: string,
    userId?: string,
    useLLM = true
  ): Promise<{ nodesAdded: number; edgesAdded: number }> {
    if (text.trim().length < 10) return { nodesAdded: 0, edgesAdded: 0 };

    const prevNodeCount = this.nodes.size;
    const prevEdgeCount = this.edges.size;

    let extraction: ExtractionResult;

    if (useLLM && process.env.ANTHROPIC_API_KEY) {
      extraction = await extractFromText(text);
    } else {
      const heuristicEntities = extractEntitiesHeuristic(text);
      extraction = {
        entities: heuristicEntities,
        relationships: [],
      };
    }

    // Add nodes
    for (const entity of extraction.entities) {
      const node = this.upsertNode(entity.label, entity.type, conversationId, entity.attributes ?? {});
      if (userId) {
        const userSet = this.userGraphs.get(userId) ?? new Set();
        userSet.add(node.id);
        this.userGraphs.set(userId, userSet);
      }
    }

    // Add edges
    for (const rel of extraction.relationships) {
      this.upsertEdge(rel.source, rel.target, rel.relationship, rel.confidence, rel.evidence);
    }

    const nodesAdded = this.nodes.size - prevNodeCount;
    const edgesAdded = this.edges.size - prevEdgeCount;

    if (nodesAdded > 0 || edgesAdded > 0) {
      logger.info(`Graph updated: +${nodesAdded} nodes, +${edgesAdded} edges (conv: ${conversationId})`);
    }

    return { nodesAdded, edgesAdded };
  }

  // ── Querying ─────────────────────────────────────────────────────────────

  findNode(label: string): GraphNode | null {
    const id = this.labelIndex.get(normalizeLabel(label));
    return id ? (this.nodes.get(id) ?? null) : null;
  }

  queryEntity(label: string): GraphQueryResult | null {
    const node = this.findNode(label);
    if (!node) return null;

    const related: GraphQueryResult["related"] = [];

    for (const edge of this.edges.values()) {
      if (edge.sourceId === node.id) {
        const targetNode = this.nodes.get(edge.targetId);
        if (targetNode) related.push({ node: targetNode, edge, direction: "outgoing" });
      } else if (edge.targetId === node.id) {
        const sourceNode = this.nodes.get(edge.sourceId);
        if (sourceNode) related.push({ node: sourceNode, edge, direction: "incoming" });
      }
    }

    related.sort((a, b) => b.edge.confidence - a.edge.confidence);

    const facts = this.getFactsAbout(node);

    return { entity: node, related, facts };
  }

  /**
   * Natural language query: "how is X related to Y?"
   */
  queryRelationship(labelA: string, labelB: string): GraphEdge[] {
    const nodeA = this.findNode(labelA);
    const nodeB = this.findNode(labelB);
    if (!nodeA || !nodeB) return [];

    return [...this.edges.values()].filter(
      (e) =>
        (e.sourceId === nodeA.id && e.targetId === nodeB.id) ||
        (e.sourceId === nodeB.id && e.targetId === nodeA.id)
    );
  }

  /**
   * Search nodes by partial label match.
   */
  searchNodes(query: string, limit = 10): GraphNode[] {
    const q = query.toLowerCase();
    return [...this.nodes.values()]
      .filter((n) => n.label.toLowerCase().includes(q) || n.aliases.some((a) => a.toLowerCase().includes(q)))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, limit);
  }

  /**
   * Get all nodes for a specific user's conversations.
   */
  getUserNodes(userId: string): GraphNode[] {
    const nodeIds = this.userGraphs.get(userId) ?? new Set();
    return [...nodeIds].map((id) => this.nodes.get(id)).filter(Boolean) as GraphNode[];
  }

  private getFactsAbout(node: GraphNode): string[] {
    const facts: string[] = [];

    facts.push(`${node.label} is a ${node.type}`);
    facts.push(`Mentioned ${node.mentions} time${node.mentions !== 1 ? "s" : ""}`);

    for (const [key, val] of Object.entries(node.attributes)) {
      facts.push(`${node.label} ${key}: ${val}`);
    }

    // Outgoing edges as facts
    for (const edge of this.edges.values()) {
      if (edge.sourceId === node.id && edge.confidence >= 0.6) {
        const target = this.nodes.get(edge.targetId);
        if (target) facts.push(`${node.label} ${edge.relationship.replace(/_/g, " ")} ${target.label}`);
      }
    }

    return facts.slice(0, 10);
  }

  /**
   * Natural language answer generator for "what about X?" queries.
   */
  async answerQuery(query: string): Promise<string | null> {
    // Detect entity references in query
    const entityMatch = query.match(/about\s+(.+?)(\?|$)/i) ??
      query.match(/what\s+is\s+(.+?)(\?|$)/i) ??
      query.match(/tell me about\s+(.+?)(\?|$)/i);

    if (!entityMatch) return null;

    const entityLabel = entityMatch[1]!.trim();
    const result = this.queryEntity(entityLabel);

    if (!result) {
      // Try fuzzy search
      const candidates = this.searchNodes(entityLabel, 3);
      if (candidates.length === 0) return null;
      const best = candidates[0]!;
      const bestResult = this.queryEntity(best.label)!;
      return this.formatQueryResult(bestResult);
    }

    return this.formatQueryResult(result);
  }

  private formatQueryResult(result: GraphQueryResult): string {
    const { entity, related, facts } = result;
    let response = `**${entity.label}** (${entity.type})\n\n`;

    if (facts.length > 0) {
      response += "**Known facts:**\n" + facts.map((f) => `- ${f}`).join("\n") + "\n\n";
    }

    if (related.length > 0) {
      response += "**Relationships:**\n";
      for (const r of related.slice(0, 5)) {
        const dir = r.direction === "outgoing" ? "→" : "←";
        response += `- ${entity.label} ${dir} [${r.edge.relationship.replace(/_/g, " ")}] ${r.node.label}\n`;
      }
    }

    return response.trim();
  }

  // ── Persistence Helpers ──────────────────────────────────────────────────

  exportGraph(userId?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    let nodes: GraphNode[];

    if (userId) {
      nodes = this.getUserNodes(userId);
    } else {
      nodes = [...this.nodes.values()];
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = [...this.edges.values()].filter(
      (e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId)
    );

    return { nodes, edges };
  }

  importGraph(data: { nodes: GraphNode[]; edges: GraphEdge[] }, userId?: string): void {
    for (const node of data.nodes) {
      this.nodes.set(node.id, node);
      this.labelIndex.set(normalizeLabel(node.label), node.id);
      if (userId) {
        const userSet = this.userGraphs.get(userId) ?? new Set();
        userSet.add(node.id);
        this.userGraphs.set(userId, userSet);
      }
    }
    for (const edge of data.edges) {
      this.edges.set(edge.id, edge);
    }
    logger.info(`Graph imported: ${data.nodes.length} nodes, ${data.edges.length} edges`);
  }

  getStats(): { nodes: number; edges: number; users: number } {
    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      users: this.userGraphs.size,
    };
  }
}

export const conversationMemoryGraph = new ConversationMemoryGraph();
