export interface SystemMetrics {
  requests: {
    total: number;
    byEndpoint: Map<string, number>;
    byStatus: Map<number, number>;
    avgDuration: number;
    totalDuration: number;
  };
  agentic: {
    complexityAnalyses: number;
    orchestrations: number;
    avgComplexityScore: number;
    totalComplexityScore: number;
  };
  tools: {
    executions: number;
    byToolId: Map<string, { success: number; failure: number }>;
    successRate: number;
  };
  memory: {
    atomCount: number;
    totalBytes: number;
    lastUpdated: Date | null;
  };
  errors: {
    total: number;
    byType: Map<string, number>;
  };
  performance: {
    p50: number;
    p95: number;
    p99: number;
    durations: number[];
  };
  startTime: Date;
}

const metrics: SystemMetrics = {
  requests: {
    total: 0,
    byEndpoint: new Map(),
    byStatus: new Map(),
    avgDuration: 0,
    totalDuration: 0,
  },
  agentic: {
    complexityAnalyses: 0,
    orchestrations: 0,
    avgComplexityScore: 0,
    totalComplexityScore: 0,
  },
  tools: {
    executions: 0,
    byToolId: new Map(),
    successRate: 100,
  },
  memory: {
    atomCount: 0,
    totalBytes: 0,
    lastUpdated: null,
  },
  errors: {
    total: 0,
    byType: new Map(),
  },
  performance: {
    p50: 0,
    p95: 0,
    p99: 0,
    durations: [],
  },
  startTime: new Date(),
};

const MAX_DURATIONS = 1000;

function calculatePercentile(sortedArr: number[], percentile: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

function updatePercentiles() {
  const sorted = [...metrics.performance.durations].sort((a, b) => a - b);
  metrics.performance.p50 = calculatePercentile(sorted, 50);
  metrics.performance.p95 = calculatePercentile(sorted, 95);
  metrics.performance.p99 = calculatePercentile(sorted, 99);
}

export const metricsCollector = {
  recordRequest(endpoint: string, status: number, duration: number) {
    metrics.requests.total++;
    
    const endpointCount = metrics.requests.byEndpoint.get(endpoint) || 0;
    metrics.requests.byEndpoint.set(endpoint, endpointCount + 1);
    
    const statusCount = metrics.requests.byStatus.get(status) || 0;
    metrics.requests.byStatus.set(status, statusCount + 1);
    
    metrics.requests.totalDuration += duration;
    metrics.requests.avgDuration = metrics.requests.totalDuration / metrics.requests.total;
    
    metrics.performance.durations.push(duration);
    if (metrics.performance.durations.length > MAX_DURATIONS) {
      metrics.performance.durations.shift();
    }
    updatePercentiles();
  },

  recordComplexityAnalysis(score: number) {
    metrics.agentic.complexityAnalyses++;
    metrics.agentic.totalComplexityScore += score;
    metrics.agentic.avgComplexityScore = 
      metrics.agentic.totalComplexityScore / metrics.agentic.complexityAnalyses;
  },

  recordOrchestration() {
    metrics.agentic.orchestrations++;
  },

  recordToolExecution(toolId: string, success: boolean) {
    metrics.tools.executions++;
    
    let toolStats = metrics.tools.byToolId.get(toolId);
    if (!toolStats) {
      toolStats = { success: 0, failure: 0 };
      metrics.tools.byToolId.set(toolId, toolStats);
    }
    
    if (success) {
      toolStats.success++;
    } else {
      toolStats.failure++;
    }
    
    let totalSuccess = 0;
    let totalFailure = 0;
    const allStats = Array.from(metrics.tools.byToolId.values());
    for (const stats of allStats) {
      totalSuccess += stats.success;
      totalFailure += stats.failure;
    }
    const total = totalSuccess + totalFailure;
    metrics.tools.successRate = total > 0 ? (totalSuccess / total) * 100 : 100;
  },

  recordMemory(atoms: number, bytes: number) {
    metrics.memory.atomCount = atoms;
    metrics.memory.totalBytes = bytes;
    metrics.memory.lastUpdated = new Date();
  },

  recordError(type: string) {
    metrics.errors.total++;
    const count = metrics.errors.byType.get(type) || 0;
    metrics.errors.byType.set(type, count + 1);
  },

  getMetrics(): {
    requests: {
      total: number;
      byEndpoint: Record<string, number>;
      byStatus: Record<string, number>;
      avgDuration: number;
    };
    agentic: typeof metrics.agentic;
    tools: {
      executions: number;
      byToolId: Record<string, { success: number; failure: number }>;
      successRate: number;
    };
    memory: typeof metrics.memory;
    errors: {
      total: number;
      byType: Record<string, number>;
    };
    performance: {
      p50: number;
      p95: number;
      p99: number;
    };
    startTime: Date;
    uptime: number;
  } {
    return {
      requests: {
        total: metrics.requests.total,
        byEndpoint: Object.fromEntries(metrics.requests.byEndpoint),
        byStatus: Object.fromEntries(metrics.requests.byStatus),
        avgDuration: Math.round(metrics.requests.avgDuration * 100) / 100,
      },
      agentic: { ...metrics.agentic },
      tools: {
        executions: metrics.tools.executions,
        byToolId: Object.fromEntries(metrics.tools.byToolId),
        successRate: Math.round(metrics.tools.successRate * 100) / 100,
      },
      memory: { ...metrics.memory },
      errors: {
        total: metrics.errors.total,
        byType: Object.fromEntries(metrics.errors.byType),
      },
      performance: {
        p50: metrics.performance.p50,
        p95: metrics.performance.p95,
        p99: metrics.performance.p99,
      },
      startTime: metrics.startTime,
      uptime: this.getUptime(),
    };
  },

  getUptime(): number {
    return Math.floor((Date.now() - metrics.startTime.getTime()) / 1000);
  },

  reset() {
    metrics.requests = {
      total: 0,
      byEndpoint: new Map(),
      byStatus: new Map(),
      avgDuration: 0,
      totalDuration: 0,
    };
    metrics.agentic = {
      complexityAnalyses: 0,
      orchestrations: 0,
      avgComplexityScore: 0,
      totalComplexityScore: 0,
    };
    metrics.tools = {
      executions: 0,
      byToolId: new Map(),
      successRate: 100,
    };
    metrics.memory = {
      atomCount: 0,
      totalBytes: 0,
      lastUpdated: null,
    };
    metrics.errors = {
      total: 0,
      byType: new Map(),
    };
    metrics.performance = {
      p50: 0,
      p95: 0,
      p99: 0,
      durations: [],
    };
    metrics.startTime = new Date();
  },
};
