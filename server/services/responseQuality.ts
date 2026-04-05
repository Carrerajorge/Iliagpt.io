// Servicio de análisis de calidad de respuestas AI

export interface QualityAnalysis {
  score: number;
  issues: string[];
  isComplete: boolean;
  hasContentIssues: boolean;
}

// Patrones que indican truncamiento o respuesta incompleta
const TRUNCATION_MARKERS = [
  "... [truncated]",
  "[truncated]",
  "...",
  "…",
  "[continued]",
  "[more]",
  "[cut off]",
];

// Patrones de error común en respuestas AI
const ERROR_PATTERNS = [
  /I cannot (complete|finish|continue)/i,
  /I'm (sorry|unable) to (complete|finish)/i,
  /error occurred/i,
  /something went wrong/i,
  /request timed out/i,
  /API (error|failure)/i,
  /rate limit/i,
];

// Patrones de contenido potencialmente inapropiado (básico)
const CONTENT_ISSUE_PATTERNS = {
  low: [] as RegExp[],
  medium: [
    /\b(hate|violent|explicit)\b/i,
  ],
  high: [
    /\b(hate|violent|explicit|offensive|inappropriate)\b/i,
    /\b(discrimination|harassment)\b/i,
  ],
};

// Detectores de oraciones incompletas
const INCOMPLETE_SENTENCE_PATTERNS = [
  /[a-zA-Z]\s*$/,  // Termina con letra sin puntuación
  /[,;:]\s*$/,     // Termina con coma, punto y coma, o dos puntos
  /\band\s*$/i,    // Termina con "and"
  /\bor\s*$/i,     // Termina con "or"
  /\bthe\s*$/i,    // Termina con "the"
  /\ba\s*$/i,      // Termina con "a"
];

// Puntuación final válida
const VALID_ENDINGS = /[.!?)\]"'`]\s*$/;

export function analyzeResponseQuality(response: string): QualityAnalysis {
  const issues: string[] = [];
  let isComplete = true;
  let hasContentIssues = false;

  // Verificar respuesta vacía o muy corta
  // Health checks y respuestas breves válidas (ej: "OK", "Hello!") no son errores
  const VALID_SHORT_RESPONSES = /^(ok|hello|hi|yes|no|done|ready|online|healthy|pong|ack|acknowledged|confirmed|success|working|alive)[\s.!]*$/i;
  
  if (!response || response.trim().length === 0) {
    issues.push("empty_response");
    isComplete = false;
  } else if (response.trim().length < 10 && !VALID_SHORT_RESPONSES.test(response.trim())) {
    issues.push("response_too_short");
    isComplete = false;
  }

  // Verificar marcadores de truncamiento
  for (const marker of TRUNCATION_MARKERS) {
    if (response.includes(marker)) {
      issues.push(`truncation_marker: ${marker}`);
      isComplete = false;
      break;
    }
  }

  // Verificar patrones de error
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(response)) {
      issues.push("error_pattern_detected");
      isComplete = false;
      break;
    }
  }

  // Verificar oraciones incompletas
  const trimmedResponse = response.trim();
  if (trimmedResponse.length > 20) {
    const hasValidEnding = VALID_ENDINGS.test(trimmedResponse);
    if (!hasValidEnding) {
      for (const pattern of INCOMPLETE_SENTENCE_PATTERNS) {
        if (pattern.test(trimmedResponse)) {
          issues.push("incomplete_sentence");
          isComplete = false;
          break;
        }
      }
    }
  }

  // Verificar contenido inapropiado (nivel medio por defecto)
  const contentPatterns = CONTENT_ISSUE_PATTERNS.medium;
  for (const pattern of contentPatterns) {
    if (pattern.test(response)) {
      hasContentIssues = true;
      issues.push("content_issue_detected");
      break;
    }
  }

  // Calcular score base
  let score = 100;

  // Penalizaciones
  if (!isComplete) score -= 30;
  if (hasContentIssues) score -= 20;
  score -= issues.length * 5;
  
  // Normalizar score
  score = Math.max(0, Math.min(100, score));

  if (issues.length > 0) {
    console.log(`[ResponseQuality] Issues detected: ${issues.join(", ")}`);
  }

  return {
    score,
    issues,
    isComplete,
    hasContentIssues,
  };
}

