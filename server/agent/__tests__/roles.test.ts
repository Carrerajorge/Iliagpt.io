import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../../lib/openai', () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}));

vi.mock('../toolRegistry', () => ({
  toolRegistry: {
    get: vi.fn(),
    list: vi.fn(),
    listForPlan: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock('../executionEngine', () => ({
  executionEngine: {
    execute: vi.fn(),
  },
  CancellationToken: class CancellationToken {
    private cancelled = false;
    private reason?: string;
    private correlationId?: string;
    
    setCorrelationId(id: string) { this.correlationId = id; }
    get isCancelled() { return this.cancelled; }
    async cancel(reason?: string) { this.cancelled = true; this.reason = reason; }
    throwIfCancelled() { if (this.cancelled) throw new CancellationError(this.reason || 'Cancelled'); }
  },
  CancellationError: class CancellationError extends Error {
    constructor(message: string) { super(message); this.name = 'CancellationError'; }
  },
  RetryableError: class RetryableError extends Error {
    isRetryable: boolean;
    constructor(message: string, isRetryable: boolean = true) {
      super(message);
      this.isRetryable = isRetryable;
    }
  },
  resourceCleanup: { register: vi.fn(), cleanup: vi.fn() },
}));

vi.mock('../policyEngine', () => ({
  policyEngine: {
    getPolicy: vi.fn().mockReturnValue({ capabilities: ['requires_network'] }),
    checkAccess: vi.fn().mockReturnValue({ allowed: true }),
  },
}));

vi.mock('../eventLogger', () => ({
  eventLogger: {
    log: vi.fn(),
    getEventsForRun: vi.fn().mockResolvedValue([]),
  },
  logRunEvent: vi.fn(),
  logStepEvent: vi.fn(),
  logToolEvent: vi.fn(),
}));

vi.mock('../../storage', () => ({
  storage: {
    createAgentRun: vi.fn().mockResolvedValue({ id: 1 }),
    getAgentRun: vi.fn(),
    updateAgentRun: vi.fn(),
  },
}));

vi.mock('../../db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  },
}));

import { openai } from '../../lib/openai';
import { toolRegistry } from '../toolRegistry';
import { executionEngine, CancellationToken, CancellationError, RetryableError } from '../executionEngine';
import { PlannerAgent, PlanningContext } from '../roles/plannerAgent';
import { ExecutorAgent, ExecutionContext, StepResult } from '../roles/executorAgent';
import { VerifierAgent, RunResultPackage, VerificationResult } from '../roles/verifierAgent';
import { RunController } from '../runController';
import { MetricsCollector, PhaseMetricsCollector, StepMetrics, PhaseMetrics } from '../metricsCollector';
import { PlanStep, AgentPlan, Artifact } from '../contracts';

const mockOpenAI = openai as any;
const mockToolRegistry = toolRegistry as any;
const mockExecutionEngine = executionEngine as any;

describe('PlannerAgent', () => {
  let planner: PlannerAgent;
  let basePlanningContext: PlanningContext;

  beforeEach(() => {
    vi.clearAllMocks();
    planner = new PlannerAgent();
    basePlanningContext = {
      userId: 'user-123',
      userPlan: 'pro',
      chatId: 'chat-123',
      runId: randomUUID(),
      correlationId: randomUUID(),
      maxSteps: 10,
      requireCitations: true,
    };

    mockToolRegistry.listForPlan.mockReturnValue([
      { name: 'web_search', description: 'Search the web' },
      { name: 'analyze_data', description: 'Analyze data' },
    ]);
    mockToolRegistry.get.mockImplementation((name: string) => ({
      name,
      description: `Mock tool ${name}`,
    }));
  });

  describe('generatePlan', () => {
    it('should return valid AgentPlan with steps', async () => {
      const mockPlanResponse = {
        objective: 'Research topic',
        steps: [
          {
            toolName: 'web_search',
            description: 'Search for information',
            input: { query: 'test query' },
            expectedOutput: 'Search results',
            dependencies: [],
            optional: false,
            timeoutMs: 30000,
          },
          {
            toolName: 'analyze_data',
            description: 'Analyze the results',
            input: { data: '$step[0].output' },
            expectedOutput: 'Analysis results',
            dependencies: [0],
            optional: false,
            timeoutMs: 60000,
          },
        ],
        estimatedTimeMs: 90000,
        reasoning: 'First search, then analyze',
      };

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockPlanResponse) } }],
      });

      const result = await planner.generatePlan('Research topic', basePlanningContext);

      expect(result).toBeDefined();
      expect(result.objective).toBe('Research topic');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].toolName).toBe('web_search');
      expect(result.steps[1].toolName).toBe('analyze_data');
      expect(result.estimatedTimeMs).toBe(90000);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should include proper tool assignments in plan', async () => {
      const mockPlanResponse = {
        objective: 'Generate report',
        steps: [
          {
            toolName: 'web_search',
            description: 'Search for data',
            input: { query: 'market data' },
            expectedOutput: 'Raw data',
            dependencies: [],
            optional: false,
            timeoutMs: 30000,
          },
        ],
        estimatedTimeMs: 30000,
      };

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockPlanResponse) } }],
      });

      const result = await planner.generatePlan('Generate report', basePlanningContext);

      expect(result.steps[0]).toMatchObject({
        index: 0,
        toolName: 'web_search',
        description: 'Search for data',
        input: { query: 'market data' },
        expectedOutput: 'Raw data',
        dependencies: [],
        optional: false,
        timeoutMs: 30000,
      });
    });

    it('should handle minimal objective gracefully', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          objective: 'x',
          steps: [{ toolName: 'web_search', description: 'Default search', input: {}, expectedOutput: 'results' }],
          estimatedTimeMs: 30000,
        }) } }],
      });

      const result = await planner.generatePlan('x', basePlanningContext);
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('should use provided objective when LLM returns empty', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          objective: '',
          steps: [{ toolName: 'web_search', description: 'Default search', input: {}, expectedOutput: 'results' }],
          estimatedTimeMs: 30000,
        }) } }],
      });

      const result = await planner.generatePlan('Fallback objective', basePlanningContext);
      expect(result.objective).toBe('Fallback objective');
    });

    it('should throw error when LLM returns no content', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      await expect(planner.generatePlan('Test', basePlanningContext))
        .rejects.toThrow('No response content from LLM');
    });

    it('should throw error for plan with no steps', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          objective: 'Empty plan',
          steps: [],
          estimatedTimeMs: 0,
        }) } }],
      });

      await expect(planner.generatePlan('Empty plan', basePlanningContext))
        .rejects.toThrow('Plan must have at least one step');
    });

    it('should enforce maxSteps constraint', async () => {
      const manySteps = Array.from({ length: 15 }, (_, i) => ({
        toolName: 'web_search',
        description: `Step ${i}`,
        input: {},
        expectedOutput: 'output',
        dependencies: i > 0 ? [i - 1] : [],
      }));

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          objective: 'Too many steps',
          steps: manySteps,
          estimatedTimeMs: 450000,
        }) } }],
      });

      await expect(planner.generatePlan('Too many steps', basePlanningContext))
        .rejects.toThrow(/exceeds maximum/);
    });

    it('should validate step dependencies', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          objective: 'Invalid deps',
          steps: [
            { toolName: 'web_search', description: 'Step 0', input: {}, expectedOutput: 'out', dependencies: [1] },
            { toolName: 'analyze_data', description: 'Step 1', input: {}, expectedOutput: 'out', dependencies: [] },
          ],
          estimatedTimeMs: 60000,
        }) } }],
      });

      await expect(planner.generatePlan('Invalid deps', basePlanningContext))
        .rejects.toThrow(/dependencies must reference earlier steps/);
    });
  });
});

