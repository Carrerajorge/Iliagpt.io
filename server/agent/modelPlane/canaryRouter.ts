import { EventEmitter } from "events";
import { budgetEventStream } from "../budget/budgetEventStream";

export type CanaryStage = "shadow" | "canary_1" | "canary_5" | "canary_25" | "canary_50" | "canary_100" | "rolled_back" | "promoted";

export interface CanaryDeployment {
  id: string;
  primaryModelId: string;
  canaryModelId: string;
  stage: CanaryStage;
  trafficPct: number;
  createdAt: string;
  promotedAt: string | null;
  rolledBackAt: string | null;
  metrics: CanaryMetrics;
  config: CanaryConfig;
  autoAdvance: boolean;
}

export interface CanaryMetrics {
  primary: CanaryModelMetrics;
  canary: CanaryModelMetrics;
}

export interface CanaryModelMetrics {
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  avgCostUsd: number;
  qualityScores: number[];
  avgQuality: number;
}

export interface CanaryConfig {
  errorRateThreshold: number;
  latencyDegradationPct: number;
  minRequestsPerStage: number;
  autoRollbackOnSpike: boolean;
  shadowMode: boolean;
  stages: { stage: CanaryStage; trafficPct: number }[];
}

export interface CanaryRouteResult {
  modelId: string;
  isCanary: boolean;
  isShadow: boolean;
  deploymentId: string;
}

function createEmptyModelMetrics(): CanaryModelMetrics {
  return {
    totalRequests: 0,
    errorCount: 0,
    errorRate: 0,
    totalLatencyMs: 0,
    avgLatencyMs: 0,
    totalCostUsd: 0,
    avgCostUsd: 0,
    qualityScores: [],
    avgQuality: 0,
  };
}

const DEFAULT_STAGES: { stage: CanaryStage; trafficPct: number }[] = [
  { stage: "shadow", trafficPct: 0 },
  { stage: "canary_1", trafficPct: 1 },
  { stage: "canary_5", trafficPct: 5 },
  { stage: "canary_25", trafficPct: 25 },
  { stage: "canary_50", trafficPct: 50 },
  { stage: "canary_100", trafficPct: 100 },
];

export class CanaryRouter extends EventEmitter {
  private deployments: Map<string, CanaryDeployment> = new Map();
  private shadowResults: Map<string, { primary: any[]; canary: any[] }> = new Map();

