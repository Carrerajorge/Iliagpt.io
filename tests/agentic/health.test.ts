import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:5050';

describe('Health Endpoints', () => {
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${BASE_URL}/api/health`);
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data.status).toBe('ok');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('node');
      expect(data).toHaveProperty('memory');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('timestamp');
    });

    it('should return memory statistics', async () => {
      const response = await fetch(`${BASE_URL}/api/health`);
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.memory).toHaveProperty('heapUsed');
      expect(data.memory).toHaveProperty('heapTotal');
      expect(data.memory).toHaveProperty('rss');
    });

    it('should return valid timestamp', async () => {
      const response = await fetch(`${BASE_URL}/api/health`);
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      const timestamp = new Date(data.timestamp);
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
      expect(timestamp.getTime()).toBeGreaterThan(Date.now() - 60000);
    });
  });

  describe('GET /api/health/live', () => {
    it('should return liveness status', async () => {
      const response = await fetch(`${BASE_URL}/api/health/live`);
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data.status).toBe('ok');
      expect(data).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/health/ready', () => {
    it('should return readiness status', async () => {
      const response = await fetch(`${BASE_URL}/api/health/ready`);
      
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(['ready', 'degraded']).toContain(data.status);
      expect(data).toHaveProperty('checks');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('timestamp');
    });

    it('should return health checks', async () => {
      const response = await fetch(`${BASE_URL}/api/health/ready`);
      
      const data = await response.json();
      expect(data.checks).toHaveProperty('database');
      expect(data.checks).toHaveProperty('memory');
      expect(data.checks).toHaveProperty('uptime');
    });

    it('should return proper status codes', async () => {
      const response = await fetch(`${BASE_URL}/api/health/ready`);
      
      const data = await response.json();
      if (data.status === 'ready') {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(503);
      }
    });
  });

  describe('Response times', () => {
    it('should respond quickly to liveness check', async () => {
      const start = Date.now();
      await fetch(`${BASE_URL}/api/health/live`);
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(1000);
    });

    it('should respond within reasonable time to health check', async () => {
      const start = Date.now();
      await fetch(`${BASE_URL}/api/health`);
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(2000);
    });
  });
});
