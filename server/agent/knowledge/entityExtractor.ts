import { llmGateway } from "../../lib/llmGateway";

export type EntityType =
  | "person"
  | "organization"
  | "concept"
  | "technology"
  | "date"
  | "location";

export type RelationshipType =
  | "uses"
  | "depends_on"
  | "authored_by"
  | "related_to"
  | "contradicts"
  | "supports";

export interface ExtractedEntity {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface ExtractedRelationship {
  subject: string;
  predicate: RelationshipType;
  object: string;
  confidence: number;
  evidence: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  sourceText: string;
  extractedAt: number;
}

const EXTRACTION_MODEL = process.env.ENTITY_EXTRACTION_MODEL || "gpt-4o-mini";

function generateEntityId(name: string, type: EntityType): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${type}:${normalized}`;
}

function deduplicateEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>();
  for (const entity of entities) {
    const existing = seen.get(entity.id);
    if (!existing || existing.confidence < entity.confidence) {
      if (existing) {
        entity.aliases = [...new Set([...existing.aliases, ...entity.aliases])];
      }
      seen.set(entity.id, entity);
    }
  }
  return Array.from(seen.values());
}

export async function extractEntities(text: string): Promise<ExtractionResult> {
  if (!text || text.trim().length < 10) {
    return { entities: [], relationships: [], sourceText: text, extractedAt: Date.now() };
  }

  const truncated = text.substring(0, 8000);

  try {
    const response = await llmGateway.chat(
      [
        {
          role: "system" as const,
          content: `You are an entity and relationship extraction engine. Given text, extract:
1. Entities: persons, organizations, concepts, technologies, dates, locations.
2. Relationships between entities: uses, depends_on, authored_by, related_to, contradicts, supports.

Output ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "entities": [
    { "name": "string", "type": "person|organization|concept|technology|date|location", "aliases": ["string"], "confidence": 0.0-1.0 }
  ],
  "relationships": [
    { "subject": "entity name", "predicate": "uses|depends_on|authored_by|related_to|contradicts|supports", "object": "entity name", "confidence": 0.0-1.0, "evidence": "brief quote" }
  ]
}`
        },
        { role: "user" as const, content: truncated }
      ],
      { model: EXTRACTION_MODEL, temperature: 0.1, maxTokens: 2000, timeout: 15000 }
    );

    const cleaned = response.content.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned);

    const entities: ExtractedEntity[] = (parsed.entities || []).map((e: any) => ({
      id: generateEntityId(e.name, e.type),
      name: String(e.name || ""),
      type: e.type as EntityType,
      aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : [],
      confidence: typeof e.confidence === "number" ? Math.min(1, Math.max(0, e.confidence)) : 0.5,
      metadata: {},
    }));

    const relationships: ExtractedRelationship[] = (parsed.relationships || []).map((r: any) => ({
      subject: String(r.subject || ""),
      predicate: r.predicate as RelationshipType,
      object: String(r.object || ""),
      confidence: typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.5,
      evidence: String(r.evidence || ""),
    }));

    return {
      entities: deduplicateEntities(entities),
      relationships,
      sourceText: truncated,
      extractedAt: Date.now(),
    };
  } catch {
    return extractEntitiesLocal(truncated);
  }
}

const ENTITY_PATTERNS: Array<{ type: EntityType; pattern: RegExp }> = [
  { type: "technology", pattern: /\b(?:JavaScript|TypeScript|Python|React|Node\.js|Docker|Kubernetes|AWS|Azure|GCP|Redis|PostgreSQL|MongoDB|GraphQL|REST|gRPC|Kafka|Terraform|Git|Linux|macOS|Windows|Java|Go|Rust|C\+\+|Swift|Kotlin)\b/gi },
  { type: "organization", pattern: /\b(?:Google|Microsoft|Apple|Amazon|Meta|Facebook|OpenAI|Anthropic|Netflix|Tesla|SpaceX|IBM|Oracle|Salesforce|Adobe|GitHub|GitLab|Vercel|Netlify|Stripe)\b/gi },
  { type: "date", pattern: /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/gi },
  { type: "location", pattern: /\b(?:United States|USA|UK|China|Japan|Germany|France|India|Brazil|Canada|Australia|Europe|Asia|Africa|North America|South America|Silicon Valley|San Francisco|New York|London|Tokyo|Berlin|Paris)\b/gi },
];

function extractEntitiesLocal(text: string): ExtractionResult {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const { type, pattern } of ENTITY_PATTERNS) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const id = generateEntityId(match, type);
      if (!seen.has(id)) {
        seen.add(id);
        entities.push({
          id,
          name: match,
          type,
          aliases: [],
          confidence: 0.6,
          metadata: {},
        });
      }
    }
  }

  const relationships: ExtractedRelationship[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const dist = Math.abs(
        text.indexOf(entities[i].name) - text.indexOf(entities[j].name)
      );
      if (dist < 200) {
        relationships.push({
          subject: entities[i].name,
          predicate: "related_to",
          object: entities[j].name,
          confidence: Math.max(0.3, 1 - dist / 200),
          evidence: "",
        });
      }
    }
  }

  return {
    entities: deduplicateEntities(entities),
    relationships: relationships.slice(0, 50),
    sourceText: text,
    extractedAt: Date.now(),
  };
}

export async function extractEntitiesBatch(
  texts: string[]
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];
  for (const text of texts) {
    results.push(await extractEntities(text));
  }
  return results;
}

export function mergeExtractionResults(results: ExtractionResult[]): ExtractionResult {
  const allEntities: ExtractedEntity[] = [];
  const allRelationships: ExtractedRelationship[] = [];

  for (const result of results) {
    allEntities.push(...result.entities);
    allRelationships.push(...result.relationships);
  }

  return {
    entities: deduplicateEntities(allEntities),
    relationships: allRelationships,
    sourceText: results.map((r) => r.sourceText.substring(0, 200)).join(" ... "),
    extractedAt: Date.now(),
  };
}
