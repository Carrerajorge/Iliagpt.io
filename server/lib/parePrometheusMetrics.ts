import { Registry, Histogram, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

const register = new Registry();

collectDefaultMetrics({ register, prefix: 'pare_' });

const VALID_PARSER_TYPES = ['pdf', 'xlsx', 'docx', 'pptx', 'csv', 'txt', 'unknown'] as const;
type ParserType = typeof VALID_PARSER_TYPES[number];

const VALID_LIMIT_TYPES = ['ip', 'user', 'global'] as const;
type LimitType = typeof VALID_LIMIT_TYPES[number];

const VALID_CIRCUIT_STATES = ['closed', 'half_open', 'open'] as const;
type CircuitState = typeof VALID_CIRCUIT_STATES[number];

const CIRCUIT_STATE_VALUES: Record<CircuitState, number> = {
  closed: 0,
  half_open: 0.5,
  open: 1,
};

function normalizeParserType(type: string): ParserType {
  const normalized = type.toLowerCase();
  if (VALID_PARSER_TYPES.includes(normalized as ParserType)) {
    return normalized as ParserType;
  }
  return 'unknown';
}

function getStatusCodeClass(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return '5xx';
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[a-f0-9-]{36}/gi, '/:uuid')
    .slice(0, 50);
}

function normalizeBlockReason(reason: string): string {
  const validReasons = [
    'malware_detected',
    'file_too_large',
    'invalid_mime_type',
    'path_traversal',
    'zip_bomb',
    'rate_limit',
    'auth_failed',
    'forbidden_extension',
    'other',
  ];
  const normalized = reason.toLowerCase().replace(/\s+/g, '_');
  if (validReasons.includes(normalized)) {
    return normalized;
  }
  return 'other';
}

