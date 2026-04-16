/**
 * SUPERINTELLIGENCE - Token Consumption Tracker
 * Monitor avanzado de consumo de tokens por LLM
 * Tarea 3: Crear monitor de consumo de tokens por LLM
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';
import { redis } from '../../../lib/redis';

// Tipos
export interface TokenUsageRecord {
  timestamp: Date;
  provider: LLMProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  requestId?: string;
  userId?: string;
  endpoint?: string;
  latency?: number;
  cached?: boolean;
}

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'xai';

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  contextWindow: number;
  maxOutput: number;
}

export interface ProviderStats {
  provider: LLMProvider;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  averageTokensPerRequest: number;
  averageLatency: number;
  cacheHitRate: number;
  models: ModelStats[];
}

export interface ModelStats {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  efficiency: number; // Output/Input ratio
}

export interface UsageTrend {
  timestamp: Date;
  provider: LLMProvider;
  tokens: number;
  cost: number;
  requests: number;
}

export interface CostAlert {
  id: string;
  type: 'hourly' | 'daily' | 'monthly';
  threshold: number;
  currentValue: number;
  triggered: boolean;
  triggeredAt?: Date;
}

export interface CostForecast {
  provider: LLMProvider;
  currentDailyCost: number;
  projectedDailyCost: number;
  projectedMonthlyCost: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

export interface TokenReport {
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  providers: ProviderStats[];
  trends: UsageTrend[];
  forecasts: CostForecast[];
  alerts: CostAlert[];
  recommendations: TokenRecommendation[];
  topUsers: UserTokenStats[];
  topEndpoints: EndpointTokenStats[];
}

export interface TokenRecommendation {
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: 'cost' | 'efficiency' | 'performance';
  title: string;
  description: string;
  estimatedSavings?: number;
  action: string;
}

export interface UserTokenStats {
  userId: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

export interface EndpointTokenStats {
  endpoint: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  averageTokensPerRequest: number;
}

// Precios actualizados por modelo (por 1M tokens)
const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-5': { inputPer1M: 5.00, outputPer1M: 15.00, contextWindow: 128000, maxOutput: 16384 },
  'gpt-5-mini': { inputPer1M: 0.50, outputPer1M: 1.50, contextWindow: 128000, maxOutput: 16384 },
  'gpt-5-nano': { inputPer1M: 0.10, outputPer1M: 0.30, contextWindow: 64000, maxOutput: 8192 },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00, contextWindow: 128000, maxOutput: 16384 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60, contextWindow: 128000, maxOutput: 16384 },
  'o1': { inputPer1M: 15.00, outputPer1M: 60.00, contextWindow: 200000, maxOutput: 100000 },
  'o1-mini': { inputPer1M: 3.00, outputPer1M: 12.00, contextWindow: 128000, maxOutput: 65536 },

  // Anthropic
  'claude-opus-4-5': { inputPer1M: 15.00, outputPer1M: 75.00, contextWindow: 200000, maxOutput: 32768 },
  'claude-sonnet-4-5': { inputPer1M: 3.00, outputPer1M: 15.00, contextWindow: 200000, maxOutput: 16384 },
  'claude-3-opus': { inputPer1M: 15.00, outputPer1M: 75.00, contextWindow: 200000, maxOutput: 4096 },
  'claude-3-sonnet': { inputPer1M: 3.00, outputPer1M: 15.00, contextWindow: 200000, maxOutput: 4096 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25, contextWindow: 200000, maxOutput: 4096 },

  // Google
  'gemini-3-flash-preview': { inputPer1M: 0.075, outputPer1M: 0.30, contextWindow: 1000000, maxOutput: 65536 },
  'gemini-3.1-pro-preview': { inputPer1M: 1.25, outputPer1M: 5.00, contextWindow: 2000000, maxOutput: 65536 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00, contextWindow: 1000000, maxOutput: 65536 },
  'gemini-2.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30, contextWindow: 1000000, maxOutput: 65536 },

  // X.AI
  'grok-3': { inputPer1M: 3.00, outputPer1M: 15.00, contextWindow: 131072, maxOutput: 16384 },
  'grok-3-fast': { inputPer1M: 0.60, outputPer1M: 3.00, contextWindow: 131072, maxOutput: 16384 },
  'grok-2-vision-1212': { inputPer1M: 2.00, outputPer1M: 10.00, contextWindow: 32768, maxOutput: 8192 },
};

// Configuración de alertas por defecto
const DEFAULT_ALERTS: Omit<CostAlert, 'currentValue' | 'triggered' | 'triggeredAt'>[] = [
  { id: 'hourly-10', type: 'hourly', threshold: 10 },
  { id: 'hourly-50', type: 'hourly', threshold: 50 },
  { id: 'daily-100', type: 'daily', threshold: 100 },
  { id: 'daily-500', type: 'daily', threshold: 500 },
  { id: 'monthly-1000', type: 'monthly', threshold: 1000 },
  { id: 'monthly-5000', type: 'monthly', threshold: 5000 },
];

export class TokenConsumptionTracker extends EventEmitter {
  private static instance: TokenConsumptionTracker;
  private records: TokenUsageRecord[] = [];
  private hourlyAggregates: Map<string, UsageTrend> = new Map();
  private alerts: CostAlert[] = [];
  private readonly REDIS_PREFIX = 'token:tracker:';
  private readonly MAX_RECORDS = 100000;
  private persistInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.initializeAlerts();
  }

  static getInstance(): TokenConsumptionTracker {
    if (!TokenConsumptionTracker.instance) {
      TokenConsumptionTracker.instance = new TokenConsumptionTracker();
    }
    return TokenConsumptionTracker.instance;
  }

  private initializeAlerts(): void {
    this.alerts = DEFAULT_ALERTS.map(alert => ({
      ...alert,
      currentValue: 0,
      triggered: false,
    }));
  }

  // Registrar uso de tokens
  track(
    provider: LLMProvider,
    model: string,
    inputTokens: number,
    outputTokens: number,
    options?: {
      requestId?: string;
      userId?: string;
      endpoint?: string;
      latency?: number;
      cached?: boolean;
    }
  ): TokenUsageRecord {
    const pricing = MODEL_PRICING[model] || { inputPer1M: 1, outputPer1M: 3, contextWindow: 128000, maxOutput: 4096 };
    const cost = (inputTokens / 1_000_000) * pricing.inputPer1M +
                 (outputTokens / 1_000_000) * pricing.outputPer1M;

    const record: TokenUsageRecord = {
      timestamp: new Date(),
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost,
      ...options,
    };

    this.records.push(record);

    // Mantener límite de registros
    if (this.records.length > this.MAX_RECORDS) {
      this.records = this.records.slice(-this.MAX_RECORDS);
    }

    // Actualizar agregados por hora
    this.updateHourlyAggregate(record);

    // Verificar alertas
    this.checkAlerts();

    // Emitir evento
    this.emit('usage', record);

    // Log si es costoso
    if (cost > 0.1) {
      Logger.info(`[TokenTracker] High cost request: ${model} - $${cost.toFixed(4)} (${inputTokens}/${outputTokens} tokens)`);
    }

    return record;
  }

  // Actualizar agregado por hora
  private updateHourlyAggregate(record: TokenUsageRecord): void {
    const hourKey = record.timestamp.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const key = `${hourKey}:${record.provider}`;

    const existing = this.hourlyAggregates.get(key) || {
      timestamp: new Date(hourKey + ':00:00.000Z'),
      provider: record.provider,
      tokens: 0,
      cost: 0,
      requests: 0,
    };

    existing.tokens += record.totalTokens;
    existing.cost += record.cost;
    existing.requests += 1;

    this.hourlyAggregates.set(key, existing);

    // Limpiar agregados antiguos (> 30 días)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [k, v] of this.hourlyAggregates) {
      if (v.timestamp.getTime() < thirtyDaysAgo) {
        this.hourlyAggregates.delete(k);
      }
    }
  }

  // Verificar alertas de costo
  private checkAlerts(): void {
    const now = new Date();
    const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    for (const alert of this.alerts) {
      let periodStart: Date;
      switch (alert.type) {
        case 'hourly':
          periodStart = hourStart;
          break;
        case 'daily':
          periodStart = dayStart;
          break;
        case 'monthly':
          periodStart = monthStart;
          break;
      }

      const periodCost = this.records
        .filter(r => r.timestamp >= periodStart)
        .reduce((sum, r) => sum + r.cost, 0);

      alert.currentValue = periodCost;

      if (periodCost >= alert.threshold && !alert.triggered) {
        alert.triggered = true;
        alert.triggeredAt = now;

        this.emit('alert', alert);
        Logger.warn(`[TokenTracker] Cost alert triggered: ${alert.id} - $${periodCost.toFixed(2)} >= $${alert.threshold}`);
      }

      // Reset al inicio de nuevo período
      if (alert.triggered && alert.triggeredAt && alert.triggeredAt < periodStart) {
        alert.triggered = false;
        alert.triggeredAt = undefined;
      }
    }
  }

  // Obtener estadísticas por proveedor
  getProviderStats(periodHours: number = 24): ProviderStats[] {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);
    const periodRecords = this.records.filter(r => r.timestamp >= cutoff);

    const providerMap = new Map<LLMProvider, TokenUsageRecord[]>();
    for (const record of periodRecords) {
      const existing = providerMap.get(record.provider) || [];
      existing.push(record);
      providerMap.set(record.provider, existing);
    }

    const stats: ProviderStats[] = [];

    for (const [provider, records] of providerMap) {
      const modelMap = new Map<string, TokenUsageRecord[]>();
      for (const r of records) {
        const existing = modelMap.get(r.model) || [];
        existing.push(r);
        modelMap.set(r.model, existing);
      }

      const models: ModelStats[] = [];
      for (const [model, modelRecords] of modelMap) {
        const inputTokens = modelRecords.reduce((s, r) => s + r.inputTokens, 0);
        const outputTokens = modelRecords.reduce((s, r) => s + r.outputTokens, 0);
        const cost = modelRecords.reduce((s, r) => s + r.cost, 0);

        models.push({
          model,
          requests: modelRecords.length,
          inputTokens,
          outputTokens,
          cost,
          averageInputTokens: inputTokens / modelRecords.length,
          averageOutputTokens: outputTokens / modelRecords.length,
          efficiency: inputTokens > 0 ? outputTokens / inputTokens : 0,
        });
      }

      const totalInputTokens = records.reduce((s, r) => s + r.inputTokens, 0);
      const totalOutputTokens = records.reduce((s, r) => s + r.outputTokens, 0);
      const totalCost = records.reduce((s, r) => s + r.cost, 0);
      const totalLatency = records.reduce((s, r) => s + (r.latency || 0), 0);
      const cachedCount = records.filter(r => r.cached).length;

      stats.push({
        provider,
        totalRequests: records.length,
        totalInputTokens,
        totalOutputTokens,
        totalCost,
        averageTokensPerRequest: (totalInputTokens + totalOutputTokens) / records.length,
        averageLatency: totalLatency / records.length,
        cacheHitRate: records.length > 0 ? (cachedCount / records.length) * 100 : 0,
        models: models.sort((a, b) => b.cost - a.cost),
      });
    }

    return stats.sort((a, b) => b.totalCost - a.totalCost);
  }

  // Obtener tendencias de uso
  getUsageTrends(periodHours: number = 24): UsageTrend[] {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);

    return Array.from(this.hourlyAggregates.values())
      .filter(t => t.timestamp >= cutoff)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // Generar pronóstico de costos
  generateForecasts(): CostForecast[] {
    const forecasts: CostForecast[] = [];
    const providers: LLMProvider[] = ['openai', 'anthropic', 'google', 'xai'];

    for (const provider of providers) {
      const providerTrends = Array.from(this.hourlyAggregates.values())
        .filter(t => t.provider === provider)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      if (providerTrends.length < 24) continue; // Necesitamos al menos 24 horas de datos

      // Calcular costo diario actual (últimas 24 horas)
      const last24h = providerTrends.slice(-24);
      const currentDailyCost = last24h.reduce((s, t) => s + t.cost, 0);

      // Calcular tendencia (comparar últimas 24h con 24h anteriores)
      const previous24h = providerTrends.slice(-48, -24);
      const previousDailyCost = previous24h.reduce((s, t) => s + t.cost, 0);

      let trend: CostForecast['trend'] = 'stable';
      let projectedDailyCost = currentDailyCost;

      if (previousDailyCost > 0) {
        const changeRate = (currentDailyCost - previousDailyCost) / previousDailyCost;

        if (changeRate > 0.1) {
          trend = 'increasing';
          projectedDailyCost = currentDailyCost * (1 + changeRate * 0.5); // Proyección conservadora
        } else if (changeRate < -0.1) {
          trend = 'decreasing';
          projectedDailyCost = currentDailyCost * (1 + changeRate * 0.5);
        }
      }

      // Calcular confianza basada en variabilidad
      const costs = last24h.map(t => t.cost);
      const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
      const variance = costs.reduce((s, c) => s + Math.pow(c - mean, 2), 0) / costs.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // Coeficiente de variación
      const confidence = Math.max(0, Math.min(100, 100 - cv * 100));

      forecasts.push({
        provider,
        currentDailyCost,
        projectedDailyCost,
        projectedMonthlyCost: projectedDailyCost * 30,
        trend,
        confidence,
      });
    }

    return forecasts;
  }

  // Generar recomendaciones de optimización
  generateRecommendations(): TokenRecommendation[] {
    const recommendations: TokenRecommendation[] = [];
    const stats = this.getProviderStats(24);

    for (const provider of stats) {
      // Detectar uso excesivo de modelos costosos
      const expensiveModels = provider.models.filter(m => {
        const pricing = MODEL_PRICING[m.model];
        return pricing && (pricing.inputPer1M > 5 || pricing.outputPer1M > 20);
      });

      for (const model of expensiveModels) {
        if (model.requests > 100 && model.averageInputTokens < 1000) {
          const cheaperModel = this.suggestCheaperModel(model.model);
          if (cheaperModel) {
            const potentialSavings = model.cost * 0.7; // Estimación conservadora

            recommendations.push({
              priority: 'high',
              category: 'cost',
              title: `Consider using ${cheaperModel} instead of ${model.model}`,
              description: `${model.requests} requests with avg ${model.averageInputTokens.toFixed(0)} input tokens could use a smaller model`,
              estimatedSavings: potentialSavings,
              action: `Route simple requests to ${cheaperModel}`,
            });
          }
        }
      }

      // Detectar baja eficiencia (input >> output)
      for (const model of provider.models) {
        if (model.efficiency < 0.1 && model.requests > 50) {
          recommendations.push({
            priority: 'medium',
            category: 'efficiency',
            title: `Low output efficiency for ${model.model}`,
            description: `Output/Input ratio is ${(model.efficiency * 100).toFixed(1)}% - prompts may be too verbose`,
            action: 'Review and optimize prompt templates to reduce input tokens',
          });
        }
      }

      // Detectar bajo cache hit rate
      if (provider.cacheHitRate < 10 && provider.totalRequests > 100) {
        recommendations.push({
          priority: 'medium',
          category: 'cost',
          title: `Low cache hit rate for ${provider.provider}`,
          description: `Only ${provider.cacheHitRate.toFixed(1)}% of requests are cached`,
          action: 'Implement semantic caching for similar queries',
        });
      }
    }

    // Alertas de costo activadas
    const triggeredAlerts = this.alerts.filter(a => a.triggered);
    for (const alert of triggeredAlerts) {
      recommendations.push({
        priority: 'critical',
        category: 'cost',
        title: `${alert.type} cost threshold exceeded`,
        description: `Current ${alert.type} cost: $${alert.currentValue.toFixed(2)} (threshold: $${alert.threshold})`,
        action: 'Review recent usage and implement rate limiting if necessary',
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  // Sugerir modelo más económico
  private suggestCheaperModel(model: string): string | null {
    const suggestions: Record<string, string> = {
      'gpt-5': 'gpt-5-mini',
      'gpt-4o': 'gpt-4o-mini',
      'claude-opus-4-5': 'claude-sonnet-4-5',
      'claude-3-opus': 'claude-3-sonnet',
      'claude-3-sonnet': 'claude-3-haiku',
      'gemini-2.5-pro': 'gemini-2.5-flash',
      'grok-3': 'grok-3-fast',
    };

    return suggestions[model] || null;
  }

  // Obtener uso por usuario
  getTopUsers(limit: number = 10, periodHours: number = 24): UserTokenStats[] {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);
    const periodRecords = this.records.filter(r => r.timestamp >= cutoff && r.userId);

    const userMap = new Map<string, UserTokenStats>();

    for (const record of periodRecords) {
      if (!record.userId) continue;

      const existing = userMap.get(record.userId) || {
        userId: record.userId,
        totalTokens: 0,
        totalCost: 0,
        requestCount: 0,
      };

      existing.totalTokens += record.totalTokens;
      existing.totalCost += record.cost;
      existing.requestCount += 1;

      userMap.set(record.userId, existing);
    }

    return Array.from(userMap.values())
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, limit);
  }

  // Obtener uso por endpoint
  getTopEndpoints(limit: number = 10, periodHours: number = 24): EndpointTokenStats[] {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);
    const periodRecords = this.records.filter(r => r.timestamp >= cutoff && r.endpoint);

    const endpointMap = new Map<string, EndpointTokenStats>();

    for (const record of periodRecords) {
      if (!record.endpoint) continue;

      const existing = endpointMap.get(record.endpoint) || {
        endpoint: record.endpoint,
        totalTokens: 0,
        totalCost: 0,
        requestCount: 0,
        averageTokensPerRequest: 0,
      };

      existing.totalTokens += record.totalTokens;
      existing.totalCost += record.cost;
      existing.requestCount += 1;
      existing.averageTokensPerRequest = existing.totalTokens / existing.requestCount;

      endpointMap.set(record.endpoint, existing);
    }

    return Array.from(endpointMap.values())
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, limit);
  }

  // Generar reporte completo
  generateReport(periodHours: number = 24): TokenReport {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);
    const periodRecords = this.records.filter(r => r.timestamp >= cutoff);

    return {
      generatedAt: new Date(),
      periodStart: cutoff,
      periodEnd: new Date(),
      totalCost: periodRecords.reduce((s, r) => s + r.cost, 0),
      totalTokens: periodRecords.reduce((s, r) => s + r.totalTokens, 0),
      totalRequests: periodRecords.length,
      providers: this.getProviderStats(periodHours),
      trends: this.getUsageTrends(periodHours),
      forecasts: this.generateForecasts(),
      alerts: [...this.alerts],
      recommendations: this.generateRecommendations(),
      topUsers: this.getTopUsers(10, periodHours),
      topEndpoints: this.getTopEndpoints(10, periodHours),
    };
  }

  private persistFailures = 0;
  private readonly MAX_PERSIST_FAILURES = 5;

  async persist(): Promise<void> {
    if (this.persistFailures >= this.MAX_PERSIST_FAILURES) {
      return;
    }
    try {
      const recentRecords = this.records.slice(-1000);

      await redis.setex(
        `${this.REDIS_PREFIX}records`,
        7 * 24 * 60 * 60,
        JSON.stringify(recentRecords)
      );

      await redis.setex(
        `${this.REDIS_PREFIX}aggregates`,
        30 * 24 * 60 * 60,
        JSON.stringify(Object.fromEntries(this.hourlyAggregates))
      );

      this.persistFailures = 0;
      Logger.info('[TokenTracker] Data persisted to Redis');
    } catch (error: any) {
      this.persistFailures++;
      if (this.persistFailures >= this.MAX_PERSIST_FAILURES) {
        Logger.warn(`[TokenTracker] Redis persist disabled after ${this.MAX_PERSIST_FAILURES} consecutive failures: ${error?.message}`);
      } else {
        Logger.error('[TokenTracker] Error persisting data:', error);
      }
    }
  }

  // Restaurar datos
  async restore(): Promise<void> {
    try {
      const recordsData = await redis.get(`${this.REDIS_PREFIX}records`);
      if (recordsData) {
        const parsed = JSON.parse(recordsData);
        this.records = parsed.map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));
      }

      const aggregatesData = await redis.get(`${this.REDIS_PREFIX}aggregates`);
      if (aggregatesData) {
        const parsed = JSON.parse(aggregatesData);
        this.hourlyAggregates = new Map(
          Object.entries(parsed).map(([k, v]: [string, any]) => [
            k,
            { ...v, timestamp: new Date(v.timestamp) },
          ])
        );
      }

      Logger.info('[TokenTracker] Data restored from Redis');
    } catch (error) {
      Logger.error('[TokenTracker] Error restoring data:', error);
    }
  }

  // Iniciar persistencia automática
  startAutoPersist(intervalMs: number = 60000): void {
    if (this.persistInterval) return;

    this.persistInterval = setInterval(() => {
      this.persist();
    }, intervalMs);
  }

  // Detener persistencia automática
  stopAutoPersist(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }
  }

  // Reset
  reset(): void {
    this.records = [];
    this.hourlyAggregates.clear();
    this.initializeAlerts();
  }

  // Obtener estado actual
  getStatus(): {
    totalRecords: number;
    oldestRecord: Date | null;
    newestRecord: Date | null;
    activeAlerts: number;
  } {
    return {
      totalRecords: this.records.length,
      oldestRecord: this.records.length > 0 ? this.records[0].timestamp : null,
      newestRecord: this.records.length > 0 ? this.records[this.records.length - 1].timestamp : null,
      activeAlerts: this.alerts.filter(a => a.triggered).length,
    };
  }
}

// Singleton export
export const tokenTracker = TokenConsumptionTracker.getInstance();
