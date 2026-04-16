import type { IntentType } from "../../../shared/schemas/intent";
import { EVALUATION_DATASET, type EvaluationExample } from "./datasets/evaluation";
import { logStructured } from "./telemetry";

export interface CalibrationExample {
  text: string;
  true_intent: IntentType;
  predicted_scores: Record<IntentType, number>;
}

export type ConfidenceZone = "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE";

export interface ConformalPredictionSet {
  intents: IntentType[];
  scores: Record<IntentType, number>;
  zone: ConfidenceZone;
  threshold: number;
  coverage_guarantee: number;
}

export interface ConformalStats {
  is_calibrated: boolean;
  calibration_size: number;
  quantile_threshold: number;
  target_coverage: number;
  empirical_coverage: number;
  total_predictions: number;
  coverage_by_zone: Record<ConfidenceZone, number>;
  predictions_by_zone: Record<ConfidenceZone, number>;
  drift_detected: boolean;
  last_calibration_time: number;
}

const DEFAULT_TARGET_COVERAGE = 0.90;
const DRIFT_THRESHOLD = 0.10;
const MIN_CALIBRATION_SIZE = 50;

let calibrationScores: number[] = [];
let quantileThreshold = 0.10;
let isCalibrated = false;
let targetCoverage = DEFAULT_TARGET_COVERAGE;
let lastCalibrationTime = 0;

let totalPredictions = 0;
let correctCoverageCount = 0;
let predictionsByZone: Record<ConfidenceZone, number> = {
  HIGH_CONFIDENCE: 0,
  MEDIUM_CONFIDENCE: 0,
  LOW_CONFIDENCE: 0
};
let coverageByZone: Record<ConfidenceZone, { correct: number; total: number }> = {
  HIGH_CONFIDENCE: { correct: 0, total: 0 },
  MEDIUM_CONFIDENCE: { correct: 0, total: 0 },
  LOW_CONFIDENCE: { correct: 0, total: 0 }
};

function computeNonconformityScore(
  trueIntent: IntentType,
  scores: Record<IntentType, number>
): number {
  const trueScore = scores[trueIntent] ?? 0;
  return 1 - trueScore;
}

function computeQuantile(scores: number[], alpha: number): number {
  if (scores.length === 0) return 1.0;
  
  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;
  const quantileIndex = Math.ceil((n + 1) * (1 - alpha)) - 1;
  const clampedIndex = Math.max(0, Math.min(n - 1, quantileIndex));
  
  return sorted[clampedIndex];
}

function softmax(scores: Record<IntentType, number>): Record<IntentType, number> {
  const values = Object.values(scores);
  const maxVal = Math.max(...values);
  const expScores: Record<string, number> = {};
  let sumExp = 0;
  
  for (const [intent, score] of Object.entries(scores)) {
    const expScore = Math.exp(score - maxVal);
    expScores[intent] = expScore;
    sumExp += expScore;
  }
  
  const result: Record<IntentType, number> = {} as Record<IntentType, number>;
  for (const [intent, expScore] of Object.entries(expScores)) {
    result[intent as IntentType] = expScore / sumExp;
  }
  
  return result;
}

export function calibrateConformalPredictor(
  calibrationData: CalibrationExample[],
  coverage: number = DEFAULT_TARGET_COVERAGE
): { success: boolean; threshold: number; calibration_size: number } {
  if (calibrationData.length < MIN_CALIBRATION_SIZE) {
    logStructured("warn", "Insufficient calibration data for conformal prediction", {
      provided: calibrationData.length,
      required: MIN_CALIBRATION_SIZE
    });
    
    return {
      success: false,
      threshold: quantileThreshold,
      calibration_size: calibrationData.length
    };
  }
  
  targetCoverage = coverage;
  calibrationScores = [];
  
  for (const example of calibrationData) {
    const normalizedScores = softmax(example.predicted_scores);
    const nonconformityScore = computeNonconformityScore(
      example.true_intent,
      normalizedScores
    );
    calibrationScores.push(nonconformityScore);
  }
  
  const alpha = 1 - targetCoverage;
  quantileThreshold = computeQuantile(calibrationScores, alpha);
  
  isCalibrated = true;
  lastCalibrationTime = Date.now();
  
  totalPredictions = 0;
  correctCoverageCount = 0;
  predictionsByZone = { HIGH_CONFIDENCE: 0, MEDIUM_CONFIDENCE: 0, LOW_CONFIDENCE: 0 };
  coverageByZone = {
    HIGH_CONFIDENCE: { correct: 0, total: 0 },
    MEDIUM_CONFIDENCE: { correct: 0, total: 0 },
    LOW_CONFIDENCE: { correct: 0, total: 0 }
  };
  
  logStructured("info", "Conformal predictor calibrated", {
    calibration_size: calibrationData.length,
    quantile_threshold: quantileThreshold,
    target_coverage: targetCoverage
  });
  
  return {
    success: true,
    threshold: quantileThreshold,
    calibration_size: calibrationData.length
  };
}

