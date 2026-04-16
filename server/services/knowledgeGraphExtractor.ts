/**
 * KnowledgeGraphExtractor — LLM-based entity and relationship extraction
 * from conversation messages. Inspired by Rowboat's automatic knowledge graph
 * building from user interactions.
 *
 * Extracts entities (people, organizations, concepts, tools, projects) and
 * relationships, then persists them into the SharedKnowledgeGraph.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";
import {
  sharedKnowledgeGraph,
  type NodeType,
  type RelationshipType,
  type KGNode,
} from "../memory/SharedKnowledgeGraph";

const logger = createLogger("KnowledgeGraphExtractor");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedEntity {
  name: string;
  type: NodeType;
  properties: Record<string, unknown>;
}

interface ExtractedRelationship {
  from: string;
  to: string;
  relationship: RelationshipType;
  properties?: Record<string, unknown>;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  nodesCreated: number;
  edgesCreated: number;
  skipped: number;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── LLM Extraction Prompt ───────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are an entity and relationship extraction engine. Analyze the conversation and extract structured knowledge.

Extract:
1. **Entities** — people, organizations, concepts, tools, projects, topics mentioned
2. **Relationships** — how entities relate to each other

Output valid JSON with this exact structure:
{
  "entities": [
    { "name": "Entity Name", "type": "person|concept|tool|topic|entity", "properties": { "description": "brief description" } }
  ],
  "relationships": [
    { "from": "Entity A", "to": "Entity B", "relationship": "uses|depends_on|related_to|part_of|created_by|knows|references|supports" }
  ]
}

Rules:
- Only extract clearly mentioned entities, do not infer
- Normalize entity names (capitalize properly, remove articles)
- Deduplicate entities with the same meaning
- Valid types: person, concept, tool, topic, entity
- Valid relationships: uses, depends_on, contradicts, supports, created_by, related_to, part_of, instance_of, knows, authored, references, implements, extends, replaces
- Keep it concise — max 15 entities, max 20 relationships
- If the conversation is trivial (greetings, small talk), return empty arrays
- Return ONLY the JSON, no markdown fences`;

// ─── Pattern-Based Extraction (fallback) ─────────────────────────────────────

function extractWithPatterns(messages: ConversationMessage[]): {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
} {
  const entities: ExtractedEntity[] = [];
  const relationships: ExtractedRelationship[] = [];
  const seen = new Set<string>();
  const allText = messages.map((m) => m.content).join("\n");

  // Extract capitalized names (likely people/orgs)
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
  for (const match of allText.matchAll(namePattern)) {
    const name = match[1]!;
    const key = name.toLowerCase();
    if (!seen.has(key) && name.length > 3) {
      seen.add(key);
      entities.push({ name, type: "entity", properties: { source: "pattern" } });
    }
  }

  // Extract tech/tool mentions
  const toolPattern = /\b(React|Python|TypeScript|JavaScript|Docker|Kubernetes|PostgreSQL|Redis|Node\.js|Express|Next\.js|Vue|Angular|MongoDB|GraphQL|REST|API|SDK|CLI|AWS|GCP|Azure)\b/gi;
  for (const match of allText.matchAll(toolPattern)) {
    const name = match[1]!;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ name, type: "tool", properties: { source: "pattern" } });
    }
  }

  // Extract "X uses Y" patterns
  const usesPattern = /(\w+(?:\s+\w+)?)\s+(?:uses?|utilizes?|leverages?)\s+(\w+(?:\s+\w+)?)/gi;
  for (const match of allText.matchAll(usesPattern)) {
    if (match[1] && match[2]) {
      relationships.push({ from: match[1], to: match[2], relationship: "uses" });
    }
  }

  return { entities: entities.slice(0, 15), relationships: relationships.slice(0, 10) };
}

// ─── Main Extractor ──────────────────────────────────────────────────────────

export async function extractKnowledgeFromConversation(
  messages: ConversationMessage[],
  contributedBy?: string
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    entities: [],
    relationships: [],
    nodesCreated: 0,
    edgesCreated: 0,
    skipped: 0,
  };

  if (messages.length < 2) return result;

  // Build transcript
  const transcript = messages
    .slice(-30)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`)
    .join("\n");

  if (transcript.length < 50) return result;

  let extracted: { entities: ExtractedEntity[]; relationships: ExtractedRelationship[] };

  try {
    // Try LLM-based extraction
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        { role: "user", content: `${EXTRACTION_PROMPT}\n\n--- CONVERSATION ---\n${transcript}` },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in LLM response");

    extracted = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(extracted.entities)) extracted.entities = [];
    if (!Array.isArray(extracted.relationships)) extracted.relationships = [];

    logger.info(`LLM extracted ${extracted.entities.length} entities, ${extracted.relationships.length} relationships`);
  } catch (err) {
    logger.warn(`LLM extraction failed, using pattern fallback: ${(err as Error).message}`);
    extracted = extractWithPatterns(messages);
  }

  result.entities = extracted.entities;
  result.relationships = extracted.relationships;

  // Persist entities to knowledge graph
  const nodeMap = new Map<string, KGNode>();

  for (const entity of extracted.entities) {
    try {
      const validType = validateNodeType(entity.type);
      const node = await sharedKnowledgeGraph.addNode(
        entity.name,
        validType,
        entity.properties || {},
        contributedBy
      );
      nodeMap.set(entity.name.toLowerCase(), node);
      result.nodesCreated++;
    } catch (err) {
      logger.debug(`Skip entity ${entity.name}: ${(err as Error).message}`);
      result.skipped++;
    }
  }

  // Persist relationships
  for (const rel of extracted.relationships) {
    try {
      const fromNode = nodeMap.get(rel.from.toLowerCase()) ||
        await sharedKnowledgeGraph.findNode(rel.from);
      const toNode = nodeMap.get(rel.to.toLowerCase()) ||
        await sharedKnowledgeGraph.findNode(rel.to);

      if (!fromNode || !toNode) {
        result.skipped++;
        continue;
      }

      const validRel = validateRelationship(rel.relationship);
      await sharedKnowledgeGraph.addEdge(
        fromNode.id,
        toNode.id,
        validRel,
        rel.properties || {},
        contributedBy
      );
      result.edgesCreated++;
    } catch (err) {
      logger.debug(`Skip relationship ${rel.from}->${rel.to}: ${(err as Error).message}`);
      result.skipped++;
    }
  }

  logger.info(`KG extraction complete: ${result.nodesCreated} nodes, ${result.edgesCreated} edges, ${result.skipped} skipped`);
  return result;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

const VALID_NODE_TYPES: Set<string> = new Set([
  "person", "concept", "file", "url", "tool", "agent", "topic", "entity",
]);

const VALID_RELATIONSHIPS: Set<string> = new Set([
  "uses", "depends_on", "contradicts", "supports", "created_by",
  "related_to", "part_of", "instance_of", "knows", "authored",
  "references", "implements", "extends", "replaces",
]);

function validateNodeType(type: string): NodeType {
  if (VALID_NODE_TYPES.has(type)) return type as NodeType;
  return "entity";
}

function validateRelationship(rel: string): RelationshipType {
  if (VALID_RELATIONSHIPS.has(rel)) return rel as RelationshipType;
  return "related_to";
}