describe('ExecutorAgent', () => {
  let executor: ExecutorAgent;
  let baseExecutionContext: ExecutionContext;
  let mockStep: PlanStep;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new ExecutorAgent();
    
    baseExecutionContext = {
      userId: 'user-123',
      userPlan: 'pro',
      chatId: 'chat-123',
      runId: randomUUID(),
      correlationId: randomUUID(),
      cancellationToken: undefined,
      previousResults: new Map(),
    };

    mockStep = {
      index: 0,
      toolName: 'web_search',
      description: 'Search for information',
      input: { query: 'test query' },
      expectedOutput: 'Search results',
      dependencies: [],
      optional: false,
      timeoutMs: 30000,
    };
  });

  describe('executeStep', () => {
    it('should run tools via executionEngine', async () => {
      const mockToolResult = {
        success: true,
        output: { results: ['result1', 'result2'] },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 100 },
      };

      mockExecutionEngine.execute.mockResolvedValue({
        success: true,
        data: mockToolResult,
      });

      const result = await executor.executeStep(mockStep, baseExecutionContext);

      expect(mockExecutionEngine.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.toolName).toBe('web_search');
      expect(result.stepIndex).toBe(0);
    });

    it('should collect citations from tool results', async () => {
      const mockToolResult = {
        success: true,
        output: {
          results: ['data'],
          sources: [
            { url: 'https://example.com', title: 'Example', excerpt: 'Sample text' },
          ],
          citations: [
            { url: 'https://citation.com', title: 'Citation', text: 'Quote text', confidence: 0.9 },
          ],
        },
        artifacts: [],
        previews: [],
        logs: [],
      };

      mockExecutionEngine.execute.mockResolvedValue({
        success: true,
        data: mockToolResult,
      });

      const result = await executor.executeStep(mockStep, baseExecutionContext);

      expect(result.success).toBe(true);
      expect(result.citations).toHaveLength(2);
      expect(result.citations[0].sourceUrl).toBe('https://example.com');
      expect(result.citations[1].sourceUrl).toBe('https://citation.com');
      expect(result.citations[1].confidence).toBe(0.9);
    });

    it('should handle cancellation tokens correctly', async () => {
      const token = new CancellationToken();
      await token.cancel('User cancelled');

      const contextWithToken: ExecutionContext = {
        ...baseExecutionContext,
        cancellationToken: token,
      };

      const result = await executor.executeStep(mockStep, contextWithToken);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CANCELLED');
      expect(result.error?.retryable).toBe(false);
    });

    it('should retry with backoff on failure', async () => {
      let callCount = 0;
      mockExecutionEngine.execute.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return {
            success: false,
            error: { code: 'TIMEOUT', message: 'Request timeout' },
          };
        }
        return {
          success: true,
          data: {
            success: true,
            output: { data: 'success' },
            artifacts: [],
            previews: [],
            logs: [],
          },
        };
      });

      const contextWithRetry: ExecutionContext = {
        ...baseExecutionContext,
        retryConfig: {
          maxRetries: 3,
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitterFactor: 0,
        },
      };

      const result = await executor.executeStep(mockStep, contextWithRetry);

      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(2);
    });

    it('should fail after max retries exceeded', async () => {
      mockExecutionEngine.execute.mockResolvedValue({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Internal error' },
      });

      const contextWithRetry: ExecutionContext = {
        ...baseExecutionContext,
        retryConfig: {
          maxRetries: 2,
          baseDelayMs: 10,
          maxDelayMs: 50,
          jitterFactor: 0,
        },
      };

      const result = await executor.executeStep(mockStep, contextWithRetry);

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(2);
      expect(result.error).toBeDefined();
    });

    it('should not retry non-retryable errors', async () => {
      mockExecutionEngine.execute.mockResolvedValue({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid input provided' },
      });

      const result = await executor.executeStep(mockStep, baseExecutionContext);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(mockExecutionEngine.execute).toHaveBeenCalledTimes(1);
    });

    it('should process artifacts from tool output', async () => {
      const mockArtifacts = [
        {
          id: randomUUID(),
          type: 'file' as const,
          name: 'results.json',
          mimeType: 'application/json',
          createdAt: new Date(),
        },
      ];

      mockExecutionEngine.execute.mockResolvedValue({
        success: true,
        data: {
          success: true,
          output: { data: 'results' },
          artifacts: mockArtifacts,
          previews: [],
          logs: [],
        },
      });

      const result = await executor.executeStep(mockStep, baseExecutionContext);

      expect(result.success).toBe(true);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].name).toBe('results.json');
    });
  });
});

