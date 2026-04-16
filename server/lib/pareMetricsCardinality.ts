/**
 * PARE Metrics Cardinality Guard
 * Strict label allowlist system with runtime validation to prevent unbounded cardinality
 */

export const LABEL_ALLOWLISTS = {
  status_code_class: ['2xx', '4xx', '5xx'] as const,
  parser_type: ['pdf', 'xlsx', 'docx', 'pptx', 'csv', 'txt', 'unknown'] as const,
  limit_type: ['ip', 'user', 'global'] as const,
  circuit_state: ['closed', 'half_open', 'open'] as const,
  block_reason: [
    'malware_detected', 'file_too_large', 'invalid_mime_type',
    'path_traversal', 'zip_bomb', 'rate_limit', 'auth_failed',
    'forbidden_extension', 'other'
  ] as const,
  endpoint: [
    '/api/analyze', '/api/chat', '/health', '/metrics', 'other'
  ] as const,
} as const;

export type StatusCodeClass = typeof LABEL_ALLOWLISTS.status_code_class[number];
export type ParserType = typeof LABEL_ALLOWLISTS.parser_type[number];
export type LimitType = typeof LABEL_ALLOWLISTS.limit_type[number];
export type CircuitState = typeof LABEL_ALLOWLISTS.circuit_state[number];
export type BlockReason = typeof LABEL_ALLOWLISTS.block_reason[number];
export type Endpoint = typeof LABEL_ALLOWLISTS.endpoint[number];

export type LabelDimension = keyof typeof LABEL_ALLOWLISTS;

type DefaultValue<T extends LabelDimension> = 
  T extends 'status_code_class' ? '5xx' :
  T extends 'parser_type' ? 'unknown' :
  T extends 'limit_type' ? 'global' :
  T extends 'circuit_state' ? 'closed' :
  T extends 'block_reason' ? 'other' :
  T extends 'endpoint' ? 'other' :
  never;

const DEFAULT_VALUES: Record<LabelDimension, string> = {
  status_code_class: '5xx',
  parser_type: 'unknown',
  limit_type: 'global',
  circuit_state: 'closed',
  block_reason: 'other',
  endpoint: 'other',
};

export function validateLabel<T extends LabelDimension>(
  dimension: T,
  value: string
): typeof LABEL_ALLOWLISTS[T][number] {
  const allowlist = LABEL_ALLOWLISTS[dimension] as readonly string[];
  const normalized = value.toLowerCase().trim();
  
  if (allowlist.includes(normalized)) {
    return normalized as typeof LABEL_ALLOWLISTS[T][number];
  }
  
  return DEFAULT_VALUES[dimension] as typeof LABEL_ALLOWLISTS[T][number];
}

export function normalizeStatusCode(code: number): StatusCodeClass {
  if (code >= 200 && code < 300) return '2xx';
  if (code >= 400 && code < 500) return '4xx';
  if (code >= 500 && code < 600) return '5xx';
  return '5xx';
}

export function normalizeParserType(type: string): ParserType {
  const normalized = type.toLowerCase().trim();
  const allowlist = LABEL_ALLOWLISTS.parser_type as readonly string[];
  
  if (allowlist.includes(normalized)) {
    return normalized as ParserType;
  }
  return 'unknown';
}

export function normalizeEndpoint(endpoint: string): Endpoint {
  const trimmed = endpoint.trim().toLowerCase();
  const allowlist = LABEL_ALLOWLISTS.endpoint as readonly string[];
  
  for (const allowed of allowlist) {
    if (allowed !== 'other' && trimmed.startsWith(allowed)) {
      return allowed as Endpoint;
    }
  }
  
  return 'other';
}

export function normalizeBlockReason(reason: string): BlockReason {
  const normalized = reason.toLowerCase().trim().replace(/\s+/g, '_');
  const allowlist = LABEL_ALLOWLISTS.block_reason as readonly string[];
  
  if (allowlist.includes(normalized)) {
    return normalized as BlockReason;
  }
  return 'other';
}

export function normalizeLimitType(limitType: string): LimitType {
  const normalized = limitType.toLowerCase().trim();
  const allowlist = LABEL_ALLOWLISTS.limit_type as readonly string[];
  
  if (allowlist.includes(normalized)) {
    return normalized as LimitType;
  }
  return 'global';
}

export function normalizeCircuitState(state: string): CircuitState {
  const normalized = state.toLowerCase().trim();
  const allowlist = LABEL_ALLOWLISTS.circuit_state as readonly string[];
  
  if (allowlist.includes(normalized)) {
    return normalized as CircuitState;
  }
  return 'closed';
}

export interface CardinalityReport {
  timestamp: string;
  dimensions: {
    [key: string]: {
      uniqueValues: number;
      maxAllowed: number;
      values: string[];
      isHealthy: boolean;
    };
  };
  totalUniqueLabels: number;
  healthy: boolean;
}

