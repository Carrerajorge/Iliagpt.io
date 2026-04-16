import { describe, it, expect } from 'vitest';
import { normalizeAgentEvent, hasPayloadDetails, type MappedAgentEvent } from '../../client/src/lib/agent-event-mapper';

describe('normalizeAgentEvent', () => {
  it('should correctly map a successful verification event with success:true', () => {
    const rawEvent = {
      type: 'verification',
      content: {
        success: true,
        feedback: 'Step completed successfully',
        confidence: 0.95,
      },
      timestamp: Date.now(),
      stepIndex: 1,
    };

    const mapped = normalizeAgentEvent(rawEvent);

    expect(mapped.kind).toBe('verification');
    expect(mapped.status).toBe('ok');
    expect(mapped.ui.label).toBe('Verificación');
    expect(mapped.ui.labelColor).toContain('purple');
  });

  it('should NOT render success:true events as errors', () => {
    const successEvent = {
      type: 'observation',
      content: {
        success: true,
        type: 'web_search',
        results: ['result1', 'result2'],
      },
      timestamp: Date.now(),
    };

    const mapped = normalizeAgentEvent(successEvent);

    expect(mapped.kind).toBe('observation');
    expect(mapped.status).toBe('ok');
    expect(mapped.ui.label).not.toBe('Error');
    expect(mapped.ui.labelColor).not.toContain('red');
  });

  it('should correctly identify error events with fail status', () => {
    const errorEvent = {
      type: 'error',
      content: {
        message: 'Failed to execute tool',
        error: 'Network timeout',
      },
      timestamp: Date.now(),
    };

    const mapped = normalizeAgentEvent(errorEvent);

    expect(mapped.kind).toBe('error');
    expect(mapped.status).toBe('fail');
    expect(mapped.ui.label).toBe('Error');
    expect(mapped.ui.labelColor).toContain('red');
  });

  it('should correctly map action events', () => {
    const actionEvent = {
      type: 'action',
      content: {
        toolName: 'web_search',
        input: { query: 'test query' },
      },
      timestamp: Date.now(),
    };

    const mapped = normalizeAgentEvent(actionEvent);

    expect(mapped.kind).toBe('action');
    expect(mapped.status).toBe('ok');
    expect(mapped.title).toBe('Búsqueda web');
    expect(mapped.ui.label).toBe('Acción');
    expect(mapped.ui.labelColor).toContain('blue');
  });

  it('should correctly map plan events', () => {
    const planEvent = {
      type: 'plan',
      content: {
        objective: 'Complete the task',
        steps: [{ description: 'Step 1' }],
      },
      timestamp: Date.now(),
    };

    const mapped = normalizeAgentEvent(planEvent);

    expect(mapped.kind).toBe('plan');
    expect(mapped.status).toBe('ok');
    expect(mapped.ui.label).toBe('Plan');
    expect(mapped.ui.icon).toBe('list');
  });

  it('should infer warn status from shouldRetry/shouldReplan', () => {
    const warningEvent = {
      type: 'verification',
      content: {
        success: false,
        shouldRetry: true,
        feedback: 'Retrying...',
      },
      timestamp: Date.now(),
    };

    const mapped = normalizeAgentEvent(warningEvent);

    expect(mapped.status).toBe('warn');
    expect(mapped.ui.labelColor).toContain('yellow');
  });

  it('should map legacy events without kind/status fields', () => {
    const legacyEvent = {
      type: 'observation',
      content: 'Simple string content',
      timestamp: Date.now(),
    };

    const mapped = normalizeAgentEvent(legacyEvent);

    expect(mapped.kind).toBe('observation');
    expect(mapped.status).toBe('ok');
  });

  it('should use new schema fields when provided', () => {
    const newSchemaEvent = {
      kind: 'verification' as const,
      status: 'ok' as const,
      title: 'Custom Title',
      summary: 'Custom Summary',
      confidence: 0.9,
      payload: { data: 'test' },
      timestamp: Date.now(),
    };

    const mapped = normalizeAgentEvent(newSchemaEvent);

    expect(mapped.kind).toBe('verification');
    expect(mapped.status).toBe('ok');
    expect(mapped.title).toBe('Custom Title');
    expect(mapped.summary).toBe('Custom Summary');
    expect(mapped.confidence).toBe(0.9);
  });
});

describe('hasPayloadDetails', () => {
  it('should return false for empty payload', () => {
    const event: MappedAgentEvent = {
      id: '1',
      kind: 'action',
      status: 'ok',
      title: 'Test',
      timestamp: Date.now(),
      payload: undefined,
      ui: {
        label: 'Test',
        labelColor: '',
        bgColor: '',
        iconColor: '',
        icon: 'check',
      },
    };

    expect(hasPayloadDetails(event)).toBe(false);
  });

  it('should return false for payload with only ignored keys', () => {
    const event: MappedAgentEvent = {
      id: '1',
      kind: 'verification',
      status: 'ok',
      title: 'Test',
      timestamp: Date.now(),
      payload: { success: true, feedback: 'ok', confidence: 0.9 },
      ui: {
        label: 'Test',
        labelColor: '',
        bgColor: '',
        iconColor: '',
        icon: 'check',
      },
    };

    expect(hasPayloadDetails(event)).toBe(false);
  });

  it('should return true for payload with extra data', () => {
    const event: MappedAgentEvent = {
      id: '1',
      kind: 'observation',
      status: 'ok',
      title: 'Test',
      timestamp: Date.now(),
      payload: { success: true, results: [1, 2, 3], extraData: 'important' },
      ui: {
        label: 'Test',
        labelColor: '',
        bgColor: '',
        iconColor: '',
        icon: 'check',
      },
    };

    expect(hasPayloadDetails(event)).toBe(true);
  });
});
