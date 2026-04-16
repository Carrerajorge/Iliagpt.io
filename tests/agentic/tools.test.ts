import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.AGENTIC_TEST_URL || 'http://localhost:5000';

/**
 * These are integration tests that require a running server with a database
 * and authenticated agentic routes.
 * Set AGENTIC_INTEGRATION_TESTS=1 to enable.
 */
const serverAvailable = !!process.env.AGENTIC_INTEGRATION_TESTS;

describe.skipIf(!serverAvailable)('ToolRegistry API', () => {
  describe('GET /api/agentic/tools', () => {
    it('should return list of all tools', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should return tools with required properties', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      const tool = data[0];

      expect(tool).toHaveProperty('id');
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('category');
      expect(tool).toHaveProperty('endpoint');
      expect(tool).toHaveProperty('method');
      expect(tool).toHaveProperty('isEnabled');
    });
  });

  describe('GET /api/agentic/tools/:id', () => {
    it('should return a specific tool by ID', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/list_users`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.id).toBe('list_users');
      expect(data.category).toBe('users');
    });

    it('should return 404 for non-existent tool', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/non_existent_tool`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/agentic/tools/category/:category', () => {
    it('should return tools filtered by category', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/category/users`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((tool: any) => {
        expect(tool.category).toBe('users');
      });
    });

    it('should return tools for payments category', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/category/payments`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.length).toBeGreaterThan(0);
    });

    it('should return tools for security category', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/category/security`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/agentic/tools/search', () => {
    it('should search tools by capability keyword', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/search?q=create`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should return empty array for non-matching search', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/search?q=xyznonexistent`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('GET /api/agentic/tools/stats', () => {
    it('should return tool registry statistics', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/stats`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('totalTools');
      expect(data).toHaveProperty('enabledTools');
      expect(data).toHaveProperty('byCategory');
      expect(typeof data.totalTools).toBe('number');
    });
  });

  describe('POST /api/agentic/tools/:id/execute', () => {
    it('should execute a tool and record usage', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/tools/list_users/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: {} })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('success');
    });
  });

  describe('PATCH /api/agentic/tools/:id/toggle', () => {
    it('should toggle tool enabled status', async () => {
      const getResponse = await fetch(`${BASE_URL}/api/agentic/tools/list_users`);
      const initialTool = await getResponse.json();

      const response = await fetch(`${BASE_URL}/api/agentic/tools/list_users/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.isEnabled).toBe(!initialTool.isEnabled);

      await fetch(`${BASE_URL}/api/agentic/tools/list_users/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      });
    });
  });
});