export interface CardinalityHealthCheck {
  healthy: boolean;
  issues: string[];
}

export class CardinalityGuard {
  private labelCounts: Map<string, Set<string>> = new Map();
  private readonly MAX_UNIQUE_VALUES: number;
  private rejectedLabels: Map<string, number> = new Map();

  constructor(maxUniqueValues: number = 50) {
    this.MAX_UNIQUE_VALUES = maxUniqueValues;
    
    for (const dimension of Object.keys(LABEL_ALLOWLISTS) as LabelDimension[]) {
      this.labelCounts.set(dimension, new Set());
    }
  }

  recordLabel(dimension: string, value: string): string {
    if (!(dimension in LABEL_ALLOWLISTS)) {
      console.warn(`[CardinalityGuard] Unknown dimension: ${dimension}`);
      return value;
    }

    const typedDimension = dimension as LabelDimension;
    const validatedValue = validateLabel(typedDimension, value);
    
    let dimensionSet = this.labelCounts.get(dimension);
    if (!dimensionSet) {
      dimensionSet = new Set();
      this.labelCounts.set(dimension, dimensionSet);
    }

    if (dimensionSet.size >= this.MAX_UNIQUE_VALUES && !dimensionSet.has(validatedValue)) {
      const key = `${dimension}:overflow`;
      this.rejectedLabels.set(key, (this.rejectedLabels.get(key) || 0) + 1);
      return DEFAULT_VALUES[typedDimension];
    }

    dimensionSet.add(validatedValue);
    return validatedValue;
  }

  getCardinalityReport(): CardinalityReport {
    const dimensions: CardinalityReport['dimensions'] = {};
    let totalUniqueLabels = 0;
    let healthy = true;

    const entries = Array.from(this.labelCounts.entries());
    for (let i = 0; i < entries.length; i++) {
      const [dimension, values] = entries[i];
      const uniqueCount = values.size;
      totalUniqueLabels += uniqueCount;
      const isHealthy = uniqueCount <= this.MAX_UNIQUE_VALUES;
      
      if (!isHealthy) {
        healthy = false;
      }

      const valuesArray: string[] = [];
      values.forEach((v) => {
        if (valuesArray.length < 100) valuesArray.push(v);
      });

      dimensions[dimension] = {
        uniqueValues: uniqueCount,
        maxAllowed: this.MAX_UNIQUE_VALUES,
        values: valuesArray,
        isHealthy,
      };
    }

    return {
      timestamp: new Date().toISOString(),
      dimensions,
      totalUniqueLabels,
      healthy,
    };
  }

  checkHealth(): CardinalityHealthCheck {
    const issues: string[] = [];
    let healthy = true;

    const entries = Array.from(this.labelCounts.entries());
    for (let i = 0; i < entries.length; i++) {
      const [dimension, values] = entries[i];
      const count = values.size;
      const threshold = this.MAX_UNIQUE_VALUES;
      
      if (count >= threshold * 0.8) {
        issues.push(
          `Dimension '${dimension}' approaching limit: ${count}/${threshold} (${Math.round((count / threshold) * 100)}%)`
        );
      }
      
      if (count >= threshold) {
        healthy = false;
        issues.push(`Dimension '${dimension}' exceeded limit: ${count}/${threshold}`);
      }
    }

    const rejectedEntries = Array.from(this.rejectedLabels.entries());
    for (let i = 0; i < rejectedEntries.length; i++) {
      const [key, count] = rejectedEntries[i];
      if (count > 0) {
        issues.push(`${key}: ${count} labels rejected due to cardinality limit`);
      }
    }

    return { healthy, issues };
  }

  reset(): void {
    const sets = Array.from(this.labelCounts.values());
    for (let i = 0; i < sets.length; i++) {
      sets[i].clear();
    }
    this.rejectedLabels.clear();
  }

  getDimensionCardinality(dimension: string): number {
    return this.labelCounts.get(dimension)?.size ?? 0;
  }

  getAllowedValues(dimension: LabelDimension): readonly string[] {
    return LABEL_ALLOWLISTS[dimension];
  }
}

export const cardinalityGuard = new CardinalityGuard();

export function withCardinalityGuard<T extends LabelDimension>(
  dimension: T,
  value: string
): typeof LABEL_ALLOWLISTS[T][number] {
  return cardinalityGuard.recordLabel(dimension, value) as typeof LABEL_ALLOWLISTS[T][number];
}

export function createSafeLabels(labels: Record<string, string>): Record<string, string> {
  const safeLabels: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(labels)) {
    if (key in LABEL_ALLOWLISTS) {
      safeLabels[key] = cardinalityGuard.recordLabel(key, value);
    } else {
      safeLabels[key] = value;
    }
  }
  
  return safeLabels;
}
