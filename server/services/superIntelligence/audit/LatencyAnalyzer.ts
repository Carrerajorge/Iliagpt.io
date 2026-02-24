/**
 * SUPERINTELLIGENCE - Latency Analyzer
 * Análisis avanzado de latencia para endpoints y servicios
 * Tarea 2: Implementar análisis de latencia de endpoints
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';
import { redis } from '../../../lib/redis';

export interface LatencyBucket {
  range: string;
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface LatencyTrend {
  timestamp: Date;
  average: number;
  p50: number;
  p95: number;
  p99: number;
  requestCount: number;
}

export interface LatencyAnomaly {
  timestamp: Date;
  endpoint: string;
  expectedLatency: number;
  actualLatency: number;
  deviation: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface EndpointLatencyProfile {
  endpoint: string;
  method: string;
  sampleCount: number;
  histogram: LatencyBucket[];
  trends: LatencyTrend[];
  anomalies: LatencyAnomaly[];
  statistics: {
    mean: number;
    median: number;
    mode: number;
    stdDev: number;
    variance: number;
    skewness: number;
    kurtosis: number;
  };
  sla: {
    target: number;
    compliance: number;
    breaches: number;
  };
}

export interface LatencyCorrelation {
  endpoint1: string;
  endpoint2: string;
  correlation: number;
  isSignificant: boolean;
}

export interface LatencyAnalysisReport {
  generatedAt: Date;
  totalEndpoints: number;
  profiles: EndpointLatencyProfile[];
  correlations: LatencyCorrelation[];
  globalTrends: LatencyTrend[];
  criticalEndpoints: string[];
  recommendations: LatencyRecommendation[];
}

export interface LatencyRecommendation {
  endpoint: string;
  issue: string;
  impact: string;
  suggestion: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

// Configuración de buckets para histograma
const LATENCY_BUCKETS = [
  { range: '0-50ms', min: 0, max: 50 },
  { range: '50-100ms', min: 50, max: 100 },
  { range: '100-200ms', min: 100, max: 200 },
  { range: '200-500ms', min: 200, max: 500 },
  { range: '500ms-1s', min: 500, max: 1000 },
  { range: '1-2s', min: 1000, max: 2000 },
  { range: '2-5s', min: 2000, max: 5000 },
  { range: '>5s', min: 5000, max: Infinity },
];

// SLA targets por tipo de endpoint
const SLA_TARGETS: Record<string, number> = {
  'GET:/api/health': 50,
  'GET:/api/chats': 200,
  'POST:/api/chat-ai': 5000, // Streaming puede tomar más
  'POST:/api/gpt': 10000,
  'GET:/api/documents': 300,
  'POST:/api/files': 2000,
  default: 500,
};

export class LatencyAnalyzer extends EventEmitter {
  private static instance: LatencyAnalyzer;
  private latencyData: Map<string, number[]> = new Map();
  private trendData: Map<string, LatencyTrend[]> = new Map();
  private anomalyHistory: LatencyAnomaly[] = [];
  private readonly REDIS_PREFIX = 'latency:analyzer:';
  private readonly MAX_SAMPLES = 10000;
  private readonly TREND_WINDOW_SIZE = 60; // seconds
  private readonly ANOMALY_THRESHOLD = 2.5; // standard deviations

  private constructor() {
    super();
  }

  static getInstance(): LatencyAnalyzer {
    if (!LatencyAnalyzer.instance) {
      LatencyAnalyzer.instance = new LatencyAnalyzer();
    }
    return LatencyAnalyzer.instance;
  }

  // Registrar una medición de latencia
  recordLatency(endpoint: string, method: string, latency: number): void {
    const key = `${method}:${endpoint}`;

    // Agregar a datos de latencia
    const samples = this.latencyData.get(key) || [];
    samples.push(latency);

    // Mantener límite de muestras
    if (samples.length > this.MAX_SAMPLES) {
      samples.shift();
    }

    this.latencyData.set(key, samples);

    // Detectar anomalías
    this.detectAnomaly(key, latency);

    // Actualizar tendencias
    this.updateTrend(key, latency);
  }

  // Detectar anomalías en latencia
  private detectAnomaly(key: string, latency: number): void {
    const samples = this.latencyData.get(key);
    if (!samples || samples.length < 30) return; // Necesitamos suficientes muestras

    const stats = this.calculateStatistics(samples.slice(-100)); // Últimas 100 muestras
    const zScore = (latency - stats.mean) / stats.stdDev;

    if (Math.abs(zScore) > this.ANOMALY_THRESHOLD) {
      const severity = this.calculateAnomalySeverity(zScore);

      const anomaly: LatencyAnomaly = {
        timestamp: new Date(),
        endpoint: key,
        expectedLatency: stats.mean,
        actualLatency: latency,
        deviation: zScore,
        severity,
      };

      this.anomalyHistory.push(anomaly);
      if (this.anomalyHistory.length > 1000) {
        this.anomalyHistory.shift();
      }

      this.emit('anomaly', anomaly);

      if (severity === 'critical') {
        Logger.warn(`[LatencyAnalyzer] Critical latency anomaly detected: ${key} - ${latency}ms (expected: ${stats.mean.toFixed(0)}ms)`);
      }
    }
  }

  // Calcular severidad de anomalía
  private calculateAnomalySeverity(zScore: number): LatencyAnomaly['severity'] {
    const absZScore = Math.abs(zScore);
    if (absZScore > 4) return 'critical';
    if (absZScore > 3.5) return 'high';
    if (absZScore > 3) return 'medium';
    return 'low';
  }

  // Actualizar tendencias
  private updateTrend(key: string, latency: number): void {
    const trends = this.trendData.get(key) || [];
    const now = new Date();

    // Agregar al bucket actual o crear nuevo
    const lastTrend = trends[trends.length - 1];
    const shouldCreateNew = !lastTrend ||
      (now.getTime() - lastTrend.timestamp.getTime()) > this.TREND_WINDOW_SIZE * 1000;

    if (shouldCreateNew) {
      const samples = this.latencyData.get(key) || [];
      const recentSamples = samples.slice(-100);

      trends.push({
        timestamp: now,
        average: this.calculateMean(recentSamples),
        p50: this.calculatePercentile(recentSamples, 50),
        p95: this.calculatePercentile(recentSamples, 95),
        p99: this.calculatePercentile(recentSamples, 99),
        requestCount: recentSamples.length,
      });

      // Mantener solo últimas 24 horas de tendencias
      const maxTrends = (24 * 60 * 60) / this.TREND_WINDOW_SIZE;
      if (trends.length > maxTrends) {
        trends.shift();
      }

      this.trendData.set(key, trends);
    }
  }

  // Generar perfil de latencia para un endpoint
  generateProfile(endpoint: string, method: string): EndpointLatencyProfile {
    const key = `${method}:${endpoint}`;
    const samples = this.latencyData.get(key) || [];
    const trends = this.trendData.get(key) || [];

    // Calcular histograma
    const histogram = this.calculateHistogram(samples);

    // Calcular estadísticas
    const statistics = this.calculateStatistics(samples);

    // Calcular SLA compliance
    const slaTarget = SLA_TARGETS[key] || SLA_TARGETS.default;
    const breaches = samples.filter(s => s > slaTarget).length;
    const compliance = samples.length > 0 ? ((samples.length - breaches) / samples.length) * 100 : 100;

    // Obtener anomalías para este endpoint
    const anomalies = this.anomalyHistory.filter(a => a.endpoint === key);

    return {
      endpoint,
      method,
      sampleCount: samples.length,
      histogram,
      trends: trends.slice(-100), // Últimas 100 tendencias
      anomalies: anomalies.slice(-50), // Últimas 50 anomalías
      statistics,
      sla: {
        target: slaTarget,
        compliance,
        breaches,
      },
    };
  }

  // Calcular histograma de latencias
  private calculateHistogram(samples: number[]): LatencyBucket[] {
    const total = samples.length;

    return LATENCY_BUCKETS.map(bucket => {
      const count = samples.filter(s => s >= bucket.min && s < bucket.max).length;
      return {
        ...bucket,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      };
    });
  }

  // Calcular estadísticas completas
  private calculateStatistics(samples: number[]): EndpointLatencyProfile['statistics'] {
    if (samples.length === 0) {
      return {
        mean: 0,
        median: 0,
        mode: 0,
        stdDev: 0,
        variance: 0,
        skewness: 0,
        kurtosis: 0,
      };
    }

    const mean = this.calculateMean(samples);
    const median = this.calculatePercentile(samples, 50);
    const mode = this.calculateMode(samples);
    const variance = this.calculateVariance(samples, mean);
    const stdDev = Math.sqrt(variance);
    const skewness = this.calculateSkewness(samples, mean, stdDev);
    const kurtosis = this.calculateKurtosis(samples, mean, stdDev);

    return { mean, median, mode, stdDev, variance, skewness, kurtosis };
  }

  // Utilidades matemáticas
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private calculateMode(values: number[]): number {
    if (values.length === 0) return 0;

    // Agrupar en buckets de 10ms para encontrar moda
    const buckets = new Map<number, number>();
    for (const v of values) {
      const bucket = Math.round(v / 10) * 10;
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }

    let maxCount = 0;
    let mode = 0;
    for (const [value, count] of buckets) {
      if (count > maxCount) {
        maxCount = count;
        mode = value;
      }
    }

    return mode;
  }

  private calculateVariance(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  }

  private calculateSkewness(values: number[], mean: number, stdDev: number): number {
    if (values.length === 0 || stdDev === 0) return 0;
    const n = values.length;
    const sum = values.reduce((acc, v) => acc + Math.pow((v - mean) / stdDev, 3), 0);
    return (n / ((n - 1) * (n - 2))) * sum;
  }

  private calculateKurtosis(values: number[], mean: number, stdDev: number): number {
    if (values.length === 0 || stdDev === 0) return 0;
    const n = values.length;
    const sum = values.reduce((acc, v) => acc + Math.pow((v - mean) / stdDev, 4), 0);
    return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum - (3 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3));
  }

  // Calcular correlaciones entre endpoints
  calculateCorrelations(): LatencyCorrelation[] {
    const correlations: LatencyCorrelation[] = [];
    const endpoints = Array.from(this.latencyData.keys());

    for (let i = 0; i < endpoints.length; i++) {
      for (let j = i + 1; j < endpoints.length; j++) {
        const samples1 = this.latencyData.get(endpoints[i]) || [];
        const samples2 = this.latencyData.get(endpoints[j]) || [];

        // Solo calcular si hay suficientes muestras
        if (samples1.length < 30 || samples2.length < 30) continue;

        const correlation = this.pearsonCorrelation(
          samples1.slice(-100),
          samples2.slice(-100)
        );

        correlations.push({
          endpoint1: endpoints[i],
          endpoint2: endpoints[j],
          correlation,
          isSignificant: Math.abs(correlation) > 0.5,
        });
      }
    }

    return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }

  // Correlación de Pearson
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;

    const meanX = this.calculateMean(x.slice(0, n));
    const meanY = this.calculateMean(y.slice(0, n));

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denom = Math.sqrt(denomX * denomY);
    return denom === 0 ? 0 : numerator / denom;
  }

  // Generar reporte completo de análisis
  generateReport(): LatencyAnalysisReport {
    const endpoints = Array.from(this.latencyData.keys());
    const profiles: EndpointLatencyProfile[] = [];

    for (const key of endpoints) {
      const [method, ...endpointParts] = key.split(':');
      const endpoint = endpointParts.join(':');
      profiles.push(this.generateProfile(endpoint, method));
    }

    // Identificar endpoints críticos
    const criticalEndpoints = profiles
      .filter(p => p.sla.compliance < 95 || p.anomalies.filter(a => a.severity === 'critical').length > 5)
      .map(p => `${p.method}:${p.endpoint}`);

    // Calcular tendencias globales
    const globalTrends = this.calculateGlobalTrends();

    // Generar recomendaciones
    const recommendations = this.generateRecommendations(profiles);

    // Calcular correlaciones
    const correlations = this.calculateCorrelations().slice(0, 20); // Top 20

    return {
      generatedAt: new Date(),
      totalEndpoints: endpoints.length,
      profiles: profiles.sort((a, b) => b.statistics.mean - a.statistics.mean), // Ordenar por latencia
      correlations,
      globalTrends,
      criticalEndpoints,
      recommendations,
    };
  }

  // Calcular tendencias globales
  private calculateGlobalTrends(): LatencyTrend[] {
    const allTrends: Map<string, LatencyTrend> = new Map();

    for (const [, trends] of this.trendData) {
      for (const trend of trends) {
        const key = trend.timestamp.toISOString().slice(0, 16); // Agrupar por minuto
        const existing = allTrends.get(key);

        if (existing) {
          existing.average = (existing.average + trend.average) / 2;
          existing.p50 = (existing.p50 + trend.p50) / 2;
          existing.p95 = (existing.p95 + trend.p95) / 2;
          existing.p99 = (existing.p99 + trend.p99) / 2;
          existing.requestCount += trend.requestCount;
        } else {
          allTrends.set(key, { ...trend });
        }
      }
    }

    return Array.from(allTrends.values())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(-100);
  }

  // Generar recomendaciones
  private generateRecommendations(profiles: EndpointLatencyProfile[]): LatencyRecommendation[] {
    const recommendations: LatencyRecommendation[] = [];

    for (const profile of profiles) {
      const key = `${profile.method}:${profile.endpoint}`;

      // SLA breach
      if (profile.sla.compliance < 95) {
        recommendations.push({
          endpoint: key,
          issue: `SLA compliance at ${profile.sla.compliance.toFixed(1)}% (target: 95%)`,
          impact: `${profile.sla.breaches} requests exceeded ${profile.sla.target}ms`,
          suggestion: 'Add caching, optimize database queries, or scale horizontally',
          priority: profile.sla.compliance < 80 ? 'critical' : 'high',
        });
      }

      // High variance
      if (profile.statistics.stdDev > profile.statistics.mean * 0.5) {
        recommendations.push({
          endpoint: key,
          issue: 'High latency variance detected',
          impact: 'Inconsistent user experience',
          suggestion: 'Investigate external dependencies, add circuit breakers',
          priority: 'medium',
        });
      }

      // Positive skewness (long tail)
      if (profile.statistics.skewness > 2) {
        recommendations.push({
          endpoint: key,
          issue: 'Long tail distribution detected',
          impact: 'Some requests take significantly longer than average',
          suggestion: 'Add timeouts, implement async processing for heavy operations',
          priority: 'medium',
        });
      }

      // High P99
      if (profile.statistics.mean > 0 && profile.trends.length > 0) {
        const recentP99 = profile.trends[profile.trends.length - 1]?.p99 || 0;
        if (recentP99 > profile.sla.target * 3) {
          recommendations.push({
            endpoint: key,
            issue: `P99 latency (${recentP99.toFixed(0)}ms) is 3x above SLA target`,
            impact: '1% of users experience very slow responses',
            suggestion: 'Optimize worst-case scenarios, add request prioritization',
            priority: 'high',
          });
        }
      }

      // Frequent anomalies
      const recentAnomalies = profile.anomalies.filter(
        a => new Date().getTime() - a.timestamp.getTime() < 3600000 // Last hour
      );
      if (recentAnomalies.length > 10) {
        recommendations.push({
          endpoint: key,
          issue: `${recentAnomalies.length} latency anomalies in the last hour`,
          impact: 'Service instability detected',
          suggestion: 'Check for resource contention, memory leaks, or external service issues',
          priority: 'high',
        });
      }
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  // Persistir datos en Redis
  async persist(): Promise<void> {
    try {
      const data = {
        latencyData: Object.fromEntries(
          Array.from(this.latencyData.entries()).map(([k, v]) => [k, v.slice(-1000)])
        ),
        anomalyHistory: this.anomalyHistory.slice(-500),
      };

      await redis.setex(
        `${this.REDIS_PREFIX}data`,
        24 * 60 * 60, // 24 hours TTL
        JSON.stringify(data)
      );
    } catch (error) {
      Logger.error('[LatencyAnalyzer] Error persisting data:', error);
    }
  }

  // Restaurar datos de Redis
  async restore(): Promise<void> {
    try {
      const data = await redis.get(`${this.REDIS_PREFIX}data`);
      if (data) {
        const parsed = JSON.parse(data);

        if (parsed.latencyData) {
          this.latencyData = new Map(Object.entries(parsed.latencyData));
        }

        if (parsed.anomalyHistory) {
          this.anomalyHistory = parsed.anomalyHistory.map((a: any) => ({
            ...a,
            timestamp: new Date(a.timestamp),
          }));
        }

        Logger.info('[LatencyAnalyzer] Data restored from Redis');
      }
    } catch (error) {
      Logger.error('[LatencyAnalyzer] Error restoring data:', error);
    }
  }

  // Limpiar datos
  reset(): void {
    this.latencyData.clear();
    this.trendData.clear();
    this.anomalyHistory = [];
  }

  // Obtener estado actual
  getStatus(): { endpoints: number; samples: number; anomalies: number } {
    let totalSamples = 0;
    for (const samples of this.latencyData.values()) {
      totalSamples += samples.length;
    }

    return {
      endpoints: this.latencyData.size,
      samples: totalSamples,
      anomalies: this.anomalyHistory.length,
    };
  }
}

// Singleton export
export const latencyAnalyzer = LatencyAnalyzer.getInstance();
