import { randomUUID } from 'crypto';
import { Logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface Entity {
  id: string;
  agentId: string;
  type: string;
  name: string;
  attributes: Record<string, unknown>;
  embedding?: number[];
  confidence: number; // 0-1
  sources: string[];
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface Relationship {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  weight: number; // 0-1
  attributes?: Record<string, unknown>;
  createdAt: Date;
  bidirectional: boolean;
}

export interface InferenceRule {
  id: string;
  name: string;
  pattern: {
    antecedents: string[]; // relationship types that must exist
    consequent: string;    // relationship type to infer
  };
  confidence: number; // 0-1
  enabled: boolean;
}

export interface KnowledgeTriple {
  subject: string;   // entity name or id
  predicate: string; // relationship type or attribute key
  object: string;    // entity name, id, or attribute value
  confidence: number;
  source?: string;
}

// ---------------------------------------------------------------------------
// Entity query
// ---------------------------------------------------------------------------

interface EntityQuery {
  type?: string;
  name?: string;
  minConfidence?: number;
}

// ---------------------------------------------------------------------------
// BFS path node
// ---------------------------------------------------------------------------

interface PathNode {
  entityId: string;
  path: string[];
}

// ---------------------------------------------------------------------------
// SemanticMemory
// ---------------------------------------------------------------------------

export class SemanticMemory {
  private readonly entities: Map<string, Entity> = new Map();
  private readonly relationships: Map<string, Relationship> = new Map();
  private readonly rules: Map<string, InferenceRule> = new Map();

  // Adjacency: entityId -> Set of relationship ids
  private readonly outgoing: Map<string, Set<string>> = new Map();
  private readonly incoming: Map<string, Set<string>> = new Map();

  // -------------------------------------------------------------------------
  // Entity operations
  // -------------------------------------------------------------------------

  addEntity(
    entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt' | 'version'>,
  ): Entity {
    const now = new Date();
    const id = randomUUID();
    const full: Entity = {
      ...entity,
      id,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.entities.set(id, full);
    this.outgoing.set(id, new Set());
    this.incoming.set(id, new Set());
    Logger.debug(
      `[SemanticMemory] addEntity id=${id} type=${entity.type} name=${entity.name}`,
    );
    return { ...full };
  }

  updateEntity(id: string, updates: Partial<Entity>): Entity {
    const existing = this.entities.get(id);
    if (!existing) {
      throw new Error(`[SemanticMemory] updateEntity: entity not found id=${id}`);
    }
    const updated: Entity = {
      ...existing,
      ...updates,
      id, // prevent id override
      createdAt: existing.createdAt,
      updatedAt: new Date(),
      version: existing.version + 1,
    };
    this.entities.set(id, updated);
    Logger.debug(`[SemanticMemory] updateEntity id=${id} version=${updated.version}`);
    return { ...updated };
  }

  getEntity(id: string): Entity | undefined {
    const e = this.entities.get(id);
    return e ? { ...e } : undefined;
  }

  findEntities(query: EntityQuery): Entity[] {
    const results: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (query.type !== undefined && entity.type !== query.type) continue;
      if (
        query.name !== undefined &&
        !entity.name.toLowerCase().includes(query.name.toLowerCase())
      )
        continue;
      if (
        query.minConfidence !== undefined &&
        entity.confidence < query.minConfidence
      )
        continue;
      results.push({ ...entity });
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Relationship operations
  // -------------------------------------------------------------------------

  addRelationship(
    rel: Omit<Relationship, 'id' | 'createdAt'>,
  ): Relationship {
    if (!this.entities.has(rel.fromEntityId)) {
      throw new Error(
        `[SemanticMemory] addRelationship: fromEntity not found id=${rel.fromEntityId}`,
      );
    }
    if (!this.entities.has(rel.toEntityId)) {
      throw new Error(
        `[SemanticMemory] addRelationship: toEntity not found id=${rel.toEntityId}`,
      );
    }

    const id = randomUUID();
    const full: Relationship = {
      ...rel,
      id,
      createdAt: new Date(),
    };
    this.relationships.set(id, full);

    // Update adjacency
    this._ensureAdjacency(rel.fromEntityId);
    this._ensureAdjacency(rel.toEntityId);
    this.outgoing.get(rel.fromEntityId)!.add(id);
    this.incoming.get(rel.toEntityId)!.add(id);
    if (rel.bidirectional) {
      this.outgoing.get(rel.toEntityId)!.add(id);
      this.incoming.get(rel.fromEntityId)!.add(id);
    }

    Logger.debug(
      `[SemanticMemory] addRelationship id=${id} type=${rel.type} from=${rel.fromEntityId} to=${rel.toEntityId}`,
    );
    return { ...full };
  }

  getRelationships(
    entityId: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'both',
  ): Relationship[] {
    const relIds = new Set<string>();
    if (direction === 'outgoing' || direction === 'both') {
      for (const id of this.outgoing.get(entityId) ?? []) relIds.add(id);
    }
    if (direction === 'incoming' || direction === 'both') {
      for (const id of this.incoming.get(entityId) ?? []) relIds.add(id);
    }
    return [...relIds]
      .map((id) => this.relationships.get(id))
      .filter((r): r is Relationship => r !== undefined)
      .map((r) => ({ ...r }));
  }

  // -------------------------------------------------------------------------
  // BFS path finding
  // -------------------------------------------------------------------------

  findPath(
    fromId: string,
    toId: string,
    maxHops = 5,
  ): Entity[][] {
    if (!this.entities.has(fromId) || !this.entities.has(toId)) return [];
    if (fromId === toId) {
      const e = this.entities.get(fromId);
      return e ? [[{ ...e }]] : [];
    }

    const queue: PathNode[] = [{ entityId: fromId, path: [fromId] }];
    const visited = new Set<string>([fromId]);
    const paths: Entity[][] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length > maxHops + 1) continue;

      const rels = this.getRelationships(current.entityId, 'outgoing');
      for (const rel of rels) {
        const neighbor =
          rel.fromEntityId === current.entityId ? rel.toEntityId : rel.fromEntityId;

        if (visited.has(neighbor)) continue;

        const newPath = [...current.path, neighbor];

        if (neighbor === toId) {
          // Found a path — resolve entity objects
          const entityPath = newPath
            .map((id) => this.entities.get(id))
            .filter((e): e is Entity => e !== undefined)
            .map((e) => ({ ...e }));
          paths.push(entityPath);
          continue; // keep searching for other paths
        }

        visited.add(neighbor);
        queue.push({ entityId: neighbor, path: newPath });
      }
    }

    return paths;
  }

  // -------------------------------------------------------------------------
  // Inference
  // -------------------------------------------------------------------------

  infer(entityId: string): KnowledgeTriple[] {
    const triples: KnowledgeTriple[] = [];
    const entity = this.entities.get(entityId);
    if (!entity) return triples;

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Check if all antecedent relationship types exist for this entity
      const antecedentsSatisfied = rule.pattern.antecedents.every((relType) => {
        const rels = this.getRelationships(entityId, 'both');
        return rels.some((r) => r.type === relType);
      });

      if (!antecedentsSatisfied) continue;

      // Find target entities connected via the last antecedent
      const lastAntecedent =
        rule.pattern.antecedents[rule.pattern.antecedents.length - 1];
      const targetRels = this.getRelationships(entityId, 'outgoing').filter(
        (r) => r.type === lastAntecedent,
      );

      for (const rel of targetRels) {
        const targetEntity = this.entities.get(rel.toEntityId);
        if (!targetEntity) continue;

        triples.push({
          subject: entity.name,
          predicate: rule.pattern.consequent,
          object: targetEntity.name,
          confidence: rule.confidence * Math.min(entity.confidence, targetEntity.confidence),
          source: `inferred:${rule.name}`,
        });
      }
    }

    Logger.debug(
      `[SemanticMemory] infer entityId=${entityId} inferredTriples=${triples.length}`,
    );
    return triples;
  }

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  addRule(rule: Omit<InferenceRule, 'id'>): InferenceRule {
    const id = randomUUID();
    const full: InferenceRule = { ...rule, id };
    this.rules.set(id, full);
    Logger.debug(`[SemanticMemory] addRule id=${id} name=${rule.name}`);
    return { ...full };
  }

  // -------------------------------------------------------------------------
  // Merge entities
  // -------------------------------------------------------------------------

  mergeEntities(id1: string, id2: string): Entity {
    const e1 = this.entities.get(id1);
    const e2 = this.entities.get(id2);
    if (!e1 || !e2) {
      throw new Error(
        `[SemanticMemory] mergeEntities: one or both entities not found id1=${id1} id2=${id2}`,
      );
    }

    // Merged entity takes id1, merges attributes, combines sources
    const merged: Entity = {
      ...e1,
      attributes: { ...e2.attributes, ...e1.attributes }, // e1 attributes win
      confidence: Math.max(e1.confidence, e2.confidence),
      sources: [...new Set([...e1.sources, ...e2.sources])],
      updatedAt: new Date(),
      version: e1.version + 1,
    };
    this.entities.set(id1, merged);

    // Transfer all relationships from e2 to e1
    const e2Rels = this.getRelationships(id2, 'both');
    for (const rel of e2Rels) {
      const newRel = { ...rel };
      if (newRel.fromEntityId === id2) newRel.fromEntityId = id1;
      if (newRel.toEntityId === id2) newRel.toEntityId = id1;

      // Skip self-loops created by the merge
      if (newRel.fromEntityId === newRel.toEntityId) continue;

      // Check for duplicate relationship
      const duplicate = [...this.relationships.values()].some(
        (r) =>
          r.fromEntityId === newRel.fromEntityId &&
          r.toEntityId === newRel.toEntityId &&
          r.type === newRel.type,
      );
      if (!duplicate) {
        // Re-add with corrected endpoints
        this.addRelationship({
          fromEntityId: newRel.fromEntityId,
          toEntityId: newRel.toEntityId,
          type: newRel.type,
          weight: newRel.weight,
          attributes: newRel.attributes,
          bidirectional: newRel.bidirectional,
        });
      }
    }

    // Remove e2 and its old relationships
    this._removeEntityRelationships(id2);
    this.entities.delete(id2);
    this.outgoing.delete(id2);
    this.incoming.delete(id2);

    Logger.info(
      `[SemanticMemory] merged id2=${id2} into id1=${id1} version=${merged.version}`,
    );
    return { ...merged };
  }

  // -------------------------------------------------------------------------
  // Triple serialization
  // -------------------------------------------------------------------------

  toTriples(): KnowledgeTriple[] {
    const triples: KnowledgeTriple[] = [];

    // Attribute triples
    for (const entity of this.entities.values()) {
      for (const [key, value] of Object.entries(entity.attributes)) {
        triples.push({
          subject: entity.id,
          predicate: key,
          object: String(value),
          confidence: entity.confidence,
          source: entity.sources[0],
        });
      }
    }

    // Relationship triples
    for (const rel of this.relationships.values()) {
      const from = this.entities.get(rel.fromEntityId);
      const to = this.entities.get(rel.toEntityId);
      if (!from || !to) continue;
      triples.push({
        subject: from.id,
        predicate: rel.type,
        object: to.id,
        confidence: rel.weight,
      });
    }

    return triples;
  }

  fromTriples(triples: KnowledgeTriple[], agentId: string): void {
    // Build entity index by name
    const nameIndex = new Map<string, string>(); // name -> id
    for (const entity of this.entities.values()) {
      nameIndex.set(entity.name, entity.id);
    }

    for (const triple of triples) {
      // Determine if subject/object are entity references or attribute values
      // Convention: if subject/object looks like a UUID, treat as entity id;
      // otherwise treat as entity name and create if missing.
      const subjectId = this._resolveOrCreateEntity(
        triple.subject,
        agentId,
        triple.confidence,
        triple.source,
        nameIndex,
      );

      // Check if this triple is an attribute (object is a literal string value)
      const objectIsEntity =
        this.entities.has(triple.object) || nameIndex.has(triple.object);

      if (objectIsEntity) {
        const objectId = this._resolveOrCreateEntity(
          triple.object,
          agentId,
          triple.confidence,
          triple.source,
          nameIndex,
        );
        // Check for existing relationship to avoid duplicates
        const exists = [...this.relationships.values()].some(
          (r) =>
            r.fromEntityId === subjectId &&
            r.toEntityId === objectId &&
            r.type === triple.predicate,
        );
        if (!exists) {
          this.addRelationship({
            fromEntityId: subjectId,
            toEntityId: objectId,
            type: triple.predicate,
            weight: triple.confidence,
            bidirectional: false,
          });
        }
      } else {
        // Attribute triple — update entity attributes
        const entity = this.entities.get(subjectId);
        if (entity) {
          entity.attributes[triple.predicate] = triple.object;
          entity.updatedAt = new Date();
          entity.version++;
          this.entities.set(subjectId, entity);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): {
    entities: number;
    relationships: number;
    rules: number;
    avgConfidence: number;
  } {
    const allEntities = [...this.entities.values()];
    const avgConfidence =
      allEntities.length > 0
        ? allEntities.reduce((s, e) => s + e.confidence, 0) / allEntities.length
        : 0;

    return {
      entities: this.entities.size,
      relationships: this.relationships.size,
      rules: this.rules.size,
      avgConfidence: parseFloat(avgConfidence.toFixed(4)),
    };
  }

  // -------------------------------------------------------------------------
  // Serialization helpers for MemoryManager
  // -------------------------------------------------------------------------

  getRawEntities(): Map<string, Entity> {
    return new Map(this.entities);
  }

  getRawRelationships(): Map<string, Relationship> {
    return new Map(this.relationships);
  }

  getRawRules(): Map<string, InferenceRule> {
    return new Map(this.rules);
  }

  loadEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
    this._ensureAdjacency(entity.id);
  }

  loadRelationship(rel: Relationship): void {
    this.relationships.set(rel.id, rel);
    this._ensureAdjacency(rel.fromEntityId);
    this._ensureAdjacency(rel.toEntityId);
    this.outgoing.get(rel.fromEntityId)!.add(rel.id);
    this.incoming.get(rel.toEntityId)!.add(rel.id);
    if (rel.bidirectional) {
      this.outgoing.get(rel.toEntityId)!.add(rel.id);
      this.incoming.get(rel.fromEntityId)!.add(rel.id);
    }
  }

  loadRule(rule: InferenceRule): void {
    this.rules.set(rule.id, rule);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _ensureAdjacency(entityId: string): void {
    if (!this.outgoing.has(entityId)) this.outgoing.set(entityId, new Set());
    if (!this.incoming.has(entityId)) this.incoming.set(entityId, new Set());
  }

  private _removeEntityRelationships(entityId: string): void {
    for (const relId of [
      ...(this.outgoing.get(entityId) ?? []),
      ...(this.incoming.get(entityId) ?? []),
    ]) {
      const rel = this.relationships.get(relId);
      if (!rel) continue;
      this.relationships.delete(relId);
      this.outgoing.get(rel.fromEntityId)?.delete(relId);
      this.incoming.get(rel.toEntityId)?.delete(relId);
    }
  }

  private _resolveOrCreateEntity(
    nameOrId: string,
    agentId: string,
    confidence: number,
    source: string | undefined,
    nameIndex: Map<string, string>,
  ): string {
    if (this.entities.has(nameOrId)) return nameOrId;
    if (nameIndex.has(nameOrId)) return nameIndex.get(nameOrId)!;

    const entity = this.addEntity({
      agentId,
      type: 'unknown',
      name: nameOrId,
      attributes: {},
      confidence,
      sources: source ? [source] : [],
    });
    nameIndex.set(nameOrId, entity.id);
    return entity.id;
  }
}
