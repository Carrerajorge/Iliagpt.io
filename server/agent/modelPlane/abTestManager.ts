import { EventEmitter } from "events";

export type ExperimentStatus = "draft" | "running" | "paused" | "completed" | "cancelled";

export interface ExperimentVariant {
  id: string;
  modelId: string;
  trafficPct: number;
  metrics: VariantMetrics;
}

export interface VariantMetrics {
  totalRequests: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  avgCostUsd: number;
  qualityScores: number[];
  avgQuality: number;
  errorCount: number;
  errorRate: number;
  satisfactionScores: number[];
  avgSatisfaction: number;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  status: ExperimentStatus;
  control: ExperimentVariant;
  treatment: ExperimentVariant;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  significanceThreshold: number;
  minSampleSize: number;
  primaryMetric: "latency" | "quality" | "cost" | "satisfaction";
  winner: string | null;
  autoPromote: boolean;
}

export interface SignificanceResult {
  significant: boolean;
  pValue: number;
  controlMean: number;
  treatmentMean: number;
  effect: number;
  effectPct: number;
  winner: "control" | "treatment" | "none";
  metric: string;
}

function createEmptyMetrics(): VariantMetrics {
  return {
    totalRequests: 0,
    totalLatencyMs: 0,
    avgLatencyMs: 0,
    totalCostUsd: 0,
    avgCostUsd: 0,
    qualityScores: [],
    avgQuality: 0,
    errorCount: 0,
    errorRate: 0,
    satisfactionScores: [],
    avgSatisfaction: 0,
  };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
}

function tTestApprox(sample1: number[], sample2: number[]): number {
  if (sample1.length < 2 || sample2.length < 2) return 1;
  const m1 = mean(sample1);
  const m2 = mean(sample2);
  const v1 = variance(sample1);
  const v2 = variance(sample2);
  const se = Math.sqrt(v1 / sample1.length + v2 / sample2.length);
  if (se === 0) return 1;
  const t = Math.abs(m1 - m2) / se;
  const df = Math.min(sample1.length, sample2.length) - 1;
  const p = Math.exp(-0.717 * t - 0.416 * t * t) * (df > 2 ? 1 : 1.5);
  return Math.min(1, Math.max(0, p));
}

function chiSquaredApprox(
  successA: number, totalA: number,
  successB: number, totalB: number
): number {
  if (totalA === 0 || totalB === 0) return 1;
  const failA = totalA - successA;
  const failB = totalB - successB;
  const total = totalA + totalB;
  const totalSuccess = successA + successB;
  const totalFail = failA + failB;

  const eSuccessA = (totalA * totalSuccess) / total;
  const eFailA = (totalA * totalFail) / total;
  const eSuccessB = (totalB * totalSuccess) / total;
  const eFailB = (totalB * totalFail) / total;

  if (eSuccessA === 0 || eFailA === 0 || eSuccessB === 0 || eFailB === 0) return 1;

  const chi2 =
    ((successA - eSuccessA) ** 2) / eSuccessA +
    ((failA - eFailA) ** 2) / eFailA +
    ((successB - eSuccessB) ** 2) / eSuccessB +
    ((failB - eFailB) ** 2) / eFailB;

  const p = Math.exp(-chi2 / 2);
  return Math.min(1, Math.max(0, p));
}

export class ABTestManager extends EventEmitter {
  private experiments: Map<string, Experiment> = new Map();
  private latencySamples: Map<string, number[]> = new Map();
  private costSamples: Map<string, number[]> = new Map();