describe('VerifierAgent', () => {
  let verifier: VerifierAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    verifier = new VerifierAgent({ useLLMVerification: false });
  });

  describe('verify', () => {
    it('should check citation coverage correctly', async () => {
      const citationId1 = randomUUID();
      const citationId2 = randomUUID();
      const claimId1 = randomUUID();
      const claimId2 = randomUUID();

      const resultPackage: RunResultPackage = {
        runId: randomUUID(),
        correlationId: randomUUID(),
        objective: 'Research topic',
        stepResults: [
          { stepIndex: 0, toolName: 'web_search', success: true, durationMs: 100, artifacts: [], citations: [], retryCount: 0 },
        ],
        artifacts: [],
        citations: [
          { id: citationId1, excerpt: 'Citation 1', confidence: 0.9, stepIndex: 0, createdAt: new Date() },
          { id: citationId2, excerpt: 'Citation 2', confidence: 0.8, stepIndex: 0, createdAt: new Date() },
        ],
        claims: [
          { id: claimId1, text: 'Claim 1', supportingCitationIds: [citationId1] },
          { id: claimId2, text: 'Claim 2', supportingCitationIds: [citationId2] },
        ],
      };

      const result = await verifier.verify(resultPackage);

      expect(result.citationCoverage).toBe(1);
      expect(result.issues.filter(i => i.type === 'unsupported_claim')).toHaveLength(0);
    });

    it('should identify claims without citations', async () => {
      const claimId = randomUUID();
      const resultPackage: RunResultPackage = {
        runId: randomUUID(),
        correlationId: randomUUID(),
        objective: 'Research topic',
        stepResults: [
          { stepIndex: 0, toolName: 'web_search', success: true, durationMs: 100, artifacts: [], citations: [], retryCount: 0 },
        ],
        artifacts: [],
        citations: [],
        claims: [
          { id: claimId, text: 'Unsupported claim without any citation' },
        ],
      };

      const result = await verifier.verify(resultPackage);

      expect(result.citationCoverage).toBe(0);
      expect(result.issues.some(i => i.type === 'unsupported_claim')).toBe(true);
      expect(result.issues.find(i => i.type === 'unsupported_claim')?.affectedClaimId).toBe(claimId);
    });

    it('should return VerificationResult with issues list', async () => {
      const artifactId = randomUUID();
      const resultPackage: RunResultPackage = {
        runId: randomUUID(),
        correlationId: randomUUID(),
        objective: 'Generate report',
        stepResults: [
          { stepIndex: 0, toolName: 'generate_file', success: true, durationMs: 200, artifacts: [], citations: [], retryCount: 0 },
        ],
        artifacts: [
          { id: artifactId, type: 'file', name: 'orphan-file.txt', createdAt: new Date() },
        ],
        citations: [],
      };

      const result = await verifier.verify(resultPackage);

      expect(result).toHaveProperty('runId');
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('citationCoverage');
      expect(result).toHaveProperty('artifactIntegrity');
      expect(result).toHaveProperty('issues');
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.issues.some(i => i.type === 'invalid_artifact')).toBe(true);
    });

    it('should pass verification when all criteria met', async () => {
      const citationId = randomUUID();
      const claimId = randomUUID();
      const artifactId = randomUUID();

      const resultPackage: RunResultPackage = {
        runId: randomUUID(),
        correlationId: randomUUID(),
        objective: 'Complete task',
        stepResults: [
          { stepIndex: 0, toolName: 'web_search', success: true, durationMs: 100, artifacts: [], citations: [], retryCount: 0 },
        ],
        artifacts: [
          { id: artifactId, type: 'file', name: 'result.txt', url: 'https://storage.example.com/result.txt', createdAt: new Date() },
        ],
        citations: [
          { id: citationId, excerpt: 'Source text', confidence: 0.95, stepIndex: 0, createdAt: new Date() },
        ],
        claims: [
          { id: claimId, text: 'Valid claim', supportingCitationIds: [citationId] },
        ],
      };

      const result = await verifier.verify(resultPackage);

      expect(result.passed).toBe(true);
      expect(result.citationCoverage).toBe(1);
      expect(result.artifactIntegrity).toBe(1);
    });

    it('should fail verification for low artifact integrity', async () => {
      const resultPackage: RunResultPackage = {
        runId: randomUUID(),
        correlationId: randomUUID(),
        objective: 'Generate files',
        stepResults: [
          { stepIndex: 0, toolName: 'generate_file', success: true, durationMs: 100, artifacts: [], citations: [], retryCount: 0 },
        ],
        artifacts: [
          { id: randomUUID(), type: 'file', name: 'valid.txt', url: 'https://example.com/valid.txt', createdAt: new Date() },
          { id: randomUUID(), type: 'file', name: 'missing-data.txt', createdAt: new Date() },
          { id: randomUUID(), type: 'file', name: 'also-missing.txt', createdAt: new Date() },
        ],
        citations: [],
      };

      const strictVerifier = new VerifierAgent({ minArtifactIntegrity: 0.9, useLLMVerification: false });
      const result = await strictVerifier.verify(resultPackage);

      expect(result.artifactIntegrity).toBeLessThan(1);
      expect(result.passed).toBe(false);
    });

    it('should identify low confidence citations', async () => {
      const resultPackage: RunResultPackage = {
        runId: randomUUID(),
        correlationId: randomUUID(),
        objective: 'Research',
        stepResults: [
          { stepIndex: 0, toolName: 'web_search', success: true, durationMs: 100, artifacts: [], citations: [], retryCount: 0 },
        ],
        artifacts: [],
        citations: [
          { id: randomUUID(), excerpt: 'Low confidence source', confidence: 0.3, stepIndex: 0, createdAt: new Date() },
        ],
      };

      const result = await verifier.verify(resultPackage);

      expect(result.issues.some(i => i.type === 'low_confidence')).toBe(true);
    });

    it('should identify gaps requiring research for failed steps', async () => {
      const resultPackage: RunResultPackage = {
        runId: randomUUID(),
        correlationId: randomUUID(),
        objective: 'Multi-step task',
        stepResults: [
          { stepIndex: 0, toolName: 'web_search', success: true, durationMs: 100, artifacts: [], citations: [], retryCount: 0 },
          { 
            stepIndex: 1, 
            toolName: 'analyze_data', 
            success: false, 
            durationMs: 50, 
            artifacts: [], 
            citations: [], 
            retryCount: 2,
            error: { code: 'TIMEOUT', message: 'Request timed out', retryable: true },
          },
        ],
        artifacts: [],
        citations: [],
      };

      const result = await verifier.verify(resultPackage);

      expect(result.gapsRequiringResearch.length).toBeGreaterThan(0);
      expect(result.gapsRequiringResearch.some(g => g.topic.includes('analyze_data'))).toBe(true);
    });
  });
});

