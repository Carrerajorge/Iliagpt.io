/**
 * Knowledge Graph Router — REST API for exploring and managing
 * the shared knowledge graph. Provides visualization data,
 * search, stats, and manual extraction triggers.
 *
 * Inspired by Rowboat's persistent knowledge graph from interactions.
 */

import { Router, type Request, type Response } from "express";
import {
  sharedKnowledgeGraph,
  type NodeType,
} from "../memory/SharedKnowledgeGraph";
import { extractKnowledgeFromConversation } from "../services/knowledgeGraphExtractor";
import { db } from "../db";
import { sql } from "drizzle-orm";

function getUserId(req: Request): string {
  const authReq = req as any;
  return (
    authReq?.user?.claims?.sub ||
    authReq?.user?.id ||
    (req as any).session?.authUserId ||
    (req as any).session?.passport?.user?.id ||
    "anonymous"
  );
}

export function createKnowledgeGraphRouter(): Router {
  const router = Router();

  // ── List nodes with pagination and filtering ──────────────────────

  router.get("/nodes", async (req: Request, res: Response) => {
    try {
      const { type, limit = "50", offset = "0", sort = "recent" } = req.query;
      const limitNum = Math.min(Number(limit) || 50, 200);
      const offsetNum = Number(offset) || 0;

      const orderClause = sort === "popular" ? "access_count DESC" : "created_at DESC";

      const result = await db.execute(sql`
        SELECT id, name, node_type, properties, contributed_by, created_at, updated_at, access_count
        FROM kg_nodes
        WHERE (${type?.toString() ?? null} IS NULL OR node_type = ${type?.toString() ?? null})
        ORDER BY ${sql.raw(orderClause)}
        LIMIT ${limitNum} OFFSET ${offsetNum}
      `) as { rows: Array<Record<string, unknown>> };

      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM kg_nodes
        WHERE (${type?.toString() ?? null} IS NULL OR node_type = ${type?.toString() ?? null})
      `) as { rows: Array<Record<string, unknown>> };

      res.json({
        success: true,
        nodes: result.rows.map(mapNode),
        total: Number(countResult.rows[0]?.total ?? 0),
        limit: limitNum,
        offset: offsetNum,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to fetch nodes" });
    }
  });

  // ── Get subgraph around a node ────────────────────────────────────

  router.get("/nodes/:id/related", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const depth = Math.min(Number(req.query.depth) || 1, 3);

      // Get the center node
      const nodeResult = await db.execute(sql`
        SELECT id, name, node_type, properties, contributed_by, created_at, updated_at, access_count
        FROM kg_nodes WHERE id = ${id}::uuid
      `) as { rows: Array<Record<string, unknown>> };

      if (nodeResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Node not found" });
      }

      const centerNode = mapNode(nodeResult.rows[0]!);

      // Get related nodes and edges
      const relatedResult = await db.execute(sql`
        SELECT
          n.id, n.name, n.node_type, n.properties, n.access_count, n.created_at, n.updated_at,
          e.id as edge_id, e.relationship, e.weight, e.properties as edge_properties,
          CASE WHEN e.from_node_id = ${id}::uuid THEN 'outgoing' ELSE 'incoming' END as direction
        FROM kg_edges e
        JOIN kg_nodes n ON n.id = CASE
          WHEN e.from_node_id = ${id}::uuid THEN e.to_node_id
          ELSE e.from_node_id
        END
        WHERE e.from_node_id = ${id}::uuid OR e.to_node_id = ${id}::uuid
        LIMIT 50
      `) as { rows: Array<Record<string, unknown>> };

      const related = relatedResult.rows.map((row) => ({
        node: mapNode(row),
        edge: {
          id: row.edge_id as string,
          relationship: row.relationship as string,
          weight: row.weight as number,
          properties: row.edge_properties as Record<string, unknown>,
          direction: row.direction as string,
        },
      }));

      res.json({ success: true, center: centerNode, related });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to fetch related nodes" });
    }
  });

  // ── Search nodes ──────────────────────────────────────────────────

  router.get("/search", async (req: Request, res: Response) => {
    try {
      const { q, type, limit = "20" } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const nodes = await sharedKnowledgeGraph.searchNodes(
        q,
        type as NodeType | undefined,
        Math.min(Number(limit) || 20, 100)
      );

      res.json({ success: true, nodes, query: q });
    } catch (error) {
      res.status(500).json({ success: false, error: "Search failed" });
    }
  });

  // ── Get graph stats ───────────────────────────────────────────────

  router.get("/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await sharedKnowledgeGraph.getStats();

      // Get type distribution
      const typeDistResult = await db.execute(sql`
        SELECT node_type, COUNT(*) as count
        FROM kg_nodes
        GROUP BY node_type
        ORDER BY count DESC
      `) as { rows: Array<Record<string, unknown>> };

      const typeDistribution = typeDistResult.rows.map((r) => ({
        type: r.node_type as string,
        count: Number(r.count),
      }));

      // Get relationship distribution
      const relDistResult = await db.execute(sql`
        SELECT relationship, COUNT(*) as count
        FROM kg_edges
        GROUP BY relationship
        ORDER BY count DESC
      `) as { rows: Array<Record<string, unknown>> };

      const relationshipDistribution = relDistResult.rows.map((r) => ({
        relationship: r.relationship as string,
        count: Number(r.count),
      }));

      res.json({
        success: true,
        ...stats,
        typeDistribution,
        relationshipDistribution,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to get stats" });
    }
  });

  // ── Get visualization data (nodes + edges for ReactFlow) ──────────

  router.get("/visualization", async (req: Request, res: Response) => {
    try {
      const { limit = "100", type } = req.query;
      const limitNum = Math.min(Number(limit) || 100, 500);

      // Get nodes
      const nodesResult = await db.execute(sql`
        SELECT id, name, node_type, properties, access_count, created_at, updated_at
        FROM kg_nodes
        WHERE (${type?.toString() ?? null} IS NULL OR node_type = ${type?.toString() ?? null})
        ORDER BY access_count DESC
        LIMIT ${limitNum}
      `) as { rows: Array<Record<string, unknown>> };

      const nodeIds = nodesResult.rows.map((r) => r.id as string);
      if (nodeIds.length === 0) {
        return res.json({ success: true, nodes: [], edges: [] });
      }

      // Get edges between these nodes
      const edgesResult = await db.execute(sql`
        SELECT id, from_node_id, to_node_id, relationship, weight, properties
        FROM kg_edges
        WHERE from_node_id = ANY(${nodeIds}::uuid[])
          AND to_node_id = ANY(${nodeIds}::uuid[])
      `) as { rows: Array<Record<string, unknown>> };

      // Format for ReactFlow
      const nodes = nodesResult.rows.map((row, i) => ({
        id: row.id as string,
        type: "kgNode",
        position: { x: 0, y: 0 }, // Client will layout with dagre/force
        data: {
          label: row.name as string,
          nodeType: row.node_type as string,
          properties: row.properties as Record<string, unknown>,
          accessCount: row.access_count as number,
        },
      }));

      const edges = edgesResult.rows.map((row) => ({
        id: row.id as string,
        source: row.from_node_id as string,
        target: row.to_node_id as string,
        label: row.relationship as string,
        data: {
          relationship: row.relationship as string,
          weight: row.weight as number,
        },
      }));

      res.json({ success: true, nodes, edges });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to get visualization data" });
    }
  });

  // ── Manually trigger extraction from a chat ───────────────────────

  router.post("/extract", async (req: Request, res: Response) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, error: "messages array is required" });
      }

      const userId = getUserId(req);
      const result = await extractKnowledgeFromConversation(messages, userId);

      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Extraction failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ── Delete a node ─────────────────────────────────────────────────

  router.delete("/nodes/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      await db.execute(sql`DELETE FROM kg_nodes WHERE id = ${id}::uuid`);

      res.json({ success: true, deleted: id });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to delete node" });
    }
  });

  return router;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapNode(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    name: row.name as string,
    nodeType: (row.node_type ?? row.nodeType) as string,
    properties: row.properties as Record<string, unknown>,
    contributedBy: row.contributed_by as string | undefined,
    accessCount: (row.access_count ?? row.accessCount ?? 0) as number,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

export default createKnowledgeGraphRouter;
