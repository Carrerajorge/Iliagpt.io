/**
 * GraphRAG Engine — Entity-Relation Knowledge Graph for Multi-Document Retrieval
 *
 * When information is highly connected across multiple documents,
 * traditional vector similarity misses relational context. GraphRAG builds
 * entity-relation subgraphs that enable:
 *
 *   - Cross-document entity linking (same person/concept across docs)
 *   - Relationship-aware retrieval (A relates to B via C)
 *   - Multi-hop reasoning paths (doc1.claim → doc2.evidence → doc3.data)
 *   - Community detection for topic clustering
 *   - Traceable citation chains
 *
 * Architecture:
 *   1. Entity Extraction: LLM extracts entities + relations from chunks
 *   2. Graph Construction: Build in-memory directed graph
 *   3. Community Detection: Louvain-like clustering for topic groups
 *   4. Subgraph Retrieval: Given a query, find relevant subgraph
 *   5. Context Assembly: Flatten subgraph into LLM-consumable context
 */

import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { LRUCache } from 'lru-cache';
import { withSpan } from '../../lib/tracing';
import type { ContextualChunk } from './contextAwareChunker';

// ============================================================================
// Configuration
// ============================================================================

const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID;
const genAI = !isTestEnv && process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const GRAPH_LLM_MODEL = process.env.GRAPH_LLM_MODEL || 'gemini-2.5-flash';

// ============================================================================
// Types
// ============================================================================

export interface GraphEntity {
  id: string;
  name: string;
  normalizedName: string;
  type: 'person' | 'organization' | 'location' | 'date' | 'concept' |
    'metric' | 'product' | 'event' | 'document' | 'regulation' | 'technology' | 'other';
  aliases: string[];
  description: string;
  /** Chunks where this entity appears */
  sourceChunkIds: string[];
  /** Document files where this entity appears */
  sourceFileIds: string[];
  /** Properties extracted about this entity */
  properties: Record<string, string>;
  /** Importance score (PageRank-like) */
  importance: number;
  /** Community/cluster ID */
  communityId?: number;
}

export interface GraphRelation {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  type: string; // e.g., "works_for", "contradicts", "supports", "references", "measured_by"
  label: string; // Human-readable description
  weight: number; // 0-1 strength
  /** Source chunk that establishes this relation */
  sourceChunkId: string;
  /** Direction matters */
  directed: boolean;
  /** Confidence in this relation */
  confidence: number;
  /** Extracted evidence for this relation */
  evidence: string;
}

export interface KnowledgeGraph {
  entities: Map<string, GraphEntity>;
  relations: GraphRelation[];
  /** Adjacency lists for fast traversal */
  adjacency: Map<string, Array<{ entityId: string; relationId: string; direction: 'outgoing' | 'incoming' }>>;
  /** Communities/clusters */
  communities: Map<number, string[]>; // communityId → entityIds
  /** Build metadata */
  metadata: {
    totalEntities: number;
    totalRelations: number;
    totalCommunities: number;
    sourceChunkCount: number;
    sourceFileCount: number;
    buildTimeMs: number;
  };
}

export interface SubgraphResult {
  /** Relevant entities */
  entities: GraphEntity[];
  /** Relevant relations */
  relations: GraphRelation[];
  /** Context text assembled from the subgraph */
  assembledContext: string;
  /** Source chunks referenced */
  referencedChunkIds: string[];
  /** Relevance score */
  score: number;
  /** Reasoning path */
  reasoningPath: string[];
}

// Entity extraction cache
const extractionCache = new LRUCache<string, { entities: any[]; relations: any[] }>({
  max: 500,
  ttl: 1000 * 60 * 60 * 2, // 2 hours
});

// ============================================================================
// Entity Extraction via LLM
// ============================================================================

