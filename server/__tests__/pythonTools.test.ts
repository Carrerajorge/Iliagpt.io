import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PythonToolsClient, PythonToolsClientError } from '../lib/pythonToolsClient';

describe('Python Tools Integration', () => {
  let client: PythonToolsClient;
  const TEST_BASE_URL = process.env.PYTHON_TOOLS_API_URL || 'http://localhost:8001';
  
  beforeAll(() => {
    client = new PythonToolsClient(TEST_BASE_URL);
  });
  
  describe('Health Check', () => {
    it('should return healthy status when API is available', async () => {
      const isAvailable = await client.isAvailable();
      if (isAvailable) {
        const health = await client.health();
        expect(health.status).toBe('healthy');
        expect(typeof health.tools_count).toBe('number');
        expect(health.tools_count).toBeGreaterThan(0);
      } else {
        console.warn('Python Tools API not available, skipping health check test');
      }
    });
    
    it('should return false when API is unavailable', async () => {
      const unavailableClient = new PythonToolsClient('http://localhost:59999');
      const isAvailable = await unavailableClient.isAvailable();
      expect(isAvailable).toBe(false);
    });
    
    it('should expose correct base URL', () => {
      expect(client.getBaseUrl()).toBe(TEST_BASE_URL);
    });
  });
  
  describe('Tools API', () => {
    it('should list all tools', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      const tools = await client.listTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      const firstTool = tools[0];
      expect(firstTool).toHaveProperty('name');
      expect(firstTool).toHaveProperty('description');
      expect(firstTool).toHaveProperty('category');
      expect(firstTool).toHaveProperty('priority');
      expect(firstTool).toHaveProperty('dependencies');
    });
    
    it('should get tool by name', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      const tool = await client.getTool('shell');
      expect(tool.name).toBe('shell');
      expect(tool.category).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.priority).toBeDefined();
      expect(Array.isArray(tool.dependencies)).toBe(true);
    });
    
    it('should throw error for non-existent tool', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      await expect(client.getTool('non_existent_tool_xyz')).rejects.toThrow(PythonToolsClientError);
    });
    
    it('should execute shell tool successfully', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      const result = await client.executeTool('shell', {
        command: 'echo test'
      });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
    
    it('should handle tool execution errors gracefully', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      await expect(
        client.executeTool('non_existent_tool', { input: 'test' })
      ).rejects.toThrow(PythonToolsClientError);
    });
    
    it('should include metadata in tool execution response', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      const result = await client.executeTool('shell', {
        command: 'echo metadata_test'
      });
      expect(result).toHaveProperty('metadata');
      expect(typeof result.metadata).toBe('object');
    });
  });
  
  describe('Agents API', () => {
    it('should list all agents', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      const agents = await client.listAgents();
      expect(Array.isArray(agents)).toBe(true);
    });
    
    it('should get agent by name when agents exist', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      const agents = await client.listAgents();
      if (agents.length > 0) {
        const agent = await client.getAgent(agents[0].name);
        expect(agent.name).toBe(agents[0].name);
        expect(agent).toHaveProperty('description');
        expect(agent).toHaveProperty('category');
        expect(Array.isArray(agent.tools_used)).toBe(true);
      }
    });
    
    it('should throw error for non-existent agent', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      await expect(client.getAgent('non_existent_agent_xyz')).rejects.toThrow(PythonToolsClientError);
    });
  });
  
  describe('Error Handling', () => {
    it('should wrap errors in PythonToolsClientError', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      try {
        await client.getTool('definitely_not_a_real_tool');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(PythonToolsClientError);
        expect((error as PythonToolsClientError).statusCode).toBe(404);
      }
    });
    
    it('should include status code in error', async () => {
      const isAvailable = await client.isAvailable();
      if (!isAvailable) {
        console.warn('Python Tools API not available, skipping test');
        return;
      }
      
      try {
        await client.getTool('fake_tool');
      } catch (error) {
        if (error instanceof PythonToolsClientError) {
          expect(error.statusCode).toBeDefined();
          expect(typeof error.statusCode).toBe('number');
        }
      }
    });
  });
  
  describe('Client Configuration', () => {
    it('should use default base URL when not provided', () => {
      const defaultClient = new PythonToolsClient();
      expect(defaultClient.getBaseUrl()).toBe('http://localhost:8001');
    });
    
    it('should use custom base URL when provided', () => {
      const customClient = new PythonToolsClient('http://custom-api:9000');
      expect(customClient.getBaseUrl()).toBe('http://custom-api:9000');
    });

    it('should reject invalid base URL', () => {
      expect(() => new PythonToolsClient('ht!tp://invalid-url')).toThrow(/Invalid Python tool service URL|Python tool service URL is required/);
    });

    it('should reject invalid tool names without contacting remote service', async () => {
      await expect(client.getTool('invalid tool!')).rejects.toThrow(PythonToolsClientError);
      await expect(client.executeTool('invalid tool!', {})).rejects.toThrow(PythonToolsClientError);
      await expect(client.getAgent('invalid/agent')).rejects.toThrow(PythonToolsClientError);
    });

    it('should reject oversized agent tasks before remote execution', async () => {
      const oversizedTask = "x".repeat(4_500);
      await expect(client.executeAgent("assistant", oversizedTask)).rejects.toThrow(PythonToolsClientError);
    });
  });
});
