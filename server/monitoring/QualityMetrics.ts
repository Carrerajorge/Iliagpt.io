import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { Logger } from '../lib/logger';

export interface QualitySignal {
  id: string;
  userId: string;
  sessionId: string;
  queryId: string;
  signalType: 'thumbs_up' | 'thumbs_down' | 'copy' | 'cite' | 'ignore' | 'retry' | 'follow_up';
  modelId: string;
  strategy: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface QualityScore {
  modelId: string;
  strategy: string;
  period: 'hour' | 'day' | 'week';
  satisfactionRate: number;
  relevanceRate: number;
  citationAccuracy: number;
  retryRate: number;
  sampleSize: number;
  computedAt: Date;
}

export interface ABTestConfig {
  id: string;
  name: string;
  variantA: { modelId: string; strategy: string };
  variantB: { modelId: string; strategy: string };
  trafficSplit: number;
  startedAt: Date;
  endedAt?: Date;
  minSamples: number;
}

export interface ABTestResult {
  configId: string;
  winner: 'A' | 'B' | 'inconclusive';
  confidenceScore: number;
  variantAScore: QualityScore;
  variantBScore: QualityScore;
  sampleSizeA: number;
  sampleSizeB: number;
  computedAt: Date;
}

export interface RegressionAlert {
  modelId: string;
  metric: string;
  previousValue: number;
  currentValue: number;
  dropPct: number;
  detectedAt: Date;
  severity: 'low' | 'medium' | 'high';
}

export interface QualityReport {
  period: QualityScore['period'];
  generatedAt: Date;
  overallScore: number;
  byModel: QualityScore[];
  regressions: RegressionAlert[];
  topPerformingStrategies: string[];
  recommendations: string[];
}

const MAX_SIGNALS = 50_000;
const REGRESSION_THRESHOLD = 0.10;

export class QualityMetrics extends EventEmitter {
  private signals: QualitySignal[] = [];
  private abTests: Map<string, ABTestConfig> = new Map();
  private abTestResults: Map<string, ABTestResult> = new Map();
  private qualityHistory: Map<string, QualityScore[]> = new Map();
  private baselineScores: Map<string, number> = new Map();

  constructor() {
    super();
  }

  recordSignal(signal: Omit<QualitySignal, 'id'>): void {
    const full: QualitySignal = { id: randomUUID(), ...signal };

    this.signals.push(full);
    if (this.signals.length > MAX_SIGNALS) {
      this.signals.shift();
    }

    this._checkRegression(signal.modelId, signal.strategy);
    this.emit('signal:recorded', full);
    Logger.debug('Quality signal recorded', { signalType: signal.signalType, modelId: signal.modelId });
  }

  computeQualityScore(modelId: string, strategy: string, period: QualityScore['period']): QualityScore {
    const since = this._periodStart(period);
    const relevant = this.signals.filter(
      s => s.modelId === modelId && s.strategy === strategy && s.timestamp >= since,
    );

    const total = relevant.length;
    const thumbsUp = relevant.filter(s => s.signalType === 'thumbs_up').length;
    const thumbsDown = relevant.filter(s => s.signalType === 'thumbs_down').length;
    const copies = relevant.filter(s => s.signalType === 'copy').length;
    const cites = relevant.filter(s => s.signalType === 'cite').length;
    const ignores = relevant.filter(s => s.signalType === 'ignore').length;
    const retries = relevant.filter(s => s.signalType === 'retry').length;

    const satisfactionBase = thumbsUp + thumbsDown;
    const satisfactionRate = satisfactionBase > 0 ? thumbsUp / satisfactionBase : 0;

    const positiveEngagements = thumbsUp + copies + cites;
    const relevanceRate = total > 0 ? positiveEngagements / total : 0;

    const citationBase = cites + ignores;
    const citationAccuracy = citationBase > 0 ? cites / citationBase : 0;

    const retryRate = total > 0 ? retries / total : 0;

    const score: QualityScore = {
      modelId,
      strategy,
      period,
      satisfactionRate,
      relevanceRate,
      citationAccuracy,
      retryRate,
      sampleSize: total,
      computedAt: new Date(),
    };

    const historyKey = `${modelId}:${strategy}`;
    const history = this.qualityHistory.get(historyKey) ?? [];
    history.push(score);
    if (history.length > 200) history.shift();
    this.qualityHistory.set(historyKey, history);

    return score;
  }

