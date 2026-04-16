import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:5050';

describe('ComplexityAnalyzer API', () => {
  describe('POST /api/agentic/analyze-complexity', () => {
    it('should analyze trivial prompts correctly', async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hola' })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('complexity_score');
      expect(data).toHaveProperty('category');
      expect(data.category).toBe('trivial');
      expect(data.recommended_path).toBe('fast');
    });

    it('should detect simple prompts', async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'what is a variable?' })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('complexity_score');
      expect(data).toHaveProperty('category');
      expect(['trivial', 'simple']).toContain(data.category);
    });

    it('should detect complex prompts with technical terms', async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: 'implement a jwt authentication system with oauth integration and database security' 
        })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('complexity_score');
      expect(data.complexity_score).toBeGreaterThanOrEqual(6);
      expect(['complex', 'architectural']).toContain(data.category);
    });

    it('should detect architectural prompts', async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: 'design a microservice architecture with kubernetes and high availability for enterprise scale' 
        })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('complexity_score');
      expect(data.complexity_score).toBeGreaterThanOrEqual(8);
      expect(data.category).toBe('architectural');
      expect(data.recommended_path).toBe('architect');
    });

    it('should return dimensions in the analysis', async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'explain how async await works in javascript' })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('dimensions');
      expect(data.dimensions).toHaveProperty('cognitive_load');
      expect(data.dimensions).toHaveProperty('domain_breadth');
      expect(data.dimensions).toHaveProperty('steps_required');
      expect(data.dimensions).toHaveProperty('ambiguity_level');
      expect(data.dimensions).toHaveProperty('technical_depth');
    });

    it('should return estimated tokens', async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'create a user registration form' })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('estimated_tokens');
      expect(typeof data.estimated_tokens).toBe('number');
      expect(data.estimated_tokens).toBeGreaterThan(0);
    });

    it('should return signals for complex requests', async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: 'design and implement a distributed caching system with redis and load balancing' 
        })
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('signals');
      expect(Array.isArray(data.signals)).toBe(true);
    });

    it('should handle empty prompt gracefully', async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '' })
      });
      
      const data = await response.json();
      expect(data).toHaveProperty('category');
      expect(data.category).toBe('trivial');
    });
  });
});
