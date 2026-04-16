// Servicio de filtrado de contenido configurable

export interface ContentFilterConfig {
  enabled: boolean;
  sensitivityLevel: "low" | "medium" | "high";
  customPatterns: string[];
}

export interface FilterResult {
  passed: boolean;
  filtered: boolean;
  originalText: string;
  filteredText: string;
  matchedPatterns: string[];
  replacementCount: number;
}

// Almacenamiento en memoria de configuraciones por usuario
const userConfigs: Map<string, ContentFilterConfig> = new Map();

// Patrones por nivel de sensibilidad
const SENSITIVITY_PATTERNS: Record<"low" | "medium" | "high", RegExp[]> = {
  low: [
    /\b(spam|phishing)\b/gi,
  ],
  medium: [
    /\b(spam|phishing)\b/gi,
    /\b(hate|violence|explicit)\b/gi,
    /\b(scam|fraud)\b/gi,
  ],
  high: [
    /\b(spam|phishing)\b/gi,
    /\b(hate|violence|explicit)\b/gi,
    /\b(scam|fraud)\b/gi,
    /\b(offensive|inappropriate|harmful)\b/gi,
    /\b(discrimination|harassment|abuse)\b/gi,
    /\b(dangerous|illegal)\b/gi,
  ],
};

// Texto de reemplazo
const REPLACEMENT_TEXT = "[filtered]";

export function getDefaultConfig(): ContentFilterConfig {
  return {
    enabled: true,
    sensitivityLevel: "medium",
    customPatterns: [],
  };
}

export function getUserConfig(userId: string): ContentFilterConfig {
  const config = userConfigs.get(userId);
  if (!config) {
    return getDefaultConfig();
  }
  return { ...config };
}

export function setUserConfig(userId: string, config: Partial<ContentFilterConfig>): ContentFilterConfig {
  const currentConfig = getUserConfig(userId);
  const newConfig: ContentFilterConfig = {
    enabled: config.enabled ?? currentConfig.enabled,
    sensitivityLevel: config.sensitivityLevel ?? currentConfig.sensitivityLevel,
    customPatterns: config.customPatterns ?? currentConfig.customPatterns,
  };
  
  userConfigs.set(userId, newConfig);
  console.log(`[ContentFilter] Updated config for user ${userId}: sensitivity=${newConfig.sensitivityLevel}, enabled=${newConfig.enabled}`);
  
  return newConfig;
}

export function clearUserConfig(userId: string): void {
  userConfigs.delete(userId);
}

export function filterContent(text: string, config: ContentFilterConfig): FilterResult {
  if (!config.enabled) {
    return {
      passed: true,
      filtered: false,
      originalText: text,
      filteredText: text,
      matchedPatterns: [],
      replacementCount: 0,
    };
  }

  const matchedPatterns: string[] = [];
  let filteredText = text;
  let replacementCount = 0;

  // Aplicar patrones de sensibilidad
  const sensitivityPatterns = SENSITIVITY_PATTERNS[config.sensitivityLevel];
  for (const pattern of sensitivityPatterns) {
    const matches = filteredText.match(pattern);
    if (matches) {
      matchedPatterns.push(pattern.source);
      replacementCount += matches.length;
      filteredText = filteredText.replace(pattern, REPLACEMENT_TEXT);
    }
  }

  // Aplicar patrones personalizados del usuario
  for (const customPattern of config.customPatterns) {
    try {
      const regex = new RegExp(customPattern, "gi");
      const matches = filteredText.match(regex);
      if (matches) {
        matchedPatterns.push(`custom: ${customPattern}`);
        replacementCount += matches.length;
        filteredText = filteredText.replace(regex, REPLACEMENT_TEXT);
      }
    } catch (e) {
      console.warn(`[ContentFilter] Invalid custom pattern: ${customPattern}`);
    }
  }

  const filtered = replacementCount > 0;
  
  if (filtered) {
    console.log(`[ContentFilter] Filtered ${replacementCount} matches, patterns: ${matchedPatterns.join(", ")}`);
  }

  return {
    passed: !filtered,
    filtered,
    originalText: text,
    filteredText,
    matchedPatterns,
    replacementCount,
  };
}

export function checkContent(text: string, config: ContentFilterConfig): {
  hasIssues: boolean;
  issues: string[];
} {
  if (!config.enabled) {
    return { hasIssues: false, issues: [] };
  }

  const issues: string[] = [];
  
  // Verificar patrones de sensibilidad
  const sensitivityPatterns = SENSITIVITY_PATTERNS[config.sensitivityLevel];
  for (const pattern of sensitivityPatterns) {
    if (pattern.test(text)) {
      issues.push(`sensitivity_${config.sensitivityLevel}: ${pattern.source}`);
    }
  }

  // Verificar patrones personalizados
  for (const customPattern of config.customPatterns) {
    try {
      const regex = new RegExp(customPattern, "gi");
      if (regex.test(text)) {
        issues.push(`custom: ${customPattern}`);
      }
    } catch (e) {
      // Patrón inválido, ignorar
    }
  }

  return {
    hasIssues: issues.length > 0,
    issues,
  };
}

export function validatePatterns(patterns: string[]): { valid: boolean; invalidPatterns: string[] } {
  const invalidPatterns: string[] = [];
  
  for (const pattern of patterns) {
    try {
      new RegExp(pattern, "gi");
    } catch (e) {
      invalidPatterns.push(pattern);
    }
  }

  return {
    valid: invalidPatterns.length === 0,
    invalidPatterns,
  };
}

// Estadísticas de uso del filtro
const filterStats = {
  totalChecks: 0,
  totalFiltered: 0,
  patternHits: new Map<string, number>(),
};

export function recordFilterUsage(result: FilterResult): void {
  filterStats.totalChecks++;
  if (result.filtered) {
    filterStats.totalFiltered++;
    for (const pattern of result.matchedPatterns) {
      const count = filterStats.patternHits.get(pattern) || 0;
      filterStats.patternHits.set(pattern, count + 1);
    }
  }
}

export function getFilterStats(): {
  totalChecks: number;
  totalFiltered: number;
  filterRate: number;
  topPatterns: Array<{ pattern: string; count: number }>;
} {
  const topPatterns = Array.from(filterStats.patternHits.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalChecks: filterStats.totalChecks,
    totalFiltered: filterStats.totalFiltered,
    filterRate: filterStats.totalChecks > 0 
      ? filterStats.totalFiltered / filterStats.totalChecks 
      : 0,
    topPatterns,
  };
}
