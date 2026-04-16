/**
 * SUPERINTELLIGENCE - Audit Dashboard API
 * Endpoints para el dashboard de métricas y auditoría
 * Tarea 5: Crear dashboard de métricas del sistema
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  performanceAuditor,
  latencyAnalyzer,
  tokenTracker,
} from '../services/superIntelligence/audit';
import { queryAnalyzer } from '../services/superIntelligence/audit/QueryAnalyzer';
import { Logger } from '../lib/logger';

const router = Router();

// Schemas de validación
const periodSchema = z.object({
  hours: z.coerce.number().min(1).max(720).default(24),
});

const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * GET /api/audit/overview
 * Resumen general del sistema
 */
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const performanceMetrics = performanceAuditor.getCurrentMetrics();
    const latencyStatus = latencyAnalyzer.getStatus();
    const tokenStatus = tokenTracker.getStatus();
    const queryStatus = queryAnalyzer.getStatus();

    const overview = {
      timestamp: new Date(),
      performance: {
        servicesMonitored: performanceMetrics.services.length,
        endpointsMonitored: performanceMetrics.endpoints.length,
        healthSamplesCollected: performanceMetrics.health.length,
      },
      latency: {
        endpointsTracked: latencyStatus.endpoints,
        totalSamples: latencyStatus.samples,
        activeAnomalies: latencyStatus.anomalies,
      },
      tokens: {
        totalRecords: tokenStatus.totalRecords,
        activeAlerts: tokenStatus.activeAlerts,
        oldestRecord: tokenStatus.oldestRecord,
      },
      database: {
        totalQueries: queryStatus.totalRecords,
        uniquePatterns: queryStatus.uniqueQueries,
        slowQueries: queryStatus.slowQueries,
      },
      systemHealth: performanceMetrics.health.slice(-1)[0] || null,
    };

    res.json(overview);
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching overview:', error);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

/**
 * GET /api/audit/performance
 * Métricas de rendimiento de servicios
 */
router.get('/performance', async (req: Request, res: Response) => {
  try {
    const { hours } = periodSchema.parse(req.query);
    const report = await performanceAuditor.generateAuditReport(hours);

    res.json({
      generatedAt: report.generatedAt,
      period: { start: report.periodStart, end: report.periodEnd },
      overallScore: report.overallScore,
      services: report.services,
      recommendations: report.recommendations,
    });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching performance:', error);
    res.status(500).json({ error: 'Failed to fetch performance metrics' });
  }
});

/**
 * GET /api/audit/latency
 * Análisis de latencia de endpoints
 */
router.get('/latency', async (req: Request, res: Response) => {
  try {
    const { hours } = periodSchema.parse(req.query);
    const report = latencyAnalyzer.generateReport();

    // Filtrar por período si es necesario
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const filteredProfiles = report.profiles.map(p => ({
      ...p,
      trends: p.trends.filter(t => t.timestamp >= cutoff),
      anomalies: p.anomalies.filter(a => a.timestamp >= cutoff),
    }));

    res.json({
      generatedAt: report.generatedAt,
      totalEndpoints: report.totalEndpoints,
      criticalEndpoints: report.criticalEndpoints,
      profiles: filteredProfiles.slice(0, 50),
      correlations: report.correlations.slice(0, 20),
      globalTrends: report.globalTrends,
      recommendations: report.recommendations,
    });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching latency:', error);
    res.status(500).json({ error: 'Failed to fetch latency analysis' });
  }
});

/**
 * GET /api/audit/latency/:endpoint
 * Perfil detallado de un endpoint
 */
router.get('/latency/:method/:endpoint(*)', async (req: Request, res: Response) => {
  try {
    const { method, endpoint } = req.params;
    const profile = latencyAnalyzer.generateProfile(endpoint, method.toUpperCase());

    res.json(profile);
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching endpoint profile:', error);
    res.status(500).json({ error: 'Failed to fetch endpoint profile' });
  }
});