async function extractEntitiesAndRelations(
  chunk: ContextualChunk,
): Promise<{ entities: any[]; relations: any[] }> {
  const cacheKey = crypto.createHash('md5').update(chunk.content).digest('hex');
  const cached = extractionCache.get(cacheKey);
  if (cached) return cached;

  if (!genAI) {
    return { entities: [], relations: [] };
  }

  const prompt = `Extrae entidades y relaciones del siguiente texto. Responde en JSON.

TEXTO:
${chunk.fullContent.slice(0, 3000)}

Responde con este formato exacto:
{
  "entities": [
    {
      "name": "nombre exacto",
      "type": "person|organization|location|date|concept|metric|product|event|document|regulation|technology|other",
      "description": "descripción breve",
      "properties": {"key": "value"}
    }
  ],
  "relations": [
    {
      "source": "nombre entidad origen",
      "target": "nombre entidad destino",
      "type": "tipo_relación",
      "label": "descripción de la relación",
      "evidence": "fragmento del texto que evidencia esta relación",
      "confidence": 0.85
    }
  ]
}

REGLAS:
1. Extrae TODAS las entidades mencionadas (personas, orgs, fechas, conceptos, métricas).
2. Extrae TODAS las relaciones implícitas y explícitas.
3. "evidence" debe ser una cita literal o paráfrasis del texto.
4. No inventes entidades ni relaciones que no estén en el texto.`;

  try {
    const result = await (genAI as any).models.generateContent({
      model: GRAPH_LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    });

    const rawText = result.text || '{}';
    let parsed: any;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      return { entities: [], relations: [] };
    }

    const extracted = {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
    };

    extractionCache.set(cacheKey, extracted);
    return extracted;
  } catch (error) {
    console.error('[GraphRAG] Entity extraction error:', error);
    return { entities: [], relations: [] };
  }
}

// ============================================================================
// Graph Construction
// ============================================================================

function normalizeEntityName(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^\w\sáéíóúñü]/g, '')
    .replace(/\s+/g, ' ');
}

function findOrCreateEntity(
  graph: KnowledgeGraph,
  name: string,
  type: GraphEntity['type'],
  description: string,
  chunkId: string,
  fileId: string,
  properties: Record<string, string> = {},
): GraphEntity {
  const normalizedName = normalizeEntityName(name);

  // Check if entity already exists (by normalized name)
  for (const [id, entity] of graph.entities) {
    if (entity.normalizedName === normalizedName) {
      // Merge info
      if (!entity.sourceChunkIds.includes(chunkId)) entity.sourceChunkIds.push(chunkId);
      if (fileId && !entity.sourceFileIds.includes(fileId)) entity.sourceFileIds.push(fileId);
      if (name !== entity.name && !entity.aliases.includes(name)) entity.aliases.push(name);
      // Merge properties
      for (const [k, v] of Object.entries(properties)) {
        if (!entity.properties[k]) entity.properties[k] = v;
      }
      return entity;
    }
  }

  // Create new entity
  const id = `ent-${crypto.createHash('md5').update(normalizedName).digest('hex').slice(0, 12)}`;
  const entity: GraphEntity = {
    id,
    name,
    normalizedName,
    type,
    aliases: [],
    description,
    sourceChunkIds: [chunkId],
    sourceFileIds: fileId ? [fileId] : [],
    properties,
    importance: 0,
    communityId: undefined,
  };

  graph.entities.set(id, entity);
  graph.adjacency.set(id, []);
  return entity;
}

function addRelation(
  graph: KnowledgeGraph,
  sourceEntity: GraphEntity,
  targetEntity: GraphEntity,
  type: string,
  label: string,
  chunkId: string,
  confidence: number,
  evidence: string,
): GraphRelation {
  const id = `rel-${crypto.randomUUID().slice(0, 12)}`;
  const relation: GraphRelation = {
    id,
    sourceEntityId: sourceEntity.id,
    targetEntityId: targetEntity.id,
    type,
    label,
    weight: confidence,
    sourceChunkId: chunkId,
    directed: true,
    confidence,
    evidence,
  };

  graph.relations.push(relation);

  // Update adjacency
  const sourceAdj = graph.adjacency.get(sourceEntity.id) || [];
  sourceAdj.push({ entityId: targetEntity.id, relationId: id, direction: 'outgoing' });
  graph.adjacency.set(sourceEntity.id, sourceAdj);

  const targetAdj = graph.adjacency.get(targetEntity.id) || [];
  targetAdj.push({ entityId: sourceEntity.id, relationId: id, direction: 'incoming' });
  graph.adjacency.set(targetEntity.id, targetAdj);

  return relation;
}

// ============================================================================
// PageRank-like Importance Scoring
// ============================================================================