export function calculateQualityScore(
  response: string,
  tokensUsed: number,
  latencyMs: number
): number {
  const analysis = analyzeResponseQuality(response);
  let score = analysis.score;

  // Bonus por eficiencia de tokens (respuesta útil con menos tokens)
  const responseLength = response.length;
  const tokenEfficiency = responseLength > 0 ? responseLength / Math.max(tokensUsed, 1) : 0;
  
  if (tokenEfficiency > 4) {
    score += 5; // Buena eficiencia de caracteres por token
  } else if (tokenEfficiency < 2) {
    score -= 5; // Baja eficiencia
  }

  // Bonus/penalización por latencia
  if (latencyMs < 1000) {
    score += 5; // Respuesta rápida
  } else if (latencyMs > 10000) {
    score -= 10; // Muy lenta
  } else if (latencyMs > 5000) {
    score -= 5; // Lenta
  }

  // Normalizar score
  score = Math.max(0, Math.min(100, score));

  return score;
}

export function detectContentIssues(
  response: string,
  sensitivityLevel: "low" | "medium" | "high" = "medium"
): { hasIssues: boolean; patterns: string[] } {
  const patterns = CONTENT_ISSUE_PATTERNS[sensitivityLevel];
  const detectedPatterns: string[] = [];

  for (const pattern of patterns) {
    if (pattern.test(response)) {
      detectedPatterns.push(pattern.source);
    }
  }

  if (detectedPatterns.length > 0) {
    console.log(`[ResponseQuality] Content issues detected at ${sensitivityLevel} level: ${detectedPatterns.length} patterns`);
  }

  return {
    hasIssues: detectedPatterns.length > 0,
    patterns: detectedPatterns,
  };
}

export function getComprehensiveAnalysis(
  response: string,
  tokensUsed: number,
  latencyMs: number,
  sensitivityLevel: "low" | "medium" | "high" = "medium"
): QualityAnalysis & { contentPatterns: string[]; qualityScore: number } {
  const baseAnalysis = analyzeResponseQuality(response);
  const contentCheck = detectContentIssues(response, sensitivityLevel);
  const qualityScore = calculateQualityScore(response, tokensUsed, latencyMs);

  return {
    ...baseAnalysis,
    hasContentIssues: contentCheck.hasIssues,
    contentPatterns: contentCheck.patterns,
    qualityScore,
    score: qualityScore,
    issues: [
      ...baseAnalysis.issues,
      ...contentCheck.patterns.map(p => `content_pattern: ${p}`),
    ],
  };
}

const REFUSAL_PATTERNS_RAG = [
  /^I('m| am) (sorry|unable|not able),? (but )?(I )?(can't|cannot|am unable)/i,
  /^(Sorry|Unfortunately),? (I |but )(can't|cannot|am not able|don't have)/i,
  /^No puedo (ayud|respond|proporcion)/i,
  /^Lo siento,? (pero )?(no puedo|no tengo)/i,
  /^I (can't|cannot) (help|assist|answer|respond|provide)/i,
  /^As an AI,? I (can't|cannot|am unable)/i,
];

const GARBAGE_PATTERNS_RAG = [
  /(.{10,})\1{3,}/,
  /^[^\w\s]{20,}$/,
  /(\b\w+\b)(\s+\1){5,}/i,
];

export function isRAGResponseUsable(
  response: string,
  contextLength: number,
): { usable: boolean; reason?: string } {
  if (!response || response.trim().length === 0) {
    return { usable: false, reason: 'empty_response' };
  }

  if (response.trim().length < 5) {
    return { usable: false, reason: 'too_short' };
  }

  for (const pat of REFUSAL_PATTERNS_RAG) {
    if (pat.test(response.trim())) {
      return { usable: false, reason: 'generic_refusal' };
    }
  }

  for (const pat of GARBAGE_PATTERNS_RAG) {
    if (pat.test(response.trim())) {
      return { usable: false, reason: 'garbage_content' };
    }
  }

  if (contextLength > 500 && response.trim().length < 20) {
    return { usable: false, reason: 'disproportionately_short' };
  }

  return { usable: true };
}
