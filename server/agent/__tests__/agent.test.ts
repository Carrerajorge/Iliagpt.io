import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { 
  RunStateMachine, 
  StepStateMachine, 
  StateMachineError,
  validateRunTransition,
  validateStepTransition
} from '../stateMachine';
import { ToolRegistry, type ToolDefinition, type ToolContext, type ToolResult } from '../toolRegistry';
import { PolicyEngine, type PolicyContext, type ToolPolicy } from '../policyEngine';
import { metricsCollector, type StepMetrics } from '../metricsCollector';

describe('RunStateMachine', () => {
  let machine: RunStateMachine;

  beforeEach(() => {
    machine = new RunStateMachine('test-run-id');
  });

  describe('initialization', () => {
    it('should initialize with queued status by default', () => {
      expect(machine.getStatus()).toBe('queued');
    });

    it('should initialize with custom status', () => {
      const customMachine = new RunStateMachine('run-2', 'planning');
      expect(customMachine.getStatus()).toBe('planning');
    });

    it('should have initial history entry', () => {
      const history = machine.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].reason).toBe('initialization');
    });
  });

  describe('valid transitions', () => {
    it('should transition queued → planning', () => {
      machine.transition('planning');
      expect(machine.getStatus()).toBe('planning');
    });

    it('should transition planning → running', () => {
      machine.transition('planning');
      machine.transition('running');
      expect(machine.getStatus()).toBe('running');
    });

    it('should transition running → verifying', () => {
      machine.transition('planning');
      machine.transition('running');
      machine.transition('verifying');
      expect(machine.getStatus()).toBe('verifying');
    });

    it('should transition verifying → completed', () => {
      machine.transition('planning');
      machine.transition('running');
      machine.transition('verifying');
      machine.transition('completed');
      expect(machine.getStatus()).toBe('completed');
    });

    it('should complete full happy path: queued → planning → running → verifying → completed', () => {
      machine.transition('planning', 'start planning');
      machine.transition('running', 'execute steps');
      machine.transition('verifying', 'verify results');
      machine.transition('completed', 'all done');
      
      expect(machine.getStatus()).toBe('completed');
      const history = machine.getHistory();
      expect(history).toHaveLength(5);
    });

    it('should transition running → paused → running', () => {
      machine.transition('planning');
      machine.transition('running');
      machine.transition('paused');
      expect(machine.getStatus()).toBe('paused');
      machine.transition('running');
      expect(machine.getStatus()).toBe('running');
    });

    it('should transition failed → queued (retry)', () => {
      machine.transition('planning');
      machine.transition('failed');
      expect(machine.getStatus()).toBe('failed');
      machine.transition('queued');
      expect(machine.getStatus()).toBe('queued');
    });
  });

  describe('invalid transitions', () => {
    it('should throw StateMachineError for queued → completed', () => {
      expect(() => machine.transition('completed')).toThrow(StateMachineError);
    });

    it('should throw StateMachineError for queued → running', () => {
      expect(() => machine.transition('running')).toThrow(StateMachineError);
    });

    it('should throw StateMachineError for completed → any state', () => {
      machine.transition('planning');
      machine.transition('running');
      machine.transition('verifying');
      machine.transition('completed');
      
      expect(() => machine.transition('running')).toThrow(StateMachineError);
      expect(() => machine.transition('queued')).toThrow(StateMachineError);
    });

    it('should include entity info in error', () => {
      try {
        machine.transition('completed');
      } catch (e) {
        expect(e).toBeInstanceOf(StateMachineError);
        const error = e as StateMachineError;
        expect(error.entityType).toBe('run');
        expect(error.entityId).toBe('test-run-id');
        expect(error.currentStatus).toBe('queued');
        expect(error.targetStatus).toBe('completed');
      }
    });
  });

  describe('canTransitionTo', () => {
    it('should return true for valid transitions', () => {
      expect(machine.canTransitionTo('planning')).toBe(true);
      expect(machine.canTransitionTo('cancelled')).toBe(true);
      expect(machine.canTransitionTo('failed')).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(machine.canTransitionTo('running')).toBe(false);
      expect(machine.canTransitionTo('completed')).toBe(false);
      expect(machine.canTransitionTo('verifying')).toBe(false);
    });
  });

  describe('getValidTransitions', () => {
    it('should return valid transitions from queued', () => {
      const transitions = machine.getValidTransitions();
      expect(transitions).toContain('planning');
      expect(transitions).toContain('cancelled');
      expect(transitions).toContain('failed');
      expect(transitions).not.toContain('running');
    });
  });

  describe('isTerminal', () => {
    it('should return false for active states', () => {
      expect(machine.isTerminal()).toBe(false);
      machine.transition('planning');
      expect(machine.isTerminal()).toBe(false);
    });

    it('should return true for terminal states', () => {
      machine.transition('planning');
      machine.transition('running');
      machine.transition('verifying');
      machine.transition('completed');
      expect(machine.isTerminal()).toBe(true);
    });
  });

  describe('isActive', () => {
    it('should return true for active states', () => {
      expect(machine.isActive()).toBe(true);
      machine.transition('planning');
      expect(machine.isActive()).toBe(true);
    });

    it('should return false for terminal states', () => {
      machine.transition('planning');
      machine.transition('failed');
      expect(machine.isActive()).toBe(false);
    });
  });

  describe('validateRunTransition', () => {
    it('should validate transitions correctly', () => {
      expect(validateRunTransition('queued', 'planning')).toBe(true);
      expect(validateRunTransition('queued', 'completed')).toBe(false);
      expect(validateRunTransition('running', 'verifying')).toBe(true);
    });
  });
});