function computeImportance(graph: KnowledgeGraph, iterations: number = 20, dampingFactor: number = 0.85): void {
  const n = graph.entities.size;
  if (n === 0) return;

  // Initialize scores
  const scores = new Map<string, number>();
  for (const id of graph.entities.keys()) {
    scores.set(id, 1.0 / n);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();
    for (const id of graph.entities.keys()) {
      let incomingScore = 0;
      const adj = graph.adjacency.get(id) || [];
      for (const link of adj) {
        if (link.direction === 'incoming') {
          const neighborAdj = graph.adjacency.get(link.entityId) || [];
          const outDegree = neighborAdj.filter(l => l.direction === 'outgoing').length || 1;
          incomingScore += (scores.get(link.entityId) || 0) / outDegree;
        }
      }
      newScores.set(id, (1 - dampingFactor) / n + dampingFactor * incomingScore);
    }

    for (const [id, score] of newScores) {
      scores.set(id, score);
    }
  }

  // Normalize and assign
  const maxScore = Math.max(...scores.values(), 0.001);
  for (const [id, score] of scores) {
    const entity = graph.entities.get(id);
    if (entity) entity.importance = score / maxScore;
  }
}

// ============================================================================
// Community Detection (Label Propagation)
// ============================================================================

function detectCommunities(graph: KnowledgeGraph): void {
  const entityIds = Array.from(graph.entities.keys());
  if (entityIds.length === 0) return;

  // Initialize each entity as its own community
  const labels = new Map<string, number>();
  entityIds.forEach((id, i) => labels.set(id, i));

  // Iterate
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    // Shuffle to avoid bias
    const shuffled = [...entityIds].sort(() => Math.random() - 0.5);

    for (const entityId of shuffled) {
      const neighbors = graph.adjacency.get(entityId) || [];
      if (neighbors.length === 0) continue;

      // Count neighbor labels
      const labelCounts = new Map<number, number>();
      for (const neighbor of neighbors) {
        const nLabel = labels.get(neighbor.entityId);
        if (nLabel !== undefined) {
          // Weight by relation confidence
          const relation = graph.relations.find(r => r.id === neighbor.relationId);
          const weight = relation?.confidence || 0.5;
          labelCounts.set(nLabel, (labelCounts.get(nLabel) || 0) + weight);
        }
      }

      // Pick most common label
      let maxCount = 0;
      let bestLabel = labels.get(entityId) || 0;
      for (const [label, count] of labelCounts) {
        if (count > maxCount) {
          maxCount = count;
          bestLabel = label;
        }
      }

      if (bestLabel !== labels.get(entityId)) {
        labels.set(entityId, bestLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Build communities map
  graph.communities.clear();
  for (const [entityId, label] of labels) {
    const entity = graph.entities.get(entityId);
    if (entity) entity.communityId = label;

    const community = graph.communities.get(label) || [];
    community.push(entityId);
    graph.communities.set(label, community);
  }

  // Remove singleton communities
  for (const [id, members] of graph.communities) {
    if (members.length <= 1) graph.communities.delete(id);
  }
}

// ============================================================================
// Graph Building (Main)
// ============================================================================

/**
 * Build a knowledge graph from a set of contextual chunks.
 */
export async function buildKnowledgeGraph(
  chunks: ContextualChunk[],
  options: { maxChunksToProcess?: number; enableLLMExtraction?: boolean } = {},
): Promise<KnowledgeGraph> {
  return withSpan('graphrag.build', async (span) => {
    const startTime = Date.now();
    const maxChunks = options.maxChunksToProcess || 100;
    const enableLLM = options.enableLLMExtraction !== false;

    span.setAttribute('graphrag.input_chunks', chunks.length);
    span.setAttribute('graphrag.max_chunks', maxChunks);

    const graph: KnowledgeGraph = {
      entities: new Map(),
      relations: [],
      adjacency: new Map(),
      communities: new Map(),
      metadata: {
        totalEntities: 0,
        totalRelations: 0,
        totalCommunities: 0,
        sourceChunkCount: chunks.length,
        sourceFileCount: new Set(chunks.map(c => c.source.fileId).filter(Boolean)).size,
        buildTimeMs: 0,
      },
    };

    // Process chunks (limit to maxChunks for performance)
    const chunksToProcess = chunks.slice(0, maxChunks);

    // Batch extraction
    const BATCH_SIZE = 5;
    for (let i = 0; i < chunksToProcess.length; i += BATCH_SIZE) {
      const batch = chunksToProcess.slice(i, i + BATCH_SIZE);
      const results = enableLLM
        ? await Promise.all(batch.map(chunk => extractEntitiesAndRelations(chunk)))
        : batch.map(chunk => extractEntitiesFromHeuristics(chunk));

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const { entities, relations } = results[j];

        // Add entities to graph
        const entityMap = new Map<string, GraphEntity>();
        for (const rawEntity of entities) {
          const entity = findOrCreateEntity(
            graph,
            rawEntity.name,
            rawEntity.type || 'other',
            rawEntity.description || '',
            chunk.id,
            chunk.source.fileId || '',
            rawEntity.properties || {},
          );
          entityMap.set(rawEntity.name, entity);
        }

        // Add relations to graph
        for (const rawRel of relations) {
          const sourceEntity = entityMap.get(rawRel.source);
          const targetEntity = entityMap.get(rawRel.target);

          if (sourceEntity && targetEntity) {
            addRelation(
              graph,
              sourceEntity,
              targetEntity,
              rawRel.type || 'related_to',
              rawRel.label || `${rawRel.source} → ${rawRel.target}`,
              chunk.id,
              rawRel.confidence || 0.5,
              rawRel.evidence || '',
            );
          }
        }
      }
    }

    // Compute importance scores
    computeImportance(graph);

    // Detect communities
    detectCommunities(graph);

    // Update metadata
    graph.metadata.totalEntities = graph.entities.size;
    graph.metadata.totalRelations = graph.relations.length;
    graph.metadata.totalCommunities = graph.communities.size;
    graph.metadata.buildTimeMs = Date.now() - startTime;

    span.setAttribute('graphrag.entities', graph.metadata.totalEntities);
    span.setAttribute('graphrag.relations', graph.metadata.totalRelations);
    span.setAttribute('graphrag.communities', graph.metadata.totalCommunities);
    span.setAttribute('graphrag.build_time_ms', graph.metadata.buildTimeMs);

    return graph;
  });
}

// ============================================================================
// Heuristic Entity Extraction (no LLM needed)
// ============================================================================

function extractEntitiesFromHeuristics(chunk: ContextualChunk): { entities: any[]; relations: any[] } {
  const text = chunk.content;
  const entities: any[] = [];
  const relations: any[] = [];

  // Extract proper nouns (capitalized multi-word phrases)
  const properNouns = text.match(/[A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+)+/g) || [];
  const seen = new Set<string>();
  for (const name of properNouns) {
    const norm = name.toLowerCase();
    if (!seen.has(norm) && name.length > 3) {
      seen.add(norm);
      entities.push({
        name,
        type: 'concept',
        description: `Mentioned in: ${chunk.breadcrumb.join(' > ') || chunk.source.fileName}`,
        properties: {},
      });
    }
  }

  // Extract dates
  const dates = text.match(/\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/g) || [];
  for (const date of dates) {
    entities.push({
      name: date,
      type: 'date',
      description: 'Date reference',
      properties: { raw: date },
    });
  }

  // Extract metrics/numbers with context
  const metrics = text.match(/(?:\$|€|USD|EUR|ARS)?\s*[\d,.]+\s*(?:%|millones|miles|billion|million|kg|km|m²|ha)?/g) || [];
  for (const metric of metrics.slice(0, 10)) {
    if (metric.trim().length > 2) {
      entities.push({
        name: metric.trim(),
        type: 'metric',
        description: 'Numeric value',
        properties: { raw: metric.trim() },
      });
    }
  }

  return { entities, relations };
}

// ============================================================================
// Subgraph Retrieval
// ============================================================================

/**
 * Given a query, find the most relevant subgraph from the knowledge graph.
 */
export async function retrieveSubgraph(
  graph: KnowledgeGraph,
  query: string,
  options: {
    maxEntities?: number;
    maxHops?: number;
    minImportance?: number;
  } = {},
): Promise<SubgraphResult> {
  return withSpan('graphrag.retrieve', async (span) => {
    const maxEntities = options.maxEntities || 20;
    const maxHops = options.maxHops || 2;
    const minImportance = options.minImportance || 0.1;

    span.setAttribute('graphrag.query_length', query.length);
    span.setAttribute('graphrag.max_entities', maxEntities);
    span.setAttribute('graphrag.max_hops', maxHops);

    // 1. Find seed entities (name/alias matching)
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const seedEntities: Array<{ entity: GraphEntity; score: number }> = [];

    for (const [id, entity] of graph.entities) {
      let matchScore = 0;
      const allNames = [entity.normalizedName, ...entity.aliases.map(a => a.toLowerCase())];

      for (const name of allNames) {
        for (const term of queryTerms) {
          if (name.includes(term)) {
            matchScore += term.length / name.length;
          }
        }
      }

      // Boost by importance
      matchScore *= (1 + entity.importance);

      if (matchScore > 0) {
        seedEntities.push({ entity, score: matchScore });
      }
    }

    seedEntities.sort((a, b) => b.score - a.score);
    const seeds = seedEntities.slice(0, Math.ceil(maxEntities / 2));

    // 2. Expand via BFS (multi-hop)
    const visitedEntities = new Set<string>();
    const resultEntities: GraphEntity[] = [];
    const resultRelations: GraphRelation[] = [];
    const reasoningPath: string[] = [];

    const queue: Array<{ entityId: string; depth: number }> = seeds.map(s => ({
      entityId: s.entity.id,
      depth: 0,
    }));

    while (queue.length > 0 && resultEntities.length < maxEntities) {
      const { entityId, depth } = queue.shift()!;
      if (visitedEntities.has(entityId) || depth > maxHops) continue;
      visitedEntities.add(entityId);

      const entity = graph.entities.get(entityId);
      if (!entity || entity.importance < minImportance) continue;

      resultEntities.push(entity);

      // Add neighbors
      const neighbors = graph.adjacency.get(entityId) || [];
      for (const neighbor of neighbors) {
        const relation = graph.relations.find(r => r.id === neighbor.relationId);
        if (relation && !resultRelations.some(r => r.id === relation.id)) {
          resultRelations.push(relation);
          reasoningPath.push(`${entity.name} --[${relation.type}]--> ${graph.entities.get(neighbor.entityId)?.name || '?'}`);
        }
        queue.push({ entityId: neighbor.entityId, depth: depth + 1 });
      }
    }

    // 3. Include community members of seed entities
    for (const seed of seeds) {
      if (seed.entity.communityId !== undefined) {
        const communityMembers = graph.communities.get(seed.entity.communityId) || [];
        for (const memberId of communityMembers) {
          if (!visitedEntities.has(memberId) && resultEntities.length < maxEntities) {
            const member = graph.entities.get(memberId);
            if (member && member.importance >= minImportance) {
              resultEntities.push(member);
              visitedEntities.add(memberId);
            }
          }
        }
      }
    }

    // 4. Assemble context text
    const contextParts: string[] = [];

    // Entity descriptions
    const sortedEntities = resultEntities.sort((a, b) => b.importance - a.importance);
    for (const entity of sortedEntities) {
      const props = Object.entries(entity.properties).map(([k, v]) => `${k}: ${v}`).join(', ');
      contextParts.push(`[Entidad: ${entity.name} (${entity.type})] ${entity.description}${props ? ` | ${props}` : ''}`);
    }

    // Key relations with evidence
    for (const rel of resultRelations.slice(0, 30)) {
      const source = graph.entities.get(rel.sourceEntityId);
      const target = graph.entities.get(rel.targetEntityId);
      if (source && target && rel.evidence) {
        contextParts.push(`[Relación: ${source.name} → ${rel.type} → ${target.name}] "${rel.evidence}"`);
      }
    }

    const assembledContext = contextParts.join('\n');
    const referencedChunkIds = new Set<string>();
    for (const entity of resultEntities) {
      for (const chunkId of entity.sourceChunkIds) referencedChunkIds.add(chunkId);
    }
    for (const rel of resultRelations) {
      referencedChunkIds.add(rel.sourceChunkId);
    }

    const score = seeds.length > 0
      ? seeds.reduce((s, seed) => s + seed.score, 0) / seeds.length
      : 0;

    span.setAttribute('graphrag.result_entities', resultEntities.length);
    span.setAttribute('graphrag.result_relations', resultRelations.length);
    span.setAttribute('graphrag.referenced_chunks', referencedChunkIds.size);
    span.setAttribute('graphrag.score', score);

    return {
      entities: resultEntities,
      relations: resultRelations,
      assembledContext,
      referencedChunkIds: Array.from(referencedChunkIds),
      score,
      reasoningPath,
    };
  });
}

export const graphRAGEngine = {
  buildKnowledgeGraph,
  retrieveSubgraph,
  computeImportance,
  detectCommunities,
  extractEntitiesFromHeuristics,
};
