/**
 * SUPERINTELLIGENCE - Audit Module
 * Exporta todos los componentes del sistema de auditoría
 *
 * Sistema completo de monitoreo y auditoría que incluye:
 * - Performance Auditor: Métricas de rendimiento de servicios
 * - Latency Analyzer: Análisis avanzado de latencia
 * - Token Tracker: Monitoreo de consumo de tokens LLM
 * - Query Analyzer: Análisis de queries PostgreSQL
 */

// Core auditor
export {
  PerformanceAuditor,
  performanceAuditor,
  type ServiceMetrics,
  type EndpointMetrics,
  type TokenMetrics,
  type QueryMetrics,
  type SystemHealthMetrics,
  type AuditReport,
  type AuditRecommendation,
} from './PerformanceAuditor';

// Latency analyzer
export {
  LatencyAnalyzer,
  latencyAnalyzer,
  type LatencyBucket,
  type LatencyTrend,
  type LatencyAnomaly,
  type EndpointLatencyProfile,
  type LatencyCorrelation,
  type LatencyAnalysisReport,
  type LatencyRecommendation,
} from './LatencyAnalyzer';

// Token tracker
export {
  TokenConsumptionTracker,
  tokenTracker,
  type TokenUsageRecord,
  type LLMProvider,
  type ModelPricing,
  type ProviderStats,
  type ModelStats,
  type UsageTrend,
  type CostAlert,
  type CostForecast,
  type TokenReport,
  type TokenRecommendation,
  type UserTokenStats,
  type EndpointTokenStats,
} from './TokenConsumptionTracker';

// Query analyzer
export {
  QueryAnalyzer,
  queryAnalyzer,
  type QueryRecord,
  type QueryProfile,
  type TableStats,
  type IndexStats,
  type QueryPlan,
  type QueryRecommendation,
  type QueryAnalysisReport,
} from './QueryAnalyzer';

// Middleware
export {
  auditMiddleware,
  withAudit,
  createAuditedService,
  trackTokenUsage,
  trackDatabaseQuery,
  ServiceAuditContext,
  audit,
  createAuditedRouter,
} from './AuditMiddleware';

// Inicialización del sistema de auditoría
import { performanceAuditor } from './PerformanceAuditor';
import { latencyAnalyzer } from './LatencyAnalyzer';
import { tokenTracker } from './TokenConsumptionTracker';
import { queryAnalyzer } from './QueryAnalyzer';
import { Logger } from '../../../lib/logger';

export async function initializeAuditSystem(): Promise<void> {
  Logger.info('[AuditSystem] Initializing SuperIntelligence Audit System...');

  try {
    // Restaurar datos de Redis
    await Promise.all([
      latencyAnalyzer.restore(),
      tokenTracker.restore(),
      queryAnalyzer.restore(),
    ]);

    // Iniciar recolección de métricas
    performanceAuditor.startCollection();

    // Iniciar auto-persistencia
    tokenTracker.startAutoPersist();

    Logger.info('[AuditSystem] SuperIntelligence Audit System initialized successfully');
    Logger.info('[AuditSystem] Components: PerformanceAuditor, LatencyAnalyzer, TokenTracker, QueryAnalyzer');
  } catch (error) {
    Logger.error('[AuditSystem] Error initializing audit system:', error);
  }
}

export async function shutdownAuditSystem(): Promise<void> {
  Logger.info('[AuditSystem] Shutting down SuperIntelligence Audit System...');

  try {
    // Detener recolección
    performanceAuditor.stopCollection();
    tokenTracker.stopAutoPersist();

    // Persistir datos finales
    await Promise.all([
      latencyAnalyzer.persist(),
      tokenTracker.persist(),
      queryAnalyzer.persist(),
    ]);

    Logger.info('[AuditSystem] SuperIntelligence Audit System shutdown complete');
  } catch (error) {
    Logger.error('[AuditSystem] Error during shutdown:', error);
  }
}

// Función para obtener estado global del sistema de auditoría
export function getAuditSystemStatus() {
  return {
    performance: {
      isCollecting: true,
      metrics: performanceAuditor.getCurrentMetrics(),
    },
    latency: latencyAnalyzer.getStatus(),
    tokens: tokenTracker.getStatus(),
    queries: queryAnalyzer.getStatus(),
  };
}