  createExperiment(config: {
    name: string;
    description: string;
    controlModelId: string;
    treatmentModelId: string;
    controlTrafficPct?: number;
    significanceThreshold?: number;
    minSampleSize?: number;
    primaryMetric?: "latency" | "quality" | "cost" | "satisfaction";
    autoPromote?: boolean;
  }): Experiment {
    const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const controlPct = config.controlTrafficPct ?? 50;

    const experiment: Experiment = {
      id,
      name: config.name,
      description: config.description,
      status: "draft",
      control: {
        id: "control",
        modelId: config.controlModelId,
        trafficPct: controlPct,
        metrics: createEmptyMetrics(),
      },
      treatment: {
        id: "treatment",
        modelId: config.treatmentModelId,
        trafficPct: 100 - controlPct,
        metrics: createEmptyMetrics(),
      },
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      significanceThreshold: config.significanceThreshold ?? 0.05,
      minSampleSize: config.minSampleSize ?? 30,
      primaryMetric: config.primaryMetric ?? "quality",
      winner: null,
      autoPromote: config.autoPromote ?? true,
    };

    this.experiments.set(id, experiment);
    this.latencySamples.set(`${id}_control`, []);
    this.latencySamples.set(`${id}_treatment`, []);
    this.costSamples.set(`${id}_control`, []);
    this.costSamples.set(`${id}_treatment`, []);
    this.emit("experiment:created", experiment);
    return experiment;
  }