const requestDurationHistogram = new Histogram({
  name: 'pare_request_duration_seconds',
  help: 'Request latency in seconds',
  labelNames: ['endpoint', 'status_code_class'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const parseDurationHistogram = new Histogram({
  name: 'pare_parse_duration_seconds',
  help: 'Parser execution time in seconds',
  labelNames: ['parser_type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30],
  registers: [register],
});

const requestsTotalCounter = new Counter({
  name: 'pare_requests_total',
  help: 'Total number of requests',
  labelNames: ['endpoint', 'status_code_class'] as const,
  registers: [register],
});

const parseOperationsTotalCounter = new Counter({
  name: 'pare_parse_operations_total',
  help: 'Total number of parse operations',
  labelNames: ['parser_type', 'success'] as const,
  registers: [register],
});

const circuitBreakerTripsCounter = new Counter({
  name: 'pare_circuit_breaker_trips_total',
  help: 'Total number of circuit breaker trips',
  labelNames: ['parser_type'] as const,
  registers: [register],
});

const rateLimitExceededCounter = new Counter({
  name: 'pare_rate_limit_exceeded_total',
  help: 'Total number of rate limit exceeded events',
  labelNames: ['limit_type'] as const,
  registers: [register],
});

const securityBlocksCounter = new Counter({
  name: 'pare_security_blocks_total',
  help: 'Total number of security blocks',
  labelNames: ['block_reason'] as const,
  registers: [register],
});

const activeWorkersGauge = new Gauge({
  name: 'pare_active_workers',
  help: 'Current number of active workers',
  registers: [register],
});

const circuitBreakerStateGauge = new Gauge({
  name: 'pare_circuit_breaker_state',
  help: 'Current circuit breaker state per parser (0=closed, 0.5=half_open, 1=open)',
  labelNames: ['parser_type'] as const,
  registers: [register],
});

const queueDepthGauge = new Gauge({
  name: 'pare_queue_depth',
  help: 'Current processing queue depth',
  registers: [register],
});

const validActionOutcomes = ['success', 'failure', 'validation_error', 'rate_limited', 'blocked', 'timeout'] as const;
type ActionOutcome = typeof validActionOutcomes[number];

const gptActionRequestDurationHistogram = new Histogram({
  name: 'pare_gpt_action_duration_seconds',
  help: 'GPT Action request latency in seconds',
  labelNames: ['gpt_id', 'action_id', 'outcome', 'circuit_state'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

const gptActionRequestsTotalCounter = new Counter({
  name: 'pare_gpt_action_requests_total',
  help: 'Total GPT Action requests',
  labelNames: ['gpt_id', 'action_id', 'outcome'] as const,
  registers: [register],
});

const gptActionRetriesTotalCounter = new Counter({
  name: 'pare_gpt_action_retries_total',
  help: 'Total GPT Action retries',
  labelNames: ['gpt_id', 'action_id'] as const,
  registers: [register],
});

const gptActionValidationErrorsTotalCounter = new Counter({
  name: 'pare_gpt_action_validation_errors_total',
  help: 'Total GPT Action validation errors',
  labelNames: ['gpt_id', 'action_id', 'stage'] as const,
  registers: [register],
});

const gptActionRateLimitCounter = new Counter({
  name: 'pare_gpt_action_rate_limit_total',
  help: 'GPT Action requests rejected by rate limit',
  labelNames: ['gpt_id', 'action_id'] as const,
  registers: [register],
});

const gptActionCircuitBreakerStateGauge = new Gauge({
  name: 'pare_gpt_action_circuit_state',
  help: 'Current GPT Action circuit state (0=closed, 0.5=half_open, 1=open)',
  labelNames: ['gpt_id', 'action_id', 'state'] as const,
  registers: [register],
});

function normalizeActionOutcome(outcome: string): ActionOutcome {
  const value = outcome.toLowerCase().trim();
  if (validActionOutcomes.includes(value as ActionOutcome)) {
    return value as ActionOutcome;
  }
  return 'failure';
}

function normalizeActionIdentifier(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || "unknown";
}

function normalizeActionState(state?: string): string {
  const validStates = ["closed", "half_open", "open"];
  return validStates.includes(state || "") ? state! : "closed";
}

export function recordRequestDuration(
  endpoint: string,
  statusCode: number,
  durationSec: number
): void {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const statusClass = getStatusCodeClass(statusCode);
  
  requestDurationHistogram.observe(
    { endpoint: normalizedEndpoint, status_code_class: statusClass },
    durationSec
  );
  
  requestsTotalCounter.inc({ endpoint: normalizedEndpoint, status_code_class: statusClass });
}

export function recordParseDuration(parserType: string, durationSec: number): void {
  const normalized = normalizeParserType(parserType);
  parseDurationHistogram.observe({ parser_type: normalized }, durationSec);
}

export function recordParseOperation(parserType: string, success: boolean): void {
  const normalized = normalizeParserType(parserType);
  parseOperationsTotalCounter.inc({
    parser_type: normalized,
    success: success ? 'true' : 'false',
  });
}

export function recordCircuitBreakerTrip(parserType: string): void {
  const normalized = normalizeParserType(parserType);
  circuitBreakerTripsCounter.inc({ parser_type: normalized });
}

export function recordRateLimitExceeded(limitType: LimitType): void {
  rateLimitExceededCounter.inc({ limit_type: limitType });
}

export function recordSecurityBlock(reason: string): void {
  const normalized = normalizeBlockReason(reason);
  securityBlocksCounter.inc({ block_reason: normalized });
}

export function setActiveWorkers(count: number): void {
  activeWorkersGauge.set(Math.max(0, Math.floor(count)));
}

export function setCircuitBreakerState(parserType: string, state: CircuitState): void {
  const normalizedType = normalizeParserType(parserType);
  const stateValue = CIRCUIT_STATE_VALUES[state] ?? 0;
  circuitBreakerStateGauge.set({ parser_type: normalizedType }, stateValue);
}

export function setQueueDepth(depth: number): void {
  queueDepthGauge.set(Math.max(0, Math.floor(depth)));
}

export function recordGptActionRequest(
  gptId: string,
  actionId: string,
  outcome: string,
  durationSec: number,
  circuitState: "closed" | "half_open" | "open"
): void {
  const outcomeLabel = normalizeActionOutcome(outcome);
  const normalizedGptId = normalizeActionIdentifier(gptId);
  const normalizedActionId = normalizeActionIdentifier(actionId);
  const state = normalizeActionState(circuitState);
  gptActionRequestDurationHistogram.observe(
    {
      gpt_id: normalizedGptId,
      action_id: normalizedActionId,
      outcome: outcomeLabel,
      circuit_state: state,
    },
    durationSec
  );
  gptActionRequestsTotalCounter.inc({
    gpt_id: normalizedGptId,
    action_id: normalizedActionId,
    outcome: outcomeLabel,
  });
}

export function recordGptActionRetry(gptId: string, actionId: string): void {
  gptActionRetriesTotalCounter.inc({
    gpt_id: normalizeActionIdentifier(gptId),
    action_id: normalizeActionIdentifier(actionId),
  });
}

export function recordGptActionValidationError(
  gptId: string,
  actionId: string,
  stage: string
): void {
  gptActionValidationErrorsTotalCounter.inc({
    gpt_id: normalizeActionIdentifier(gptId),
    action_id: normalizeActionIdentifier(actionId),
    stage: stage || "unknown",
  });
}

export function recordGptActionRateLimit(gptId: string, actionId: string): void {
  gptActionRateLimitCounter.inc({
    gpt_id: normalizeActionIdentifier(gptId),
    action_id: normalizeActionIdentifier(actionId),
  });
}

export function setGptActionCircuitBreakerState(
  gptId: string,
  actionId: string,
  state: "closed" | "half_open" | "open",
  count: number
): void {
  gptActionCircuitBreakerStateGauge.set(
    {
      gpt_id: normalizeActionIdentifier(gptId),
      action_id: normalizeActionIdentifier(actionId),
      state,
    },
    count
  );
}

export async function getMetricsText(): Promise<string> {
  return register.metrics();
}

export function getMetricsJson(): object {
  const metrics = register.getMetricsAsJSON();
  return {
    timestamp: new Date().toISOString(),
    metrics,
  };
}

export async function metricsHandler(
  _req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const metricsText = await getMetricsText();
    res.set('Content-Type', register.contentType);
    res.end(metricsText);
  } catch (error) {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
}

export function createMetricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = process.hrtime.bigint();
    
    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const durationNs = Number(endTime - startTime);
      const durationSec = durationNs / 1e9;
      
      recordRequestDuration(req.path, res.statusCode, durationSec);
    });
    
    next();
  };
}

export { register as prometheusRegistry };
