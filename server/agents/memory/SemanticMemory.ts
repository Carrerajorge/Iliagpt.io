import { randomUUID } from "crypto";
import pino from "pino";
import { VectorMemoryStore } from "./VectorMemoryStore.js";

const logger = pino({ name: "SemanticMemory" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Entity {
  entityId: string;
  label: string;
  type: string; // e.g. "person", "organization", "concept", "tool", "location"
  aliases: string[];
  properties: Record<string, unknown>;
  confidence: number; // 0-1
  createdAt: number;
  updatedAt: number;
  sourceEpisodeIds: string[];
}

export interface Relation {
  relationId: string;
  subjectId: string; // Entity ID
  predicate: string; // e.g. "uses", "works_for", "has_property", "is_a"
  objectId: string | string[]; // Entity ID or literal
  confidence: number; // 0-1
  evidenceCount: number;
  createdAt: number;
  updatedAt: number;
  /** IDs of the episodes that provided evidence for this relation */
  evidenceEpisodeIds: string[];
}

/** subject-predicate-object triple */
export type Triple = {
  subject: string;
  predicate: string;
  object: string;
};

export interface ConflictRecord {
  conflictId: string;
  triple: Triple;
  conflictingTriple: Triple;
  resolution: "kept_original" | "replaced" | "merged" | "pending";
  resolvedAt?: number;
  note?: string;
}

export interface EntityQuery {
  label?: string;
  type?: string;
  properties?: Record<string, unknown>;
  topK?: number;
}

export interface InferenceResult {
  triple: Triple;
  confidence: number;
  basis: string; // human-readable explanation
}

// ─── SemanticMemory ──────────────────────────────────────────────────────────

export class SemanticMemory {
  private entities = new Map<string, Entity>();
  /** label → entityId index */
  private labelIndex = new Map<string, string>();
  /** type → Set<entityId> */
  private typeIndex = new Map<string, Set<string>>();

  private relations = new Map<string, Relation>();
  /** subjectId:predicate → Set<relationId> */
  private relationIndex = new Map<string, Set<string>>();

  private conflicts: ConflictRecord[] = [];

  constructor(
    private readonly vectorStore: VectorMemoryStore,
    private readonly agentId: string
  ) {
    logger.info({ agentId }, "[SemanticMemory] Initialized");
  }

  // ── Entities ─────────────────────────────────────────────────────────────────

  async upsertEntity(
    label: string,
    type: string,
    properties: Record<string, unknown> = {},
    opts: {
      aliases?: string[];
      confidence?: number;
      sourceEpisodeId?: string;
    } = {}
  ): Promise<Entity> {
    const normalizedLabel = label.trim().toLowerCase();
    const existingId = this.labelIndex.get(normalizedLabel);

    if (existingId) {
      return this.mergeEntity(existingId, properties, opts);
    }

    const entityId = randomUUID();
    const entity: Entity = {
      entityId,
      label,
      type,
      aliases: opts.aliases ?? [],
      properties,
      confidence: opts.confidence ?? 0.8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceEpisodeIds: opts.sourceEpisodeId ? [opts.sourceEpisodeId] : [],
    };

    this.entities.set(entityId, entity);
    this.labelIndex.set(normalizedLabel, entityId);
    for (const alias of entity.aliases) {
      this.labelIndex.set(alias.toLowerCase(), entityId);
    }

    if (!this.typeIndex.has(type)) this.typeIndex.set(type, new Set());
    this.typeIndex.get(type)!.add(entityId);

    // Also index in vector store for fuzzy retrieval
    await this.vectorStore.upsert({
      id: `entity:${entityId}`,
      content: `${label} (${type}): ${JSON.stringify(properties).slice(0, 500)}`,
      metadata: { entityId, label, type, kind: "entity" },
      namespace: VectorMemoryStore.agentNamespace(this.agentId),
      importance: entity.confidence,
    });

    logger.debug({ entityId, label, type }, "[SemanticMemory] Entity created");
    return entity;
  }

  private async mergeEntity(
    entityId: string,
    newProperties: Record<string, unknown>,
    opts: { confidence?: number; sourceEpisodeId?: string; aliases?: string[] }
  ): Promise<Entity> {
    const existing = this.entities.get(entityId)!;

    const mergedProps = { ...existing.properties };
    for (const [k, v] of Object.entries(newProperties)) {
      if (k in mergedProps && mergedProps[k] !== v) {
        logger.debug(
          { entityId, key: k, old: mergedProps[k], new: v },
          "[SemanticMemory] Property conflict detected, keeping higher confidence value"
        );
      }
      mergedProps[k] = v;
    }

    const newAliases = [...new Set([...existing.aliases, ...(opts.aliases ?? [])])];
    const newSources = opts.sourceEpisodeId
      ? [...new Set([...existing.sourceEpisodeIds, opts.sourceEpisodeId])]
      : existing.sourceEpisodeIds;

    const updated: Entity = {
      ...existing,
      properties: mergedProps,
      aliases: newAliases,
      confidence: Math.max(existing.confidence, opts.confidence ?? 0),
      updatedAt: Date.now(),
      sourceEpisodeIds: newSources,
    };

    this.entities.set(entityId, updated);

    // Update vector store
    await this.vectorStore.upsert({
      id: `entity:${entityId}`,
      content: `${updated.label} (${updated.type}): ${JSON.stringify(updated.properties).slice(0, 500)}`,
      metadata: { entityId, label: updated.label, type: updated.type, kind: "entity" },
      namespace: VectorMemoryStore.agentNamespace(this.agentId),
      importance: updated.confidence,
    });

    return updated;
  }

  getEntity(entityId: string): Entity | null {
    return this.entities.get(entityId) ?? null;
  }

  findEntity(label: string): Entity | null {
    const id = this.labelIndex.get(label.trim().toLowerCase());
    if (!id) return null;
    return this.entities.get(id) ?? null;
  }

  async searchEntities(query: EntityQuery): Promise<Entity[]> {
    const { label, type, topK = 10 } = query;

    let candidates: Entity[] = [];

    if (label) {
      // Semantic search
      const result = await this.vectorStore.query(label, {
        namespace: VectorMemoryStore.agentNamespace(this.agentId),
        topK: topK * 2,
        filters: { kind: "entity" },
      });
      candidates = result.records
        .map((r) => this.entities.get(String(r.metadata.entityId)))
        .filter((e): e is Entity => e !== undefined);
    } else {
      candidates = Array.from(this.entities.values());
    }

    if (type) candidates = candidates.filter((e) => e.type === type);

    if (query.properties) {
      candidates = candidates.filter((e) =>
        Object.entries(query.properties!).every(
          ([k, v]) => e.properties[k] === v
        )
      );
    }

    return candidates.slice(0, topK);
  }

  getEntitiesByType(type: string): Entity[] {
    const ids = this.typeIndex.get(type) ?? new Set();
    return Array.from(ids)
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => e !== undefined);
  }

  // ── Relations ─────────────────────────────────────────────────────────────────

  async addRelation(
    subjectId: string,
    predicate: string,
    objectId: string | string[],
    opts: {
      confidence?: number;
      evidenceEpisodeId?: string;
    } = {}
  ): Promise<Relation> {
    if (!this.entities.has(subjectId)) {
      throw new Error(`Subject entity '${subjectId}' does not exist`);
    }

    // Check for conflicts
    const existing = this.findRelation(subjectId, predicate);
    if (existing && existing.objectId !== objectId) {
      await this.handleConflict(
        { subject: subjectId, predicate, object: String(existing.objectId) },
        { subject: subjectId, predicate, object: String(objectId) }
      );
    }

    const key = `${subjectId}:${predicate}`;
    const existingIds = this.relationIndex.get(key) ?? new Set();

    // If same relation already exists, reinforce it
    for (const relId of existingIds) {
      const rel = this.relations.get(relId);
      if (rel && rel.objectId === objectId) {
        const updated: Relation = {
          ...rel,
          confidence: Math.min(1, rel.confidence + 0.05),
          evidenceCount: rel.evidenceCount + 1,
          updatedAt: Date.now(),
          evidenceEpisodeIds: opts.evidenceEpisodeId
            ? [...new Set([...rel.evidenceEpisodeIds, opts.evidenceEpisodeId])]
            : rel.evidenceEpisodeIds,
        };
        this.relations.set(relId, updated);
        return updated;
      }
    }

    const relation: Relation = {
      relationId: randomUUID(),
      subjectId,
      predicate,
      objectId,
      confidence: opts.confidence ?? 0.7,
      evidenceCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      evidenceEpisodeIds: opts.evidenceEpisodeId ? [opts.evidenceEpisodeId] : [],
    };

    this.relations.set(relation.relationId, relation);
    if (!this.relationIndex.has(key)) this.relationIndex.set(key, new Set());
    this.relationIndex.get(key)!.add(relation.relationId);

    // Also store in vector store for semantic relation search
    const subject = this.entities.get(subjectId);
    await this.vectorStore.upsert({
      id: `relation:${relation.relationId}`,
      content: `${subject?.label ?? subjectId} ${predicate} ${String(objectId)}`,
      metadata: { relationId: relation.relationId, subjectId, predicate, kind: "relation" },
      namespace: VectorMemoryStore.agentNamespace(this.agentId),
      importance: relation.confidence,
    });

    logger.debug(
      { subjectId, predicate, objectId },
      "[SemanticMemory] Relation added"
    );
    return relation;
  }

  findRelation(subjectId: string, predicate: string): Relation | null {
    const key = `${subjectId}:${predicate}`;
    const ids = this.relationIndex.get(key);
    if (!ids?.size) return null;
    return this.relations.get(ids.values().next().value!) ?? null;
  }

  getRelationsForSubject(subjectId: string): Relation[] {
    const results: Relation[] = [];
    for (const [key, ids] of this.relationIndex.entries()) {
      if (!key.startsWith(subjectId + ":")) continue;
      for (const id of ids) {
        const rel = this.relations.get(id);
        if (rel) results.push(rel);
      }
    }
    return results;
  }

  getRelationsForPredicate(predicate: string): Relation[] {
    return Array.from(this.relations.values()).filter(
      (r) => r.predicate === predicate
    );
  }

  // ── Conflict resolution ───────────────────────────────────────────────────────

  private async handleConflict(existing: Triple, incoming: Triple): Promise<void> {
    const conflict: ConflictRecord = {
      conflictId: randomUUID(),
      triple: existing,
      conflictingTriple: incoming,
      resolution: "pending",
    };

    this.conflicts.push(conflict);

    logger.warn(
      { existing, incoming },
      "[SemanticMemory] Knowledge conflict detected"
    );
  }

  resolveConflict(
    conflictId: string,
    resolution: ConflictRecord["resolution"],
    note?: string
  ): void {
    const conflict = this.conflicts.find((c) => c.conflictId === conflictId);
    if (!conflict) return;

    conflict.resolution = resolution;
    conflict.resolvedAt = Date.now();
    conflict.note = note;

    if (resolution === "replaced") {
      // Remove the old relation and let the new one stand
      const key = `${conflict.triple.subject}:${conflict.triple.predicate}`;
      this.relationIndex.delete(key);
    }

    logger.info({ conflictId, resolution }, "[SemanticMemory] Conflict resolved");
  }

  getPendingConflicts(): ConflictRecord[] {
    return this.conflicts.filter((c) => c.resolution === "pending");
  }

  // ── Inference ─────────────────────────────────────────────────────────────────

  infer(subjectId: string): InferenceResult[] {
    const results: InferenceResult[] = [];
    const directRelations = this.getRelationsForSubject(subjectId);
    const subject = this.entities.get(subjectId);
    if (!subject) return results;

    // Transitivity: if A is_a B and B has_property X, then A has_property X
    for (const rel of directRelations) {
      if (rel.predicate === "is_a" && typeof rel.objectId === "string") {
        const parentRelations = this.getRelationsForSubject(rel.objectId);
        for (const parentRel of parentRelations) {
          if (parentRel.predicate === "has_property") {
            results.push({
              triple: {
                subject: subjectId,
                predicate: "has_property",
                object: String(parentRel.objectId),
              },
              confidence: rel.confidence * parentRel.confidence,
              basis: `Inferred from transitivity: ${subject.label} is_a ${this.entities.get(rel.objectId)?.label ?? rel.objectId}`,
            });
          }
        }
      }
    }

    // Symmetry: if A knows B, infer B knows A
    for (const rel of directRelations) {
      if (rel.predicate === "knows" && typeof rel.objectId === "string") {
        const reverseExists = this.findRelation(rel.objectId, "knows");
        if (!reverseExists) {
          results.push({
            triple: { subject: rel.objectId, predicate: "knows", object: subjectId },
            confidence: rel.confidence * 0.8,
            basis: `Inferred from symmetry of 'knows' relation`,
          });
        }
      }
    }

    return results.filter((r) => r.confidence > 0.3);
  }

  // ── Triple API ────────────────────────────────────────────────────────────────

  async assertTriple(triple: Triple, confidence = 0.7): Promise<void> {
    let subject = this.findEntity(triple.subject);
    if (!subject) {
      subject = await this.upsertEntity(triple.subject, "unknown", {}, { confidence });
    }

    let object = this.findEntity(triple.object);
    if (!object) {
      object = await this.upsertEntity(triple.object, "unknown", {}, { confidence });
    }

    await this.addRelation(subject.entityId, triple.predicate, object.entityId, {
      confidence,
    });
  }

  async queryTriples(
    subject?: string,
    predicate?: string,
    topK = 20
  ): Promise<Relation[]> {
    let results = Array.from(this.relations.values());

    if (subject) {
      const entity = this.findEntity(subject);
      if (entity) results = results.filter((r) => r.subjectId === entity.entityId);
      else results = [];
    }

    if (predicate) {
      results = results.filter((r) => r.predicate === predicate);
    }

    return results
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, topK);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  getStats() {
    return {
      entities: this.entities.size,
      relations: this.relations.size,
      entityTypes: Array.from(this.typeIndex.entries()).map(([type, ids]) => ({
        type,
        count: ids.size,
      })),
      pendingConflicts: this.conflicts.filter((c) => c.resolution === "pending").length,
      resolvedConflicts: this.conflicts.filter((c) => c.resolution !== "pending").length,
    };
  }

  exportGraph(): { entities: Entity[]; relations: Relation[] } {
    return {
      entities: Array.from(this.entities.values()),
      relations: Array.from(this.relations.values()),
    };
  }
}
