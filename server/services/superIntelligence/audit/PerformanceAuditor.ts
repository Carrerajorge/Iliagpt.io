/**
 * SUPERINTELLIGENCE - Performance Auditor
 * Sistema de auditoría de rendimiento para los 179 servicios
 * Tarea 1: Auditar rendimiento de servicios
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';
import { redis } from '../../../lib/redis';

// Tipos de métricas
export interface ServiceMetrics {
  serviceName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  maxLatency: number;
  minLatency: number;
  throughput: number; // calls per second
  errorRate: number;
  lastUpdated: Date;
  memoryUsage: number;
  cpuUsage: number;
}

export interface EndpointMetrics {
  endpoint: string;
  method: string;
  totalRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  errorCount: number;
  statusCodes: Record<number, number>;
  bytesTransferred: number;
}

export interface TokenMetrics {
  provider: 'openai' | 'anthropic' | 'google' | 'xai';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  requestCount: number;
  averageTokensPerRequest: number;
}

export interface QueryMetrics {
  queryHash: string;
  queryPattern: string;
  executionCount: number;
  averageExecutionTime: number;
  maxExecutionTime: number;
  rowsAffected: number;
  isSlowQuery: boolean;
}

export interface SystemHealthMetrics {
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: number;
  heapUsed: number;
  heapTotal: number;
  externalMemory: number;
  activeConnections: number;
  redisConnections: number;
  dbPoolSize: number;
  dbPoolAvailable: number;
  eventLoopLag: number;
}

export interface AuditReport {
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  services: ServiceMetrics[];
  endpoints: EndpointMetrics[];
  tokens: TokenMetrics[];
  queries: QueryMetrics[];
  systemHealth: SystemHealthMetrics[];
  recommendations: AuditRecommendation[];
  overallScore: number;
}

export interface AuditRecommendation {
  severity: 'critical' | 'warning' | 'info';
  category: 'performance' | 'cost' | 'reliability' | 'security';
  title: string;
  description: string;
  affectedService?: string;
  suggestedAction: string;
  estimatedImpact: string;
}

// Configuración de umbrales
const THRESHOLDS = {
  latency: {
    warning: 500, // ms
    critical: 2000, // ms
  },
  errorRate: {
    warning: 0.01, // 1%
    critical: 0.05, // 5%
  },
  throughput: {
    warning: 100, // req/s
    critical: 500, // req/s
  },
  memory: {
    warning: 0.7, // 70%
    critical: 0.9, // 90%
  },
  tokenCost: {
    warning: 10, // $10/hour
    critical: 50, // $50/hour
  },
  queryTime: {
    warning: 100, // ms
    critical: 1000, // ms
  },
};

// Precios por 1M tokens (aproximados)
const TOKEN_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-5': { input: 5, output: 15 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-sonnet': { input: 3, output: 15 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'gemini-2.5-pro': { input: 1.25, output: 5 },
  'gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'grok-3': { input: 3, output: 15 },
  'grok-3-fast': { input: 0.6, output: 3 },
};

export class PerformanceAuditor extends EventEmitter {
  private static instance: PerformanceAuditor;
  private metricsBuffer: Map<string, ServiceMetrics> = new Map();
  private endpointBuffer: Map<string, EndpointMetrics> = new Map();
  private tokenBuffer: Map<string, TokenMetrics> = new Map();
  private queryBuffer: Map<string, QueryMetrics> = new Map();
  private healthHistory: SystemHealthMetrics[] = [];
  private latencyHistogram: Map<string, number[]> = new Map();
  private isCollecting: boolean = false;
  private collectionInterval: NodeJS.Timeout | null = null;
  private readonly REDIS_PREFIX = 'perf:audit:';
  private readonly COLLECTION_INTERVAL = 10000; // 10 seconds
  private readonly MAX_HISTORY_SIZE = 1000;

  private constructor() {
    super();
    this.setupEventHandlers();
  }

  static getInstance(): PerformanceAuditor {
    if (!PerformanceAuditor.instance) {
      PerformanceAuditor.instance = new PerformanceAuditor();
    }
    return PerformanceAuditor.instance;
  }

  private setupEventHandlers(): void {
    this.on('metric', (metric: ServiceMetrics) => {
      this.processMetric(metric);
    });

    this.on('threshold-exceeded', (data: { type: string; value: number; threshold: number }) => {
      Logger.warn(`[PerformanceAuditor] Threshold exceeded: ${data.type} = ${data.value} (threshold: ${data.threshold})`);
    });
  }

  // Iniciar recolección de métricas
  startCollection(): void {
    if (this.isCollecting) return;

    this.isCollecting = true;
    Logger.info('[PerformanceAuditor] Starting metrics collection');

    this.collectionInterval = setInterval(() => {
      this.collectSystemHealth();
      this.flushToRedis();
    }, this.COLLECTION_INTERVAL);

    // Recolección inicial
    this.collectSystemHealth();
  }

  // Detener recolección
  stopCollection(): void {
    if (!this.isCollecting) return;

    this.isCollecting = false;
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    Logger.info('[PerformanceAuditor] Stopped metrics collection');
  }

  // Registrar llamada a servicio
  recordServiceCall(
    serviceName: string,
    duration: number,
    success: boolean,
    metadata?: Record<string, any>
  ): void {
    const existing = this.metricsBuffer.get(serviceName) || this.createEmptyServiceMetrics(serviceName);

    existing.totalCalls++;
    if (success) {
      existing.successfulCalls++;
    } else {
      existing.failedCalls++;
    }

    // Actualizar latencias
    const latencies = this.latencyHistogram.get(serviceName) || [];
    latencies.push(duration);
    if (latencies.length > this.MAX_HISTORY_SIZE) {
      latencies.shift();
    }
    this.latencyHistogram.set(serviceName, latencies);

    // Calcular estadísticas
    existing.averageLatency = this.calculateAverage(latencies);
    existing.p50Latency = this.calculatePercentile(latencies, 50);
    existing.p95Latency = this.calculatePercentile(latencies, 95);
    existing.p99Latency = this.calculatePercentile(latencies, 99);
    existing.maxLatency = Math.max(...latencies);
    existing.minLatency = Math.min(...latencies);
    existing.errorRate = existing.failedCalls / existing.totalCalls;
    existing.lastUpdated = new Date();

    this.metricsBuffer.set(serviceName, existing);

    // Verificar umbrales
    this.checkThresholds(existing);

    this.emit('metric', existing);
  }

  // Registrar llamada a endpoint
  recordEndpointCall(
    endpoint: string,
    method: string,
    statusCode: number,
    responseTime: number,
    bytesTransferred: number
  ): void {
    const key = `${method}:${endpoint}`;
    const existing = this.endpointBuffer.get(key) || this.createEmptyEndpointMetrics(endpoint, method);

    existing.totalRequests++;
    existing.statusCodes[statusCode] = (existing.statusCodes[statusCode] || 0) + 1;
    existing.bytesTransferred += bytesTransferred;

    if (statusCode >= 400) {
      existing.errorCount++;
    }

    // Actualizar tiempos de respuesta (moving average)
    existing.averageResponseTime =
      (existing.averageResponseTime * (existing.totalRequests - 1) + responseTime) / existing.totalRequests;

    this.endpointBuffer.set(key, existing);
  }

  // Registrar consumo de tokens
  recordTokenUsage(
    provider: TokenMetrics['provider'],
    model: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    const key = `${provider}:${model}`;
    const existing = this.tokenBuffer.get(key) || this.createEmptyTokenMetrics(provider, model);

    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.totalTokens += inputTokens + outputTokens;
    existing.requestCount++;
    existing.averageTokensPerRequest = existing.totalTokens / existing.requestCount;

    // Calcular costo estimado
    const prices = TOKEN_PRICES[model] || { input: 1, output: 3 };
    existing.estimatedCost =
      (existing.inputTokens / 1_000_000) * prices.input +
      (existing.outputTokens / 1_000_000) * prices.output;

    this.tokenBuffer.set(key, existing);

    // Verificar umbral de costo
    if (existing.estimatedCost > THRESHOLDS.tokenCost.critical) {
      this.emit('threshold-exceeded', {
        type: 'token-cost',
        value: existing.estimatedCost,
        threshold: THRESHOLDS.tokenCost.critical,
      });
    }
  }

  // Registrar query de base de datos
  recordDatabaseQuery(
    queryPattern: string,
    executionTime: number,
    rowsAffected: number
  ): void {
    const queryHash = this.hashQuery(queryPattern);
    const existing = this.queryBuffer.get(queryHash) || this.createEmptyQueryMetrics(queryHash, queryPattern);

    existing.executionCount++;
    existing.rowsAffected += rowsAffected;
    existing.averageExecutionTime =
      (existing.averageExecutionTime * (existing.executionCount - 1) + executionTime) / existing.executionCount;
    existing.maxExecutionTime = Math.max(existing.maxExecutionTime, executionTime);
    existing.isSlowQuery = existing.averageExecutionTime > THRESHOLDS.queryTime.warning;

    this.queryBuffer.set(queryHash, existing);

    if (executionTime > THRESHOLDS.queryTime.critical) {
      this.emit('threshold-exceeded', {
        type: 'slow-query',
        value: executionTime,
        threshold: THRESHOLDS.queryTime.critical,
      });
    }
  }

  // Recolectar métricas de salud del sistema
  private collectSystemHealth(): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const health: SystemHealthMetrics = {
      timestamp: new Date(),
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
      memoryUsage: memUsage.rss / (1024 * 1024 * 1024), // GB
      heapUsed: memUsage.heapUsed / (1024 * 1024), // MB
      heapTotal: memUsage.heapTotal / (1024 * 1024), // MB
      externalMemory: memUsage.external / (1024 * 1024), // MB
      activeConnections: 0, // Will be populated by middleware
      redisConnections: 0, // Will be populated
      dbPoolSize: 20, // From config
      dbPoolAvailable: 0, // Will be populated
      eventLoopLag: 0, // Will be measured
    };

    this.healthHistory.push(health);
    if (this.healthHistory.length > this.MAX_HISTORY_SIZE) {
      this.healthHistory.shift();
    }

    // Verificar umbral de memoria
    const memoryPercent = health.heapUsed / health.heapTotal;
    if (memoryPercent > THRESHOLDS.memory.critical) {
      this.emit('threshold-exceeded', {
        type: 'memory',
        value: memoryPercent,
        threshold: THRESHOLDS.memory.critical,
      });
    }
  }

  // Generar reporte de auditoría completo
  async generateAuditReport(periodHours: number = 24): Promise<AuditReport> {
    const now = new Date();
    const periodStart = new Date(now.getTime() - periodHours * 60 * 60 * 1000);

    const services = Array.from(this.metricsBuffer.values());
    const endpoints = Array.from(this.endpointBuffer.values());
    const tokens = Array.from(this.tokenBuffer.values());
    const queries = Array.from(this.queryBuffer.values());

    // Generar recomendaciones
    const recommendations = this.generateRecommendations(services, endpoints, tokens, queries);

    // Calcular puntuación general
    const overallScore = this.calculateOverallScore(services, endpoints, tokens, queries);

    const report: AuditReport = {
      generatedAt: now,
      periodStart,
      periodEnd: now,
      services,
      endpoints,
      tokens,
      queries,
      systemHealth: this.healthHistory.slice(-100), // Last 100 samples
      recommendations,
      overallScore,
    };

    // Guardar reporte en Redis
    await this.saveReportToRedis(report);

    return report;
  }

  // Generar recomendaciones basadas en métricas
  private generateRecommendations(
    services: ServiceMetrics[],
    endpoints: EndpointMetrics[],
    tokens: TokenMetrics[],
    queries: QueryMetrics[]
  ): AuditRecommendation[] {
    const recommendations: AuditRecommendation[] = [];

    // Analizar servicios con alta latencia
    for (const service of services) {
      if (service.p95Latency > THRESHOLDS.latency.critical) {
        recommendations.push({
          severity: 'critical',
          category: 'performance',
          title: `Alta latencia en ${service.serviceName}`,
          description: `El servicio tiene una latencia P95 de ${service.p95Latency.toFixed(0)}ms`,
          affectedService: service.serviceName,
          suggestedAction: 'Revisar queries, agregar caché, o escalar horizontalmente',
          estimatedImpact: 'Mejora de 50-80% en tiempo de respuesta',
        });
      }

      if (service.errorRate > THRESHOLDS.errorRate.critical) {
        recommendations.push({
          severity: 'critical',
          category: 'reliability',
          title: `Alta tasa de errores en ${service.serviceName}`,
          description: `El servicio tiene una tasa de errores del ${(service.errorRate * 100).toFixed(2)}%`,
          affectedService: service.serviceName,
          suggestedAction: 'Revisar logs de errores, implementar circuit breaker',
          estimatedImpact: 'Mejora en disponibilidad del servicio',
        });
      }
    }

    // Analizar costos de tokens
    const totalTokenCost = tokens.reduce((sum, t) => sum + t.estimatedCost, 0);
    if (totalTokenCost > THRESHOLDS.tokenCost.warning) {
      const mostExpensive = tokens.sort((a, b) => b.estimatedCost - a.estimatedCost)[0];
      recommendations.push({
        severity: totalTokenCost > THRESHOLDS.tokenCost.critical ? 'critical' : 'warning',
        category: 'cost',
        title: 'Alto consumo de tokens LLM',
        description: `Costo estimado: $${totalTokenCost.toFixed(2)}. Mayor consumidor: ${mostExpensive?.model}`,
        suggestedAction: 'Implementar caché de respuestas, usar modelos más económicos para tareas simples',
        estimatedImpact: 'Reducción de 30-60% en costos de API',
      });
    }

    // Analizar queries lentas
    const slowQueries = queries.filter(q => q.isSlowQuery);
    if (slowQueries.length > 0) {
      recommendations.push({
        severity: 'warning',
        category: 'performance',
        title: `${slowQueries.length} queries lentas detectadas`,
        description: `Queries con tiempo promedio > ${THRESHOLDS.queryTime.warning}ms`,
        suggestedAction: 'Agregar índices, optimizar queries, usar materialized views',
        estimatedImpact: 'Mejora de 40-70% en tiempo de queries',
      });
    }

    // Analizar endpoints con muchos errores
    for (const endpoint of endpoints) {
      const errorRate = endpoint.errorCount / endpoint.totalRequests;
      if (errorRate > THRESHOLDS.errorRate.warning) {
        recommendations.push({
          severity: errorRate > THRESHOLDS.errorRate.critical ? 'critical' : 'warning',
          category: 'reliability',
          title: `Endpoint con alta tasa de errores: ${endpoint.method} ${endpoint.endpoint}`,
          description: `${(errorRate * 100).toFixed(2)}% de requests fallan`,
          suggestedAction: 'Revisar validación de inputs, manejo de errores, y logs',
          estimatedImpact: 'Mejora en experiencia de usuario',
        });
      }
    }

    // Analizar memoria
    const recentHealth = this.healthHistory.slice(-10);
    const avgMemoryUsage = recentHealth.reduce((sum, h) => sum + h.heapUsed / h.heapTotal, 0) / recentHealth.length;
    if (avgMemoryUsage > THRESHOLDS.memory.warning) {
      recommendations.push({
        severity: avgMemoryUsage > THRESHOLDS.memory.critical ? 'critical' : 'warning',
        category: 'performance',
        title: 'Alto uso de memoria',
        description: `Uso promedio: ${(avgMemoryUsage * 100).toFixed(1)}% del heap`,
        suggestedAction: 'Revisar memory leaks, optimizar estructuras de datos, aumentar límites',
        estimatedImpact: 'Prevención de crashes por OOM',
      });
    }

    return recommendations.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  // Calcular puntuación general (0-100)
  private calculateOverallScore(
    services: ServiceMetrics[],
    endpoints: EndpointMetrics[],
    tokens: TokenMetrics[],
    queries: QueryMetrics[]
  ): number {
    let score = 100;

    // Penalizar por servicios con problemas
    for (const service of services) {
      if (service.errorRate > THRESHOLDS.errorRate.critical) score -= 10;
      else if (service.errorRate > THRESHOLDS.errorRate.warning) score -= 5;

      if (service.p95Latency > THRESHOLDS.latency.critical) score -= 8;
      else if (service.p95Latency > THRESHOLDS.latency.warning) score -= 3;
    }

    // Penalizar por queries lentas
    const slowQueryRatio = queries.filter(q => q.isSlowQuery).length / Math.max(queries.length, 1);
    score -= slowQueryRatio * 20;

    // Penalizar por alto costo de tokens
    const totalCost = tokens.reduce((sum, t) => sum + t.estimatedCost, 0);
    if (totalCost > THRESHOLDS.tokenCost.critical) score -= 15;
    else if (totalCost > THRESHOLDS.tokenCost.warning) score -= 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // Utilidades
  private createEmptyServiceMetrics(serviceName: string): ServiceMetrics {
    return {
      serviceName,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageLatency: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
      maxLatency: 0,
      minLatency: Infinity,
      throughput: 0,
      errorRate: 0,
      lastUpdated: new Date(),
      memoryUsage: 0,
      cpuUsage: 0,
    };
  }

  private createEmptyEndpointMetrics(endpoint: string, method: string): EndpointMetrics {
    return {
      endpoint,
      method,
      totalRequests: 0,
      averageResponseTime: 0,
      p95ResponseTime: 0,
      errorCount: 0,
      statusCodes: {},
      bytesTransferred: 0,
    };
  }

  private createEmptyTokenMetrics(provider: TokenMetrics['provider'], model: string): TokenMetrics {
    return {
      provider,
      model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      requestCount: 0,
      averageTokensPerRequest: 0,
    };
  }

  private createEmptyQueryMetrics(queryHash: string, queryPattern: string): QueryMetrics {
    return {
      queryHash,
      queryPattern,
      executionCount: 0,
      averageExecutionTime: 0,
      maxExecutionTime: 0,
      rowsAffected: 0,
      isSlowQuery: false,
    };
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private hashQuery(query: string): string {
    // Simple hash for query pattern
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private checkThresholds(metrics: ServiceMetrics): void {
    if (metrics.p95Latency > THRESHOLDS.latency.critical) {
      this.emit('threshold-exceeded', {
        type: 'latency',
        value: metrics.p95Latency,
        threshold: THRESHOLDS.latency.critical,
      });
    }

    if (metrics.errorRate > THRESHOLDS.errorRate.critical) {
      this.emit('threshold-exceeded', {
        type: 'error-rate',
        value: metrics.errorRate,
        threshold: THRESHOLDS.errorRate.critical,
      });
    }
  }

  private async flushToRedis(): Promise<void> {
    try {
      const pipeline = redis.pipeline();

      // Guardar métricas de servicios
      for (const [key, metrics] of this.metricsBuffer) {
        pipeline.hset(`${this.REDIS_PREFIX}services`, key, JSON.stringify(metrics));
      }

      // Guardar métricas de endpoints
      for (const [key, metrics] of this.endpointBuffer) {
        pipeline.hset(`${this.REDIS_PREFIX}endpoints`, key, JSON.stringify(metrics));
      }

      // Guardar métricas de tokens
      for (const [key, metrics] of this.tokenBuffer) {
        pipeline.hset(`${this.REDIS_PREFIX}tokens`, key, JSON.stringify(metrics));
      }

      // TTL de 24 horas
      pipeline.expire(`${this.REDIS_PREFIX}services`, 86400);
      pipeline.expire(`${this.REDIS_PREFIX}endpoints`, 86400);
      pipeline.expire(`${this.REDIS_PREFIX}tokens`, 86400);

      await pipeline.exec();
    } catch (error) {
      Logger.error('[PerformanceAuditor] Error flushing to Redis:', error);
    }
  }

  private async saveReportToRedis(report: AuditReport): Promise<void> {
    try {
      const key = `${this.REDIS_PREFIX}report:${report.generatedAt.toISOString()}`;
      await redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(report)); // 7 days TTL
      await redis.lpush(`${this.REDIS_PREFIX}reports:list`, key);
      await redis.ltrim(`${this.REDIS_PREFIX}reports:list`, 0, 99); // Keep last 100 reports
    } catch (error) {
      Logger.error('[PerformanceAuditor] Error saving report to Redis:', error);
    }
  }

  // Obtener métricas actuales
  getCurrentMetrics(): {
    services: ServiceMetrics[];
    endpoints: EndpointMetrics[];
    tokens: TokenMetrics[];
    queries: QueryMetrics[];
    health: SystemHealthMetrics[];
  } {
    return {
      services: Array.from(this.metricsBuffer.values()),
      endpoints: Array.from(this.endpointBuffer.values()),
      tokens: Array.from(this.tokenBuffer.values()),
      queries: Array.from(this.queryBuffer.values()),
      health: this.healthHistory.slice(-100),
    };
  }

  // Obtener reportes históricos
  async getHistoricalReports(limit: number = 10): Promise<AuditReport[]> {
    try {
      const keys = await redis.lrange(`${this.REDIS_PREFIX}reports:list`, 0, limit - 1);
      const reports: AuditReport[] = [];

      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          reports.push(JSON.parse(data));
        }
      }

      return reports;
    } catch (error) {
      Logger.error('[PerformanceAuditor] Error fetching historical reports:', error);
      return [];
    }
  }

  // Reset de métricas (para testing o mantenimiento)
  reset(): void {
    this.metricsBuffer.clear();
    this.endpointBuffer.clear();
    this.tokenBuffer.clear();
    this.queryBuffer.clear();
    this.healthHistory = [];
    this.latencyHistogram.clear();
  }
}

// Singleton export
export const performanceAuditor = PerformanceAuditor.getInstance();