  createABTest(config: Omit<ABTestConfig, 'id'>): ABTestConfig {
    const full: ABTestConfig = { id: randomUUID(), ...config };
    this.abTests.set(full.id, full);
    Logger.info('A/B test created', { testId: full.id, name: full.name });
    return full;
  }

  assignToVariant(testId: string, userId: string): 'A' | 'B' {
    const test = this.abTests.get(testId);
    if (!test) {
      Logger.warn('A/B test not found', { testId });
      return 'A';
    }

    // Deterministic hash: sum of char codes mod 100 as a percentage
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    }
    const normalised = (hash % 1000) / 1000;
    return normalised < test.trafficSplit ? 'A' : 'B';
  }

  evaluateABTest(testId: string): ABTestResult {
    const test = this.abTests.get(testId);
    if (!test) {
      throw new Error(`A/B test ${testId} not found`);
    }

    const scoreA = this.computeQualityScore(test.variantA.modelId, test.variantA.strategy, 'day');
    const scoreB = this.computeQualityScore(test.variantB.modelId, test.variantB.strategy, 'day');

    const since = test.startedAt;
    const signalsA = this.signals.filter(
      s => s.modelId === test.variantA.modelId &&
        s.strategy === test.variantA.strategy &&
        s.timestamp >= since,
    );
    const signalsB = this.signals.filter(
      s => s.modelId === test.variantB.modelId &&
        s.strategy === test.variantB.strategy &&
        s.timestamp >= since,
    );

    const sampleSizeA = signalsA.length;
    const sampleSizeB = signalsB.length;

    const diff = Math.abs(scoreA.satisfactionRate - scoreB.satisfactionRate);
    const hasEnoughSamples = sampleSizeA >= test.minSamples && sampleSizeB >= test.minSamples;

    let winner: 'A' | 'B' | 'inconclusive' = 'inconclusive';
    let confidenceScore = 0;

    if (hasEnoughSamples && diff > 0.05) {
      // Normal approximation for confidence
      const pA = scoreA.satisfactionRate;
      const pB = scoreB.satisfactionRate;
      const pooled = (pA * sampleSizeA + pB * sampleSizeB) / (sampleSizeA + sampleSizeB);
      const se = Math.sqrt(pooled * (1 - pooled) * (1 / sampleSizeA + 1 / sampleSizeB));
      const z = se > 0 ? Math.abs(pA - pB) / se : 0;
      // Approximate normal CDF: confidence = 1 - 2 * (1 - Phi(z))
      confidenceScore = Math.min(1, 1 - 2 * (1 - this._normalCDF(z)));
      if (confidenceScore > 0.5) {
        winner = scoreA.satisfactionRate >= scoreB.satisfactionRate ? 'A' : 'B';
      }
    }

    const result: ABTestResult = {
      configId: testId,
      winner,
      confidenceScore,
      variantAScore: scoreA,
      variantBScore: scoreB,
      sampleSizeA,
      sampleSizeB,
      computedAt: new Date(),
    };

    this.abTestResults.set(testId, result);

    if (winner !== 'inconclusive') {
      this.emit('abtest:winner', result);
      Logger.info('A/B test winner determined', { testId, winner, confidenceScore });
    }

    return result;
  }

