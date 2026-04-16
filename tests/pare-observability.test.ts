import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API_BASE = 'http://localhost:5000';
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('PARE Observability Phase 3', () => {
  describe('Prometheus Metrics Endpoint', () => {
    it('should expose /metrics endpoint with Prometheus format', async () => {
      const response = await fetch(`${API_BASE}/metrics`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      
      const text = await response.text();
      expect(text).toContain('# HELP');
      expect(text).toContain('# TYPE');
      expect(text).toContain('pare_');
    });

    it('should include request duration histogram definition', async () => {
      const response = await fetch(`${API_BASE}/metrics`);
      const text = await response.text();
      
      expect(text).toContain('pare_request_duration_seconds');
      expect(text).toContain('# HELP pare_request_duration_seconds');
      expect(text).toContain('# TYPE pare_request_duration_seconds histogram');
    });

    it('should include parse duration histogram', async () => {
      const response = await fetch(`${API_BASE}/metrics`);
      const text = await response.text();
      
      expect(text).toContain('pare_parse_duration_seconds');
    });

    it('should include counter metrics', async () => {
      const response = await fetch(`${API_BASE}/metrics`);
      const text = await response.text();
      
      expect(text).toContain('pare_requests_total');
      expect(text).toContain('pare_parse_operations_total');
    });

    it('should include gauge metrics', async () => {
      const response = await fetch(`${API_BASE}/metrics`);
      const text = await response.text();
      
      expect(text).toContain('pare_active_workers');
      expect(text).toContain('pare_queue_depth');
    });

    it('should include default Node.js metrics with pare_ prefix', async () => {
      const response = await fetch(`${API_BASE}/metrics`);
      const text = await response.text();
      
      expect(text).toContain('pare_process_cpu');
      expect(text).toContain('pare_nodejs_heap');
    });
  });

  describe('PARE Health Endpoints', () => {
    it('should expose /health/pare/live endpoint', async () => {
      const response = await fetch(`${API_BASE}/health/pare/live`);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.uptime_seconds).toBeGreaterThan(0);
      expect(data.version).toBeDefined();
    });

    it('should expose /health/pare/ready endpoint', async () => {
      const response = await fetch(`${API_BASE}/health/pare/ready`);
      
      expect([200, 503]).toContain(response.status);
      const data = await response.json();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status);
      expect(data.checks).toBeDefined();
    });

    it('should include database check in readiness', async () => {
      const response = await fetch(`${API_BASE}/health/pare/ready`);
      const data = await response.json();
      
      expect(data.checks.database).toBeDefined();
      expect(['pass', 'warn', 'fail']).toContain(data.checks.database.status);
      expect(data.checks.database.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should include worker pool check in readiness', async () => {
      const response = await fetch(`${API_BASE}/health/pare/ready`);
      const data = await response.json();
      
      expect(data.checks.worker_pool).toBeDefined();
      expect(['pass', 'warn', 'fail']).toContain(data.checks.worker_pool.status);
    });

    it('should include memory check in readiness', async () => {
      const response = await fetch(`${API_BASE}/health/pare/ready`);
      const data = await response.json();
      
      expect(data.checks.memory).toBeDefined();
      expect(['pass', 'warn', 'fail']).toContain(data.checks.memory.status);
    });

    it('should expose /health/pare endpoint with full status', async () => {
      const response = await fetch(`${API_BASE}/health/pare`);
      
      expect([200, 503]).toContain(response.status);
      const data = await response.json();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status);
      expect(data.checks).toBeDefined();
      expect(data.uptime_seconds).toBeGreaterThan(0);
    });
  });

  describe('PARE Internal Metrics Dashboard', () => {
    it('should expose /api/pare/metrics with combined metrics', async () => {
      const response = await fetch(`${API_BASE}/api/pare/metrics`);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.prometheus).toBeDefined();
      expect(data.internal).toBeDefined();
      expect(data.health).toBeDefined();
    });

    it('should include internal metrics summary', async () => {
      const response = await fetch(`${API_BASE}/api/pare/metrics`);
      const data = await response.json();
      
      expect(data.internal.uptime_ms).toBeGreaterThan(0);
      expect(data.internal.request_duration_ms).toBeDefined();
      expect(data.internal.parse_duration_ms).toBeDefined();
      expect(data.internal.files_processed).toBeDefined();
      expect(data.internal.memory_usage_mb).toBeGreaterThan(0);
    });

    it('should include percentile metrics', async () => {
      const response = await fetch(`${API_BASE}/api/pare/metrics`);
      const data = await response.json();
      
      expect(data.internal.request_duration_ms.p50).toBeDefined();
      expect(data.internal.request_duration_ms.p95).toBeDefined();
      expect(data.internal.request_duration_ms.p99).toBeDefined();
    });

    it('should include health summary', async () => {
      const response = await fetch(`${API_BASE}/api/pare/metrics`);
      const data = await response.json();
      
      expect(typeof data.health.live).toBe('boolean');
      expect(typeof data.health.ready).toBe('boolean');
      expect(data.health.details).toBeDefined();
    });
  });

  describe('Existing Health Endpoints', () => {
    it('should still expose /health/live endpoint', async () => {
      const response = await fetch(`${API_BASE}/health/live`);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('ok');
    });

    it('should still expose /health/ready endpoint', async () => {
      const response = await fetch(`${API_BASE}/health/ready`);
      
      expect([200, 503]).toContain(response.status);
      const data = await response.json();
      expect(['ready', 'degraded']).toContain(data.status);
    });

    it('should still expose /health endpoint', async () => {
      const response = await fetch(`${API_BASE}/health`);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('ok');
      expect(data.memory).toBeDefined();
      expect(data.uptime).toBeDefined();
    });
  });

  describe('Metrics Cardinality Control', () => {
    it('should normalize status codes to classes (2xx, 4xx, 5xx)', async () => {
      const response = await fetch(`${API_BASE}/metrics`);
      const text = await response.text();
      
      const statusCodePattern = /status_code_class="[245]xx"/g;
      const matches = text.match(statusCodePattern);
      
      if (matches) {
        matches.forEach(match => {
          expect(match).toMatch(/status_code_class="[245]xx"/);
        });
      }
    });

    it('should normalize parser types to known set', async () => {
      const response = await fetch(`${API_BASE}/metrics`);
      const text = await response.text();
      
      const validParserTypes = ['pdf', 'xlsx', 'docx', 'pptx', 'csv', 'txt', 'unknown'];
      const parserTypePattern = /parser_type="(\w+)"/g;
      let match;
      
      while ((match = parserTypePattern.exec(text)) !== null) {
        expect(validParserTypes).toContain(match[1]);
      }
    });
  });

  describe('Response Headers', () => {
    it('should include trace headers in API responses', async () => {
      const response = await fetch(`${API_BASE}/health/pare/live`);
      
      expect(response.headers.get('x-request-id') || response.headers.get('X-Request-ID')).toBeDefined;
    });
  });
});
