import type { CalibrationConfig, IntentType } from "../../../shared/schemas/intent";
import {
  getConformalPredictionSet,
  getConfidenceZone,
  getConformalStats,
  isDriftDetected,
  isConformalCalibrated,
  initializeConformalPredictor,
  selectTopIntent,
  generateClarificationFromSet,
  type ConformalPredictionSet,
  type ConfidenceZone
} from "./conformalPredictor";

export interface CalibrationInput {
  rule_confidence: number;
  knn_confidence: number;
  rule_patterns_matched: number;
  has_creation_verb: boolean;
  text_length: number;
  language_confidence: number;
  intent_scores?: Record<IntentType, number>;
}

export interface CalibrationOutput {
  calibrated_confidence: number;
  raw_combined: number;
  adjustment_applied: string;
  should_fallback: boolean;
  conformal_prediction_set?: ConformalPredictionSet;
  confidence_zone?: ConfidenceZone;
  calibration_drift_detected?: boolean;
}

export interface CalibratorConfig {
  useConformal: boolean;
  fallbackToIsotonic: boolean;
}

const DEFAULT_CALIBRATOR_CONFIG: CalibratorConfig = {
  useConformal: true,
  fallbackToIsotonic: true
};

let calibratorConfig = { ...DEFAULT_CALIBRATOR_CONFIG };
let conformalInitialized = false;

export function configureCal(config: Partial<CalibratorConfig>): void {
  calibratorConfig = { ...calibratorConfig, ...config };
}

export function getCalibratorConfig(): CalibratorConfig {
  return { ...calibratorConfig };
}

function ensureConformalInitialized(): void {
  if (!conformalInitialized && calibratorConfig.useConformal) {
    initializeConformalPredictor();
    conformalInitialized = true;
  }
}

function temperatureScale(logit: number, temperature: number): number {
  return 1 / (1 + Math.exp(-logit / temperature));
}

function logit(p: number): number {
  const clampedP = Math.max(0.001, Math.min(0.999, p));
  return Math.log(clampedP / (1 - clampedP));
}

function isotonicCalibrate(
  confidence: number,
  bins: number[],
  values: number[]
): number {
  if (bins.length !== values.length) {
    return confidence;
  }
  
  if (confidence <= bins[0]) return values[0];
  if (confidence >= bins[bins.length - 1]) return values[values.length - 1];
  
  for (let i = 0; i < bins.length - 1; i++) {
    if (confidence >= bins[i] && confidence < bins[i + 1]) {
      const ratio = (confidence - bins[i]) / (bins[i + 1] - bins[i]);
      return values[i] + ratio * (values[i + 1] - values[i]);
    }
  }
  
  return confidence;
}

export function calibrate(
  input: CalibrationInput,
  config: CalibrationConfig
): CalibrationOutput {
  const combinedRaw =
    input.rule_confidence * config.rule_weight +
    input.knn_confidence * config.knn_weight;
  
  let adjusted = combinedRaw;
  let adjustmentReason = "none";
  
  if (input.rule_patterns_matched >= 3) {
    adjusted = Math.min(1, adjusted + 0.05);
    adjustmentReason = "high_pattern_match";
  }
  
  if (input.has_creation_verb && input.rule_patterns_matched >= 1) {
    adjusted = Math.min(1, adjusted + 0.05);
    adjustmentReason = adjustmentReason === "none" ? "creation_verb_boost" : adjustmentReason + "+creation_verb";
  }
  
  if (input.text_length < 10) {
    adjusted = Math.max(0, adjusted - 0.10);
    adjustmentReason = adjustmentReason === "none" ? "short_text_penalty" : adjustmentReason + "+short_text";
  }
  
  if (input.language_confidence < 0.6) {
    adjusted = Math.max(0, adjusted - 0.05);
    adjustmentReason = adjustmentReason === "none" ? "low_lang_confidence" : adjustmentReason + "+low_lang";
  }
  
  const logitValue = logit(adjusted);
  const tempScaled = temperatureScale(logitValue, config.temperature);
  
  const calibrated = isotonicCalibrate(
    tempScaled,
    config.isotonic_bins,
    config.isotonic_values
  );
  
  const shouldFallback = calibrated < config.fallback_threshold;
  
  let conformalPredictionSet: ConformalPredictionSet | undefined;
  let confidenceZone: ConfidenceZone | undefined;
  let calibrationDriftDetected = false;
  
  if (calibratorConfig.useConformal && input.intent_scores) {
    ensureConformalInitialized();
    
    if (isConformalCalibrated()) {
      conformalPredictionSet = getConformalPredictionSet(input.intent_scores);
      confidenceZone = conformalPredictionSet.zone;
      calibrationDriftDetected = isDriftDetected();
    }
  }
  
  return {
    calibrated_confidence: Math.max(config.min_threshold, Math.min(0.99, calibrated)),
    raw_combined: combinedRaw,
    adjustment_applied: adjustmentReason,
    should_fallback: shouldFallback,
    conformal_prediction_set: conformalPredictionSet,
    confidence_zone: confidenceZone,
    calibration_drift_detected: calibrationDriftDetected
  };
}

