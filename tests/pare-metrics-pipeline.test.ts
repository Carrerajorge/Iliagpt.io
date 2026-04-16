import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  LABEL_ALLOWLISTS,
  normalizeStatusCode,
  normalizeParserType,
  normalizeEndpoint,
  normalizeBlockReason,
  normalizeLimitType,
  normalizeCircuitState,
  validateLabel,
  CardinalityGuard,
  cardinalityGuard,
  withCardinalityGuard,
  createSafeLabels,
} from '../server/lib/pareMetricsCardinality';
import {
  recordRequestDuration,
  recordParseDuration,
  recordParseOperation,
  recordCircuitBreakerTrip,
  recordRateLimitExceeded,
  recordSecurityBlock,
  setActiveWorkers,
  setCircuitBreakerState,
  setQueueDepth,
  getMetricsText,
  getMetricsJson,
  prometheusRegistry,
} from '../server/lib/parePrometheusMetrics';
import {
  pareMetrics,
  getMetricsSummary,
  Histogram,
  Counter,
  PareMetricsCollector,
} from '../server/lib/pareMetrics';

describe('PARE Metrics Pipeline', () => {
  describe('Histogram Buckets', () => {
    it('request duration should have SLO-aligned buckets', async () => {
      recordRequestDuration('/api/analyze', 200, 0.15);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_request_duration_seconds');
      
      const requiredBuckets = [0.1, 0.5, 1, 5];
      requiredBuckets.forEach(bucket => {
        expect(metricsText).toContain(`le="${bucket}"`);
      });
    });

    it('parse duration should have appropriate buckets for long operations', async () => {
      recordParseDuration('pdf', 25.0);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_parse_duration_seconds');
      
      expect(metricsText).toContain('le="30"');
    });

    it('should include standard histogram metadata', async () => {
      const metricsText = await getMetricsText();
      
      expect(metricsText).toContain('# HELP pare_request_duration_seconds');
      expect(metricsText).toContain('# TYPE pare_request_duration_seconds histogram');
      expect(metricsText).toContain('# HELP pare_parse_duration_seconds');
      expect(metricsText).toContain('# TYPE pare_parse_duration_seconds histogram');
    });

    it('should have +Inf bucket for unbounded observations', async () => {
      const metricsText = await getMetricsText();
      
      expect(metricsText).toContain('le="+Inf"');
    });
  });

  describe('Label Cardinality Control', () => {
    it('should normalize unknown parser types to "unknown"', () => {
      expect(normalizeParserType('weird_format')).toBe('unknown');
      expect(normalizeParserType('RANDOM_TYPE')).toBe('unknown');
      expect(normalizeParserType('something_else')).toBe('unknown');
      expect(normalizeParserType('')).toBe('unknown');
    });

    it('should accept valid parser types', () => {
      expect(normalizeParserType('pdf')).toBe('pdf');
      expect(normalizeParserType('PDF')).toBe('pdf');
      expect(normalizeParserType('xlsx')).toBe('xlsx');
      expect(normalizeParserType('DOCX')).toBe('docx');
      expect(normalizeParserType('pptx')).toBe('pptx');
      expect(normalizeParserType('csv')).toBe('csv');
      expect(normalizeParserType('txt')).toBe('txt');
    });

    it('should normalize status codes to classes', () => {
      expect(normalizeStatusCode(200)).toBe('2xx');
      expect(normalizeStatusCode(201)).toBe('2xx');
      expect(normalizeStatusCode(204)).toBe('2xx');
      expect(normalizeStatusCode(299)).toBe('2xx');
      
      expect(normalizeStatusCode(400)).toBe('4xx');
      expect(normalizeStatusCode(401)).toBe('4xx');
      expect(normalizeStatusCode(404)).toBe('4xx');
      expect(normalizeStatusCode(499)).toBe('4xx');
      
      expect(normalizeStatusCode(500)).toBe('5xx');
      expect(normalizeStatusCode(502)).toBe('5xx');
      expect(normalizeStatusCode(503)).toBe('5xx');
      expect(normalizeStatusCode(599)).toBe('5xx');
    });

    it('should default to 5xx for out of range status codes', () => {
      expect(normalizeStatusCode(100)).toBe('5xx');
      expect(normalizeStatusCode(199)).toBe('5xx');
      expect(normalizeStatusCode(600)).toBe('5xx');
      expect(normalizeStatusCode(0)).toBe('5xx');
      expect(normalizeStatusCode(-1)).toBe('5xx');
    });

    it('should normalize endpoints to allowlist', () => {
      expect(normalizeEndpoint('/api/analyze')).toBe('/api/analyze');
      expect(normalizeEndpoint('/api/analyze/123')).toBe('/api/analyze');
      expect(normalizeEndpoint('/api/chat')).toBe('/api/chat');
      expect(normalizeEndpoint('/health')).toBe('/health');
      expect(normalizeEndpoint('/metrics')).toBe('/metrics');
      expect(normalizeEndpoint('/unknown/path')).toBe('other');
      expect(normalizeEndpoint('/custom/endpoint')).toBe('other');
    });

    it('should normalize block reasons', () => {
      expect(normalizeBlockReason('malware_detected')).toBe('malware_detected');
      expect(normalizeBlockReason('MALWARE_DETECTED')).toBe('malware_detected');
      expect(normalizeBlockReason('file_too_large')).toBe('file_too_large');
      expect(normalizeBlockReason('invalid_mime_type')).toBe('invalid_mime_type');
      expect(normalizeBlockReason('path_traversal')).toBe('path_traversal');
      expect(normalizeBlockReason('zip_bomb')).toBe('zip_bomb');
      expect(normalizeBlockReason('rate_limit')).toBe('rate_limit');
      expect(normalizeBlockReason('auth_failed')).toBe('auth_failed');
      expect(normalizeBlockReason('forbidden_extension')).toBe('forbidden_extension');
      expect(normalizeBlockReason('something_unknown')).toBe('other');
    });

    it('should normalize limit types', () => {
      expect(normalizeLimitType('ip')).toBe('ip');
      expect(normalizeLimitType('IP')).toBe('ip');
      expect(normalizeLimitType('user')).toBe('user');
      expect(normalizeLimitType('global')).toBe('global');
      expect(normalizeLimitType('unknown')).toBe('global');
    });

    it('should normalize circuit states', () => {
      expect(normalizeCircuitState('closed')).toBe('closed');
      expect(normalizeCircuitState('CLOSED')).toBe('closed');
      expect(normalizeCircuitState('half_open')).toBe('half_open');
      expect(normalizeCircuitState('open')).toBe('open');
      expect(normalizeCircuitState('invalid')).toBe('closed');
    });

    it('should reject unbounded label values via validateLabel', () => {
      expect(validateLabel('parser_type', 'user_input_abc123')).toBe('unknown');
      expect(validateLabel('status_code_class', 'random')).toBe('5xx');
      expect(validateLabel('block_reason', 'custom_reason_xyz')).toBe('other');
      expect(validateLabel('limit_type', 'arbitrary')).toBe('global');
      expect(validateLabel('circuit_state', 'broken')).toBe('closed');
      expect(validateLabel('endpoint', '/some/random/path')).toBe('other');
    });

    it('should have bounded allowlist for all dimensions', () => {
      Object.entries(LABEL_ALLOWLISTS).forEach(([dim, values]) => {
        expect(values.length).toBeLessThanOrEqual(20);
        expect(values.length).toBeGreaterThan(0);
      });
    });

    it('should handle whitespace in label values', () => {
      expect(normalizeParserType('  pdf  ')).toBe('pdf');
      expect(normalizeBlockReason('  malware_detected  ')).toBe('malware_detected');
      expect(normalizeLimitType('  ip  ')).toBe('ip');
    });

    it('should handle spaces converted to underscores in block reasons', () => {
      expect(normalizeBlockReason('malware detected')).toBe('malware_detected');
      expect(normalizeBlockReason('file too large')).toBe('file_too_large');
    });
  });

  describe('Metrics Recording', () => {
    beforeEach(() => {
      pareMetrics.reset();
    });

    it('recordRequestDuration should use normalized labels', async () => {
      recordRequestDuration('/api/analyze/test', 200, 0.5);
      recordRequestDuration('/api/unknown/path', 404, 0.1);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('status_code_class="2xx"');
      expect(metricsText).toContain('status_code_class="4xx"');
    });

    it('recordParseDuration should use valid parser types', async () => {
      recordParseDuration('pdf', 1.5);
      recordParseDuration('xlsx', 2.0);
      recordParseDuration('invalid_type', 0.5);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('parser_type="pdf"');
      expect(metricsText).toContain('parser_type="xlsx"');
      expect(metricsText).toContain('parser_type="unknown"');
    });

    it('recordParseOperation should track success and failure', async () => {
      recordParseOperation('pdf', true);
      recordParseOperation('pdf', false);
      recordParseOperation('xlsx', true);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_parse_operations_total');
      expect(metricsText).toContain('success="true"');
      expect(metricsText).toContain('success="false"');
    });

    it('recordSecurityBlock should normalize block reasons', async () => {
      recordSecurityBlock('malware_detected');
      recordSecurityBlock('unknown_reason');
      recordSecurityBlock('RATE_LIMIT');
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_security_blocks_total');
      expect(metricsText).toContain('block_reason="malware_detected"');
      expect(metricsText).toContain('block_reason="other"');
      expect(metricsText).toContain('block_reason="rate_limit"');
    });

    it('recordCircuitBreakerTrip should normalize parser type', async () => {
      recordCircuitBreakerTrip('pdf');
      recordCircuitBreakerTrip('INVALID_PARSER');
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_circuit_breaker_trips_total');
    });

    it('recordRateLimitExceeded should use valid limit types', async () => {
      recordRateLimitExceeded('ip');
      recordRateLimitExceeded('user');
      recordRateLimitExceeded('global');
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_rate_limit_exceeded_total');
    });

    it('setActiveWorkers should set gauge value', async () => {
      setActiveWorkers(5);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_active_workers');
    });

    it('setQueueDepth should set gauge value', async () => {
      setQueueDepth(10);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_queue_depth');
    });

    it('setCircuitBreakerState should normalize parser type', async () => {
      setCircuitBreakerState('pdf', 'closed');
      setCircuitBreakerState('xlsx', 'open');
      setCircuitBreakerState('invalid', 'half_open');
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_circuit_breaker_state');
    });
  });

  describe('Prometheus Endpoint', () => {
    it('should return valid Prometheus text format', async () => {
      const metricsText = await getMetricsText();
      
      expect(typeof metricsText).toBe('string');
      expect(metricsText.length).toBeGreaterThan(0);
      
      expect(metricsText).toContain('# HELP');
      expect(metricsText).toContain('# TYPE');
      
      const lines = metricsText.split('\n');
      const dataLines = lines.filter(line => line.trim() && !line.startsWith('#'));
      
      dataLines.forEach(line => {
        expect(line).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})?\s+([\d.eE+-]+|Nan|NaN)/i);
      });
    });

    it('should include all defined metrics', async () => {
      const metricsText = await getMetricsText();
      
      const expectedMetrics = [
        'pare_request_duration_seconds',
        'pare_parse_duration_seconds',
        'pare_requests_total',
        'pare_parse_operations_total',
        'pare_circuit_breaker_trips_total',
        'pare_rate_limit_exceeded_total',
        'pare_security_blocks_total',
        'pare_active_workers',
        'pare_circuit_breaker_state',
        'pare_queue_depth',
      ];
      
      expectedMetrics.forEach(metric => {
        expect(metricsText).toContain(metric);
      });
    });

    it('should have no unbounded label values in output', async () => {
      recordRequestDuration('/random/user/path/12345', 999, 0.1);
      recordParseDuration('user_custom_parser', 1.0);
      recordSecurityBlock('user_defined_reason_abc123');
      
      const metricsText = await getMetricsText();
      
      expect(metricsText).not.toContain('user_custom_parser');
      expect(metricsText).not.toContain('user_defined_reason_abc123');
      expect(metricsText).not.toContain('/random/user/path/12345');
    });

    it('should include HELP and TYPE for all metrics', async () => {
      const metricsText = await getMetricsText();
      
      const metricNames = metricsText.match(/# TYPE (\w+)/g);
      expect(metricNames).not.toBeNull();
      expect(metricNames!.length).toBeGreaterThan(0);
      
      metricNames?.forEach(typeLine => {
        const metricName = typeLine.replace('# TYPE ', '').split(' ')[0];
        expect(metricsText).toContain(`# HELP ${metricName}`);
      });
    });

    it('getMetricsJson should return structured data', () => {
      const json = getMetricsJson() as { timestamp: string; metrics: unknown };
      
      expect(json).toHaveProperty('timestamp');
      expect(json).toHaveProperty('metrics');
      expect(json.metrics).toBeDefined();
    });

    it('should include default Node.js metrics with pare_ prefix', async () => {
      const metricsText = await getMetricsText();
      
      expect(metricsText).toContain('pare_process_');
      expect(metricsText).toContain('pare_nodejs_');
    });
  });

  describe('CardinalityGuard', () => {
    let guard: CardinalityGuard;

    beforeEach(() => {
      guard = new CardinalityGuard(10);
    });

    it('should track unique values per dimension', () => {
      guard.recordLabel('parser_type', 'pdf');
      guard.recordLabel('parser_type', 'xlsx');
      guard.recordLabel('parser_type', 'docx');
      
      expect(guard.getDimensionCardinality('parser_type')).toBe(3);
    });

    it('should not count duplicate values', () => {
      guard.recordLabel('parser_type', 'pdf');
      guard.recordLabel('parser_type', 'pdf');
      guard.recordLabel('parser_type', 'pdf');
      
      expect(guard.getDimensionCardinality('parser_type')).toBe(1);
    });

    it('should report health issues when cardinality too high', () => {
      const smallGuard = new CardinalityGuard(3);
      
      smallGuard.recordLabel('parser_type', 'pdf');
      smallGuard.recordLabel('parser_type', 'xlsx');
      smallGuard.recordLabel('parser_type', 'docx');
      
      const health = smallGuard.checkHealth();
      expect(health.issues.length).toBeGreaterThan(0);
      expect(health.issues.some(i => i.includes('parser_type'))).toBe(true);
    });

    it('should cap unbounded dimensions', () => {
      const tinyGuard = new CardinalityGuard(3);
      
      tinyGuard.recordLabel('parser_type', 'pdf');
      tinyGuard.recordLabel('parser_type', 'xlsx');
      tinyGuard.recordLabel('parser_type', 'docx');
      const result = tinyGuard.recordLabel('parser_type', 'pptx');
      
      expect(result).toBe('unknown');
      expect(tinyGuard.getDimensionCardinality('parser_type')).toBe(3);
    });

    it('should generate cardinality report', () => {
      guard.recordLabel('parser_type', 'pdf');
      guard.recordLabel('status_code_class', '2xx');
      
      const report = guard.getCardinalityReport();
      
      expect(report.timestamp).toBeDefined();
      expect(report.dimensions).toBeDefined();
      expect(report.totalUniqueLabels).toBeGreaterThan(0);
      expect(typeof report.healthy).toBe('boolean');
    });

    it('should return allowed values for dimension', () => {
      const allowedParsers = guard.getAllowedValues('parser_type');
      
      expect(allowedParsers).toContain('pdf');
      expect(allowedParsers).toContain('xlsx');
      expect(allowedParsers).toContain('unknown');
    });

    it('should reset all counters', () => {
      guard.recordLabel('parser_type', 'pdf');
      guard.recordLabel('parser_type', 'xlsx');
      expect(guard.getDimensionCardinality('parser_type')).toBe(2);
      
      guard.reset();
      
      expect(guard.getDimensionCardinality('parser_type')).toBe(0);
    });

    it('should validate labels against allowlist', () => {
      const result = guard.recordLabel('parser_type', 'invalid_type');
      
      expect(result).toBe('unknown');
    });

    it('should warn on unknown dimension', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      guard.recordLabel('unknown_dimension' as any, 'value');
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should track rejected labels due to overflow', () => {
      const tinyGuard = new CardinalityGuard(2);
      
      tinyGuard.recordLabel('parser_type', 'pdf');
      tinyGuard.recordLabel('parser_type', 'xlsx');
      tinyGuard.recordLabel('parser_type', 'docx');
      
      const health = tinyGuard.checkHealth();
      expect(health.issues.some(i => i.includes('rejected'))).toBe(true);
    });
  });

  describe('withCardinalityGuard helper', () => {
    beforeEach(() => {
      cardinalityGuard.reset();
    });

    it('should record and validate labels via global guard', () => {
      const result = withCardinalityGuard('parser_type', 'pdf');
      expect(result).toBe('pdf');
      
      const invalid = withCardinalityGuard('parser_type', 'invalid');
      expect(invalid).toBe('unknown');
    });
  });

  describe('createSafeLabels helper', () => {
    beforeEach(() => {
      cardinalityGuard.reset();
    });

    it('should normalize known label dimensions', () => {
      const labels = {
        parser_type: 'PDF',
        status_code_class: '200',
        custom_label: 'custom_value',
      };
      
      const safeLabels = createSafeLabels(labels);
      
      expect(safeLabels.parser_type).toBe('pdf');
      expect(safeLabels.custom_label).toBe('custom_value');
    });

    it('should preserve unknown label keys', () => {
      const labels = {
        unknown_key: 'some_value',
      };
      
      const safeLabels = createSafeLabels(labels);
      
      expect(safeLabels.unknown_key).toBe('some_value');
    });
  });

  describe('Internal Metrics Collector', () => {
    beforeEach(() => {
      pareMetrics.reset();
    });

    it('should record request duration', () => {
      pareMetrics.recordRequestDuration(100);
      pareMetrics.recordRequestDuration(200);
      pareMetrics.recordRequestDuration(150);
      
      const summary = getMetricsSummary();
      expect(summary.request_duration_ms.count).toBe(3);
      expect(summary.request_duration_ms.avg).toBe(150);
    });

    it('should record parse duration', () => {
      pareMetrics.recordParseDuration(50);
      pareMetrics.recordParseDuration(100);
      
      const summary = getMetricsSummary();
      expect(summary.parse_duration_ms.count).toBe(2);
    });

    it('should record file processing stats', () => {
      pareMetrics.recordFileProcessed(true);
      pareMetrics.recordFileProcessed(true);
      pareMetrics.recordFileProcessed(false);
      
      const summary = getMetricsSummary();
      expect(summary.files_processed.total).toBe(3);
      expect(summary.files_processed.success).toBe(2);
      expect(summary.files_processed.failed).toBe(1);
    });

    it('should record parser execution metrics', () => {
      pareMetrics.recordParserExecution('pdf', 100, true);
      pareMetrics.recordParserExecution('pdf', 150, true);
      pareMetrics.recordParserExecution('pdf', 200, false);
      
      const summary = getMetricsSummary();
      expect(summary.parsers.pdf).toBeDefined();
      expect(summary.parsers.pdf.success_count).toBe(2);
      expect(summary.parsers.pdf.failure_count).toBe(1);
    });

    it('should track uptime', () => {
      const summary = getMetricsSummary();
      expect(summary.uptime_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track memory usage', () => {
      const summary = getMetricsSummary();
      expect(summary.memory_usage_mb).toBeGreaterThan(0);
    });

    it('should calculate percentiles correctly', () => {
      for (let i = 1; i <= 100; i++) {
        pareMetrics.recordRequestDuration(i);
      }
      
      const summary = getMetricsSummary();
      expect(summary.request_duration_ms.p50).toBeCloseTo(50, 0);
      expect(summary.request_duration_ms.p95).toBeCloseTo(95, 0);
      expect(summary.request_duration_ms.p99).toBeCloseTo(99, 0);
    });
  });

  describe('Internal Histogram Class', () => {
    it('should handle empty histogram', () => {
      const histogram = new Histogram();
      const stats = histogram.getStats();
      
      expect(stats.count).toBe(0);
      expect(stats.avg).toBe(0);
      expect(stats.p50).toBe(0);
    });

    it('should limit stored values', () => {
      const smallHistogram = new Histogram(10);
      
      for (let i = 0; i < 20; i++) {
        smallHistogram.record(i);
      }
      
      const stats = smallHistogram.getStats();
      expect(stats.count).toBe(10);
    });

    it('should track min and max', () => {
      const histogram = new Histogram();
      histogram.record(5);
      histogram.record(10);
      histogram.record(3);
      
      const stats = histogram.getStats();
      expect(stats.min).toBe(3);
      expect(stats.max).toBe(10);
    });

    it('should reset correctly', () => {
      const histogram = new Histogram();
      histogram.record(100);
      histogram.record(200);
      histogram.reset();
      
      const stats = histogram.getStats();
      expect(stats.count).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
    });
  });

  describe('Internal Counter Class', () => {
    it('should increment by default amount', () => {
      const counter = new Counter();
      counter.increment();
      counter.increment();
      
      expect(counter.get()).toBe(2);
    });

    it('should increment by custom amount', () => {
      const counter = new Counter();
      counter.increment(5);
      counter.increment(3);
      
      expect(counter.get()).toBe(8);
    });

    it('should reset to zero', () => {
      const counter = new Counter();
      counter.increment(10);
      counter.reset();
      
      expect(counter.get()).toBe(0);
    });
  });

  describe('Gauge Safety', () => {
    it('setActiveWorkers should not accept negative values', async () => {
      setActiveWorkers(-5);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_active_workers 0');
    });

    it('setQueueDepth should not accept negative values', async () => {
      setQueueDepth(-10);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_queue_depth 0');
    });

    it('setActiveWorkers should floor decimal values', async () => {
      setActiveWorkers(5.7);
      
      const metricsText = await getMetricsText();
      expect(metricsText).toContain('pare_active_workers 5');
    });
  });

  describe('Label Allowlist Completeness', () => {
    it('all dimensions should have at least one fallback value', () => {
      expect(LABEL_ALLOWLISTS.parser_type).toContain('unknown');
      expect(LABEL_ALLOWLISTS.block_reason).toContain('other');
      expect(LABEL_ALLOWLISTS.endpoint).toContain('other');
    });

    it('status code classes should cover 2xx, 4xx, 5xx', () => {
      expect(LABEL_ALLOWLISTS.status_code_class).toContain('2xx');
      expect(LABEL_ALLOWLISTS.status_code_class).toContain('4xx');
      expect(LABEL_ALLOWLISTS.status_code_class).toContain('5xx');
    });

    it('circuit states should match standard patterns', () => {
      expect(LABEL_ALLOWLISTS.circuit_state).toContain('closed');
      expect(LABEL_ALLOWLISTS.circuit_state).toContain('half_open');
      expect(LABEL_ALLOWLISTS.circuit_state).toContain('open');
    });

    it('parser types should cover common document formats', () => {
      const formats = ['pdf', 'xlsx', 'docx', 'pptx', 'csv', 'txt'];
      formats.forEach(format => {
        expect(LABEL_ALLOWLISTS.parser_type).toContain(format);
      });
    });
  });
});
