import { knowledgeGraph, type GraphNode, type GraphEdge, type SubgraphResult } from "./knowledgeGraph";
import { extractEntities, type ExtractedEntity } from "./entityExtractor";

export interface GraphRetrievalResult {
  query: string;
  queryEntities: ExtractedEntity[];
  graphContext: GraphContextItem[];
  paths: GraphPathItem[];
  subgraph: SubgraphResult;
  hops: number;
  totalNodesTraversed: number;
}

export interface GraphContextItem {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  relevance: number;
  connectedFacts: string[];
}

export interface GraphPathItem {
  from: string;
  to: string;
  via: string[];
  predicates: string[];
  totalWeight: number;
}

const MAX_HOPS = 3;
const MAX_CONTEXT_ITEMS = 20;
const MIN_RELEVANCE = 0.3;

function computeRelevance(
  entity: ExtractedEntity,
  node: GraphNode,
  depth: number
): number {
  let score = 0;

  if (node.id === entity.id) score += 1.0;
  else if (node.name.toLowerCase() === entity.name.toLowerCase()) score += 0.9;
  else if (node.aliases.some((a) => a.toLowerCase() === entity.name.toLowerCase())) score += 0.7;

  if (node.type === entity.type) score += 0.2;

  score *= Math.pow(0.6, depth);

  return Math.min(1.0, score);
}

function edgeToFact(edge: GraphEdge, graph: typeof knowledgeGraph): string {
  const sourceNode = graph.getNode(edge.source);
  const targetNode = graph.getNode(edge.target);
  if (!sourceNode || !targetNode) return "";
  return `${sourceNode.name} ${edge.predicate.replace(/_/g, " ")} ${targetNode.name}`;
}

export async function graphRetrieve(
  query: string,
  options: {
    maxHops?: number;
    maxResults?: number;
    minRelevance?: number;
  } = {}
): Promise<GraphRetrievalResult> {
  const maxHops = options.maxHops ?? MAX_HOPS;
  const maxResults = options.maxResults ?? MAX_CONTEXT_ITEMS;
  const minRelevance = options.minRelevance ?? MIN_RELEVANCE;

  const extraction = await extractEntities(query);
  const queryEntities = extraction.entities;

  const contextMap = new Map<string, GraphContextItem>();
  const allPaths: GraphPathItem[] = [];
  const traversedNodes = new Set<string>();
  let totalHops = 0;

  for (const entity of queryEntities) {
    let matchedNode = knowledgeGraph.getNode(entity.id);
    if (!matchedNode) matchedNode = knowledgeGraph.findNodeByName(entity.name);
    if (!matchedNode) continue;

    const { nodes, edges } = knowledgeGraph.neighborhood(matchedNode.id, maxHops);
    totalHops = Math.max(totalHops, maxHops);

    for (const node of nodes) {
      traversedNodes.add(node.id);
      const relevance = computeRelevance(entity, node, 0);
      if (relevance < minRelevance) continue;

      const nodeEdges = knowledgeGraph.getEdges(node.id, "both");
      const facts = nodeEdges
        .map((e) => edgeToFact(e, knowledgeGraph))
        .filter(Boolean);

      const existing = contextMap.get(node.id);
      if (!existing || existing.relevance < relevance) {
        contextMap.set(node.id, {
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          relevance,
          connectedFacts: facts.slice(0, 10),
        });
      }
    }
  }

  for (let i = 0; i < queryEntities.length; i++) {
    for (let j = i + 1; j < queryEntities.length; j++) {
      const nodeA = knowledgeGraph.getNode(queryEntities[i].id) ||
        knowledgeGraph.findNodeByName(queryEntities[i].name);
      const nodeB = knowledgeGraph.getNode(queryEntities[j].id) ||
        knowledgeGraph.findNodeByName(queryEntities[j].name);
      if (!nodeA || !nodeB) continue;

      const pathResult = knowledgeGraph.shortestPath(nodeA.id, nodeB.id);
      if (pathResult && pathResult.path.length > 1) {
        allPaths.push({
          from: nodeA.name,
          to: nodeB.name,
          via: pathResult.path
            .slice(1, -1)
            .map((id) => knowledgeGraph.getNode(id)?.name || id),
          predicates: pathResult.edges.map((e) => e.predicate),
          totalWeight: pathResult.totalWeight,
        });
      }
    }
  }

  const graphContext = Array.from(contextMap.values())
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxResults);

  const relevantNodeIds = graphContext.map((c) => c.nodeId);
  const subgraph = knowledgeGraph.extractSubgraph(relevantNodeIds);

  return {
    query,
    queryEntities,
    graphContext,
    paths: allPaths,
    subgraph,
    hops: totalHops,
    totalNodesTraversed: traversedNodes.size,
  };
}

export function formatGraphContextForRAG(result: GraphRetrievalResult): string {
  if (result.graphContext.length === 0 && result.paths.length === 0) {
    return "";
  }

  const parts: string[] = ["[Knowledge Graph Context]"];

  if (result.graphContext.length > 0) {
    parts.push("Entities:");
    for (const item of result.graphContext.slice(0, 10)) {
      parts.push(`- ${item.nodeName} (${item.nodeType}, relevance: ${item.relevance.toFixed(2)})`);
      for (const fact of item.connectedFacts.slice(0, 3)) {
        parts.push(`  → ${fact}`);
      }
    }
  }

  if (result.paths.length > 0) {
    parts.push("\nRelationship paths:");
    for (const path of result.paths.slice(0, 5)) {
      const via = path.via.length > 0 ? ` via ${path.via.join(" → ")}` : "";
      parts.push(`- ${path.from} → ${path.to}${via} [${path.predicates.join(", ")}]`);
    }
  }

  return parts.join("\n");
}

export async function graphAugmentedSearch(
  query: string,
  vectorSearchResults: Array<{ content: string; score: number }>,
  options: { maxHops?: number; maxGraphResults?: number } = {}
): Promise<{
  combinedContext: string;
  graphResult: GraphRetrievalResult;
  vectorResults: Array<{ content: string; score: number }>;
}> {
  const graphResult = await graphRetrieve(query, {
    maxHops: options.maxHops,
    maxResults: options.maxGraphResults,
  });

  const graphContextStr = formatGraphContextForRAG(graphResult);

  const vectorContextStr = vectorSearchResults
    .slice(0, 5)
    .map((r, i) => `[Vector Result ${i + 1}] (score: ${r.score.toFixed(3)}): ${r.content.substring(0, 500)}`)
    .join("\n");

  const combinedContext = [graphContextStr, vectorContextStr]
    .filter(Boolean)
    .join("\n\n");

  return {
    combinedContext,
    graphResult,
    vectorResults: vectorSearchResults,
  };
}