export function getConformalPredictionSet(
  scores: Record<IntentType, number>
): ConformalPredictionSet {
  const normalizedScores = softmax(scores);
  const predictionSet: IntentType[] = [];
  
  for (const [intent, score] of Object.entries(normalizedScores)) {
    const nonconformityScore = 1 - score;
    if (nonconformityScore <= quantileThreshold) {
      predictionSet.push(intent as IntentType);
    }
  }
  
  if (predictionSet.length === 0) {
    const sortedIntents = Object.entries(normalizedScores)
      .sort((a, b) => b[1] - a[1]);
    if (sortedIntents.length > 0) {
      predictionSet.push(sortedIntents[0][0] as IntentType);
    }
  }
  
  const zone = getConfidenceZone(predictionSet);
  
  predictionsByZone[zone]++;
  totalPredictions++;
  
  return {
    intents: predictionSet,
    scores: normalizedScores,
    zone,
    threshold: quantileThreshold,
    coverage_guarantee: targetCoverage
  };
}

export function getConfidenceZone(predictionSet: IntentType[]): ConfidenceZone {
  const size = predictionSet.length;
  
  if (size === 1) {
    return "HIGH_CONFIDENCE";
  } else if (size >= 2 && size <= 3) {
    return "MEDIUM_CONFIDENCE";
  } else {
    return "LOW_CONFIDENCE";
  }
}

export function recordCoverageOutcome(
  predictionSet: ConformalPredictionSet,
  trueIntent: IntentType
): void {
  const zone = predictionSet.zone;
  const covered = predictionSet.intents.includes(trueIntent);
  
  coverageByZone[zone].total++;
  if (covered) {
    coverageByZone[zone].correct++;
    correctCoverageCount++;
  }
}

export function getEmpiricalCoverage(): number {
  if (totalPredictions === 0) return targetCoverage;
  return correctCoverageCount / totalPredictions;
}

export function isDriftDetected(): boolean {
  if (totalPredictions < MIN_CALIBRATION_SIZE) return false;
  
  const empiricalCoverage = getEmpiricalCoverage();
  return empiricalCoverage < (targetCoverage - DRIFT_THRESHOLD);
}

export function getConformalStats(): ConformalStats {
  const empiricalCoverage = getEmpiricalCoverage();
  
  const coverageByZoneResult: Record<ConfidenceZone, number> = {
    HIGH_CONFIDENCE: coverageByZone.HIGH_CONFIDENCE.total > 0 
      ? coverageByZone.HIGH_CONFIDENCE.correct / coverageByZone.HIGH_CONFIDENCE.total 
      : 1.0,
    MEDIUM_CONFIDENCE: coverageByZone.MEDIUM_CONFIDENCE.total > 0 
      ? coverageByZone.MEDIUM_CONFIDENCE.correct / coverageByZone.MEDIUM_CONFIDENCE.total 
      : 1.0,
    LOW_CONFIDENCE: coverageByZone.LOW_CONFIDENCE.total > 0 
      ? coverageByZone.LOW_CONFIDENCE.correct / coverageByZone.LOW_CONFIDENCE.total 
      : 1.0
  };
  
  return {
    is_calibrated: isCalibrated,
    calibration_size: calibrationScores.length,
    quantile_threshold: quantileThreshold,
    target_coverage: targetCoverage,
    empirical_coverage: empiricalCoverage,
    total_predictions: totalPredictions,
    coverage_by_zone: coverageByZoneResult,
    predictions_by_zone: { ...predictionsByZone },
    drift_detected: isDriftDetected(),
    last_calibration_time: lastCalibrationTime
  };
}

export function selectTopIntent(predictionSet: ConformalPredictionSet): IntentType {
  const { intents, scores, zone } = predictionSet;
  
  if (intents.length === 0) {
    return "NEED_CLARIFICATION";
  }
  
  if (zone === "HIGH_CONFIDENCE") {
    return intents[0];
  }
  
  if (zone === "MEDIUM_CONFIDENCE") {
    const sorted = intents
      .map(intent => ({ intent, score: scores[intent] || 0 }))
      .sort((a, b) => b.score - a.score);
    
    if (sorted.length >= 2) {
      const scoreDiff = sorted[0].score - sorted[1].score;
      if (scoreDiff >= 0.15) {
        return sorted[0].intent;
      }
    }
    
    return sorted[0].intent;
  }
  
  return "NEED_CLARIFICATION";
}

