import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.AGENTIC_TEST_URL || 'http://localhost:5000';

/**
 * These are integration tests that require a running server with a database
 * and authenticated agentic routes.
 * Set AGENTIC_INTEGRATION_TESTS=1 to enable.
 */
const serverAvailable = !!process.env.AGENTIC_INTEGRATION_TESTS;

describe.skipIf(!serverAvailable)('CompressedMemory API', () => {
  describe('POST /api/agentic/memory/atoms', () => {
    it('should create a new memory atom', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/memory/atoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'intent',
          data: { action: 'test', target: 'memory' }
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('type');
      expect(data.type).toBe('intent');
      expect(data).toHaveProperty('signature');
      expect(data).toHaveProperty('weight');
      expect(data.weight).toBeGreaterThanOrEqual(1);
    });

    it('should increment weight for duplicate atoms', async () => {
      const atomData = { type: 'pattern', data: { pattern: 'duplicate-test-' + Date.now() } };

      const first = await fetch(`${BASE_URL}/api/agentic/memory/atoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(atomData)
      });
      const firstAtom = await first.json();

      const second = await fetch(`${BASE_URL}/api/agentic/memory/atoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(atomData)
      });
      const secondAtom = await second.json();

      expect(secondAtom.id).toBe(firstAtom.id);
      expect(secondAtom.weight).toBeGreaterThanOrEqual(firstAtom.weight);
    });

    it('should create atoms with different types', async () => {
      const types = ['intent', 'pattern', 'correction', 'preference', 'outcome'];

      for (const type of types) {
        const response = await fetch(`${BASE_URL}/api/agentic/memory/atoms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            data: { test: `type-${type}-${Date.now()}` }
          })
        });

        expect(response.ok).toBe(true);
        const data = await response.json();
        expect(data.type).toBe(type);
      }
    });
  });

  describe('GET /api/agentic/memory/atoms/:id', () => {
    it('should retrieve an atom by ID', async () => {
      const createResponse = await fetch(`${BASE_URL}/api/agentic/memory/atoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'preference',
          data: { preference: 'retrieve-test-' + Date.now() }
        })
      });
      const created = await createResponse.json();

      const response = await fetch(`${BASE_URL}/api/agentic/memory/atoms/${created.id}`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.id).toBe(created.id);
    });

    it('should return 404 for non-existent atom', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/memory/atoms/nonexistent123`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/agentic/memory/atoms/type/:type', () => {
    it('should return atoms filtered by type', async () => {
      await fetch(`${BASE_URL}/api/agentic/memory/atoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'correction',
          data: { correction: 'filter-test-' + Date.now() }
        })
      });

      const response = await fetch(`${BASE_URL}/api/agentic/memory/atoms/type/correction`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((atom: any) => {
        expect(atom.type).toBe('correction');
      });
    });
  });

  describe('GET /api/agentic/memory/stats', () => {
    it('should return memory statistics', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/memory/stats`);

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('totalAtoms');
      expect(data).toHaveProperty('storageBytes');
      expect(data).toHaveProperty('avgWeight');
      expect(data).toHaveProperty('byType');
      expect(typeof data.totalAtoms).toBe('number');
    });
  });

  describe('POST /api/agentic/memory/decay', () => {
    it('should apply decay to memory atoms', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/memory/decay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('decayedCount');
      expect(typeof data.decayedCount).toBe('number');
    });
  });

  describe('POST /api/agentic/memory/gc', () => {
    it('should run garbage collection', async () => {
      const response = await fetch(`${BASE_URL}/api/agentic/memory/gc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minWeight: 0.1 })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('removedCount');
      expect(typeof data.removedCount).toBe('number');
    });
  });
});