describe('RunController', () => {
  let controller: RunController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new RunController({
      maxConcurrentRuns: 5,
      enableVerification: false,
    });
  });

  afterEach(() => {
    controller.removeAllListeners();
  });

  describe('createRun', () => {
    it('should create run with proper initial state', async () => {
      const request = {
        chatId: 'chat-123',
        messageId: 'msg-456',
        message: 'Research AI trends',
        idempotencyKey: 'key-789',
      };

      const run = await controller.createRun(request, 'user-123');

      expect(run).toBeDefined();
      expect(run.id).toBeDefined();
      expect(run.chatId).toBe('chat-123');
      expect(run.messageId).toBe('msg-456');
      expect(run.userId).toBe('user-123');
      expect(run.status).toBe('queued');
      expect(run.correlationId).toBeDefined();
      expect(run.steps).toEqual([]);
      expect(run.artifacts).toEqual([]);
      expect(run.currentStepIndex).toBe(0);
      expect(run.totalSteps).toBe(0);
      expect(run.completedSteps).toBe(0);
      expect(run.createdAt).toBeInstanceOf(Date);
      expect(run.updatedAt).toBeInstanceOf(Date);
      expect(run.metadata?.originalMessage).toBe('Research AI trends');
    });

    it('should emit runCreated event', async () => {
      const eventHandler = vi.fn();
      controller.on('runCreated', eventHandler);

      const request = {
        chatId: 'chat-123',
        messageId: 'msg-456',
        message: 'Test message',
      };

      await controller.createRun(request, 'user-123');

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler.mock.calls[0][0]).toHaveProperty('id');
      expect(eventHandler.mock.calls[0][0]).toHaveProperty('status', 'queued');
    });

    it('should generate unique run IDs', async () => {
      const request = {
        chatId: 'chat-123',
        messageId: 'msg-456',
        message: 'Test',
      };

      const run1 = await controller.createRun(request, 'user-123');
      const run2 = await controller.createRun(request, 'user-123');

      expect(run1.id).not.toBe(run2.id);
      expect(run1.correlationId).not.toBe(run2.correlationId);
    });
  });

  describe('pauseRun and resumeRun', () => {
    it('should not pause run that is not active', async () => {
      const result = await controller.pauseRun('non-existent-run');
      expect(result).toBe(false);
    });

    it('should not resume run that is not paused', async () => {
      const result = await controller.resumeRun('non-existent-run');
      expect(result).toBe(false);
    });
  });

  describe('cancelRun', () => {
    it('should return false for non-existent run', async () => {
      const result = await controller.cancelRun('non-existent-run', 'User requested');
      expect(result).toBe(false);
    });
  });

  describe('getRunStatus', () => {
    it('should throw error for non-existent run', async () => {
      await expect(controller.getRunStatus('non-existent-run'))
        .rejects.toThrow(/not found/);
    });
  });
});

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('P50/P95/P99 calculations', () => {
    it('should calculate P50 correctly', () => {
      const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      latencies.forEach((latencyMs, i) => {
        collector.record({
          toolName: 'test_tool',
          latencyMs,
          success: true,
          timestamp: new Date(),
        });
      });

      const p50 = collector.getLatencyP50('test_tool');
      expect(p50).toBeGreaterThanOrEqual(500);
      expect(p50).toBeLessThanOrEqual(600);
    });

    it('should calculate P95 correctly', () => {
      for (let i = 1; i <= 100; i++) {
        collector.record({
          toolName: 'test_tool',
          latencyMs: i * 10,
          success: true,
          timestamp: new Date(),
        });
      }

      const p95 = collector.getLatencyP95('test_tool');
      expect(p95).toBeGreaterThanOrEqual(950);
    });

    it('should calculate P99 correctly', () => {
      for (let i = 1; i <= 100; i++) {
        collector.record({
          toolName: 'test_tool',
          latencyMs: i * 10,
          success: true,
          timestamp: new Date(),
        });
      }

      const p99 = collector.getLatencyP99('test_tool');
      expect(p99).toBeGreaterThanOrEqual(990);
    });

    it('should return 0 for empty metrics', () => {
      expect(collector.getLatencyP50('non_existent_tool')).toBe(0);
      expect(collector.getLatencyP95('non_existent_tool')).toBe(0);
      expect(collector.getLatencyP99('non_existent_tool')).toBe(0);
    });

    it('should calculate aggregate metrics across all tools', () => {
      collector.record({ toolName: 'tool_a', latencyMs: 100, success: true, timestamp: new Date() });
      collector.record({ toolName: 'tool_a', latencyMs: 200, success: true, timestamp: new Date() });
      collector.record({ toolName: 'tool_b', latencyMs: 300, success: true, timestamp: new Date() });
      collector.record({ toolName: 'tool_b', latencyMs: 400, success: false, timestamp: new Date() });

      const avg = collector.getLatencyAvg();
      expect(avg).toBe(250);

      const successRate = collector.getSuccessRate();
      expect(successRate).toBe(75);

      const errorRate = collector.getErrorRate();
      expect(errorRate).toBe(25);
    });
  });

  describe('tool-specific metrics', () => {
    it('should calculate success rate per tool', () => {
      collector.record({ toolName: 'reliable_tool', latencyMs: 100, success: true, timestamp: new Date() });
      collector.record({ toolName: 'reliable_tool', latencyMs: 100, success: true, timestamp: new Date() });
      collector.record({ toolName: 'unreliable_tool', latencyMs: 100, success: false, timestamp: new Date() });
      collector.record({ toolName: 'unreliable_tool', latencyMs: 100, success: false, timestamp: new Date() });

      expect(collector.getSuccessRate('reliable_tool')).toBe(100);
      expect(collector.getSuccessRate('unreliable_tool')).toBe(0);
    });

    it('should get tool stats correctly', () => {
      collector.record({ toolName: 'test_tool', latencyMs: 100, success: true, timestamp: new Date() });
      collector.record({ toolName: 'test_tool', latencyMs: 200, success: true, timestamp: new Date() });
      collector.record({ toolName: 'test_tool', latencyMs: 300, success: false, timestamp: new Date() });

      const stats = collector.getToolStats();

      expect(stats['test_tool']).toBeDefined();
      expect(stats['test_tool'].totalCalls).toBe(3);
      expect(stats['test_tool'].latencyAvg).toBe(200);
      expect(stats['test_tool'].successRate).toBeCloseTo(66.67, 1);
      expect(stats['test_tool'].errorRate).toBeCloseTo(33.33, 1);
    });
  });

  describe('exportMetrics', () => {
    it('should export complete metrics snapshot', () => {
      collector.record({ toolName: 'tool_a', latencyMs: 100, success: true, timestamp: new Date() });
      collector.record({ toolName: 'tool_b', latencyMs: 200, success: false, timestamp: new Date() });

      const exported = collector.exportMetrics();

      expect(exported.timestamp).toBeDefined();
      expect(exported.tools).toHaveProperty('tool_a');
      expect(exported.tools).toHaveProperty('tool_b');
      expect(exported.aggregate.totalCalls).toBe(2);
      expect(exported.aggregate.overallSuccessRate).toBe(50);
      expect(exported.aggregate.overallErrorRate).toBe(50);
    });
  });

  describe('clear', () => {
    it('should clear all metrics', () => {
      collector.record({ toolName: 'test_tool', latencyMs: 100, success: true, timestamp: new Date() });
      expect(collector.getToolStats()['test_tool']).toBeDefined();

      collector.clear();

      expect(collector.getToolStats()['test_tool']).toBeUndefined();
      expect(collector.getLatencyAvg()).toBe(0);
    });
  });
});