  startExperiment(experimentId: string): Experiment {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);
    if (exp.status !== "draft" && exp.status !== "paused") {
      throw new Error(`Cannot start experiment in status ${exp.status}`);
    }
    exp.status = "running";
    exp.startedAt = exp.startedAt || new Date().toISOString();
    this.emit("experiment:started", exp);
    return exp;
  }

  pauseExperiment(experimentId: string): Experiment {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);
    exp.status = "paused";
    this.emit("experiment:paused", exp);
    return exp;
  }

  cancelExperiment(experimentId: string): Experiment {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);
    exp.status = "cancelled";
    exp.completedAt = new Date().toISOString();
    this.emit("experiment:cancelled", exp);
    return exp;
  }

  routeRequest(experimentId: string): { variant: "control" | "treatment"; modelId: string } {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== "running") {
      return { variant: "control", modelId: exp?.control.modelId || "" };
    }
    const roll = Math.random() * 100;
    if (roll < exp.control.trafficPct) {
      return { variant: "control", modelId: exp.control.modelId };
    }
    return { variant: "treatment", modelId: exp.treatment.modelId };
  }

  recordResult(
    experimentId: string,
    variant: "control" | "treatment",
    result: {
      latencyMs: number;
      costUsd: number;
      qualityScore?: number;
      satisfactionScore?: number;
      error?: boolean;
    }
  ): void {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== "running") return;

    const v = variant === "control" ? exp.control : exp.treatment;
    const m = v.metrics;

    m.totalRequests++;
    m.totalLatencyMs += result.latencyMs;
    m.avgLatencyMs = m.totalLatencyMs / m.totalRequests;
    m.totalCostUsd += result.costUsd;
    m.avgCostUsd = m.totalCostUsd / m.totalRequests;

    if (result.error) {
      m.errorCount++;
    }
    m.errorRate = m.errorCount / m.totalRequests;

    if (result.qualityScore !== undefined) {
      m.qualityScores.push(result.qualityScore);
      m.avgQuality = mean(m.qualityScores);
    }

    if (result.satisfactionScore !== undefined) {
      m.satisfactionScores.push(result.satisfactionScore);
      m.avgSatisfaction = mean(m.satisfactionScores);
    }

    const sampleKey = `${experimentId}_${variant}`;
    this.latencySamples.get(sampleKey)?.push(result.latencyMs);
    this.costSamples.get(sampleKey)?.push(result.costUsd);

    this.emit("experiment:result", { experimentId, variant, result });

    const minMet =
      exp.control.metrics.totalRequests >= exp.minSampleSize &&
      exp.treatment.metrics.totalRequests >= exp.minSampleSize;

    if (minMet) {
      const sig = this.checkSignificance(experimentId);
      if (sig && sig.significant && exp.autoPromote) {
        exp.winner = sig.winner === "control" ? exp.control.modelId : exp.treatment.modelId;
        exp.status = "completed";
        exp.completedAt = new Date().toISOString();
        this.emit("experiment:completed", { experiment: exp, significance: sig });
      }
    }
  }

  checkSignificance(experimentId: string): SignificanceResult | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) return null;

    const controlLatency = this.latencySamples.get(`${experimentId}_control`) || [];
    const treatmentLatency = this.latencySamples.get(`${experimentId}_treatment`) || [];
    const controlCost = this.costSamples.get(`${experimentId}_cost_control`) || [];
    const treatmentCost = this.costSamples.get(`${experimentId}_cost_treatment`) || [];

    let pValue: number;
    let controlMean: number;
    let treatmentMean: number;

    switch (exp.primaryMetric) {
      case "latency":
        pValue = tTestApprox(controlLatency, treatmentLatency);
        controlMean = mean(controlLatency);
        treatmentMean = mean(treatmentLatency);
        break;
      case "cost":
        pValue = tTestApprox(controlCost, treatmentCost);
        controlMean = exp.control.metrics.avgCostUsd;
        treatmentMean = exp.treatment.metrics.avgCostUsd;
        break;
      case "quality":
        pValue = tTestApprox(exp.control.metrics.qualityScores, exp.treatment.metrics.qualityScores);
        controlMean = exp.control.metrics.avgQuality;
        treatmentMean = exp.treatment.metrics.avgQuality;
        break;
      case "satisfaction":
        pValue = tTestApprox(exp.control.metrics.satisfactionScores, exp.treatment.metrics.satisfactionScores);
        controlMean = exp.control.metrics.avgSatisfaction;
        treatmentMean = exp.treatment.metrics.avgSatisfaction;
        break;
      default:
        return null;
    }

    const effect = treatmentMean - controlMean;
    const effectPct = controlMean !== 0 ? (effect / controlMean) * 100 : 0;
    const significant = pValue < exp.significanceThreshold;

    let winner: "control" | "treatment" | "none" = "none";
    if (significant) {
      const lowerIsBetter = exp.primaryMetric === "latency" || exp.primaryMetric === "cost";
      if (lowerIsBetter) {
        winner = treatmentMean < controlMean ? "treatment" : "control";
      } else {
        winner = treatmentMean > controlMean ? "treatment" : "control";
      }
    }

    return {
      significant,
      pValue,
      controlMean,
      treatmentMean,
      effect,
      effectPct,
      winner,
      metric: exp.primaryMetric,
    };
  }

  checkErrorRateSignificance(experimentId: string): SignificanceResult | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) return null;

    const cSuccess = exp.control.metrics.totalRequests - exp.control.metrics.errorCount;
    const tSuccess = exp.treatment.metrics.totalRequests - exp.treatment.metrics.errorCount;

    const pValue = chiSquaredApprox(
      cSuccess, exp.control.metrics.totalRequests,
      tSuccess, exp.treatment.metrics.totalRequests
    );

    return {
      significant: pValue < exp.significanceThreshold,
      pValue,
      controlMean: exp.control.metrics.errorRate,
      treatmentMean: exp.treatment.metrics.errorRate,
      effect: exp.treatment.metrics.errorRate - exp.control.metrics.errorRate,
      effectPct: exp.control.metrics.errorRate !== 0
        ? ((exp.treatment.metrics.errorRate - exp.control.metrics.errorRate) / exp.control.metrics.errorRate) * 100
        : 0,
      winner: exp.treatment.metrics.errorRate < exp.control.metrics.errorRate ? "treatment" : "control",
      metric: "errorRate",
    };
  }

  getExperiment(experimentId: string): Experiment | undefined {
    return this.experiments.get(experimentId);
  }

  listExperiments(status?: ExperimentStatus): Experiment[] {
    const all = Array.from(this.experiments.values());
    if (status) return all.filter((e) => e.status === status);
    return all;
  }

  getExperimentSummary(experimentId: string): {
    experiment: Experiment;
    significance: SignificanceResult | null;
    errorSignificance: SignificanceResult | null;
  } | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) return null;
    return {
      experiment: exp,
      significance: this.checkSignificance(experimentId),
      errorSignificance: this.checkErrorRateSignificance(experimentId),
    };
  }

  deleteExperiment(experimentId: string): boolean {
    this.latencySamples.delete(`${experimentId}_control`);
    this.latencySamples.delete(`${experimentId}_treatment`);
    this.costSamples.delete(`${experimentId}_control`);
    this.costSamples.delete(`${experimentId}_treatment`);
    return this.experiments.delete(experimentId);
  }
}

export const abTestManager = new ABTestManager();