  createDeployment(config: {
    primaryModelId: string;
    canaryModelId: string;
    startShadow?: boolean;
    errorRateThreshold?: number;
    latencyDegradationPct?: number;
    minRequestsPerStage?: number;
    autoRollbackOnSpike?: boolean;
    autoAdvance?: boolean;
  }): CanaryDeployment {
    const id = `canary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startShadow = config.startShadow ?? true;

    const deployment: CanaryDeployment = {
      id,
      primaryModelId: config.primaryModelId,
      canaryModelId: config.canaryModelId,
      stage: startShadow ? "shadow" : "canary_1",
      trafficPct: startShadow ? 0 : 1,
      createdAt: new Date().toISOString(),
      promotedAt: null,
      rolledBackAt: null,
      metrics: {
        primary: createEmptyModelMetrics(),
        canary: createEmptyModelMetrics(),
      },
      config: {
        errorRateThreshold: config.errorRateThreshold ?? 0.05,
        latencyDegradationPct: config.latencyDegradationPct ?? 50,
        minRequestsPerStage: config.minRequestsPerStage ?? 20,
        autoRollbackOnSpike: config.autoRollbackOnSpike ?? true,
        shadowMode: startShadow,
        stages: [...DEFAULT_STAGES],
      },
      autoAdvance: config.autoAdvance ?? true,
    };

    this.deployments.set(id, deployment);
    this.shadowResults.set(id, { primary: [], canary: [] });
    this.emit("canary:created", deployment);
    return deployment;
  }

  route(deploymentId: string): CanaryRouteResult {
    const dep = this.deployments.get(deploymentId);
    if (!dep || dep.stage === "rolled_back") {
      return {
        modelId: dep?.primaryModelId || "",
        isCanary: false,
        isShadow: false,
        deploymentId: deploymentId,
      };
    }

    if (dep.stage === "promoted") {
      return {
        modelId: dep.canaryModelId,
        isCanary: false,
        isShadow: false,
        deploymentId: deploymentId,
      };
    }

    if (dep.stage === "shadow") {
      return {
        modelId: dep.primaryModelId,
        isCanary: false,
        isShadow: true,
        deploymentId: deploymentId,
      };
    }

    const roll = Math.random() * 100;
    if (roll < dep.trafficPct) {
      return {
        modelId: dep.canaryModelId,
        isCanary: true,
        isShadow: false,
        deploymentId: deploymentId,
      };
    }

    return {
      modelId: dep.primaryModelId,
      isCanary: false,
      isShadow: false,
      deploymentId: deploymentId,
    };
  }

  recordResult(
    deploymentId: string,
    variant: "primary" | "canary",
    result: {
      latencyMs: number;
      costUsd: number;
      qualityScore?: number;
      error?: boolean;
    }
  ): void {
    const dep = this.deployments.get(deploymentId);
    if (!dep || dep.stage === "rolled_back" || dep.stage === "promoted") return;

    const m = variant === "primary" ? dep.metrics.primary : dep.metrics.canary;

    m.totalRequests++;
    m.totalLatencyMs += result.latencyMs;
    m.avgLatencyMs = m.totalLatencyMs / m.totalRequests;
    m.totalCostUsd += result.costUsd;
    m.avgCostUsd = m.totalCostUsd / m.totalRequests;

    if (result.error) m.errorCount++;
    m.errorRate = m.errorCount / m.totalRequests;

    if (result.qualityScore !== undefined) {
      m.qualityScores.push(result.qualityScore);
      m.avgQuality = m.qualityScores.reduce((a, b) => a + b, 0) / m.qualityScores.length;
    }

    const modelId = variant === "primary" ? dep.primaryModelId : dep.canaryModelId;
    const provider = modelId.split("/")[0];
    budgetEventStream.trackProviderCost(provider, result.costUsd);

    if (dep.stage === "shadow") {
      const shadow = this.shadowResults.get(deploymentId);
      if (shadow) {
        shadow[variant].push({ ...result, timestamp: Date.now() });
        if (shadow[variant].length > 200) {
          shadow[variant] = shadow[variant].slice(-200);
        }
      }
    }

    if (variant === "canary" && dep.config.autoRollbackOnSpike) {
      this.checkAutoRollback(dep);
    }

    if (dep.autoAdvance) {
      this.checkAutoAdvance(dep);
    }

    this.emit("canary:result", { deploymentId, variant, result });
  }

  recordShadowComparison(
    deploymentId: string,
    primaryResult: { latencyMs: number; costUsd: number; qualityScore?: number; error?: boolean },
    canaryResult: { latencyMs: number; costUsd: number; qualityScore?: number; error?: boolean }
  ): void {
    this.recordResult(deploymentId, "primary", primaryResult);
    this.recordResult(deploymentId, "canary", canaryResult);
  }

  private checkAutoRollback(dep: CanaryDeployment): void {
    const canary = dep.metrics.canary;
    const primary = dep.metrics.primary;

    if (canary.totalRequests < 5) return;

    if (canary.errorRate > dep.config.errorRateThreshold) {
      this.rollback(dep.id, `Error rate spike: ${(canary.errorRate * 100).toFixed(1)}% > ${(dep.config.errorRateThreshold * 100).toFixed(1)}%`);
      return;
    }

    if (primary.avgLatencyMs > 0 && canary.avgLatencyMs > 0) {
      const degradation = ((canary.avgLatencyMs - primary.avgLatencyMs) / primary.avgLatencyMs) * 100;
      if (degradation > dep.config.latencyDegradationPct) {
        this.rollback(dep.id, `Latency degradation: ${degradation.toFixed(1)}% > ${dep.config.latencyDegradationPct}%`);
      }
    }
  }

  private checkAutoAdvance(dep: CanaryDeployment): void {
    const stageIdx = dep.config.stages.findIndex((s) => s.stage === dep.stage);
    if (stageIdx < 0 || stageIdx >= dep.config.stages.length - 1) return;

    const canary = dep.metrics.canary;
    if (canary.totalRequests < dep.config.minRequestsPerStage) return;

    if (canary.errorRate <= dep.config.errorRateThreshold) {
      this.advanceStage(dep.id);
    }
  }

  advanceStage(deploymentId: string): CanaryDeployment | null {
    const dep = this.deployments.get(deploymentId);
    if (!dep || dep.stage === "rolled_back" || dep.stage === "promoted") return null;

    const stageIdx = dep.config.stages.findIndex((s) => s.stage === dep.stage);
    if (stageIdx < 0 || stageIdx >= dep.config.stages.length - 1) {
      this.promote(deploymentId);
      return dep;
    }

    const nextStage = dep.config.stages[stageIdx + 1];
    dep.stage = nextStage.stage;
    dep.trafficPct = nextStage.trafficPct;

    dep.metrics.canary = createEmptyModelMetrics();
    dep.metrics.primary = createEmptyModelMetrics();

    this.emit("canary:advanced", { deploymentId, stage: dep.stage, trafficPct: dep.trafficPct });
    return dep;
  }

  promote(deploymentId: string): CanaryDeployment | null {
    const dep = this.deployments.get(deploymentId);
    if (!dep) return null;

    dep.stage = "promoted";
    dep.trafficPct = 100;
    dep.promotedAt = new Date().toISOString();

    this.emit("canary:promoted", { deploymentId, canaryModelId: dep.canaryModelId });
    return dep;
  }

  rollback(deploymentId: string, reason: string): CanaryDeployment | null {
    const dep = this.deployments.get(deploymentId);
    if (!dep) return null;

    dep.stage = "rolled_back";
    dep.trafficPct = 0;
    dep.rolledBackAt = new Date().toISOString();

    this.emit("canary:rolled_back", { deploymentId, reason, canaryModelId: dep.canaryModelId });
    return dep;
  }

  getDeployment(deploymentId: string): CanaryDeployment | undefined {
    return this.deployments.get(deploymentId);
  }

  listDeployments(): CanaryDeployment[] {
    return Array.from(this.deployments.values());
  }

  getActiveDeployments(): CanaryDeployment[] {
    return Array.from(this.deployments.values()).filter(
      (d) => d.stage !== "rolled_back" && d.stage !== "promoted"
    );
  }

  getShadowComparison(deploymentId: string): {
    primaryMetrics: CanaryModelMetrics;
    canaryMetrics: CanaryModelMetrics;
    costDifferencePct: number;
    latencyDifferencePct: number;
    qualityDifference: number;
  } | null {
    const dep = this.deployments.get(deploymentId);
    if (!dep) return null;

    const primary = dep.metrics.primary;
    const canary = dep.metrics.canary;

    const costDiffPct = primary.avgCostUsd > 0
      ? ((canary.avgCostUsd - primary.avgCostUsd) / primary.avgCostUsd) * 100
      : 0;

    const latencyDiffPct = primary.avgLatencyMs > 0
      ? ((canary.avgLatencyMs - primary.avgLatencyMs) / primary.avgLatencyMs) * 100
      : 0;

    const qualityDiff = canary.avgQuality - primary.avgQuality;

    return {
      primaryMetrics: primary,
      canaryMetrics: canary,
      costDifferencePct: Math.round(costDiffPct * 10) / 10,
      latencyDifferencePct: Math.round(latencyDiffPct * 10) / 10,
      qualityDifference: Math.round(qualityDiff * 100) / 100,
    };
  }

  deleteDeployment(deploymentId: string): boolean {
    this.shadowResults.delete(deploymentId);
    return this.deployments.delete(deploymentId);
  }
}

export const canaryRouter = new CanaryRouter();
