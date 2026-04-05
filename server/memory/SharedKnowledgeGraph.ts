/**
 * SharedKnowledgeGraph — cross-agent knowledge sharing via a structured entity-relationship graph.
 * Nodes: entities (people, concepts, files, URLs). Edges: relationships.
 * Persisted in PostgreSQL with JSON columns. Queryable by entity, path, or relationship type.
 */

import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";
import { db } from "../db";
import { sql, eq, and, or } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, index, integer } from "drizzle-orm/pg-core";

const logger = createLogger("SharedKnowledgeGraph");

// ─── Schema ───────────────────────────────────────────────────────────────────

export const kgNodes = pgTable("kg_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nodeType: text("node_type").notNull(),
  properties: jsonb("properties").default({}),
  contributedBy: text("contributed_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  accessCount: integer("access_count").default(0),
}, (t) => ({
  nameTypeIdx: index("kg_nodes_name_type").on(t.name, t.nodeType),
}));

export const kgEdges = pgTable("kg_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromNodeId: uuid("from_node_id").notNull().references(() => kgNodes.id, { onDelete: "cascade" }),
  toNodeId: uuid("to_node_id").notNull().references(() => kgNodes.id, { onDelete: "cascade" }),
  relationship: text("relationship").notNull(),
  weight: integer("weight").default(1),
  properties: jsonb("properties").default({}),
  contributedBy: text("contributed_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  fromIdx: index("kg_edges_from").on(t.fromNodeId),
  toIdx: index("kg_edges_to").on(t.toNodeId),
  relIdx: index("kg_edges_rel").on(t.relationship),
}));

// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeType = "person" | "concept" | "file" | "url" | "tool" | "agent" | "topic" | "entity";

export type RelationshipType =
  | "uses" | "depends_on" | "contradicts" | "supports" | "created_by"
  | "related_to" | "part_of" | "instance_of" | "knows" | "authored"
  | "references" | "implements" | "extends" | "replaces";

export interface KGNode {
  id: string;
  name: string;
  nodeType: NodeType;
  properties: Record<string, unknown>;
  contributedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  accessCount: number;
}

export interface KGEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationship: RelationshipType;
  weight: number;
  properties: Record<string, unknown>;
  contributedBy?: string;
  createdAt: Date;
}

export interface GraphPath {
  nodes: KGNode[];
  edges: KGEdge[];
  length: number;
}

export interface RelatedEntities {
  entity: KGNode;
  related: Array<{ node: KGNode; relationship: RelationshipType; direction: "outgoing" | "incoming" }>;
}

// ─── Schema Setup ─────────────────────────────────────────────────────────────