export function calibrateWithConformal(
  intentScores: Record<IntentType, number>,
  locale: string = "en"
): {
  predictionSet: ConformalPredictionSet;
  selectedIntent: IntentType;
  shouldClarify: boolean;
  clarificationQuestion: string;
  driftDetected: boolean;
} {
  ensureConformalInitialized();
  
  const predictionSet = getConformalPredictionSet(intentScores);
  const selectedIntent = selectTopIntent(predictionSet);
  const shouldClarify = predictionSet.zone === "LOW_CONFIDENCE" || selectedIntent === "NEED_CLARIFICATION";
  const clarificationQuestion = shouldClarify ? generateClarificationFromSet(predictionSet, locale) : "";
  const driftDetected = isDriftDetected();
  
  return {
    predictionSet,
    selectedIntent,
    shouldClarify,
    clarificationQuestion,
    driftDetected
  };
}

export function getCalibrationStatus(): {
  conformal_enabled: boolean;
  conformal_calibrated: boolean;
  conformal_stats: ReturnType<typeof getConformalStats> | null;
  drift_detected: boolean;
} {
  const conformalEnabled = calibratorConfig.useConformal;
  const conformalCalibrated = isConformalCalibrated();
  
  return {
    conformal_enabled: conformalEnabled,
    conformal_calibrated: conformalCalibrated,
    conformal_stats: conformalCalibrated ? getConformalStats() : null,
    drift_detected: conformalCalibrated ? isDriftDetected() : false
  };
}

export function updateCalibration(
  predictions: Array<{ predicted: number; actual: boolean }>
): { bins: number[]; values: number[] } {
  const sorted = [...predictions].sort((a, b) => a.predicted - b.predicted);
  
  const numBins = 7;
  const binSize = Math.ceil(sorted.length / numBins);
  
  const bins: number[] = [];
  const values: number[] = [];
  
  for (let i = 0; i < numBins; i++) {
    const start = i * binSize;
    const end = Math.min((i + 1) * binSize, sorted.length);
    const slice = sorted.slice(start, end);
    
    if (slice.length === 0) continue;
    
    const avgPredicted = slice.reduce((a, b) => a + b.predicted, 0) / slice.length;
    const actualRate = slice.filter(p => p.actual).length / slice.length;
    
    bins.push(avgPredicted);
    values.push(actualRate);
  }
  
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) {
      values[i] = values[i - 1];
    }
  }
  
  return { bins, values };
}

export interface ConfusionMatrix {
  matrix: number[][];
  labels: string[];
  accuracy: number;
  top2_accuracy: number;
  per_class_accuracy: Record<string, number>;
  per_class_precision: Record<string, number>;
  per_class_recall: Record<string, number>;
}

export function computeConfusionMatrix(
  predictions: Array<{ predicted: string; actual: string; top2?: string[] }>
): ConfusionMatrix {
  const labels = [...new Set([
    ...predictions.map(p => p.predicted),
    ...predictions.map(p => p.actual)
  ])].sort();
  
  const labelIndex = new Map(labels.map((l, i) => [l, i]));
  
  const n = labels.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  
  let correct = 0;
  let top2Correct = 0;
  
  for (const pred of predictions) {
    const actualIdx = labelIndex.get(pred.actual);
    const predictedIdx = labelIndex.get(pred.predicted);
    
    if (actualIdx !== undefined && predictedIdx !== undefined) {
      matrix[actualIdx][predictedIdx]++;
      
      if (pred.predicted === pred.actual) {
        correct++;
        top2Correct++;
      } else if (pred.top2 && pred.top2.includes(pred.actual)) {
        top2Correct++;
      }
    }
  }
  
  const accuracy = predictions.length > 0 ? correct / predictions.length : 0;
  const top2_accuracy = predictions.length > 0 ? top2Correct / predictions.length : 0;
  
  const per_class_accuracy: Record<string, number> = {};
  const per_class_precision: Record<string, number> = {};
  const per_class_recall: Record<string, number> = {};
  
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    const tp = matrix[i][i];
    const rowSum = matrix[i].reduce((a, b) => a + b, 0);
    const colSum = matrix.reduce((sum, row) => sum + row[i], 0);
    
    per_class_recall[label] = rowSum > 0 ? tp / rowSum : 0;
    per_class_precision[label] = colSum > 0 ? tp / colSum : 0;
    
    let correctOther = 0;
    let totalOther = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i) {
        for (let k = 0; k < n; k++) {
          if (k !== i) {
            correctOther += matrix[j][k];
          }
          totalOther += matrix[j][k];
        }
      }
    }
    per_class_accuracy[label] = totalOther > 0 ? (tp + correctOther) / (rowSum + totalOther) : 0;
  }
  
  return {
    matrix,
    labels,
    accuracy,
    top2_accuracy,
    per_class_accuracy,
    per_class_precision,
    per_class_recall
  };
}
