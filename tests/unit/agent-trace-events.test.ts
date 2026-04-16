import { describe, it, expect } from 'vitest';
import { 
  TraceEventSchema, 
  TraceEventTypeSchema,
  createTraceEvent,
  type TraceEvent,
  type TraceEventType
} from '@shared/schema';

describe('TraceEvent Contract Tests', () => {
  describe('TraceEventTypeSchema', () => {
    const validEventTypes: TraceEventType[] = [
      'task_start', 'plan_created', 'plan_step', 'step_started',
      'tool_call', 'tool_output', 'tool_chunk', 'observation',
      'verification', 'step_completed', 'step_failed', 'step_retried',
      'replan', 'thinking', 'shell_output', 'artifact_created',
      'error', 'done', 'cancelled', 'heartbeat'
    ];

    it.each(validEventTypes)('should accept valid event type: %s', (eventType) => {
      expect(() => TraceEventTypeSchema.parse(eventType)).not.toThrow();
    });

    it('should reject invalid event types', () => {
      expect(() => TraceEventTypeSchema.parse('invalid_type')).toThrow();
      expect(() => TraceEventTypeSchema.parse('')).toThrow();
      expect(() => TraceEventTypeSchema.parse(123)).toThrow();
    });
  });

  describe('TraceEventSchema', () => {
    it('should validate minimal trace event', () => {
      const event: TraceEvent = {
        event_type: 'task_start',
        runId: 'run-123',
        timestamp: Date.now(),
      };

      const result = TraceEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it('should validate full trace event with all fields', () => {
      const event: TraceEvent = {
        event_type: 'step_completed',
        runId: 'run-123',
        stepId: 'step-0',
        stepIndex: 0,
        phase: 'executing',
        status: 'completed',
        tool_name: 'web_search',
        command: 'search "AI news"',
        output_snippet: 'Found 10 results...',
        chunk_sequence: 1,
        is_final_chunk: true,
        artifact: {
          type: 'file',
          name: 'results.json',
          url: '/api/artifacts/123',
        },
        plan: {
          objective: 'Search for AI news',
          steps: [{ index: 0, toolName: 'web_search', description: 'Search the web' }],
          estimatedTime: '2 minutes',
        },
        error: {
          code: 'TIMEOUT',
          message: 'Request timed out',
          retryable: true,
        },
        summary: 'Step completed successfully',
        confidence: 0.95,
        timestamp: Date.now(),
        metadata: { duration: 1500 },
      };

      const result = TraceEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it('should reject event without required runId', () => {
      const event = {
        event_type: 'task_start',
        timestamp: Date.now(),
      };

      const result = TraceEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it('should reject event without required event_type', () => {
      const event = {
        runId: 'run-123',
        timestamp: Date.now(),
      };

      const result = TraceEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it('should reject event without required timestamp', () => {
      const event = {
        event_type: 'task_start',
        runId: 'run-123',
      };

      const result = TraceEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it('should validate phase enum values', () => {
      const validPhases = ['planning', 'executing', 'verifying', 'completed', 'failed', 'cancelled'];
      
      for (const phase of validPhases) {
        const event = {
          event_type: 'step_started' as const,
          runId: 'run-123',
          timestamp: Date.now(),
          phase,
        };
        expect(TraceEventSchema.safeParse(event).success).toBe(true);
      }
    });

    it('should validate status enum values', () => {
      const validStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled', 'retrying'];
      
      for (const status of validStatuses) {
        const event = {
          event_type: 'step_started' as const,
          runId: 'run-123',
          timestamp: Date.now(),
          status,
        };
        expect(TraceEventSchema.safeParse(event).success).toBe(true);
      }
    });

    it('should validate confidence in range [0, 1]', () => {
      const validEvent = {
        event_type: 'verification' as const,
        runId: 'run-123',
        timestamp: Date.now(),
        confidence: 0.85,
      };
      expect(TraceEventSchema.safeParse(validEvent).success).toBe(true);

      const lowConfidence = { ...validEvent, confidence: 0 };
      expect(TraceEventSchema.safeParse(lowConfidence).success).toBe(true);

      const highConfidence = { ...validEvent, confidence: 1 };
      expect(TraceEventSchema.safeParse(highConfidence).success).toBe(true);

      const invalidLow = { ...validEvent, confidence: -0.1 };
      expect(TraceEventSchema.safeParse(invalidLow).success).toBe(false);

      const invalidHigh = { ...validEvent, confidence: 1.1 };
      expect(TraceEventSchema.safeParse(invalidHigh).success).toBe(false);
    });
  });

  describe('createTraceEvent helper', () => {
    it('should create valid trace event with minimal params', () => {
      const event = createTraceEvent('task_start', 'run-123');
      
      expect(event.event_type).toBe('task_start');
      expect(event.runId).toBe('run-123');
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe('number');
    });

    it('should create trace event with options', () => {
      const event = createTraceEvent('step_completed', 'run-456', {
        stepIndex: 2,
        stepId: 'step-2',
        tool_name: 'generate_document',
        status: 'completed',
        summary: 'Document generated successfully',
      });

      expect(event.event_type).toBe('step_completed');
      expect(event.runId).toBe('run-456');
      expect(event.stepIndex).toBe(2);
      expect(event.stepId).toBe('step-2');
      expect(event.tool_name).toBe('generate_document');
      expect(event.status).toBe('completed');
      expect(event.summary).toBe('Document generated successfully');
    });

    it('should automatically set timestamp', () => {
      const before = Date.now();
      const event = createTraceEvent('heartbeat', 'run-789');
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('SSE Event Format', () => {
    it('should serialize to valid JSON for SSE transmission', () => {
      const event = createTraceEvent('tool_output', 'run-abc', {
        stepIndex: 0,
        tool_name: 'web_search',
        output_snippet: 'Search results: 1. Article about AI...',
        chunk_sequence: 1,
        is_final_chunk: false,
      });

      const serialized = JSON.stringify(event);
      expect(() => JSON.parse(serialized)).not.toThrow();
      
      const parsed = JSON.parse(serialized);
      expect(parsed.event_type).toBe('tool_output');
      expect(parsed.runId).toBe('run-abc');
    });

    it('should handle special characters in output_snippet', () => {
      const event = createTraceEvent('shell_output', 'run-def', {
        output_snippet: 'Line 1\nLine 2\tTabbed\r\nWindows line',
        command: 'echo "test"',
      });

      const serialized = JSON.stringify(event);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.output_snippet).toContain('\n');
      expect(parsed.output_snippet).toContain('\t');
    });

    it('should handle Unicode content', () => {
      const event = createTraceEvent('observation', 'run-ghi', {
        summary: 'Búsqueda completada: 日本語テスト 🎉',
      });

      const serialized = JSON.stringify(event);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.summary).toContain('日本語');
      expect(parsed.summary).toContain('🎉');
    });
  });

  describe('Event Type Semantics', () => {
    it('task_start should mark run beginning', () => {
      const event = createTraceEvent('task_start', 'run-001', {
        phase: 'planning',
        summary: 'Starting agent run',
      });

      expect(event.phase).toBe('planning');
    });

    it('done should mark run completion', () => {
      const event = createTraceEvent('done', 'run-001', {
        phase: 'completed',
        status: 'completed',
        summary: 'All steps executed successfully',
      });

      expect(event.phase).toBe('completed');
      expect(event.status).toBe('completed');
    });

    it('error should include error details', () => {
      const event = createTraceEvent('error', 'run-001', {
        phase: 'failed',
        status: 'failed',
        error: {
          code: 'TOOL_EXECUTION_ERROR',
          message: 'Tool failed to execute',
          retryable: true,
        },
      });

      expect(event.error?.code).toBe('TOOL_EXECUTION_ERROR');
      expect(event.error?.retryable).toBe(true);
    });

    it('artifact_created should include artifact details', () => {
      const event = createTraceEvent('artifact_created', 'run-001', {
        stepIndex: 3,
        artifact: {
          type: 'document',
          name: 'report.docx',
          url: '/downloads/report.docx',
        },
      });

      expect(event.artifact?.type).toBe('document');
      expect(event.artifact?.name).toBe('report.docx');
    });
  });
});
