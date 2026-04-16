import type { RobustIntent, SubIntent } from "./robustIntentClassifier";

export interface QACheck {
  name: string;
  passed: boolean;
  details: string;
  severity: "info" | "warning" | "error";
}

export interface QAResult {
  passed: boolean;
  checks: QACheck[];
  overallScore: number;
  recommendations: string[];
}

const NUMBER_PATTERN = /\b\d+([.,]\d+)?\b/g;
const DATE_PATTERN = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g;
const NAME_PATTERN = /\b[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)*\b/g;
const CITATION_PATTERNS = [
  /\[(\d+)\]/g,
  /\(fuente:\s*[^)]+\)/gi,
  /\(source:\s*[^)]+\)/gi,
  /según\s+[^.,]+/gi,
  /according\s+to\s+[^.,]+/gi,
];

const MARKDOWN_PATTERNS = {
  headers: /^#{1,6}\s+.+$/gm,
  bold: /\*\*[^*]+\*\*/g,
  italic: /\*[^*]+\*/g,
  lists: /^[\s]*[-*]\s+.+$/gm,
  numberedLists: /^[\s]*\d+\.\s+.+$/gm,
  codeBlocks: /```[\s\S]*?```/g,
  tables: /\|[^|]+\|/g,
};

export function checkConsistency(response: string): QACheck {
  const numbers = response.match(NUMBER_PATTERN) || [];
  const dates = response.match(DATE_PATTERN) || [];
  const names = response.match(NAME_PATTERN) || [];

  const issues: string[] = [];

  const numberSet = new Set(numbers);
  if (numbers.length > 0 && numbers.length !== numberSet.size) {
    const repeated = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    if (repeated.length > 0) {
      issues.push(`Números repetidos: ${repeated.slice(0, 3).join(", ")}`);
    }
  }

  const dateFormats = new Set<string>();
  for (const date of dates) {
    if (date.includes("/")) dateFormats.add("slash");
    if (date.includes("-")) dateFormats.add("dash");
  }
  if (dateFormats.size > 1) {
    issues.push("Formatos de fecha inconsistentes (/ y -)");
  }

  const passed = issues.length === 0;
  return {
    name: "Consistency Check",
    passed,
    details: passed
      ? `Datos consistentes: ${numbers.length} números, ${dates.length} fechas, ${names.length} nombres propios`
      : `Problemas encontrados: ${issues.join("; ")}`,
    severity: passed ? "info" : "warning",
  };
}

export function checkFormatting(response: string, intent: RobustIntent, subIntent: SubIntent | null): QACheck {
  const hasHeaders = MARKDOWN_PATTERNS.headers.test(response);
  const hasLists = MARKDOWN_PATTERNS.lists.test(response) || MARKDOWN_PATTERNS.numberedLists.test(response);
  const hasTables = MARKDOWN_PATTERNS.tables.test(response);
  const hasCodeBlocks = MARKDOWN_PATTERNS.codeBlocks.test(response);

  const issues: string[] = [];
  const suggestions: string[] = [];

  if (intent === "analysis" && response.length > 500 && !hasHeaders) {
    issues.push("Análisis largo sin encabezados");
    suggestions.push("Agregar encabezados para mejorar legibilidad");
  }

  if ((subIntent === "summarize" || intent === "analysis") && response.length > 300 && !hasLists) {
    suggestions.push("Considerar usar listas para puntos clave");
  }

  if (subIntent === "extract_table" && !hasTables) {
    issues.push("Se solicitó tabla pero no se detectó formato de tabla");
  }

  if (intent === "code" && response.includes("function") && !hasCodeBlocks) {
    suggestions.push("Código debería estar en bloques de código");
  }

  const passed = issues.length === 0;
  return {
    name: "Formatting Check",
    passed,
    details: passed
      ? `Formato correcto: headers=${hasHeaders}, lists=${hasLists}, tables=${hasTables}, code=${hasCodeBlocks}`
      : `Problemas: ${issues.join("; ")}. Sugerencias: ${suggestions.join("; ")}`,
    severity: passed ? "info" : "warning",
  };
}

export function checkCitations(response: string, hasWebSearch: boolean): QACheck {
  let citationCount = 0;
  for (const pattern of CITATION_PATTERNS) {
    const matches = response.match(pattern);
    if (matches) {
      citationCount += matches.length;
    }
  }

  const hasClaims = /\b(según|afirma|indica|reporta|according|states|reports|claims)\b/i.test(response);
  const hasStats = /\b\d+%|\b\d+\s*(millones?|billions?|trillions?|mil|thousand|hundred)/gi.test(response);

  const issues: string[] = [];

  if (hasWebSearch && citationCount === 0 && (hasClaims || hasStats)) {
    issues.push("Afirmaciones sin citar fuentes después de búsqueda web");
  }

  if (hasStats && citationCount === 0) {
    issues.push("Estadísticas sin fuente citada");
  }

  const passed = issues.length === 0;
  return {
    name: "Citations Check",
    passed,
    details: passed
      ? `Citaciones: ${citationCount} referencias encontradas`
      : `Problemas: ${issues.join("; ")}`,
    severity: passed ? "info" : "warning",
  };
}