/**
 * GET /api/audit/tokens
 * Consumo de tokens por LLM
 */
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const { hours } = periodSchema.parse(req.query);
    const report = tokenTracker.generateReport(hours);

    res.json({
      generatedAt: report.generatedAt,
      period: { start: report.periodStart, end: report.periodEnd },
      summary: {
        totalCost: report.totalCost,
        totalTokens: report.totalTokens,
        totalRequests: report.totalRequests,
      },
      providers: report.providers,
      trends: report.trends,
      forecasts: report.forecasts,
      alerts: report.alerts,
      recommendations: report.recommendations,
    });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching tokens:', error);
    res.status(500).json({ error: 'Failed to fetch token consumption' });
  }
});

/**
 * GET /api/audit/tokens/users
 * Top usuarios por consumo de tokens
 */
router.get('/tokens/users', async (req: Request, res: Response) => {
  try {
    const { hours } = periodSchema.parse(req.query);
    const { limit } = paginationSchema.parse(req.query);
    const users = tokenTracker.getTopUsers(limit, hours);

    res.json({ users });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching token users:', error);
    res.status(500).json({ error: 'Failed to fetch user token stats' });
  }
});

/**
 * GET /api/audit/tokens/endpoints
 * Top endpoints por consumo de tokens
 */
router.get('/tokens/endpoints', async (req: Request, res: Response) => {
  try {
    const { hours } = periodSchema.parse(req.query);
    const { limit } = paginationSchema.parse(req.query);
    const endpoints = tokenTracker.getTopEndpoints(limit, hours);

    res.json({ endpoints });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching token endpoints:', error);
    res.status(500).json({ error: 'Failed to fetch endpoint token stats' });
  }
});

/**
 * GET /api/audit/database
 * Análisis de queries de base de datos
 */
router.get('/database', async (req: Request, res: Response) => {
  try {
    const { hours } = periodSchema.parse(req.query);
    const report = await queryAnalyzer.generateReport(hours);

    res.json({
      generatedAt: report.generatedAt,
      period: { start: report.periodStart, end: report.periodEnd },
      summary: {
        totalQueries: report.totalQueries,
        slowQueries: report.slowQueries,
        averageExecutionTime: report.averageExecutionTime,
        healthScore: report.healthScore,
      },
      queryProfiles: report.queryProfiles.slice(0, 30),
      tableStats: report.tableStats,
      indexStats: report.indexStats,
      recommendations: report.recommendations,
    });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching database:', error);
    res.status(500).json({ error: 'Failed to fetch database analysis' });
  }
});

/**
 * GET /api/audit/database/tables
 * Estadísticas de tablas
 */
router.get('/database/tables', async (_req: Request, res: Response) => {
  try {
    const tableStats = await queryAnalyzer.getTableStats();
    res.json({ tables: tableStats });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching tables:', error);
    res.status(500).json({ error: 'Failed to fetch table stats' });
  }
});

/**
 * GET /api/audit/database/indexes
 * Estadísticas de índices
 */
router.get('/database/indexes', async (_req: Request, res: Response) => {
  try {
    const indexStats = await queryAnalyzer.getIndexStats();
    res.json({ indexes: indexStats });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching indexes:', error);
    res.status(500).json({ error: 'Failed to fetch index stats' });
  }
});

/**
 * GET /api/audit/health
 * Historial de salud del sistema
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const { limit } = paginationSchema.parse(req.query);
    const metrics = performanceAuditor.getCurrentMetrics();

    res.json({
      current: metrics.health.slice(-1)[0] || null,
      history: metrics.health.slice(-limit),
    });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching health:', error);
    res.status(500).json({ error: 'Failed to fetch health metrics' });
  }
});

/**
 * GET /api/audit/recommendations
 * Todas las recomendaciones consolidadas
 */