describe('StepStateMachine', () => {
  let machine: StepStateMachine;

  beforeEach(() => {
    machine = new StepStateMachine('test-step-id');
  });

  describe('initialization', () => {
    it('should initialize with pending status by default', () => {
      expect(machine.getStatus()).toBe('pending');
    });

    it('should initialize with custom status and max retries', () => {
      const customMachine = new StepStateMachine('step-2', 'running', 5);
      expect(customMachine.getStatus()).toBe('running');
    });
  });

  describe('valid transitions', () => {
    it('should transition pending → running', () => {
      machine.transition('running');
      expect(machine.getStatus()).toBe('running');
    });

    it('should transition running → succeeded', () => {
      machine.transition('running');
      machine.transition('succeeded');
      expect(machine.getStatus()).toBe('succeeded');
    });

    it('should transition running → verifying → succeeded', () => {
      machine.transition('running');
      machine.transition('verifying');
      machine.transition('succeeded');
      expect(machine.getStatus()).toBe('succeeded');
    });

    it('should transition pending → skipped', () => {
      machine.transition('skipped');
      expect(machine.getStatus()).toBe('skipped');
    });

    it('should transition running → failed → running (retry)', () => {
      machine.transition('running');
      machine.transition('failed');
      expect(machine.getRetryCount()).toBe(0);
      machine.transition('running');
      expect(machine.getRetryCount()).toBe(1);
      expect(machine.getStatus()).toBe('running');
    });
  });

  describe('invalid transitions', () => {
    it('should throw for pending → succeeded', () => {
      expect(() => machine.transition('succeeded')).toThrow(StateMachineError);
    });

    it('should throw for succeeded → any state', () => {
      machine.transition('running');
      machine.transition('succeeded');
      expect(() => machine.transition('running')).toThrow(StateMachineError);
    });
  });

  describe('retry logic', () => {
    it('should track retry count', () => {
      machine.transition('running');
      machine.transition('failed');
      expect(machine.getRetryCount()).toBe(0);
      expect(machine.canRetry()).toBe(true);
      
      machine.transition('running');
      expect(machine.getRetryCount()).toBe(1);
    });

    it('should respect max retries', () => {
      const limitedMachine = new StepStateMachine('step', 'pending', 2);
      
      limitedMachine.transition('running');
      limitedMachine.transition('failed');
      limitedMachine.transition('running');
      limitedMachine.transition('failed');
      expect(limitedMachine.canRetry()).toBe(true);
      
      limitedMachine.transition('running');
      limitedMachine.transition('failed');
      expect(limitedMachine.canRetry()).toBe(false);
    });

    it('should not allow retry when not failed', () => {
      machine.transition('running');
      expect(machine.canRetry()).toBe(false);
    });
  });

  describe('canTransitionTo', () => {
    it('should return correct values for pending state', () => {
      expect(machine.canTransitionTo('running')).toBe(true);
      expect(machine.canTransitionTo('skipped')).toBe(true);
      expect(machine.canTransitionTo('cancelled')).toBe(true);
      expect(machine.canTransitionTo('succeeded')).toBe(false);
    });
  });

  describe('isTerminal and isActive', () => {
    it('should correctly identify terminal states', () => {
      expect(machine.isTerminal()).toBe(false);
      machine.transition('running');
      expect(machine.isTerminal()).toBe(false);
      machine.transition('succeeded');
      expect(machine.isTerminal()).toBe(true);
    });

    it('should correctly identify active states', () => {
      expect(machine.isActive()).toBe(false);
      machine.transition('running');
      expect(machine.isActive()).toBe(true);
      machine.transition('verifying');
      expect(machine.isActive()).toBe(true);
    });
  });

  describe('validateStepTransition', () => {
    it('should validate transitions correctly', () => {
      expect(validateStepTransition('pending', 'running')).toBe(true);
      expect(validateStepTransition('pending', 'succeeded')).toBe(false);
      expect(validateStepTransition('running', 'succeeded')).toBe(true);
    });
  });
});

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  const mockTool: ToolDefinition = {
    name: 'mock_tool',
    description: 'A mock tool for testing',
    inputSchema: z.object({
      message: z.string(),
    }),
    capabilities: ['produces_artifacts'],
    execute: async (input, context): Promise<ToolResult> => {
      return {
        success: true,
        output: { echo: input.message },
        artifacts: [{
          id: 'artifact-1',
          type: 'data',
          name: 'result',
          data: input.message,
          createdAt: new Date(),
        }],
        previews: [{
          type: 'text',
          content: input.message,
          title: 'Preview',
        }],
        logs: [{
          level: 'info',
          message: 'Tool executed',
          timestamp: new Date(),
        }],
        metrics: {
          durationMs: 10,
          tokensUsed: 100,
        },
      };
    },
  };

  const failingTool: ToolDefinition = {
    name: 'failing_tool',
    description: 'A tool that fails',
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResult> => {
      throw new Error('Tool execution failed');
    },
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    metricsCollector.clear();
  });

  describe('registration and retrieval', () => {
    it('should register a tool', () => {
      registry.register(mockTool);
      expect(registry.get('mock_tool')).toBeDefined();
    });

    it('should retrieve registered tool', () => {
      registry.register(mockTool);
      const tool = registry.get('mock_tool');
      expect(tool?.name).toBe('mock_tool');
      expect(tool?.description).toBe('A mock tool for testing');
    });

    it('should return undefined for unknown tool', () => {
      expect(registry.get('unknown_tool')).toBeUndefined();
    });

    it('should list all registered tools', () => {
      registry.register(mockTool);
      registry.register(failingTool);
      const tools = registry.list();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('mock_tool');
      expect(tools.map(t => t.name)).toContain('failing_tool');
    });

    it('should overwrite existing tool with same name', () => {
      registry.register(mockTool);
      const updatedTool = { ...mockTool, description: 'Updated description' };
      registry.register(updatedTool);
      expect(registry.get('mock_tool')?.description).toBe('Updated description');
    });
  });

  describe('execute', () => {
    const context: ToolContext = {
      userId: 'user-1',
      chatId: 'chat-1',
      runId: 'run-1',
      userPlan: 'admin',
    };

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('unknown_tool', {}, context);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_NOT_FOUND');
      expect(result.artifacts).toEqual([]);
      expect(result.previews).toEqual([]);
      expect(result.logs).toBeDefined();
      expect(result.metrics).toBeDefined();
    });

    it('should return standardized output with all fields', async () => {
      registry.register(mockTool);
      
      const result = await registry.execute('mock_tool', { message: 'test' }, context);
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('previews');
      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('metrics');
      expect(Array.isArray(result.artifacts)).toBe(true);
      expect(Array.isArray(result.previews)).toBe(true);
      expect(Array.isArray(result.logs)).toBe(true);
    });

    it('should return error for invalid input', async () => {
      registry.register(mockTool);
      
      const result = await registry.execute('mock_tool', { invalidField: 123 }, context);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');
    });
  });

  describe('createArtifact', () => {
    it('should create artifact with correct structure', () => {
      const artifact = registry.createArtifact('file', 'test.txt', 'content', 'text/plain');
      
      expect(artifact.id).toBeDefined();
      expect(artifact.type).toBe('file');
      expect(artifact.name).toBe('test.txt');
      expect(artifact.data).toBe('content');
      expect(artifact.mimeType).toBe('text/plain');
      expect(artifact.createdAt).toBeInstanceOf(Date);
    });
  });
});

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
    engine.clearRateLimits();
  });

  describe('checkAccess for different user plans', () => {
    it('should allow free plan to access analyze_spreadsheet', () => {
      const result = engine.checkAccess({
        userId: 'user-1',
        userPlan: 'free',
        toolName: 'analyze_spreadsheet',
      });
      
      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('should allow free plan to access generate_image', () => {
      const result = engine.checkAccess({
        userId: 'user-1',
        userPlan: 'free',
        toolName: 'generate_image',
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow pro plan to access generate_image', () => {
      const result = engine.checkAccess({
        userId: 'user-1',
        userPlan: 'pro',
        toolName: 'generate_image',
      });
      
      expect(result.allowed).toBe(true);
    });

    it('should allow admin to access all tools', () => {
      const result = engine.checkAccess({
        userId: 'user-1',
        userPlan: 'admin',
        toolName: 'execute_code',
        isConfirmed: true,
      });
      
      expect(result.allowed).toBe(true);
    });

    it('should allow high-risk tools without confirmation when policy does not require it', () => {
      const result = engine.checkAccess({
        userId: 'user-1',
        userPlan: 'admin',
        toolName: 'execute_code',
        isConfirmed: false,
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('should allow access by default when tool policy not found', () => {
      const result = engine.checkAccess({
        userId: 'user-1',
        userPlan: 'admin',
        toolName: 'nonexistent_tool',
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('No explicit policy');
    });
  });

  describe('rate limiting', () => {
    it('should track rate limit calls with incrementRateLimit', () => {
      engine.registerPolicy({
        toolName: 'rate_limited_tool',
        capabilities: [],
        allowedPlans: ['free', 'pro', 'admin'],
        requiresConfirmation: false,
        maxExecutionTimeMs: 30000,
        maxRetries: 1,
        rateLimit: {
          maxCalls: 3,
          windowMs: 60000,
        },
        deniedByDefault: false,
      });

      const context: PolicyContext = {
        userId: 'user-1',
        userPlan: 'free',
        toolName: 'rate_limited_tool',
      };

      expect(engine.checkAccess(context).allowed).toBe(true);
      engine.incrementRateLimit(context);
      expect(engine.checkAccess(context).allowed).toBe(true);
      engine.incrementRateLimit(context);
      expect(engine.checkAccess(context).allowed).toBe(true);
      engine.incrementRateLimit(context);
      
      const result = engine.checkAccess(context);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
    });

    it('should clear rate limits', () => {
      engine.registerPolicy({
        toolName: 'rate_limited_tool',
        capabilities: [],
        allowedPlans: ['free', 'pro', 'admin'],
        requiresConfirmation: false,
        maxExecutionTimeMs: 30000,
        maxRetries: 1,
        rateLimit: {
          maxCalls: 1,
          windowMs: 60000,
        },
        deniedByDefault: false,
      });

      const context: PolicyContext = {
        userId: 'user-1',
        userPlan: 'free',
        toolName: 'rate_limited_tool',
      };

      engine.checkAccess(context);
      engine.incrementRateLimit(context);
      expect(engine.checkAccess(context).allowed).toBe(false);
      
      engine.clearRateLimits();
      expect(engine.checkAccess(context).allowed).toBe(true);
    });
  });

  describe('getPolicy', () => {
    it('should return policy for registered tool', () => {
      const policy = engine.getPolicy('web_search');
      expect(policy).toBeDefined();
      expect(policy?.toolName).toBe('web_search');
    });

    it('should return undefined for unregistered tool', () => {
      expect(engine.getPolicy('unknown')).toBeUndefined();
    });
  });

  describe('getCapabilities', () => {
    it('should return capabilities for tool', () => {
      const capabilities = engine.getCapabilities('generate_image');
      expect(capabilities).toContain('requires_network');
      expect(capabilities).toContain('produces_artifacts');
    });

    it('should return empty array for unknown tool', () => {
      expect(engine.getCapabilities('unknown')).toEqual([]);
    });
  });

  describe('hasCapability', () => {
    it('should return true if tool has capability', () => {
      expect(engine.hasCapability('generate_image', 'produces_artifacts')).toBe(true);
    });

    it('should return false if tool lacks capability', () => {
      expect(engine.hasCapability('web_search', 'writes_files')).toBe(false);
    });
  });

  describe('getToolsWithCapability', () => {
    it('should return tools with specified capability', () => {
      const tools = engine.getToolsWithCapability('requires_network');
      expect(tools).toContain('web_search');
      expect(tools).toContain('generate_image');
    });
  });

  describe('getToolsForPlan', () => {
    it('should return tools available for free plan', () => {
      const tools = engine.getToolsForPlan('free');
      expect(tools).toContain('analyze_spreadsheet');
      expect(tools).toContain('web_search');
      expect(tools).toContain('generate_image');
    });

    it('should return more tools for pro plan', () => {
      const freeTools = engine.getToolsForPlan('free');
      const proTools = engine.getToolsForPlan('pro');
      expect(proTools.length).toBeGreaterThanOrEqual(freeTools.length);
      expect(proTools).toContain('generate_image');
    });
  });

  describe('registerPolicy', () => {
    it('should register new policy', () => {
      const customPolicy: ToolPolicy = {
        toolName: 'custom_tool',
        capabilities: ['reads_files'],
        allowedPlans: ['admin'],
        requiresConfirmation: false,
        maxExecutionTimeMs: 10000,
        maxRetries: 1,
        deniedByDefault: false,
      };

      engine.registerPolicy(customPolicy);
      expect(engine.getPolicy('custom_tool')).toBeDefined();
    });
  });
});

describe('MetricsCollector', () => {
  beforeEach(() => {
    metricsCollector.clear();
  });

  describe('record', () => {
    it('should store metrics', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });

      const stats = metricsCollector.getToolStats();
      expect(stats['test_tool']).toBeDefined();
      expect(stats['test_tool'].totalCalls).toBe(1);
    });

    it('should accumulate multiple records', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 200,
        success: true,
        timestamp: new Date(),
      });

      const stats = metricsCollector.getToolStats();
      expect(stats['test_tool'].totalCalls).toBe(2);
    });
  });

  describe('getLatencyP95', () => {
    it('should return 0 for unknown tool', () => {
      expect(metricsCollector.getLatencyP95('unknown')).toBe(0);
    });

    it('should calculate P95 correctly for single value', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });

      expect(metricsCollector.getLatencyP95('test_tool')).toBe(100);
    });

    it('should calculate P95 correctly for multiple values', () => {
      const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
      
      latencies.forEach(latencyMs => {
        metricsCollector.record({
          toolName: 'test_tool',
          latencyMs,
          success: true,
          timestamp: new Date(),
        });
      });

      const p95 = metricsCollector.getLatencyP95('test_tool');
      expect(p95).toBeGreaterThanOrEqual(180);
      expect(p95).toBeLessThanOrEqual(200);
    });
  });

  describe('getSuccessRate', () => {
    it('should return 0 for unknown tool', () => {
      expect(metricsCollector.getSuccessRate('unknown')).toBe(0);
    });

    it('should calculate success rate correctly', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: false,
        timestamp: new Date(),
      });

      expect(metricsCollector.getSuccessRate('test_tool')).toBeCloseTo(66.67, 0);
    });

    it('should return 100 when all successful', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });

      expect(metricsCollector.getSuccessRate('test_tool')).toBe(100);
    });
  });

  describe('getErrorRate', () => {
    it('should return 0 for unknown tool', () => {
      expect(metricsCollector.getErrorRate('unknown')).toBe(0);
    });

    it('should calculate error rate correctly', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: false,
        errorCode: 'TEST_ERROR',
        timestamp: new Date(),
      });

      expect(metricsCollector.getErrorRate('test_tool')).toBe(50);
    });

    it('should return 0 when no errors', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });

      expect(metricsCollector.getErrorRate('test_tool')).toBe(0);
    });

    it('should return 100 when all failed', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: false,
        timestamp: new Date(),
      });

      expect(metricsCollector.getErrorRate('test_tool')).toBe(100);
    });
  });

  describe('getToolStats', () => {
    it('should return empty object when no metrics', () => {
      const stats = metricsCollector.getToolStats();
      expect(Object.keys(stats)).toHaveLength(0);
    });

    it('should return stats for all tools', () => {
      metricsCollector.record({
        toolName: 'tool_a',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });
      metricsCollector.record({
        toolName: 'tool_b',
        latencyMs: 200,
        success: false,
        timestamp: new Date(),
      });

      const stats = metricsCollector.getToolStats();
      expect(stats['tool_a']).toBeDefined();
      expect(stats['tool_b']).toBeDefined();
      expect(stats['tool_a'].successRate).toBe(100);
      expect(stats['tool_b'].errorRate).toBe(100);
    });

    it('should include all required fields in stats', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });

      const stats = metricsCollector.getToolStats();
      expect(stats['test_tool']).toHaveProperty('latencyP95');
      expect(stats['test_tool']).toHaveProperty('successRate');
      expect(stats['test_tool']).toHaveProperty('errorRate');
      expect(stats['test_tool']).toHaveProperty('totalCalls');
    });
  });

  describe('clear', () => {
    it('should reset all metrics', () => {
      metricsCollector.record({
        toolName: 'test_tool',
        latencyMs: 100,
        success: true,
        timestamp: new Date(),
      });

      expect(metricsCollector.getToolStats()['test_tool']).toBeDefined();

      metricsCollector.clear();

      expect(Object.keys(metricsCollector.getToolStats())).toHaveLength(0);
      expect(metricsCollector.getLatencyP95('test_tool')).toBe(0);
      expect(metricsCollector.getSuccessRate('test_tool')).toBe(0);
    });
  });
});
