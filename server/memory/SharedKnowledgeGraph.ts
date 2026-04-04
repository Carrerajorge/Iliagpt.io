/**
 * SharedKnowledgeGraph — cross-agent entity/relationship store backed by Redis.
 * Entities and relationships are stored in Redis Hashes; lookup sets provide index.
 */

import crypto from "crypto"
import { redis } from "../lib/redis"
import { llmGateway } from "../lib/llmGateway"
import { Logger } from "../lib/logger"

// ─── Types ─────────────────────────────────────────────────────────────────────

export type EntityType =
  | "person"
  | "organization"
  | "concept"
  | "technology"
  | "event"
  | "place"
  | "document"

export interface Entity {
  id: string
  type: EntityType
  name: string
  aliases: string[]
  properties: Record<string, unknown>
  confidence: number
  sources: string[]
  createdAt: Date
  updatedAt: Date
}

export interface Relationship {
  id: string
  fromEntityId: string
  toEntityId: string
  type: string
  confidence: number
  properties?: Record<string, unknown>
  source: string
  createdAt: Date
}

export interface KnowledgeQuery {
  entityName?: string
  entityType?: string
  relationshipType?: string
  fromEntityId?: string
  toEntityId?: string
  minConfidence?: number
  limit?: number
}

// ─── Redis key helpers ─────────────────────────────────────────────────────────

const ENTITY_KEY = (id: string) => `kg:entity:${id}`
const REL_KEY = (id: string) => `kg:rel:${id}`
const ENTITY_NAME_INDEX = (normalizedKey: string) => `kg:idx:name:${normalizedKey}`
const ENTITY_TYPE_INDEX = (type: string) => `kg:idx:type:${type}`
const ENTITY_REL_INDEX = (entityId: string) => `kg:idx:rels:${entityId}`
const STATS_KEY = "kg:stats"
const CONFLICT_LOG_KEY = "kg:conflicts"

// ─── Graph ────────────────────────────────────────────────────────────────────

class SharedKnowledgeGraph {
  // ── addEntity ────────────────────────────────────────────────────────────────

  async addEntity(
    entity: Omit<Entity, "id" | "createdAt" | "updatedAt">
  ): Promise<Entity> {
    const normalizedKey = this.generateEntityKey(entity.name, entity.type)

    // Deduplication: check if entity with same normalized name+type exists
    const existingId = await redis.get(ENTITY_NAME_INDEX(normalizedKey))
    if (existingId) {
      const existing = await this.getEntity(existingId)
      if (existing) {
        return this.mergeEntity(existing, entity)
      }
    }

    const now = new Date()
    const id = crypto.randomUUID()
    const full: Entity = {
      id,
      ...entity,
      createdAt: now,
      updatedAt: now,
    }

    await redis.set(ENTITY_KEY(id), JSON.stringify(full))
    await redis.set(ENTITY_NAME_INDEX(normalizedKey), id)
    await redis.sadd(ENTITY_TYPE_INDEX(entity.type), id)

    // Update stats
    await redis.hincrby(STATS_KEY, "totalEntities", 1)
    await redis.hincrby(STATS_KEY, `type:${entity.type}`, 1)

    Logger.debug("[SharedKnowledgeGraph] entity added", { id, name: entity.name, type: entity.type })
    return full
  }

  private async mergeEntity(
    existing: Entity,
    incoming: Omit<Entity, "id" | "createdAt" | "updatedAt">
  ): Promise<Entity> {
    const updated: Entity = {
      ...existing,
      // Merge aliases (union)
      aliases: Array.from(new Set([...existing.aliases, ...incoming.aliases, incoming.name])).filter(
        (a) => a !== existing.name
      ),
      // Merge properties: higher-confidence source wins per key
      properties:
        incoming.confidence >= existing.confidence
          ? { ...existing.properties, ...incoming.properties }
          : { ...incoming.properties, ...existing.properties },
      // Keep max confidence
      confidence: Math.max(existing.confidence, incoming.confidence),
      // Union sources
      sources: Array.from(new Set([...existing.sources, ...incoming.sources])),
      updatedAt: new Date(),
    }

    await redis.set(ENTITY_KEY(existing.id), JSON.stringify(updated))
    Logger.debug("[SharedKnowledgeGraph] entity merged", { id: existing.id })
    return updated
  }

