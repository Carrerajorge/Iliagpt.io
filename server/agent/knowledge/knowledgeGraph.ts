import { writeFileSync, readFileSync, existsSync } from "fs";
import type { ExtractedEntity, ExtractedRelationship, ExtractionResult } from "./entityExtractor";

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  properties: Record<string, unknown>;
  edgeCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  weight: number;
  confidence: number;
  evidence: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  density: number;
  avgDegree: number;
  connectedComponents: number;
  nodesByType: Record<string, number>;
  edgesByPredicate: Record<string, number>;
}

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PathResult {
  path: string[];
  edges: GraphEdge[];
  totalWeight: number;
}

function edgeId(source: string, predicate: string, target: string): string {
  return `${source}::${predicate}::${target}`;
}

export class KnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private adjacency: Map<string, Map<string, GraphEdge>> = new Map();
  private reverseAdjacency: Map<string, Map<string, GraphEdge>> = new Map();

  addNode(entity: ExtractedEntity): GraphNode {
    const existing = this.nodes.get(entity.id);
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...entity.aliases])];
      Object.assign(existing.properties, entity.metadata);
      existing.updatedAt = Date.now();
      return existing;
    }

    const node: GraphNode = {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      aliases: [...entity.aliases],
      properties: { ...entity.metadata },
      edgeCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.nodes.set(entity.id, node);
    this.adjacency.set(entity.id, new Map());
    this.reverseAdjacency.set(entity.id, new Map());
    return node;
  }

  updateNode(id: string, updates: Partial<Pick<GraphNode, "name" | "properties" | "aliases">>): GraphNode | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    if (updates.name) node.name = updates.name;
    if (updates.properties) Object.assign(node.properties, updates.properties);
    if (updates.aliases) node.aliases = [...new Set([...node.aliases, ...updates.aliases])];
    node.updatedAt = Date.now();
    return node;
  }

  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;
    const outEdges = this.adjacency.get(id);
    if (outEdges) {
      for (const [, edge] of outEdges) {
        const targetNode = this.nodes.get(edge.target);
        if (targetNode) targetNode.edgeCount--;
        this.reverseAdjacency.get(edge.target)?.delete(edge.id);
      }
    }
    const inEdges = this.reverseAdjacency.get(id);
    if (inEdges) {
      for (const [, edge] of inEdges) {
        const sourceNode = this.nodes.get(edge.source);
        if (sourceNode) sourceNode.edgeCount--;
        this.adjacency.get(edge.source)?.delete(edge.id);
      }
    }
    this.nodes.delete(id);
    this.adjacency.delete(id);
    this.reverseAdjacency.delete(id);
    return true;
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  findNodeByName(name: string): GraphNode | undefined {
    const normalized = name.toLowerCase();
    for (const node of this.nodes.values()) {
      if (node.name.toLowerCase() === normalized) return node;
      if (node.aliases.some((a) => a.toLowerCase() === normalized)) return node;
    }
    return undefined;
  }

  addEdge(rel: ExtractedRelationship): GraphEdge {
    const sourceNode = this.findNodeByName(rel.subject);
    const targetNode = this.findNodeByName(rel.object);

    if (!sourceNode || !targetNode) {
      throw new Error(`Cannot add edge: source "${rel.subject}" or target "${rel.object}" not found in graph`);
    }

    const eid = edgeId(sourceNode.id, rel.predicate, targetNode.id);
    const existingEdge = this.adjacency.get(sourceNode.id)?.get(eid);

    if (existingEdge) {
      existingEdge.weight += 1;
      existingEdge.confidence = Math.max(existingEdge.confidence, rel.confidence);
      if (rel.evidence) existingEdge.evidence.push(rel.evidence);
      existingEdge.updatedAt = Date.now();
      return existingEdge;
    }

    const edge: GraphEdge = {
      id: eid,
      source: sourceNode.id,
      target: targetNode.id,
      predicate: rel.predicate,
      weight: 1,
      confidence: rel.confidence,
      evidence: rel.evidence ? [rel.evidence] : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (!this.adjacency.has(sourceNode.id)) this.adjacency.set(sourceNode.id, new Map());
    if (!this.reverseAdjacency.has(targetNode.id)) this.reverseAdjacency.set(targetNode.id, new Map());

    this.adjacency.get(sourceNode.id)!.set(eid, edge);
    this.reverseAdjacency.get(targetNode.id)!.set(eid, edge);

    sourceNode.edgeCount++;
    targetNode.edgeCount++;

    return edge;
  }

  getEdges(nodeId: string, direction: "out" | "in" | "both" = "both"): GraphEdge[] {
    const edges: GraphEdge[] = [];
    if (direction === "out" || direction === "both") {
      const out = this.adjacency.get(nodeId);
      if (out) edges.push(...out.values());
    }
    if (direction === "in" || direction === "both") {
      const inc = this.reverseAdjacency.get(nodeId);
      if (inc) edges.push(...inc.values());
    }
    return edges;
  }

  neighborhood(nodeId: string, depth: number = 1): SubgraphResult {
    const visitedNodes = new Set<string>();
    const collectedEdges: GraphEdge[] = [];
    const queue: Array<{ id: string; d: number }> = [{ id: nodeId, d: 0 }];

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (visitedNodes.has(id) || d > depth) continue;
      visitedNodes.add(id);

      const edges = this.getEdges(id, "both");
      for (const edge of edges) {
        collectedEdges.push(edge);
        const neighbor = edge.source === id ? edge.target : edge.source;
        if (!visitedNodes.has(neighbor) && d + 1 <= depth) {
          queue.push({ id: neighbor, d: d + 1 });
        }
      }
    }

    const nodes = Array.from(visitedNodes)
      .map((id) => this.nodes.get(id)!)
      .filter(Boolean);

    const uniqueEdges = new Map<string, GraphEdge>();
    for (const e of collectedEdges) uniqueEdges.set(e.id, e);

    return { nodes, edges: Array.from(uniqueEdges.values()) };
  }

  shortestPath(startId: string, endId: string): PathResult | null {
    if (!this.nodes.has(startId) || !this.nodes.has(endId)) return null;
    if (startId === endId) return { path: [startId], edges: [], totalWeight: 0 };

    const visited = new Set<string>();
    const prev = new Map<string, { nodeId: string; edge: GraphEdge }>();
    const queue: string[] = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === endId) break;

      const edges = this.getEdges(current, "both");
      for (const edge of edges) {
        const neighbor = edge.source === current ? edge.target : edge.source;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          prev.set(neighbor, { nodeId: current, edge });
          queue.push(neighbor);
        }
      }
    }

    if (!prev.has(endId)) return null;

    const path: string[] = [];
    const edges: GraphEdge[] = [];
    let current: string | undefined = endId;
    let totalWeight = 0;

    while (current && current !== startId) {
      path.unshift(current);
      const p = prev.get(current);
      if (p) {
        edges.unshift(p.edge);
        totalWeight += p.edge.weight;
        current = p.nodeId;
      } else {
        break;
      }
    }
    path.unshift(startId);

    return { path, edges, totalWeight };
  }

  patternMatch(pattern: { nodeType?: string; predicate?: string; targetType?: string }): SubgraphResult {
    const matchedNodes = new Set<string>();
    const matchedEdges: GraphEdge[] = [];

    for (const [, edgeMap] of this.adjacency) {
      for (const [, edge] of edgeMap) {
        const sourceNode = this.nodes.get(edge.source);
        const targetNode = this.nodes.get(edge.target);
        if (!sourceNode || !targetNode) continue;

        const nodeTypeMatch = !pattern.nodeType || sourceNode.type === pattern.nodeType;
        const predicateMatch = !pattern.predicate || edge.predicate === pattern.predicate;
        const targetTypeMatch = !pattern.targetType || targetNode.type === pattern.targetType;

        if (nodeTypeMatch && predicateMatch && targetTypeMatch) {
          matchedNodes.add(edge.source);
          matchedNodes.add(edge.target);
          matchedEdges.push(edge);
        }
      }
    }

    const nodes = Array.from(matchedNodes)
      .map((id) => this.nodes.get(id)!)
      .filter(Boolean);

    return { nodes, edges: matchedEdges };
  }

  extractSubgraph(nodeIds: string[]): SubgraphResult {
    const idSet = new Set(nodeIds);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const id of idSet) {
      const node = this.nodes.get(id);
      if (node) nodes.push(node);
    }

    for (const id of idSet) {
      const outEdges = this.adjacency.get(id);
      if (outEdges) {
        for (const [, edge] of outEdges) {
          if (idSet.has(edge.target)) edges.push(edge);
        }
      }
    }

    return { nodes, edges };
  }

  mergeDuplicates(id1: string, id2: string): GraphNode | null {
    const node1 = this.nodes.get(id1);
    const node2 = this.nodes.get(id2);
    if (!node1 || !node2) return null;

    node1.aliases = [...new Set([...node1.aliases, node2.name, ...node2.aliases])];
    Object.assign(node1.properties, node2.properties);
    node1.updatedAt = Date.now();

    const inEdges = this.reverseAdjacency.get(id2);
    if (inEdges) {
      for (const [, edge] of inEdges) {
        edge.target = id1;
        if (!this.reverseAdjacency.has(id1)) this.reverseAdjacency.set(id1, new Map());
        this.reverseAdjacency.get(id1)!.set(edge.id, edge);
      }
    }

    const outEdges = this.adjacency.get(id2);
    if (outEdges) {
      for (const [, edge] of outEdges) {
        edge.source = id1;
        if (!this.adjacency.has(id1)) this.adjacency.set(id1, new Map());
        this.adjacency.get(id1)!.set(edge.id, edge);
      }
    }

    node1.edgeCount += node2.edgeCount;
    this.nodes.delete(id2);
    this.adjacency.delete(id2);
    this.reverseAdjacency.delete(id2);

    return node1;
  }

  ingestExtractionResult(result: ExtractionResult): { nodesAdded: number; edgesAdded: number } {
    let nodesAdded = 0;
    let edgesAdded = 0;

    for (const entity of result.entities) {
      const existing = this.nodes.has(entity.id);
      this.addNode(entity);
      if (!existing) nodesAdded++;
    }

    for (const rel of result.relationships) {
      try {
        this.addEdge(rel);
        edgesAdded++;
      } catch {
        // skip edges where nodes not found
      }
    }

    return { nodesAdded, edgesAdded };
  }

  getStats(): GraphStats {
    const nodeCount = this.nodes.size;
    let edgeCount = 0;
    const nodesByType: Record<string, number> = {};
    const edgesByPredicate: Record<string, number> = {};

    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }

    for (const [, edgeMap] of this.adjacency) {
      for (const [, edge] of edgeMap) {
        edgeCount++;
        edgesByPredicate[edge.predicate] = (edgesByPredicate[edge.predicate] || 0) + 1;
      }
    }

    const maxPossibleEdges = nodeCount * (nodeCount - 1);
    const density = maxPossibleEdges > 0 ? edgeCount / maxPossibleEdges : 0;
    const avgDegree = nodeCount > 0 ? (edgeCount * 2) / nodeCount : 0;

    const visited = new Set<string>();
    let connectedComponents = 0;
    for (const id of this.nodes.keys()) {
      if (!visited.has(id)) {
        connectedComponents++;
        const stack = [id];
        while (stack.length > 0) {
          const current = stack.pop()!;
          if (visited.has(current)) continue;
          visited.add(current);
          const edges = this.getEdges(current, "both");
          for (const edge of edges) {
            const neighbor = edge.source === current ? edge.target : edge.source;
            if (!visited.has(neighbor)) stack.push(neighbor);
          }
        }
      }
    }

    return {
      nodeCount,
      edgeCount,
      density,
      avgDegree,
      connectedComponents,
      nodesByType,
      edgesByPredicate,
    };
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  getAllEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const [, edgeMap] of this.adjacency) {
      for (const [, edge] of edgeMap) edges.push(edge);
    }
    return edges;
  }

  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: this.getAllNodes(),
      edges: this.getAllEdges(),
    };
  }

  persistToFile(filePath: string): void {
    const data = this.toJSON();
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  loadFromFile(filePath: string): boolean {
    if (!existsSync(filePath)) return false;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      this.nodes.clear();
      this.adjacency.clear();
      this.reverseAdjacency.clear();

      for (const node of data.nodes || []) {
        this.nodes.set(node.id, node);
        this.adjacency.set(node.id, new Map());
        this.reverseAdjacency.set(node.id, new Map());
      }

      for (const edge of data.edges || []) {
        if (!this.adjacency.has(edge.source)) this.adjacency.set(edge.source, new Map());
        if (!this.reverseAdjacency.has(edge.target)) this.reverseAdjacency.set(edge.target, new Map());
        this.adjacency.get(edge.source)!.set(edge.id, edge);
        this.reverseAdjacency.get(edge.target)!.set(edge.id, edge);
      }

      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    this.nodes.clear();
    this.adjacency.clear();
    this.reverseAdjacency.clear();
  }
}

export const knowledgeGraph = new KnowledgeGraph();