export function checkCompleteness(response: string, objectives: string[]): QACheck {
  if (objectives.length === 0) {
    return {
      name: "Completeness Check",
      passed: true,
      details: "No hay objetivos específicos para verificar",
      severity: "info",
    };
  }

  const lowerResponse = response.toLowerCase();
  const addressedObjectives: string[] = [];
  const missedObjectives: string[] = [];

  for (const objective of objectives) {
    const keywords = objective.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matchCount = keywords.filter(kw => lowerResponse.includes(kw)).length;
    const matchRatio = keywords.length > 0 ? matchCount / keywords.length : 0;

    if (matchRatio >= 0.3) {
      addressedObjectives.push(objective.slice(0, 50));
    } else {
      missedObjectives.push(objective.slice(0, 50));
    }
  }

  const completionRatio = objectives.length > 0 ? addressedObjectives.length / objectives.length : 1;
  const passed = completionRatio >= 0.7;

  return {
    name: "Completeness Check",
    passed,
    details: passed
      ? `${addressedObjectives.length}/${objectives.length} objetivos abordados`
      : `Objetivos no abordados: ${missedObjectives.join("; ")}`,
    severity: passed ? "info" : "error",
  };
}

export function checkResponseLength(response: string, intent: RobustIntent, subIntent: SubIntent | null): QACheck {
  const length = response.length;
  const wordCount = response.split(/\s+/).length;

  let minWords = 10;
  let maxWords = 5000;
  let idealRange = "";

  if (subIntent === "summarize") {
    minWords = 50;
    maxWords = 500;
    idealRange = "50-500 palabras";
  } else if (intent === "analysis") {
    minWords = 100;
    maxWords = 2000;
    idealRange = "100-2000 palabras";
  } else if (intent === "chat") {
    minWords = 5;
    maxWords = 500;
    idealRange = "5-500 palabras";
  } else if (intent === "code") {
    minWords = 10;
    maxWords = 3000;
    idealRange = "10-3000 palabras";
  }

  const passed = wordCount >= minWords && wordCount <= maxWords;

  return {
    name: "Response Length Check",
    passed,
    details: passed
      ? `Longitud apropiada: ${wordCount} palabras (ideal: ${idealRange})`
      : `Longitud inapropiada: ${wordCount} palabras (esperado: ${idealRange})`,
    severity: passed ? "info" : "warning",
  };
}

export function runQualityAssurance(
  response: string,
  intent: RobustIntent,
  subIntent: SubIntent | null,
  objectives: string[],
  hasWebSearch: boolean
): QAResult {
  const checks: QACheck[] = [
    checkConsistency(response),
    checkFormatting(response, intent, subIntent),
    checkCitations(response, hasWebSearch),
    checkCompleteness(response, objectives),
    checkResponseLength(response, intent, subIntent),
  ];

  const passedCount = checks.filter(c => c.passed).length;
  const overallScore = checks.length > 0 ? passedCount / checks.length : 1;

  const recommendations: string[] = [];
  for (const check of checks) {
    if (!check.passed) {
      if (check.name === "Formatting Check") {
        recommendations.push("Mejorar estructura con encabezados y listas");
      }
      if (check.name === "Citations Check") {
        recommendations.push("Agregar citas para afirmaciones importantes");
      }
      if (check.name === "Completeness Check") {
        recommendations.push("Verificar que todos los objetivos estén cubiertos");
      }
      if (check.name === "Response Length Check") {
        recommendations.push("Ajustar longitud de la respuesta");
      }
    }
  }

  const passed = overallScore >= 0.6;

  return {
    passed,
    checks,
    overallScore,
    recommendations,
  };
}

export class QualityAssurance {
  run(
    response: string,
    intent: RobustIntent,
    subIntent: SubIntent | null,
    objectives: string[],
    hasWebSearch: boolean
  ): QAResult {
    const startTime = Date.now();
    const result = runQualityAssurance(response, intent, subIntent, objectives, hasWebSearch);
    const duration = Date.now() - startTime;

    console.log(
      `[QualityAssurance] Completed in ${duration}ms: ` +
      `passed=${result.passed}, score=${(result.overallScore * 100).toFixed(0)}%, ` +
      `checks=${result.checks.length}`
    );

    return result;
  }
}