  // ── addRelationship ───────────────────────────────────────────────────────────

  async addRelationship(
    rel: Omit<Relationship, "id" | "createdAt">
  ): Promise<Relationship> {
    const id = crypto.randomUUID()
    const full: Relationship = {
      id,
      ...rel,
      createdAt: new Date(),
    }

    await redis.set(REL_KEY(id), JSON.stringify(full))
    // Index by both endpoints
    await redis.sadd(ENTITY_REL_INDEX(rel.fromEntityId), id)
    await redis.sadd(ENTITY_REL_INDEX(rel.toEntityId), id)

    await redis.hincrby(STATS_KEY, "totalRelationships", 1)
    Logger.debug("[SharedKnowledgeGraph] relationship added", { id, type: rel.type })
    return full
  }

  // ── getEntity ────────────────────────────────────────────────────────────────

  async getEntity(id: string): Promise<Entity | null> {
    try {
      const raw = await redis.get(ENTITY_KEY(id))
      if (!raw) return null
      const parsed = JSON.parse(raw) as Entity
      parsed.createdAt = new Date(parsed.createdAt)
      parsed.updatedAt = new Date(parsed.updatedAt)
      return parsed
    } catch (err) {
      Logger.error("[SharedKnowledgeGraph] getEntity failed", err)
      return null
    }
  }

  // ── findEntities ──────────────────────────────────────────────────────────────

  async findEntities(query: KnowledgeQuery): Promise<Entity[]> {
    const { entityName, entityType, minConfidence = 0, limit = 20 } = query
    let ids: string[] = []

    try {
      if (entityName) {
        // Exact name match via index
        const normalizedKey = this.generateEntityKey(entityName, entityType ?? "concept")
        const exactId = await redis.get(ENTITY_NAME_INDEX(normalizedKey))
        if (exactId) ids.push(exactId)

        // Also try type-agnostic search: iterate all types if no type specified
        if (!entityType) {
          for (const t of [
            "person",
            "organization",
            "concept",
            "technology",
            "event",
            "place",
            "document",
          ] as EntityType[]) {
            const k = this.generateEntityKey(entityName, t)
            const id = await redis.get(ENTITY_NAME_INDEX(k))
            if (id && !ids.includes(id)) ids.push(id)
          }
        }
      } else if (entityType) {
        ids = await redis.smembers(ENTITY_TYPE_INDEX(entityType))
      }

      if (ids.length === 0) return []

      const entities = await Promise.all(ids.slice(0, limit * 2).map((id) => this.getEntity(id)))
      return entities
        .filter((e): e is Entity => e !== null && e.confidence >= minConfidence)
        .slice(0, limit)
    } catch (err) {
      Logger.error("[SharedKnowledgeGraph] findEntities failed", err)
      return []
    }
  }

  // ── findRelationships ─────────────────────────────────────────────────────────

  async findRelationships(query: KnowledgeQuery): Promise<Relationship[]> {
    const { fromEntityId, toEntityId, relationshipType, minConfidence = 0, limit = 50 } = query
    let relIds: string[] = []

    try {
      if (fromEntityId) {
        relIds = await redis.smembers(ENTITY_REL_INDEX(fromEntityId))
      } else if (toEntityId) {
        relIds = await redis.smembers(ENTITY_REL_INDEX(toEntityId))
      }

      if (relIds.length === 0) return []

      const rels = await Promise.all(relIds.slice(0, limit * 2).map((id) => this.getRelationship(id)))
      return rels
        .filter(
          (r): r is Relationship =>
            r !== null &&
            r.confidence >= minConfidence &&
            (!relationshipType || r.type === relationshipType) &&
            (!fromEntityId || r.fromEntityId === fromEntityId) &&
            (!toEntityId || r.toEntityId === toEntityId)
        )
        .slice(0, limit)
    } catch (err) {
      Logger.error("[SharedKnowledgeGraph] findRelationships failed", err)
      return []
    }
  }

