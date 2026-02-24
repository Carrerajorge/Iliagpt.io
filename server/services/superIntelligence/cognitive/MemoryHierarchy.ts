/**
 * SUPERINTELLIGENCE - Memory Hierarchy
 * Sistema de memoria jerárquica persistente (corto/medio/largo plazo)
 * Fase 3: Arquitectura Cognitiva - Componente de Memoria
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';
import { redis } from '../../../lib/redis';

// Tipos de memoria
export type MemoryTier = 'working' | 'short_term' | 'long_term' | 'episodic' | 'semantic' | 'procedural';

export interface MemoryItem {
  id: string;
  tier: MemoryTier;
  content: string;
  contentType: ContentType;
  importance: number; // 0-1
  activation: number; // 0-1 (qué tan "activa" está)
  accessCount: number;
  lastAccessed: Date;
  createdAt: Date;
  expiresAt?: Date;
  associations: Association[];
  metadata: MemoryMetadata;
  embedding?: number[];
  compressed?: boolean;
}

export type ContentType = 'fact' | 'concept' | 'procedure' | 'episode' | 'skill' | 'preference' | 'context';

export interface Association {
  targetId: string;
  type: AssociationType;
  strength: number; // 0-1
  bidirectional: boolean;
}

export type AssociationType = 'semantic' | 'temporal' | 'causal' | 'part_of' | 'similar' | 'opposite' | 'prerequisite';

export interface MemoryMetadata {
  source: string;
  context?: string;
  tags: string[];
  confidence: number;
  userId?: string;
  sessionId?: string;
}

export interface MemoryQuery {
  text?: string;
  tier?: MemoryTier;
  contentType?: ContentType;
  tags?: string[];
  minImportance?: number;
  minActivation?: number;
  limit?: number;
  userId?: string;
}

export interface MemorySearchResult {
  item: MemoryItem;
  relevance: number;
  matchType: 'exact' | 'semantic' | 'association';
}

export interface ConsolidationResult {
  promoted: number;
  demoted: number;
  compressed: number;
  deleted: number;
}

// Configuración por tier
const TIER_CONFIG: Record<MemoryTier, {
  maxItems: number;
  defaultTTL: number; // segundos (0 = sin expiración)
  activationDecay: number; // factor de decaimiento por hora
  importanceThreshold: number; // umbral para promoción
}> = {
  working: {
    maxItems: 50,
    defaultTTL: 3600, // 1 hora
    activationDecay: 0.5,
    importanceThreshold: 0,
  },
  short_term: {
    maxItems: 500,
    defaultTTL: 86400, // 24 horas
    activationDecay: 0.8,
    importanceThreshold: 0.3,
  },
  long_term: {
    maxItems: 10000,
    defaultTTL: 0, // sin expiración
    activationDecay: 0.95,
    importanceThreshold: 0.5,
  },
  episodic: {
    maxItems: 5000,
    defaultTTL: 0,
    activationDecay: 0.9,
    importanceThreshold: 0.4,
  },
  semantic: {
    maxItems: 20000,
    defaultTTL: 0,
    activationDecay: 0.98,
    importanceThreshold: 0.6,
  },
  procedural: {
    maxItems: 2000,
    defaultTTL: 0,
    activationDecay: 0.99,
    importanceThreshold: 0.7,
  },
};

export class MemoryHierarchy extends EventEmitter {
  private static instance: MemoryHierarchy;
  private memories: Map<MemoryTier, Map<string, MemoryItem>> = new Map();
  private associationIndex: Map<string, Set<string>> = new Map();
  private readonly REDIS_PREFIX = 'memory:hierarchy:';
  private consolidationInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.initializeTiers();
  }

  static getInstance(): MemoryHierarchy {
    if (!MemoryHierarchy.instance) {
      MemoryHierarchy.instance = new MemoryHierarchy();
    }
    return MemoryHierarchy.instance;
  }

  private initializeTiers(): void {
    for (const tier of Object.keys(TIER_CONFIG) as MemoryTier[]) {
      this.memories.set(tier, new Map());
    }
  }

  /**
   * Almacenar item en memoria
   */
  store(
    content: string,
    tier: MemoryTier,
    contentType: ContentType,
    metadata: Partial<MemoryMetadata> = {}
  ): MemoryItem {
    const config = TIER_CONFIG[tier];
    const tierMemory = this.memories.get(tier)!;

    // Verificar límite
    if (tierMemory.size >= config.maxItems) {
      this.evictLeastImportant(tier);
    }

    const item: MemoryItem = {
      id: this.generateId(),
      tier,
      content,
      contentType,
      importance: this.calculateInitialImportance(content, contentType),
      activation: 1.0, // Nueva memoria está completamente activa
      accessCount: 0,
      lastAccessed: new Date(),
      createdAt: new Date(),
      expiresAt: config.defaultTTL > 0 ? new Date(Date.now() + config.defaultTTL * 1000) : undefined,
      associations: [],
      metadata: {
        source: metadata.source || 'user',
        context: metadata.context,
        tags: metadata.tags || [],
        confidence: metadata.confidence || 0.8,
        userId: metadata.userId,
        sessionId: metadata.sessionId,
      },
    };

    tierMemory.set(item.id, item);
    this.emit('memory-stored', { item, tier });

    Logger.debug(`[MemoryHierarchy] Stored item ${item.id} in ${tier}`);

    return item;
  }

  /**
   * Recuperar item por ID
   */
  retrieve(id: string): MemoryItem | null {
    for (const [tier, tierMemory] of this.memories) {
      const item = tierMemory.get(id);
      if (item) {
        // Actualizar acceso
        item.accessCount++;
        item.lastAccessed = new Date();
        item.activation = Math.min(1, item.activation + 0.1); // Boost de activación

        this.emit('memory-accessed', { item, tier });
        return item;
      }
    }
    return null;
  }

  /**
   * Buscar en memoria
   */
  search(query: MemoryQuery): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];
    const tiers = query.tier ? [query.tier] : Array.from(this.memories.keys());

    for (const tier of tiers) {
      const tierMemory = this.memories.get(tier as MemoryTier);
      if (!tierMemory) continue;

      for (const item of tierMemory.values()) {
        // Filtrar por tipo de contenido
        if (query.contentType && item.contentType !== query.contentType) continue;

        // Filtrar por importancia
        if (query.minImportance && item.importance < query.minImportance) continue;

        // Filtrar por activación
        if (query.minActivation && item.activation < query.minActivation) continue;

        // Filtrar por usuario
        if (query.userId && item.metadata.userId !== query.userId) continue;

        // Filtrar por tags
        if (query.tags && query.tags.length > 0) {
          const hasTag = query.tags.some(tag => item.metadata.tags.includes(tag));
          if (!hasTag) continue;
        }

        // Calcular relevancia
        let relevance = item.importance * item.activation;
        let matchType: 'exact' | 'semantic' | 'association' = 'semantic';

        if (query.text) {
          const textRelevance = this.calculateTextRelevance(query.text, item.content);
          relevance *= textRelevance;

          if (item.content.toLowerCase().includes(query.text.toLowerCase())) {
            matchType = 'exact';
            relevance *= 1.5;
          }
        }

        if (relevance > 0.1) {
          results.push({ item, relevance, matchType });
        }
      }
    }

    // Ordenar por relevancia
    results.sort((a, b) => b.relevance - a.relevance);

    // Actualizar acceso de resultados retornados
    const limit = query.limit || 10;
    const topResults = results.slice(0, limit);

    for (const result of topResults) {
      result.item.accessCount++;
      result.item.lastAccessed = new Date();
    }

    return topResults;
  }

  /**
   * Crear asociación entre items
   */
  associate(
    sourceId: string,
    targetId: string,
    type: AssociationType,
    strength: number = 0.5,
    bidirectional: boolean = true
  ): boolean {
    const source = this.retrieve(sourceId);
    const target = this.retrieve(targetId);

    if (!source || !target) return false;

    // Agregar asociación
    const association: Association = {
      targetId,
      type,
      strength: Math.min(1, Math.max(0, strength)),
      bidirectional,
    };

    source.associations.push(association);

    // Actualizar índice
    const sourceAssociations = this.associationIndex.get(sourceId) || new Set();
    sourceAssociations.add(targetId);
    this.associationIndex.set(sourceId, sourceAssociations);

    // Si es bidireccional, agregar en reversa
    if (bidirectional) {
      const reverseAssociation: Association = {
        targetId: sourceId,
        type,
        strength,
        bidirectional: true,
      };
      target.associations.push(reverseAssociation);

      const targetAssociations = this.associationIndex.get(targetId) || new Set();
      targetAssociations.add(sourceId);
      this.associationIndex.set(targetId, targetAssociations);
    }

    this.emit('association-created', { sourceId, targetId, type });
    return true;
  }

  /**
   * Obtener items asociados
   */
  getAssociated(itemId: string, type?: AssociationType): MemoryItem[] {
    const item = this.retrieve(itemId);
    if (!item) return [];

    const associated: MemoryItem[] = [];

    for (const association of item.associations) {
      if (type && association.type !== type) continue;

      const target = this.retrieve(association.targetId);
      if (target) {
        associated.push(target);
      }
    }

    return associated.sort((a, b) => {
      const aAssoc = item.associations.find(assoc => assoc.targetId === a.id);
      const bAssoc = item.associations.find(assoc => assoc.targetId === b.id);
      return (bAssoc?.strength || 0) - (aAssoc?.strength || 0);
    });
  }

  /**
   * Consolidar memorias (promover, degradar, comprimir)
   */
  async consolidate(): Promise<ConsolidationResult> {
    Logger.info('[MemoryHierarchy] Starting memory consolidation');

    const result: ConsolidationResult = {
      promoted: 0,
      demoted: 0,
      compressed: 0,
      deleted: 0,
    };

    const now = Date.now();

    // Procesar cada tier
    for (const [tier, tierMemory] of this.memories) {
      const config = TIER_CONFIG[tier as MemoryTier];
      const toDelete: string[] = [];
      const toPromote: MemoryItem[] = [];
      const toDemote: MemoryItem[] = [];

      for (const [id, item] of tierMemory) {
        // Aplicar decaimiento de activación
        const hoursSinceAccess = (now - item.lastAccessed.getTime()) / (1000 * 60 * 60);
        item.activation *= Math.pow(config.activationDecay, hoursSinceAccess);

        // Verificar expiración
        if (item.expiresAt && item.expiresAt.getTime() < now) {
          toDelete.push(id);
          continue;
        }

        // Determinar promoción o degradación
        if (item.importance >= config.importanceThreshold && item.accessCount > 5) {
          // Candidato a promoción
          const nextTier = this.getNextTier(tier as MemoryTier);
          if (nextTier) {
            toPromote.push(item);
          }
        } else if (item.activation < 0.1 && item.accessCount < 2) {
          // Candidato a degradación o eliminación
          const prevTier = this.getPrevTier(tier as MemoryTier);
          if (prevTier) {
            toDemote.push(item);
          } else if (tier !== 'working') {
            toDelete.push(id);
          }
        }
      }

      // Ejecutar eliminaciones
      for (const id of toDelete) {
        tierMemory.delete(id);
        result.deleted++;
      }

      // Ejecutar promociones
      for (const item of toPromote) {
        const nextTier = this.getNextTier(tier as MemoryTier)!;
        this.moveTier(item, nextTier);
        result.promoted++;
      }

      // Ejecutar degradaciones
      for (const item of toDemote) {
        const prevTier = this.getPrevTier(tier as MemoryTier)!;
        this.moveTier(item, prevTier);
        result.demoted++;
      }
    }

    Logger.info(`[MemoryHierarchy] Consolidation complete: ${JSON.stringify(result)}`);
    this.emit('consolidation-complete', result);

    return result;
  }

  /**
   * Mover item a otro tier
   */
  private moveTier(item: MemoryItem, newTier: MemoryTier): void {
    const oldTierMemory = this.memories.get(item.tier);
    const newTierMemory = this.memories.get(newTier);

    if (!oldTierMemory || !newTierMemory) return;

    // Remover de tier actual
    oldTierMemory.delete(item.id);

    // Actualizar tier
    item.tier = newTier;

    // Agregar a nuevo tier
    newTierMemory.set(item.id, item);
  }

  /**
   * Obtener siguiente tier (para promoción)
   */
  private getNextTier(tier: MemoryTier): MemoryTier | null {
    const hierarchy: MemoryTier[] = ['working', 'short_term', 'long_term'];
    const index = hierarchy.indexOf(tier);
    return index >= 0 && index < hierarchy.length - 1 ? hierarchy[index + 1] : null;
  }

  /**
   * Obtener tier anterior (para degradación)
   */
  private getPrevTier(tier: MemoryTier): MemoryTier | null {
    const hierarchy: MemoryTier[] = ['working', 'short_term', 'long_term'];
    const index = hierarchy.indexOf(tier);
    return index > 0 ? hierarchy[index - 1] : null;
  }

  /**
   * Evictar item menos importante
   */
  private evictLeastImportant(tier: MemoryTier): void {
    const tierMemory = this.memories.get(tier);
    if (!tierMemory || tierMemory.size === 0) return;

    // Encontrar item con menor score (importancia * activación)
    let minItem: MemoryItem | null = null;
    let minScore = Infinity;

    for (const item of tierMemory.values()) {
      const score = item.importance * item.activation;
      if (score < minScore) {
        minScore = score;
        minItem = item;
      }
    }

    if (minItem) {
      tierMemory.delete(minItem.id);
      this.emit('memory-evicted', { item: minItem, tier });
    }
  }

  /**
   * Calcular importancia inicial
   */
  private calculateInitialImportance(content: string, contentType: ContentType): number {
    let importance = 0.5;

    // Ajustar por tipo
    const typeWeights: Record<ContentType, number> = {
      fact: 0.6,
      concept: 0.7,
      procedure: 0.8,
      episode: 0.5,
      skill: 0.9,
      preference: 0.6,
      context: 0.4,
    };
    importance = typeWeights[contentType];

    // Ajustar por longitud (contenido más sustancial)
    if (content.length > 200) importance += 0.1;
    if (content.length > 500) importance += 0.1;

    return Math.min(1, importance);
  }

  /**
   * Calcular relevancia de texto
   */
  private calculateTextRelevance(query: string, content: string): number {
    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const contentWords = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    const intersection = new Set([...queryWords].filter(w => contentWords.has(w)));
    return queryWords.size > 0 ? intersection.size / queryWords.size : 0;
  }

  /**
   * Iniciar consolidación periódica
   */
  startPeriodicConsolidation(intervalMs: number = 3600000): void { // 1 hora por defecto
    if (this.consolidationInterval) return;

    this.consolidationInterval = setInterval(() => {
      this.consolidate();
    }, intervalMs);

    Logger.info('[MemoryHierarchy] Started periodic consolidation');
  }

  /**
   * Detener consolidación periódica
   */
  stopPeriodicConsolidation(): void {
    if (this.consolidationInterval) {
      clearInterval(this.consolidationInterval);
      this.consolidationInterval = null;
    }
  }

  /**
   * Persistir en Redis
   */
  async persist(): Promise<void> {
    try {
      for (const [tier, tierMemory] of this.memories) {
        const items = Array.from(tierMemory.values());
        await redis.setex(
          `${this.REDIS_PREFIX}${tier}`,
          7 * 24 * 60 * 60, // 7 días
          JSON.stringify(items)
        );
      }
      Logger.info('[MemoryHierarchy] Persisted to Redis');
    } catch (error) {
      Logger.error('[MemoryHierarchy] Error persisting:', error);
    }
  }

  /**
   * Restaurar de Redis
   */
  async restore(): Promise<void> {
    try {
      for (const tier of Object.keys(TIER_CONFIG) as MemoryTier[]) {
        const data = await redis.get(`${this.REDIS_PREFIX}${tier}`);
        if (data) {
          const items: MemoryItem[] = JSON.parse(data);
          const tierMemory = this.memories.get(tier)!;

          for (const item of items) {
            item.lastAccessed = new Date(item.lastAccessed);
            item.createdAt = new Date(item.createdAt);
            if (item.expiresAt) item.expiresAt = new Date(item.expiresAt);

            tierMemory.set(item.id, item);
          }
        }
      }
      Logger.info('[MemoryHierarchy] Restored from Redis');
    } catch (error) {
      Logger.error('[MemoryHierarchy] Error restoring:', error);
    }
  }

  /**
   * Obtener estadísticas
   */
  getStats(): Record<MemoryTier, { count: number; avgImportance: number; avgActivation: number }> {
    const stats: Record<string, any> = {};

    for (const [tier, tierMemory] of this.memories) {
      const items = Array.from(tierMemory.values());
      stats[tier] = {
        count: items.length,
        avgImportance: items.length > 0
          ? items.reduce((sum, i) => sum + i.importance, 0) / items.length
          : 0,
        avgActivation: items.length > 0
          ? items.reduce((sum, i) => sum + i.activation, 0) / items.length
          : 0,
      };
    }

    return stats as Record<MemoryTier, { count: number; avgImportance: number; avgActivation: number }>;
  }

  /**
   * Limpiar tier
   */
  clearTier(tier: MemoryTier): void {
    this.memories.get(tier)?.clear();
  }

  /**
   * Limpiar toda la memoria
   */
  clearAll(): void {
    for (const tierMemory of this.memories.values()) {
      tierMemory.clear();
    }
    this.associationIndex.clear();
  }

  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton export
export const memoryHierarchy = MemoryHierarchy.getInstance();