  generateReport(period: QualityScore['period']): QualityReport {
    const modelStrategyKeys = new Set<string>();
    for (const s of this.signals) {
      modelStrategyKeys.add(`${s.modelId}:${s.strategy}`);
    }

    const byModel: QualityScore[] = [];
    const regressions: RegressionAlert[] = [];
    const strategyScores: Map<string, number> = new Map();

    for (const key of modelStrategyKeys) {
      const [modelId, ...stratParts] = key.split(':');
      const strategy = stratParts.join(':');
      const score = this.computeQualityScore(modelId, strategy, period);
      byModel.push(score);

      const composite = (score.satisfactionRate + score.relevanceRate + score.citationAccuracy) / 3
        - score.retryRate;
      strategyScores.set(strategy, Math.max(strategyScores.get(strategy) ?? 0, composite));

      const baselineKey = `${modelId}:${strategy}:satisfactionRate`;
      const baseline = this.baselineScores.get(baselineKey);
      if (baseline !== undefined && score.sampleSize >= 10) {
        const drop = baseline - score.satisfactionRate;
        const dropPct = baseline > 0 ? drop / baseline : 0;
        if (dropPct > REGRESSION_THRESHOLD) {
          regressions.push({
            modelId,
            metric: 'satisfactionRate',
            previousValue: baseline,
            currentValue: score.satisfactionRate,
            dropPct,
            detectedAt: new Date(),
            severity: dropPct > 0.3 ? 'high' : dropPct > 0.15 ? 'medium' : 'low',
          });
        }
      }
    }

    const topPerformingStrategies = [...strategyScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s);

    const recommendations: string[] = [];
    for (const score of byModel) {
      if (score.retryRate > 0.2 && score.sampleSize >= 20) {
        const alt = byModel.find(
          s => s.modelId !== score.modelId && s.retryRate < score.retryRate,
        );
        if (alt) {
          recommendations.push(
            `Model ${score.modelId} showing high retry rate (${(score.retryRate * 100).toFixed(1)}%), consider switching to ${alt.modelId}`,
          );
        }
      }
      if (score.satisfactionRate < 0.5 && score.sampleSize >= 20) {
        recommendations.push(
          `Model ${score.modelId} with strategy "${score.strategy}" has low satisfaction (${(score.satisfactionRate * 100).toFixed(1)}%). Review prompting strategy.`,
        );
      }
    }

    const overallScore = byModel.length > 0
      ? byModel.reduce((s, m) => s + m.satisfactionRate, 0) / byModel.length
      : 0;

    const report: QualityReport = {
      period,
      generatedAt: new Date(),
      overallScore,
      byModel,
      regressions,
      topPerformingStrategies,
      recommendations,
    };

    this.emit('report:generated', report);
    Logger.info('Quality report generated', { period, modelCount: byModel.length });
    return report;
  }

  private _checkRegression(modelId: string, strategy: string): void {
    const since = new Date(Date.now() - 3_600_000);
    const recentSignals = this.signals.filter(
      s => s.modelId === modelId && s.strategy === strategy && s.timestamp >= since,
    );
    if (recentSignals.length < 10) return;

    const thumbsUp = recentSignals.filter(s => s.signalType === 'thumbs_up').length;
    const thumbsDown = recentSignals.filter(s => s.signalType === 'thumbs_down').length;
    const base = thumbsUp + thumbsDown;
    const rollingScore = base > 0 ? thumbsUp / base : 0;

    const baselineKey = `${modelId}:${strategy}:satisfactionRate`;
    const baseline = this.baselineScores.get(baselineKey);

    if (baseline === undefined) {
      this._setBaseline(modelId, strategy, rollingScore);
      return;
    }

    const drop = baseline - rollingScore;
    const dropPct = baseline > 0 ? drop / baseline : 0;

    if (dropPct > REGRESSION_THRESHOLD) {
      const alert: RegressionAlert = {
        modelId,
        metric: 'satisfactionRate',
        previousValue: baseline,
        currentValue: rollingScore,
        dropPct,
        detectedAt: new Date(),
        severity: dropPct > 0.3 ? 'high' : dropPct > 0.15 ? 'medium' : 'low',
      };
      this.emit('regression:detected', alert);
      Logger.warn('Quality regression detected', { modelId, strategy, dropPct });
    }
  }

  private _setBaseline(modelId: string, strategy: string, score: number): void {
    const key = `${modelId}:${strategy}:satisfactionRate`;
    this.baselineScores.set(key, score);
  }

  getSignals(filter?: {
    modelId?: string;
    userId?: string;
    since?: Date;
    signalType?: string;
  }): QualitySignal[] {
    let result = [...this.signals];
    if (filter?.modelId) result = result.filter(s => s.modelId === filter.modelId);
    if (filter?.userId) result = result.filter(s => s.userId === filter.userId);
    if (filter?.since) result = result.filter(s => s.timestamp >= filter.since!);
    if (filter?.signalType) result = result.filter(s => s.signalType === filter.signalType);
    return result;
  }

  getQualityTrend(modelId: string, strategy: string, periods = 10): QualityScore[] {
    const key = `${modelId}:${strategy}`;
    const history = this.qualityHistory.get(key) ?? [];
    return history.slice(-periods);
  }

  private _periodStart(period: QualityScore['period']): Date {
    const now = Date.now();
    switch (period) {
      case 'hour': return new Date(now - 3_600_000);
      case 'day': return new Date(now - 86_400_000);
      case 'week': return new Date(now - 7 * 86_400_000);
    }
  }

  private _normalCDF(z: number): number {
    // Abramowitz & Stegun approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const result = 1 - pdf * poly;
    return z >= 0 ? result : 1 - result;
  }
}