router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const { hours } = periodSchema.parse(req.query);

    // Recopilar recomendaciones de todos los sistemas
    const [perfReport, tokenReport, dbReport] = await Promise.all([
      performanceAuditor.generateAuditReport(hours),
      Promise.resolve(tokenTracker.generateReport(hours)),
      queryAnalyzer.generateReport(hours),
    ]);

    const latencyReport = latencyAnalyzer.generateReport();

    const allRecommendations = [
      ...perfReport.recommendations.map(r => ({ ...r, source: 'performance' })),
      ...latencyReport.recommendations.map(r => ({ ...r, source: 'latency' })),
      ...tokenReport.recommendations.map(r => ({ ...r, source: 'tokens' })),
      ...dbReport.recommendations.map(r => ({ ...r, source: 'database' })),
    ];

    // Ordenar por prioridad
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    allRecommendations.sort((a, b) =>
      (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3)
    );

    res.json({
      total: allRecommendations.length,
      bySeverity: {
        critical: allRecommendations.filter(r => r.priority === 'critical').length,
        high: allRecommendations.filter(r => r.priority === 'high').length,
        medium: allRecommendations.filter(r => r.priority === 'medium').length,
        low: allRecommendations.filter(r => r.priority === 'low').length,
      },
      recommendations: allRecommendations,
    });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching recommendations:', error);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

/**
 * GET /api/audit/reports
 * Historial de reportes de auditoría
 */
router.get('/reports', async (req: Request, res: Response) => {
  try {
    const { limit } = paginationSchema.parse(req.query);
    const reports = await performanceAuditor.getHistoricalReports(limit);

    res.json({
      count: reports.length,
      reports: reports.map(r => ({
        generatedAt: r.generatedAt,
        period: { start: r.periodStart, end: r.periodEnd },
        overallScore: r.overallScore,
        servicesCount: r.services.length,
        endpointsCount: r.endpoints.length,
        recommendationsCount: r.recommendations.length,
      })),
    });
  } catch (error) {
    Logger.error('[AuditDashboard] Error fetching reports:', error);
    res.status(500).json({ error: 'Failed to fetch historical reports' });
  }
});

/**
 * POST /api/audit/report/generate
 * Generar reporte de auditoría completo
 */
router.post('/report/generate', async (req: Request, res: Response) => {
  try {
    const { hours } = periodSchema.parse(req.body);

    const [perfReport, tokenReport, dbReport] = await Promise.all([
      performanceAuditor.generateAuditReport(hours),
      Promise.resolve(tokenTracker.generateReport(hours)),
      queryAnalyzer.generateReport(hours),
    ]);

    const latencyReport = latencyAnalyzer.generateReport();

    const fullReport = {
      generatedAt: new Date(),
      period: hours,
      performance: {
        score: perfReport.overallScore,
        services: perfReport.services.length,
        endpoints: perfReport.endpoints.length,
        recommendations: perfReport.recommendations.length,
      },
      latency: {
        endpoints: latencyReport.totalEndpoints,
        criticalEndpoints: latencyReport.criticalEndpoints.length,
        recommendations: latencyReport.recommendations.length,
      },
      tokens: {
        totalCost: tokenReport.totalCost,
        totalTokens: tokenReport.totalTokens,
        alerts: tokenReport.alerts.filter(a => a.triggered).length,
        recommendations: tokenReport.recommendations.length,
      },
      database: {
        healthScore: dbReport.healthScore,
        slowQueries: dbReport.slowQueries,
        recommendations: dbReport.recommendations.length,
      },
      overallHealth: Math.round(
        (perfReport.overallScore + dbReport.healthScore) / 2
      ),
    };

    res.json(fullReport);
  } catch (error) {
    Logger.error('[AuditDashboard] Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * POST /api/audit/reset
 * Resetear métricas (solo admin)
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const { target } = req.body;

    switch (target) {
      case 'performance':
        performanceAuditor.reset();
        break;
      case 'latency':
        latencyAnalyzer.reset();
        break;
      case 'tokens':
        tokenTracker.reset();
        break;
      case 'database':
        queryAnalyzer.reset();
        break;
      case 'all':
        performanceAuditor.reset();
        latencyAnalyzer.reset();
        tokenTracker.reset();
        queryAnalyzer.reset();
        break;
      default:
        return res.status(400).json({ error: 'Invalid target. Use: performance, latency, tokens, database, or all' });
    }

    Logger.info(`[AuditDashboard] Metrics reset: ${target}`);
    res.json({ success: true, reset: target });
  } catch (error) {
    Logger.error('[AuditDashboard] Error resetting:', error);
    res.status(500).json({ error: 'Failed to reset metrics' });
  }
});

export function createAuditDashboardRouter(): Router {
  return router;
}

export { router as auditDashboardRouter };
