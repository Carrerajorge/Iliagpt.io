// Sistema de métricas de calidad de respuestas AI

export interface QualityMetric {
  responseId: string;
  provider: string;
  score: number;
  tokensUsed: number;
  latencyMs: number;
  timestamp: Date;
  issues: string[];
  isComplete?: boolean;
  hasContentIssues?: boolean;
}

export interface QualityStats {
  totalResponses: number;
  averageScore: number;
  averageLatency: number;
  averageTokens: number;
  completionRate: number;
  contentIssueRate: number;
  issueFrequency: Record<string, number>;
  byProvider: Record<string, ProviderQualityStats>;
  scoreDistribution: {
    excellent: number; // 90-100
    good: number;      // 70-89
    fair: number;      // 50-69
    poor: number;      // 0-49
  };
}

export interface ProviderQualityStats {
  count: number;
  averageScore: number;
  averageLatency: number;
  averageTokens: number;
  completionRate: number;
}

const MAX_METRICS = 1000;
const metricsHistory: QualityMetric[] = [];

// Métricas agregadas en tiempo real
let runningStats = {
  count: 0,
  totalScore: 0,
  lastReset: Date.now(),
};

export function recordQualityMetric(metric: QualityMetric): void {
  metricsHistory.push(metric);
  
  // Rotación: eliminar los más antiguos si excede el límite
  while (metricsHistory.length > MAX_METRICS) {
    metricsHistory.shift();
  }

  // Actualizar estadísticas en tiempo real
  runningStats.count++;
  runningStats.totalScore += metric.score;

  // Logging para métricas con problemas
  if (metric.issues.length > 0) {
    console.log(
      `[QualityMetrics] Response ${metric.responseId} - Score: ${metric.score}, Issues: ${metric.issues.join(", ")}`
    );
  }
  
  if (metric.score < 50) {
    console.warn(
      `[QualityMetrics] Low quality response ${metric.responseId} from ${metric.provider} - Score: ${metric.score}`
    );
  }
}

export function getQualityStats(since?: Date): QualityStats {
  const cutoffTime = since ? since.getTime() : 0;
  const relevantMetrics = metricsHistory.filter(
    (m) => m.timestamp.getTime() >= cutoffTime
  );

  if (relevantMetrics.length === 0) {
    return {
      totalResponses: 0,
      averageScore: 0,
      averageLatency: 0,
      averageTokens: 0,
      completionRate: 0,
      contentIssueRate: 0,
      issueFrequency: {},
      byProvider: {},
      scoreDistribution: {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0,
      },
    };
  }

  // Calcular estadísticas generales
  let totalScore = 0;
  let totalLatency = 0;
  let totalTokens = 0;
  let completeCount = 0;
  let contentIssueCount = 0;
  const issueFrequency: Record<string, number> = {};
  const byProvider: Record<string, { 
    count: number; 
    totalScore: number; 
    totalLatency: number; 
    totalTokens: number;
    completeCount: number;
  }> = {};
  const scoreDistribution = {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
  };

  for (const metric of relevantMetrics) {
    totalScore += metric.score;
    totalLatency += metric.latencyMs;
    totalTokens += metric.tokensUsed;
    
    if (metric.isComplete !== false) {
      completeCount++;
    }
    
    if (metric.hasContentIssues) {
      contentIssueCount++;
    }

    // Contar issues
    for (const issue of metric.issues) {
      issueFrequency[issue] = (issueFrequency[issue] || 0) + 1;
    }

    // Estadísticas por proveedor
    if (!byProvider[metric.provider]) {
      byProvider[metric.provider] = {
        count: 0,
        totalScore: 0,
        totalLatency: 0,
        totalTokens: 0,
        completeCount: 0,
      };
    }
    const providerStats = byProvider[metric.provider];
    providerStats.count++;
    providerStats.totalScore += metric.score;
    providerStats.totalLatency += metric.latencyMs;
    providerStats.totalTokens += metric.tokensUsed;
    if (metric.isComplete !== false) {
      providerStats.completeCount++;
    }

    // Distribución de scores
    if (metric.score >= 90) {
      scoreDistribution.excellent++;
    } else if (metric.score >= 70) {
      scoreDistribution.good++;
    } else if (metric.score >= 50) {
      scoreDistribution.fair++;
    } else {
      scoreDistribution.poor++;
    }
  }

  const count = relevantMetrics.length;

  // Convertir estadísticas por proveedor
  const providerQualityStats: Record<string, ProviderQualityStats> = {};
  for (const [provider, stats] of Object.entries(byProvider)) {
    providerQualityStats[provider] = {
      count: stats.count,
      averageScore: stats.totalScore / stats.count,
      averageLatency: stats.totalLatency / stats.count,
      averageTokens: stats.totalTokens / stats.count,
      completionRate: stats.completeCount / stats.count,
    };
  }

  return {
    totalResponses: count,
    averageScore: totalScore / count,
    averageLatency: totalLatency / count,
    averageTokens: totalTokens / count,
    completionRate: completeCount / count,
    contentIssueRate: contentIssueCount / count,
    issueFrequency,
    byProvider: providerQualityStats,
    scoreDistribution,
  };
}

export function getRecentMetrics(limit: number = 100): QualityMetric[] {
  return metricsHistory.slice(-limit);
}

export function getMetricsForProvider(provider: string, limit: number = 100): QualityMetric[] {
  return metricsHistory
    .filter((m) => m.provider === provider)
    .slice(-limit);
}

export function getLowQualityResponses(threshold: number = 50, limit: number = 50): QualityMetric[] {
  return metricsHistory
    .filter((m) => m.score < threshold)
    .slice(-limit);
}

export function clearMetrics(): void {
  metricsHistory.length = 0;
  runningStats.count = 0;
  runningStats.totalScore = 0;
  runningStats.lastReset = Date.now();
  console.log("[QualityMetrics] Metrics history cleared");
}

export function getRunningAverageScore(): number {
  if (runningStats.count === 0) return 0;
  return runningStats.totalScore / runningStats.count;
}

export function resetRunningStats(): void {
  runningStats.count = 0;
  runningStats.totalScore = 0;
  runningStats.lastReset = Date.now();
}
