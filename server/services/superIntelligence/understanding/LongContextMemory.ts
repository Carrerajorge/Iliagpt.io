/**
 * SUPERINTELLIGENCE - Long Context Memory System
 * Sistema de memoria de contexto largo (>100k tokens)
 * Tarea 7: Crear sistema de memoria de contexto largo
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';
import { redis } from '../../../lib/redis';

// Tipos
export interface MemorySegment {
  id: string;
  content: string;
  type: SegmentType;
  importance: number; // 0-1
  tokens: number;
  timestamp: Date;
  metadata: SegmentMetadata;
  embedding?: number[];
  compressed?: boolean;
}

export type SegmentType =
  | 'user_message'
  | 'assistant_response'
  | 'system_instruction'
  | 'tool_result'
  | 'code_artifact'
  | 'document_context'
  | 'summary'
  | 'key_fact';

export interface SegmentMetadata {
  source?: string;
  topic?: string;
  entities?: string[];
  sentiment?: string;
  isKeyPoint?: boolean;
  references?: string[];
}

export interface ConversationContext {
  sessionId: string;
  userId: string;
  segments: MemorySegment[];
  totalTokens: number;
  summaries: ContextSummary[];
  keyFacts: KeyFact[];
  activeTopics: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ContextSummary {
  id: string;
  content: string;
  coversSegments: string[]; // IDs de segmentos resumidos
  tokens: number;
  createdAt: Date;
}

export interface KeyFact {
  id: string;
  fact: string;
  source: string;
  confidence: number;
  extractedAt: Date;
  lastReferencedAt: Date;
  referenceCount: number;
}

export interface ContextWindow {
  content: string;
  tokens: number;
  segments: MemorySegment[];
  summaries: ContextSummary[];
  keyFacts: KeyFact[];
}

export interface MemoryConfig {
  maxTokens: number;
  compressionThreshold: number; // Tokens antes de comprimir
  summaryThreshold: number; // Segmentos antes de resumir
  importanceDecay: number; // Factor de decaimiento por tiempo
  retentionDays: number;
}

const DEFAULT_CONFIG: MemoryConfig = {
  maxTokens: 128000, // 128k context window
  compressionThreshold: 32000,
  summaryThreshold: 20,
  importanceDecay: 0.95,
  retentionDays: 30,
};

// Estrategias de compresión
export type CompressionStrategy = 'summarize' | 'extract_key_points' | 'remove_low_importance' | 'hybrid';

export class LongContextMemory extends EventEmitter {
  private static instance: LongContextMemory;
  private contexts: Map<string, ConversationContext> = new Map();
  private config: MemoryConfig;
  private readonly REDIS_PREFIX = 'memory:context:';

  private constructor(config: Partial<MemoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<MemoryConfig>): LongContextMemory {
    if (!LongContextMemory.instance) {
      LongContextMemory.instance = new LongContextMemory(config);
    }
    return LongContextMemory.instance;
  }

  // Crear o obtener contexto de conversación
  getOrCreateContext(sessionId: string, userId: string): ConversationContext {
    let context = this.contexts.get(sessionId);

    if (!context) {
      context = {
        sessionId,
        userId,
        segments: [],
        totalTokens: 0,
        summaries: [],
        keyFacts: [],
        activeTopics: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.contexts.set(sessionId, context);
    }

    return context;
  }

  // Agregar segmento de memoria
  async addSegment(
    sessionId: string,
    content: string,
    type: SegmentType,
    metadata: Partial<SegmentMetadata> = {}
  ): Promise<MemorySegment> {
    const context = this.contexts.get(sessionId);
    if (!context) {
      throw new Error(`Context not found for session: ${sessionId}`);
    }

    const tokens = this.estimateTokens(content);
    const importance = this.calculateImportance(content, type, metadata);

    const segment: MemorySegment = {
      id: this.generateId(),
      content,
      type,
      importance,
      tokens,
      timestamp: new Date(),
      metadata: {
        ...metadata,
        entities: metadata.entities || this.extractEntities(content),
        topic: metadata.topic || this.detectTopic(content),
      },
    };

    context.segments.push(segment);
    context.totalTokens += tokens;
    context.updatedAt = new Date();

    // Actualizar temas activos
    if (segment.metadata.topic && !context.activeTopics.includes(segment.metadata.topic)) {
      context.activeTopics.push(segment.metadata.topic);
      if (context.activeTopics.length > 5) {
        context.activeTopics.shift();
      }
    }

    // Extraer hechos clave si es respuesta del asistente
    if (type === 'assistant_response' || type === 'tool_result') {
      await this.extractKeyFacts(context, segment);
    }

    // Verificar si necesitamos comprimir
    if (context.totalTokens > this.config.compressionThreshold) {
      await this.compressContext(sessionId);
    }

    this.emit('segment-added', { sessionId, segment });

    return segment;
  }

  // Obtener ventana de contexto optimizada
  async getContextWindow(
    sessionId: string,
    maxTokens?: number,
    prioritizeRecent: boolean = true
  ): Promise<ContextWindow> {
    const context = this.contexts.get(sessionId);
    if (!context) {
      return { content: '', tokens: 0, segments: [], summaries: [], keyFacts: [] };
    }

    const targetTokens = maxTokens || this.config.maxTokens;
    const result: ContextWindow = {
      content: '',
      tokens: 0,
      segments: [],
      summaries: [],
      keyFacts: [],
    };

    // Siempre incluir key facts primero (son concisos)
    const keyFactsContent = this.formatKeyFacts(context.keyFacts);
    const keyFactsTokens = this.estimateTokens(keyFactsContent);

    if (keyFactsTokens < targetTokens * 0.1) { // Max 10% para key facts
      result.keyFacts = [...context.keyFacts];
      result.tokens += keyFactsTokens;
    }

    // Incluir resúmenes disponibles
    for (const summary of context.summaries) {
      if (result.tokens + summary.tokens < targetTokens * 0.3) { // Max 30% para summaries
        result.summaries.push(summary);
        result.tokens += summary.tokens;
      }
    }

    // Calcular espacio restante para segmentos
    const remainingTokens = targetTokens - result.tokens;

    // Seleccionar segmentos por importancia y recencia
    const rankedSegments = this.rankSegments(context.segments, prioritizeRecent);

    for (const segment of rankedSegments) {
      if (result.tokens + segment.tokens <= targetTokens) {
        result.segments.push(segment);
        result.tokens += segment.tokens;
      }
    }

    // Construir contenido final
    result.content = this.buildContextContent(result);

    return result;
  }

  // Rankear segmentos por relevancia
  private rankSegments(segments: MemorySegment[], prioritizeRecent: boolean): MemorySegment[] {
    const now = Date.now();

    return [...segments]
      .map(segment => {
        // Calcular score combinado
        const ageMinutes = (now - segment.timestamp.getTime()) / (1000 * 60);
        const recencyScore = prioritizeRecent
          ? Math.pow(this.config.importanceDecay, ageMinutes / 60) // Decay por hora
          : 1;

        const typeWeight = this.getTypeWeight(segment.type);
        const finalScore = segment.importance * recencyScore * typeWeight;

        return { segment, score: finalScore };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.segment);
  }

  // Peso por tipo de segmento
  private getTypeWeight(type: SegmentType): number {
    const weights: Record<SegmentType, number> = {
      'system_instruction': 1.5,
      'key_fact': 1.4,
      'user_message': 1.2,
      'assistant_response': 1.0,
      'tool_result': 1.1,
      'code_artifact': 1.3,
      'document_context': 0.9,
      'summary': 0.8,
    };
    return weights[type] || 1.0;
  }

  // Comprimir contexto
  async compressContext(
    sessionId: string,
    strategy: CompressionStrategy = 'hybrid'
  ): Promise<void> {
    const context = this.contexts.get(sessionId);
    if (!context) return;

    Logger.info(`[LongContextMemory] Compressing context for session ${sessionId}`);

    switch (strategy) {
      case 'summarize':
        await this.compressBySummarization(context);
        break;
      case 'extract_key_points':
        await this.compressByKeyPointExtraction(context);
        break;
      case 'remove_low_importance':
        this.compressByRemovingLowImportance(context);
        break;
      case 'hybrid':
      default:
        await this.compressHybrid(context);
    }

    this.emit('context-compressed', { sessionId, newTotalTokens: context.totalTokens });
  }

  // Estrategia de compresión por resumen
  private async compressBySummarization(context: ConversationContext): Promise<void> {
    // Identificar segmentos antiguos para resumir
    const segmentsToSummarize = context.segments
      .filter(s => !s.compressed && s.type !== 'system_instruction')
      .slice(0, this.config.summaryThreshold);

    if (segmentsToSummarize.length < 5) return;

    // Generar resumen (en producción usaríamos el LLM)
    const summaryContent = this.generateLocalSummary(segmentsToSummarize);
    const summaryTokens = this.estimateTokens(summaryContent);

    const summary: ContextSummary = {
      id: this.generateId(),
      content: summaryContent,
      coversSegments: segmentsToSummarize.map(s => s.id),
      tokens: summaryTokens,
      createdAt: new Date(),
    };

    context.summaries.push(summary);

    // Marcar segmentos como comprimidos
    for (const segment of segmentsToSummarize) {
      segment.compressed = true;
    }

    // Eliminar segmentos comprimidos de baja importancia
    const tokensRecovered = segmentsToSummarize.reduce((sum, s) => sum + s.tokens, 0);
    context.totalTokens = context.totalTokens - tokensRecovered + summaryTokens;

    // Filtrar segmentos comprimidos si el espacio es crítico
    if (context.totalTokens > this.config.maxTokens * 0.9) {
      context.segments = context.segments.filter(s => !s.compressed || s.importance > 0.7);
      context.totalTokens = context.segments.reduce((sum, s) => sum + s.tokens, 0) +
        context.summaries.reduce((sum, s) => sum + s.tokens, 0);
    }
  }

  // Generar resumen local (sin LLM)
  private generateLocalSummary(segments: MemorySegment[]): string {
    const topics = new Set<string>();
    const keyPoints: string[] = [];

    for (const segment of segments) {
      if (segment.metadata.topic) {
        topics.add(segment.metadata.topic);
      }
      if (segment.metadata.isKeyPoint) {
        keyPoints.push(segment.content.slice(0, 200));
      }
    }

    const topicsList = Array.from(topics).slice(0, 5).join(', ');
    const pointsList = keyPoints.slice(0, 3).join('; ');

    return `[Resumen de ${segments.length} mensajes] Temas: ${topicsList || 'varios'}. ${pointsList ? `Puntos clave: ${pointsList}` : ''}`;
  }

  // Estrategia de extracción de puntos clave
  private async compressByKeyPointExtraction(context: ConversationContext): Promise<void> {
    // Extraer puntos clave de segmentos no procesados
    const unprocessedSegments = context.segments.filter(s => !s.compressed && s.importance > 0.5);

    for (const segment of unprocessedSegments) {
      const keyPoints = this.extractKeyPointsFromText(segment.content);

      for (const point of keyPoints) {
        const existing = context.keyFacts.find(kf =>
          this.calculateSimilarity(kf.fact, point) > 0.8
        );

        if (!existing) {
          context.keyFacts.push({
            id: this.generateId(),
            fact: point,
            source: segment.id,
            confidence: segment.importance,
            extractedAt: new Date(),
            lastReferencedAt: new Date(),
            referenceCount: 1,
          });
        } else {
          existing.referenceCount++;
          existing.lastReferencedAt = new Date();
        }
      }

      segment.compressed = true;
    }

    // Limitar key facts
    if (context.keyFacts.length > 50) {
      context.keyFacts = context.keyFacts
        .sort((a, b) => b.confidence * b.referenceCount - a.confidence * a.referenceCount)
        .slice(0, 50);
    }
  }

  // Extraer puntos clave del texto
  private extractKeyPointsFromText(text: string): string[] {
    const points: string[] = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();

      // Detectar oraciones con información clave
      const hasKeyIndicator =
        /importan|clave|princip|esencial|conclus|result|defin|signific/i.test(trimmed) ||
        /important|key|main|essential|conclusion|result|define|signific/i.test(trimmed);

      const hasNumber = /\d+/.test(trimmed);
      const hasProperNoun = /[A-Z][a-z]+\s[A-Z]/.test(trimmed);

      if (hasKeyIndicator || hasNumber || hasProperNoun) {
        if (trimmed.length < 200) {
          points.push(trimmed);
        } else {
          points.push(trimmed.slice(0, 200) + '...');
        }
      }
    }

    return points.slice(0, 5);
  }

  // Estrategia de eliminación por baja importancia
  private compressByRemovingLowImportance(context: ConversationContext): void {
    const threshold = 0.3;
    const recentCount = 10; // Siempre mantener los últimos N

    const recentSegments = context.segments.slice(-recentCount);
    const olderSegments = context.segments.slice(0, -recentCount);

    const filteredOlder = olderSegments.filter(s =>
      s.importance > threshold ||
      s.type === 'system_instruction' ||
      s.metadata.isKeyPoint
    );

    const removedTokens = olderSegments
      .filter(s => !filteredOlder.includes(s))
      .reduce((sum, s) => sum + s.tokens, 0);

    context.segments = [...filteredOlder, ...recentSegments];
    context.totalTokens -= removedTokens;
  }

  // Estrategia híbrida
  private async compressHybrid(context: ConversationContext): Promise<void> {
    // Paso 1: Extraer key facts
    await this.compressByKeyPointExtraction(context);

    // Paso 2: Si aún hay muchos tokens, resumir
    if (context.totalTokens > this.config.compressionThreshold) {
      await this.compressBySummarization(context);
    }

    // Paso 3: Si aún excede, eliminar baja importancia
    if (context.totalTokens > this.config.maxTokens * 0.8) {
      this.compressByRemovingLowImportance(context);
    }
  }

  // Calcular importancia de segmento
  private calculateImportance(content: string, type: SegmentType, metadata: Partial<SegmentMetadata>): number {
    let importance = 0.5; // Base

    // Ajustar por tipo
    const typeBonus: Record<SegmentType, number> = {
      'system_instruction': 0.3,
      'key_fact': 0.3,
      'code_artifact': 0.2,
      'tool_result': 0.15,
      'user_message': 0.1,
      'assistant_response': 0.05,
      'document_context': 0,
      'summary': 0,
    };
    importance += typeBonus[type] || 0;

    // Ajustar por contenido
    if (/importan|clave|crítico|esencial|urgente/i.test(content)) {
      importance += 0.1;
    }
    if (/\d+/.test(content)) { // Contiene números (posibles datos)
      importance += 0.05;
    }
    if (content.length > 500) { // Contenido sustancial
      importance += 0.05;
    }

    // Ajustar por metadata
    if (metadata.isKeyPoint) {
      importance += 0.2;
    }
    if (metadata.entities && metadata.entities.length > 2) {
      importance += 0.1;
    }

    return Math.min(1, Math.max(0, importance));
  }

  // Extraer entidades simples
  private extractEntities(text: string): string[] {
    const entities: string[] = [];

    // Nombres propios (palabras capitalizadas)
    const properNouns = text.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g);
    if (properNouns) {
      entities.push(...properNouns.slice(0, 5));
    }

    // Tecnologías/lenguajes
    const techTerms = text.match(/\b(JavaScript|TypeScript|Python|React|Node\.js|PostgreSQL|Redis|API|REST|GraphQL)\b/gi);
    if (techTerms) {
      entities.push(...techTerms);
    }

    return [...new Set(entities)].slice(0, 10);
  }

  // Detectar tema
  private detectTopic(text: string): string | undefined {
    const topicPatterns: Record<string, RegExp> = {
      'programming': /código|program|function|class|variable|error|debug|typescript|javascript|python/i,
      'data': /datos|database|sql|query|tabla|análisis|estadístic/i,
      'design': /diseño|ui|ux|interfaz|color|layout|responsive/i,
      'security': /seguridad|password|auth|token|encrypt|vulnerab/i,
      'business': /negocio|empresa|cliente|producto|servicio|venta/i,
      'documentation': /document|manual|guía|tutorial|readme/i,
    };

    for (const [topic, pattern] of Object.entries(topicPatterns)) {
      if (pattern.test(text)) {
        return topic;
      }
    }

    return undefined;
  }

  // Extraer key facts de un segmento
  private async extractKeyFacts(context: ConversationContext, segment: MemorySegment): Promise<void> {
    const keyPoints = this.extractKeyPointsFromText(segment.content);

    for (const point of keyPoints) {
      // Verificar si ya existe un hecho similar
      const similar = context.keyFacts.find(kf => this.calculateSimilarity(kf.fact, point) > 0.8);

      if (similar) {
        similar.referenceCount++;
        similar.lastReferencedAt = new Date();
        similar.confidence = Math.min(1, similar.confidence + 0.1);
      } else {
        context.keyFacts.push({
          id: this.generateId(),
          fact: point,
          source: segment.id,
          confidence: segment.importance,
          extractedAt: new Date(),
          lastReferencedAt: new Date(),
          referenceCount: 1,
        });
      }
    }

    // Limitar número de key facts
    if (context.keyFacts.length > 30) {
      context.keyFacts.sort((a, b) => {
        const scoreA = a.confidence * a.referenceCount;
        const scoreB = b.confidence * b.referenceCount;
        return scoreB - scoreA;
      });
      context.keyFacts = context.keyFacts.slice(0, 30);
    }
  }

  // Calcular similitud simple entre textos
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size; // Jaccard similarity
  }

  // Formatear key facts para contexto
  private formatKeyFacts(keyFacts: KeyFact[]): string {
    if (keyFacts.length === 0) return '';

    const sorted = [...keyFacts].sort((a, b) => b.confidence - a.confidence);
    const lines = sorted.slice(0, 10).map(kf => `• ${kf.fact}`);

    return `[Hechos clave recordados]\n${lines.join('\n')}`;
  }

  // Construir contenido de contexto
  private buildContextContent(window: ContextWindow): string {
    const parts: string[] = [];

    // Key facts primero
    if (window.keyFacts.length > 0) {
      parts.push(this.formatKeyFacts(window.keyFacts));
    }

    // Resúmenes
    if (window.summaries.length > 0) {
      const summaryContent = window.summaries.map(s => s.content).join('\n');
      parts.push(`[Contexto previo resumido]\n${summaryContent}`);
    }

    // Segmentos
    if (window.segments.length > 0) {
      const segmentContent = window.segments
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .map(s => {
          const prefix = s.type === 'user_message' ? 'Usuario' :
                        s.type === 'assistant_response' ? 'Asistente' :
                        s.type === 'system_instruction' ? 'Sistema' :
                        s.type === 'tool_result' ? 'Herramienta' : 'Contexto';
          return `[${prefix}]: ${s.content}`;
        })
        .join('\n\n');

      parts.push(segmentContent);
    }

    return parts.join('\n\n---\n\n');
  }

  // Estimar tokens
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // Generar ID
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Persistir contexto
  async persistContext(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    if (!context) return;

    try {
      await redis.setex(
        `${this.REDIS_PREFIX}${sessionId}`,
        this.config.retentionDays * 24 * 60 * 60,
        JSON.stringify(context)
      );
      Logger.info(`[LongContextMemory] Context persisted for session ${sessionId}`);
    } catch (error) {
      Logger.error('[LongContextMemory] Error persisting context:', error);
    }
  }

  // Restaurar contexto
  async restoreContext(sessionId: string): Promise<ConversationContext | null> {
    try {
      const data = await redis.get(`${this.REDIS_PREFIX}${sessionId}`);
      if (!data) return null;

      const context = JSON.parse(data);
      context.createdAt = new Date(context.createdAt);
      context.updatedAt = new Date(context.updatedAt);
      context.segments = context.segments.map((s: any) => ({
        ...s,
        timestamp: new Date(s.timestamp),
      }));
      context.summaries = context.summaries.map((s: any) => ({
        ...s,
        createdAt: new Date(s.createdAt),
      }));
      context.keyFacts = context.keyFacts.map((kf: any) => ({
        ...kf,
        extractedAt: new Date(kf.extractedAt),
        lastReferencedAt: new Date(kf.lastReferencedAt),
      }));

      this.contexts.set(sessionId, context);
      Logger.info(`[LongContextMemory] Context restored for session ${sessionId}`);

      return context;
    } catch (error) {
      Logger.error('[LongContextMemory] Error restoring context:', error);
      return null;
    }
  }

  // Obtener estadísticas
  getStats(sessionId: string): {
    totalSegments: number;
    totalTokens: number;
    summaries: number;
    keyFacts: number;
    compressionRatio: number;
  } | null {
    const context = this.contexts.get(sessionId);
    if (!context) return null;

    const originalTokens = context.segments.reduce((sum, s) => sum + s.tokens, 0);
    const currentTokens = context.totalTokens;

    return {
      totalSegments: context.segments.length,
      totalTokens: context.totalTokens,
      summaries: context.summaries.length,
      keyFacts: context.keyFacts.length,
      compressionRatio: originalTokens > 0 ? currentTokens / originalTokens : 1,
    };
  }

  // Limpiar contexto
  clearContext(sessionId: string): void {
    this.contexts.delete(sessionId);
    redis.del(`${this.REDIS_PREFIX}${sessionId}`).catch(() => {});
  }

  // Buscar en contexto
  searchInContext(sessionId: string, query: string): MemorySegment[] {
    const context = this.contexts.get(sessionId);
    if (!context) return [];

    const queryWords = query.toLowerCase().split(/\s+/);

    return context.segments
      .map(segment => {
        const contentLower = segment.content.toLowerCase();
        const matchCount = queryWords.filter(word => contentLower.includes(word)).length;
        const score = matchCount / queryWords.length;
        return { segment, score };
      })
      .filter(item => item.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .map(item => item.segment)
      .slice(0, 10);
  }
}

// Singleton export
export const longContextMemory = LongContextMemory.getInstance();
