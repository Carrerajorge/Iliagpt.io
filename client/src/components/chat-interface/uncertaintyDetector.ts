/**
 * Heuristic function to detect uncertainty in AI responses
 * Used for showing confidence indicators to users
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface UncertaintyResult {
  confidence: ConfidenceLevel;
  reason?: string;
}

const LOW_CONFIDENCE_PATTERNS = [
  /no (estoy|está) seguro/i,
  /no (puedo|logro|he podido) confirmar/i,
  /falta información/i,
  /información (insuficiente|limitada)/i,
  /no (se menciona|se especifica|aparece|encontré)/i,
  /podría ser/i,
  /es probable que/i,
  /sin certeza/i,
  /no garantiza/i,
  /difícil determinar/i,
  /i('m| am) not sure/i,
  /i can('t|not) confirm/i,
  /insufficient information/i,
  /not (mentioned|specified|found)/i,
  /might be/i,
  /it('s| is) likely that/i,
  /uncertain/i,
  /difficult to determine/i,
];

const MEDIUM_CONFIDENCE_PATTERNS = [
  /parece indicar/i,
  /sugiere que/i,
  /aparentemente/i,
  /posiblemente/i,
  /en principio/i,
  /según el contexto/i,
  /seems to indicate/i,
  /suggests that/i,
  /apparently/i,
  /possibly/i,
  /in principle/i,
  /according to context/i,
  /based on/i,
];

export function detectUncertainty(content: string): UncertaintyResult {
  for (const pattern of LOW_CONFIDENCE_PATTERNS) {
    if (pattern.test(content)) {
      return {
        confidence: 'low',
        reason: 'La respuesta contiene expresiones de duda o falta de información.'
      };
    }
  }

  for (const pattern of MEDIUM_CONFIDENCE_PATTERNS) {
    if (pattern.test(content)) {
      return {
        confidence: 'medium',
        reason: 'La respuesta se basa en inferencias o indicaciones no explícitas.'
      };
    }
  }

  return { confidence: 'high' };
}

/**
 * Get a display label for the confidence level
 */
export function getConfidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'Alta confianza';
    case 'medium':
      return 'Confianza media';
    case 'low':
      return 'Baja confianza';
  }
}

/**
 * Get a color class for the confidence level
 */
export function getConfidenceColor(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'text-green-500';
    case 'medium':
      return 'text-yellow-500';
    case 'low':
      return 'text-red-500';
  }
}