  private async getRelationship(id: string): Promise<Relationship | null> {
    try {
      const raw = await redis.get(REL_KEY(id))
      if (!raw) return null
      const parsed = JSON.parse(raw) as Relationship
      parsed.createdAt = new Date(parsed.createdAt)
      return parsed
    } catch {
      return null
    }
  }

  // ── getNeighbors ──────────────────────────────────────────────────────────────

  async getNeighbors(
    entityId: string,
    depth: number = 1
  ): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
    const visitedEntities = new Set<string>([entityId])
    const visitedRels = new Set<string>()
    const entities: Entity[] = []
    const relationships: Relationship[] = []
    const queue: Array<{ id: string; currentDepth: number }> = [{ id: entityId, currentDepth: 0 }]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.currentDepth >= depth) continue

      const relIds = await redis.smembers(ENTITY_REL_INDEX(current.id))
      for (const relId of relIds) {
        if (visitedRels.has(relId)) continue
        visitedRels.add(relId)

        const rel = await this.getRelationship(relId)
        if (!rel) continue
        relationships.push(rel)

        const neighborId =
          rel.fromEntityId === current.id ? rel.toEntityId : rel.fromEntityId
        if (!visitedEntities.has(neighborId)) {
          visitedEntities.add(neighborId)
          const neighbor = await this.getEntity(neighborId)
          if (neighbor) {
            entities.push(neighbor)
            queue.push({ id: neighborId, currentDepth: current.currentDepth + 1 })
          }
        }
      }
    }

    return { entities, relationships }
  }

  // ── query (natural language) ──────────────────────────────────────────────────

  async query(
    naturalLanguage: string
  ): Promise<{ entities: Entity[]; relationships: Relationship[]; answer?: string }> {
    Logger.debug("[SharedKnowledgeGraph] natural language query", { query: naturalLanguage })

    const prompt = `You are a knowledge graph query parser. Convert this natural language query into a structured query.

Return JSON with this exact format:
{
  "entityName": "string or null",
  "entityType": "person|organization|concept|technology|event|place|document|null",
  "relationshipType": "string or null",
  "intent": "find_entity|find_relationships|find_neighbors"
}

Query: "${naturalLanguage}"
Respond with only valid JSON.`

    try {
      const response = await llmGateway.chat(
        [{ role: "user", content: prompt }],
        { maxTokens: 150, temperature: 0 }
      )
      const jsonMatch = response.content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error("No JSON")
      const parsed = JSON.parse(jsonMatch[0]) as {
        entityName?: string | null
        entityType?: string | null
        relationshipType?: string | null
        intent?: string
      }

      const kq: KnowledgeQuery = {
        entityName: parsed.entityName ?? undefined,
        entityType: parsed.entityType ?? undefined,
        relationshipType: parsed.relationshipType ?? undefined,
        limit: 10,
      }

      const foundEntities = await this.findEntities(kq)
      const foundRels: Relationship[] = []

      if (foundEntities.length > 0 && parsed.intent === "find_neighbors") {
        const { entities: neighbors, relationships } = await this.getNeighbors(
          foundEntities[0].id,
          2
        )
        return {
          entities: [foundEntities[0], ...neighbors],
          relationships,
          answer: `Found ${foundEntities[0].name} with ${neighbors.length} connected entities.`,
        }
      }

      for (const entity of foundEntities) {
        const rels = await this.findRelationships({ fromEntityId: entity.id })
        foundRels.push(...rels)
      }

      return { entities: foundEntities, relationships: foundRels }
    } catch (err) {
      Logger.warn("[SharedKnowledgeGraph] query parsing failed", err)
      return { entities: [], relationships: [] }
    }
  }

  // ── contribute ────────────────────────────────────────────────────────────────

  async contribute(
    agentId: string,
    entities: Partial<Entity>[],
    relationships: Partial<Relationship>[]
  ): Promise<void> {
    Logger.info("[SharedKnowledgeGraph] agent contribution", {
      agentId,
      entityCount: entities.length,
      relCount: relationships.length,
    })

    const entityIdMap = new Map<string, string>() // temp name → real id

    for (const e of entities) {
      if (!e.name || !e.type) continue
      const full = await this.addEntity({
        type: e.type as EntityType,
        name: e.name,
        aliases: e.aliases ?? [],
        properties: e.properties ?? {},
        confidence: e.confidence ?? 0.7,
        sources: [agentId, ...(e.sources ?? [])],
      })
      if (e.id) entityIdMap.set(e.id, full.id)
    }

    for (const r of relationships) {
      if (!r.fromEntityId || !r.toEntityId || !r.type) continue
      const fromId = entityIdMap.get(r.fromEntityId) ?? r.fromEntityId
      const toId = entityIdMap.get(r.toEntityId) ?? r.toEntityId
      await this.addRelationship({
        fromEntityId: fromId,
        toEntityId: toId,
        type: r.type,
        confidence: r.confidence ?? 0.7,
        properties: r.properties,
        source: agentId,
      })
    }
  }

  // ── resolveConflict ───────────────────────────────────────────────────────────

  async resolveConflict(
    entityId: string,
    conflictingProperties: Record<string, unknown[]>
  ): Promise<void> {
    const entity = await this.getEntity(entityId)
    if (!entity) return

    // Log conflict
    await redis.lpush(
      CONFLICT_LOG_KEY,
      JSON.stringify({
        entityId,
        conflictingProperties,
        resolvedAt: new Date().toISOString(),
      })
    )
    await redis.ltrim(CONFLICT_LOG_KEY, 0, 999) // keep last 1000 conflict logs

    // Resolution: for each conflicting property, highest confidence source wins.
    // Since we don't have per-property confidence, use entity confidence as proxy.
    // Simply keep first value (the one stored from highest-confidence source).
    const resolved: Record<string, unknown> = {}
    for (const [key, values] of Object.entries(conflictingProperties)) {
      resolved[key] = values[0] // first = highest confidence
    }

    const updated: Entity = {
      ...entity,
      properties: { ...entity.properties, ...resolved },
      updatedAt: new Date(),
    }
    await redis.set(ENTITY_KEY(entityId), JSON.stringify(updated))
    Logger.info("[SharedKnowledgeGraph] conflict resolved", { entityId })
  }

  // ── exportSubgraph ────────────────────────────────────────────────────────────

  async exportSubgraph(
    entityIds: string[]
  ): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
    const entities: Entity[] = []
    const relationships: Relationship[] = []
    const relSeen = new Set<string>()
    const entityIdSet = new Set(entityIds)

    for (const id of entityIds) {
      const entity = await this.getEntity(id)
      if (entity) entities.push(entity)

      const relIds = await redis.smembers(ENTITY_REL_INDEX(id))
      for (const relId of relIds) {
        if (relSeen.has(relId)) continue
        relSeen.add(relId)
        const rel = await this.getRelationship(relId)
        if (rel && entityIdSet.has(rel.fromEntityId) && entityIdSet.has(rel.toEntityId)) {
          relationships.push(rel)
        }
      }
    }

    return { entities, relationships }
  }

  // ── getStats ──────────────────────────────────────────────────────────────────

  async getStats(): Promise<{
    totalEntities: number
    totalRelationships: number
    byType: Record<string, number>
  }> {
    try {
      const raw = await redis.hgetall(STATS_KEY)
      if (!raw) return { totalEntities: 0, totalRelationships: 0, byType: {} }

      const byType: Record<string, number> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith("type:")) {
          byType[k.replace("type:", "")] = parseInt(v, 10)
        }
      }

      return {
        totalEntities: parseInt(raw.totalEntities ?? "0", 10),
        totalRelationships: parseInt(raw.totalRelationships ?? "0", 10),
        byType,
      }
    } catch (err) {
      Logger.error("[SharedKnowledgeGraph] getStats failed", err)
      return { totalEntities: 0, totalRelationships: 0, byType: {} }
    }
  }

  // ── private helpers ───────────────────────────────────────────────────────────

  private normalizeEntityName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, "_")
  }

  private generateEntityKey(name: string, type: string): string {
    return `${type}::${this.normalizeEntityName(name)}`
  }
}

export const sharedKnowledgeGraph = new SharedKnowledgeGraph()