describe('PhaseMetricsCollector', () => {
  let phaseCollector: PhaseMetricsCollector;

  beforeEach(() => {
    phaseCollector = new PhaseMetricsCollector();
  });

  describe('record and retrieve stats', () => {
    it('should record phase metrics correctly', () => {
      phaseCollector.record({
        phase: 'planning',
        durationMs: 1000,
        toolCalls: 0,
        success: true,
        timestamp: new Date(),
      });

      phaseCollector.record({
        phase: 'planning',
        durationMs: 1500,
        toolCalls: 0,
        success: true,
        timestamp: new Date(),
      });

      const stats = phaseCollector.getPhaseStats();

      expect(stats['planning']).toBeDefined();
      expect(stats['planning'].totalRuns).toBe(2);
      expect(stats['planning'].latencyAvg).toBe(1250);
      expect(stats['planning'].successRate).toBe(100);
    });

    it('should calculate phase percentiles correctly', () => {
      for (let i = 1; i <= 100; i++) {
        phaseCollector.record({
          phase: 'execution',
          durationMs: i * 100,
          toolCalls: i,
          success: i % 10 !== 0,
          timestamp: new Date(),
        });
      }

      const stats = phaseCollector.getPhaseStats();

      expect(stats['execution'].latencyP50).toBeGreaterThanOrEqual(5000);
      expect(stats['execution'].latencyP95).toBeGreaterThanOrEqual(9500);
      expect(stats['execution'].latencyP99).toBeGreaterThanOrEqual(9900);
      expect(stats['execution'].successRate).toBe(90);
    });

    it('should track multiple phases independently', () => {
      phaseCollector.record({ phase: 'planning', durationMs: 500, toolCalls: 0, success: true, timestamp: new Date() });
      phaseCollector.record({ phase: 'execution', durationMs: 2000, toolCalls: 5, success: true, timestamp: new Date() });
      phaseCollector.record({ phase: 'verification', durationMs: 300, toolCalls: 1, success: false, timestamp: new Date() });

      const stats = phaseCollector.getPhaseStats();

      expect(Object.keys(stats)).toHaveLength(3);
      expect(stats['planning'].latencyAvg).toBe(500);
      expect(stats['execution'].latencyAvg).toBe(2000);
      expect(stats['verification'].latencyAvg).toBe(300);
      expect(stats['verification'].successRate).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all phase metrics', () => {
      phaseCollector.record({ phase: 'planning', durationMs: 1000, toolCalls: 0, success: true, timestamp: new Date() });

      phaseCollector.clear();

      const stats = phaseCollector.getPhaseStats();
      expect(Object.keys(stats)).toHaveLength(0);
    });
  });
});