async function ensureSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kg_nodes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        node_type TEXT NOT NULL,
        properties JSONB DEFAULT '{}',
        contributed_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        access_count INTEGER DEFAULT 0
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kg_edges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        from_node_id UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
        to_node_id UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
        relationship TEXT NOT NULL,
        weight INTEGER DEFAULT 1,
        properties JSONB DEFAULT '{}',
        contributed_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS kg_nodes_name_type ON kg_nodes(name, node_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS kg_edges_from ON kg_edges(from_node_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS kg_edges_to ON kg_edges(to_node_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS kg_edges_rel ON kg_edges(relationship)`);
    logger.info("Knowledge graph schema ready");
  } catch (err) {
    logger.warn(`KG schema setup: ${(err as Error).message}`);
  }
}

// ─── SharedKnowledgeGraph ─────────────────────────────────────────────────────

export class SharedKnowledgeGraph {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await ensureSchema();
    this.initialized = true;
  }

  async addNode(name: string, nodeType: NodeType, properties: Record<string, unknown> = {}, contributedBy?: string): Promise<KGNode> {
    await this.initialize();

    // Upsert: if same name+type exists, update properties
    const existing = await this.findNode(name, nodeType);
    if (existing) {
      await db.execute(sql`
        UPDATE kg_nodes
        SET properties = ${JSON.stringify({ ...existing.properties, ...properties })}::jsonb,
            updated_at = NOW()
        WHERE id = ${existing.id}::uuid
      `);
      return { ...existing, properties: { ...existing.properties, ...properties }, updatedAt: new Date() };
    }

    const result = await db.execute(sql`
      INSERT INTO kg_nodes (name, node_type, properties, contributed_by)
      VALUES (${name}, ${nodeType}, ${JSON.stringify(properties)}::jsonb, ${contributedBy ?? null})
      RETURNING id, name, node_type, properties, contributed_by, created_at, updated_at, access_count
    `) as { rows: Array<Record<string, unknown>> };

    const row = result.rows[0]!;
    logger.debug(`Added KG node: ${name} (${nodeType})`);

    return {
      id: row["id"] as string,
      name: row["name"] as string,
      nodeType: row["node_type"] as NodeType,
      properties: row["properties"] as Record<string, unknown>,
      contributedBy: row["contributed_by"] as string | undefined,
      createdAt: new Date(row["created_at"] as string),
      updatedAt: new Date(row["updated_at"] as string),
      accessCount: row["access_count"] as number,
    };
  }

  async addEdge(
    fromId: string,
    toId: string,
    relationship: RelationshipType,
    properties: Record<string, unknown> = {},
    contributedBy?: string
  ): Promise<KGEdge> {
    await this.initialize();

    const result = await db.execute(sql`
      INSERT INTO kg_edges (from_node_id, to_node_id, relationship, properties, contributed_by)
      VALUES (${fromId}::uuid, ${toId}::uuid, ${relationship}, ${JSON.stringify(properties)}::jsonb, ${contributedBy ?? null})
      ON CONFLICT DO NOTHING
      RETURNING id, from_node_id, to_node_id, relationship, weight, properties, contributed_by, created_at
    `) as { rows: Array<Record<string, unknown>> };

    const row = result.rows[0];
    if (!row) throw new AppError("Failed to create edge", 500, "KG_EDGE_ERROR");

    return {
      id: row["id"] as string,
      fromNodeId: row["from_node_id"] as string,
      toNodeId: row["to_node_id"] as string,
      relationship: row["relationship"] as RelationshipType,
      weight: row["weight"] as number,
      properties: row["properties"] as Record<string, unknown>,
      contributedBy: row["contributed_by"] as string | undefined,
      createdAt: new Date(row["created_at"] as string),
    };
  }

  async findNode(name: string, nodeType?: NodeType): Promise<KGNode | null> {
    await this.initialize();

    const result = await db.execute(sql`
      SELECT id, name, node_type, properties, contributed_by, created_at, updated_at, access_count
      FROM kg_nodes
      WHERE name = ${name}
        AND (${nodeType ?? null} IS NULL OR node_type = ${nodeType ?? null})
      LIMIT 1
    `) as { rows: Array<Record<string, unknown>> };

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row["id"] as string,
      name: row["name"] as string,
      nodeType: row["node_type"] as NodeType,
      properties: row["properties"] as Record<string, unknown>,
      contributedBy: row["contributed_by"] as string | undefined,
      createdAt: new Date(row["created_at"] as string),
      updatedAt: new Date(row["updated_at"] as string),
      accessCount: row["access_count"] as number,
    };
  }

  async findRelated(entityName: string, nodeType?: NodeType, maxDepth = 1): Promise<RelatedEntities> {
    await this.initialize();

    const node = await this.findNode(entityName, nodeType);
    if (!node) throw new AppError(`Entity not found: ${entityName}`, 404, "KG_NOT_FOUND");

    // Increment access count
    await db.execute(sql`UPDATE kg_nodes SET access_count = access_count + 1 WHERE id = ${node.id}::uuid`);

    const result = await db.execute(sql`
      SELECT
        n.id, n.name, n.node_type, n.properties, n.access_count, n.created_at, n.updated_at,
        e.relationship,
        'outgoing' AS direction
      FROM kg_edges e
      JOIN kg_nodes n ON n.id = e.to_node_id
      WHERE e.from_node_id = ${node.id}::uuid

      UNION ALL

      SELECT
        n.id, n.name, n.node_type, n.properties, n.access_count, n.created_at, n.updated_at,
        e.relationship,
        'incoming' AS direction
      FROM kg_edges e
      JOIN kg_nodes n ON n.id = e.from_node_id
      WHERE e.to_node_id = ${node.id}::uuid

      LIMIT 50
    `) as { rows: Array<Record<string, unknown>> };

    const related = result.rows.map((row) => ({
      node: {
        id: row["id"] as string,
        name: row["name"] as string,
        nodeType: row["node_type"] as NodeType,
        properties: row["properties"] as Record<string, unknown>,
        createdAt: new Date(row["created_at"] as string),
        updatedAt: new Date(row["updated_at"] as string),
        accessCount: row["access_count"] as number,
      },
      relationship: row["relationship"] as RelationshipType,
      direction: row["direction"] as "outgoing" | "incoming",
    }));

    return { entity: node, related };
  }

  async getAllFactsAbout(entityName: string): Promise<string[]> {
    await this.initialize();

    const { entity, related } = await this.findRelated(entityName);
    const facts: string[] = [];

    for (const { node, relationship, direction } of related) {
      if (direction === "outgoing") {
        facts.push(`${entity.name} ${relationship} ${node.name}`);
      } else {
        facts.push(`${node.name} ${relationship} ${entity.name}`);
      }
    }

    // Also include properties as facts
    for (const [key, value] of Object.entries(entity.properties)) {
      facts.push(`${entity.name} has ${key}: ${String(value)}`);
    }

    return facts;
  }

  async findPath(fromName: string, toName: string, maxDepth = 3): Promise<GraphPath | null> {
    await this.initialize();

    // BFS traversal
    const fromNode = await this.findNode(fromName);
    const toNode = await this.findNode(toName);

    if (!fromNode || !toNode) return null;

    const visited = new Set<string>([fromNode.id]);
    const queue: Array<{ nodeId: string; path: GraphPath }> = [
      { nodeId: fromNode.id, path: { nodes: [fromNode], edges: [], length: 0 } },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.nodeId === toNode.id) return current.path;
      if (current.path.length >= maxDepth) continue;

      const result = await db.execute(sql`
        SELECT e.id, e.from_node_id, e.to_node_id, e.relationship, e.weight, e.properties, e.created_at,
               n.id as node_id, n.name, n.node_type, n.properties as node_props, n.access_count, n.created_at as node_created, n.updated_at
        FROM kg_edges e
        JOIN kg_nodes n ON n.id = e.to_node_id
        WHERE e.from_node_id = ${current.nodeId}::uuid
        LIMIT 20
      `) as { rows: Array<Record<string, unknown>> };

      for (const row of result.rows) {
        const neighborId = row["node_id"] as string;
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const edge: KGEdge = {
          id: row["id"] as string,
          fromNodeId: row["from_node_id"] as string,
          toNodeId: row["to_node_id"] as string,
          relationship: row["relationship"] as RelationshipType,
          weight: row["weight"] as number,
          properties: row["properties"] as Record<string, unknown>,
          createdAt: new Date(row["created_at"] as string),
        };

        const neighborNode: KGNode = {
          id: neighborId,
          name: row["name"] as string,
          nodeType: row["node_type"] as NodeType,
          properties: row["node_props"] as Record<string, unknown>,
          createdAt: new Date(row["node_created"] as string),
          updatedAt: new Date(row["updated_at"] as string),
          accessCount: row["access_count"] as number,
        };

        queue.push({
          nodeId: neighborId,
          path: {
            nodes: [...current.path.nodes, neighborNode],
            edges: [...current.path.edges, edge],
            length: current.path.length + 1,
          },
        });
      }
    }

    return null;
  }

  async searchNodes(query: string, nodeType?: NodeType, limit = 10): Promise<KGNode[]> {
    await this.initialize();

    const result = await db.execute(sql`
      SELECT id, name, node_type, properties, contributed_by, created_at, updated_at, access_count
      FROM kg_nodes
      WHERE name ILIKE ${"%" + query + "%"}
        AND (${nodeType ?? null} IS NULL OR node_type = ${nodeType ?? null})
      ORDER BY access_count DESC
      LIMIT ${limit}
    `) as { rows: Array<Record<string, unknown>> };

    return result.rows.map((row) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      nodeType: row["node_type"] as NodeType,
      properties: row["properties"] as Record<string, unknown>,
      contributedBy: row["contributed_by"] as string | undefined,
      createdAt: new Date(row["created_at"] as string),
      updatedAt: new Date(row["updated_at"] as string),
      accessCount: row["access_count"] as number,
    }));
  }

  async getStats(): Promise<{ nodeCount: number; edgeCount: number; topEntities: string[] }> {
    await this.initialize();

    const counts = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM kg_nodes) as node_count,
        (SELECT COUNT(*) FROM kg_edges) as edge_count
    `) as { rows: Array<Record<string, unknown>> };

    const topNodes = await db.execute(sql`
      SELECT name FROM kg_nodes ORDER BY access_count DESC LIMIT 5
    `) as { rows: Array<Record<string, unknown>> };

    return {
      nodeCount: Number(counts.rows[0]?.["node_count"] ?? 0),
      edgeCount: Number(counts.rows[0]?.["edge_count"] ?? 0),
      topEntities: topNodes.rows.map((r) => r["name"] as string),
    };
  }
}

export const sharedKnowledgeGraph = new SharedKnowledgeGraph();