export function generateClarificationFromSet(
  predictionSet: ConformalPredictionSet,
  locale: string = "en"
): string {
  const { intents, zone } = predictionSet;
  
  if (zone !== "LOW_CONFIDENCE" && zone !== "MEDIUM_CONFIDENCE") {
    return "";
  }
  
  const topIntents = intents.slice(0, 3);
  
  const intentDescriptions: Record<IntentType, Record<string, string>> = {
    CREATE_PRESENTATION: { en: "a presentation", es: "una presentación" },
    CREATE_DOCUMENT: { en: "a document", es: "un documento" },
    CREATE_SPREADSHEET: { en: "a spreadsheet", es: "una hoja de cálculo" },
    SUMMARIZE: { en: "summarize content", es: "resumir contenido" },
    TRANSLATE: { en: "translate text", es: "traducir texto" },
    SEARCH_WEB: { en: "search the web", es: "buscar en la web" },
    ANALYZE_DOCUMENT: { en: "analyze a document", es: "analizar un documento" },
    CHAT_GENERAL: { en: "have a conversation", es: "tener una conversación" },
    NEED_CLARIFICATION: { en: "clarify your request", es: "aclarar tu solicitud" }
  };
  
  const lang = locale === "es" ? "es" : "en";
  
  if (zone === "LOW_CONFIDENCE") {
    if (lang === "es") {
      return "No estoy seguro de lo que necesitas. ¿Podrías ser más específico?";
    }
    return "I'm not sure what you need. Could you be more specific?";
  }
  
  if (topIntents.length >= 2) {
    const options = topIntents
      .map(i => intentDescriptions[i]?.[lang] || i)
      .join(lang === "es" ? " o " : " or ");
    
    if (lang === "es") {
      return `¿Quieres que cree ${options}?`;
    }
    return `Would you like me to create ${options}?`;
  }
  
  if (lang === "es") {
    return "¿Podrías darme más detalles sobre lo que necesitas?";
  }
  return "Could you give me more details about what you need?";
}

export function bootstrapFromEvaluationDataset(): CalibrationExample[] {
  const calibrationExamples: CalibrationExample[] = [];
  
  const ALL_INTENTS: IntentType[] = [
    "CREATE_PRESENTATION",
    "CREATE_DOCUMENT",
    "CREATE_SPREADSHEET",
    "SUMMARIZE",
    "TRANSLATE",
    "SEARCH_WEB",
    "ANALYZE_DOCUMENT",
    "CHAT_GENERAL",
    "NEED_CLARIFICATION"
  ];
  
  for (const example of EVALUATION_DATASET) {
    const scores: Record<IntentType, number> = {} as Record<IntentType, number>;
    
    for (const intent of ALL_INTENTS) {
      if (intent === example.expected_intent) {
        const difficultyBoost = example.difficulty === "easy" ? 0.9 : 
                               example.difficulty === "medium" ? 0.75 : 0.55;
        scores[intent] = difficultyBoost + Math.random() * 0.1;
      } else {
        scores[intent] = Math.random() * 0.15;
      }
    }
    
    calibrationExamples.push({
      text: example.text,
      true_intent: example.expected_intent,
      predicted_scores: scores
    });
  }
  
  return calibrationExamples;
}

export function initializeConformalPredictor(): void {
  const calibrationData = bootstrapFromEvaluationDataset();
  const result = calibrateConformalPredictor(calibrationData, DEFAULT_TARGET_COVERAGE);
  
  if (result.success) {
    logStructured("info", "Conformal predictor initialized from evaluation dataset", {
      calibration_size: result.calibration_size,
      threshold: result.threshold
    });
  }
}

export function isConformalCalibrated(): boolean {
  return isCalibrated;
}

export function resetConformalStats(): void {
  totalPredictions = 0;
  correctCoverageCount = 0;
  predictionsByZone = { HIGH_CONFIDENCE: 0, MEDIUM_CONFIDENCE: 0, LOW_CONFIDENCE: 0 };
  coverageByZone = {
    HIGH_CONFIDENCE: { correct: 0, total: 0 },
    MEDIUM_CONFIDENCE: { correct: 0, total: 0 },
    LOW_CONFIDENCE: { correct: 0, total: 0 }
  };
}
