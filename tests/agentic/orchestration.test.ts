import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.AGENTIC_TEST_URL || 'http://localhost:5000';

/**
 * These are integration tests that require a running server with a database
 * and authenticated agentic routes.
 * Set AGENTIC_INTEGRATION_TESTS=1 to enable.
 */
const serverAvailable = !!process.env.AGENTIC_INTEGRATION_TESTS;

describe.skipIf(!serverAvailable)('OrchestrationEngine API', () => {
  describe('POST /api/agentic/orchestrate', () => {
    it('should decompose a user-related task', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'list all users',
          complexity: 3
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('subtasks');
      expect(Array.isArray(data.subtasks)).toBe(true);
    });

    it('should decompose a report-related task', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'generate a report for analytics',
          complexity: 5
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('subtasks');
      expect(data.subtasks.some((t: any) => t.id.includes('report'))).toBe(true);
    });

    it('should decompose security-related tasks', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'check security status',
          complexity: 4
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('subtasks');
    });

    it('should return execution plan', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'create user and generate report',
          complexity: 6
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('plan');
      expect(data.plan).toHaveProperty('waves');
      expect(data.plan).toHaveProperty('totalEstimatedTime');
      expect(data.plan).toHaveProperty('maxParallelism');
    });
  });

  describe('POST /api/agentic/orchestrate/execute', () => {
    it('should execute an orchestration plan', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/orchestrate/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'get dashboard metrics',
          complexity: 3
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('result');
      expect(data.result).toHaveProperty('success');
      expect(data.result).toHaveProperty('completedTasks');
      expect(data.result).toHaveProperty('executionTimeMs');
    });

    it('should handle multi-task orchestration', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/orchestrate/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'list users and check security and get analytics dashboard',
          complexity: 7
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.result.completedTasks).toBeGreaterThan(0);
    });

    it('should return combined results', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/orchestrate/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'analyze user data',
          complexity: 4
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('combined');
      expect(data.combined).toHaveProperty('success');
      expect(data.combined).toHaveProperty('summary');
    });
  });

  describe('GET /api/agentic/orchestrate/status', () => {
    it('should return orchestration engine status', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/orchestrate/status`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('maxConcurrent');
    });
  });
});
