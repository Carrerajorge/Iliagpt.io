import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initModelWiring } from '../../integration/modelWiring';

const redisSetMock = vi.fn(async () => 'OK');
const redisGetMock = vi.fn(async () => null);
const redisDelMock = vi.fn(async () => 1);

vi.mock('../../lib/redis', () => ({
  redis: {
    set: redisSetMock,
    get: redisGetMock,
    del: redisDelMock,
  },
}));

vi.mock('../../agentic/core/AgenticLoop', () => {
  class MockAgenticLoop {
    private listeners = new Map<string, Array<(payload: any) => void>>();

    on(event: string, handler: (payload: any) => void) {
      const handlers = this.listeners.get(event) ?? [];
      handlers.push(handler);
      this.listeners.set(event, handlers);
      return this;
    }

    private emit(event: string, payload: any) {
      for (const handler of this.listeners.get(event) ?? []) {
        handler(payload);
      }
    }

    async run() {
      this.emit('event', { type: 'turn_start', turn: 1 });
      this.emit('event', {
        type: 'turn_end',
        turn: 1,
        stopReason: 'stop',
        hasToolCalls: false,
        conversationSnapshot: [
          { role: 'system', content: 'Recovered system prompt' },
          { role: 'user', content: 'Continue task' },
          { role: 'assistant', content: 'Checkpointed progress' },
        ],
      });
      this.emit('event', {
        type: 'loop_done',
        turns: 1,
        finalAnswer: 'FINAL ANSWER: done',
      });
      return 'FINAL ANSWER: done';
    }
  }

  return { AgenticLoop: MockAgenticLoop };
});

describe('TaskExecutor checkpointing', () => {
  beforeEach(() => {
    redisSetMock.mockClear();
    redisGetMock.mockClear();
    redisDelMock.mockClear();
    process.env.XAI_API_KEY = 'test-xai-key';
    initModelWiring();
  });

  it('persists the latest conversation snapshot for resume checkpoints', async () => {
    const { TaskExecutor } = await import('../TaskExecutor');

    const executor = new TaskExecutor();
    const result = await executor.execute({
      id: 'task_checkpoint',
      userId: 'user_test',
      chatId: 'chat_test',
      objective: 'Resume the background task',
      status: 'queued',
      priority: 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      output: '',
      steps: [],
      metadata: { model: 'grok-beta' },
    });

    expect(result).toBe('FINAL ANSWER: done');
    expect(redisSetMock).toHaveBeenCalled();

    const checkpointWrite = redisSetMock.mock.calls.find(
      (call) => call[0] === 'ilia:task:checkpoint:task_checkpoint',
    );

    expect(checkpointWrite).toBeTruthy();
    const checkpoint = JSON.parse(String(checkpointWrite?.[1]));
    expect(checkpoint.turn).toBe(1);
    expect(checkpoint.conversation).toEqual([
      { role: 'system', content: 'Recovered system prompt' },
      { role: 'user', content: 'Continue task' },
      { role: 'assistant', content: 'Checkpointed progress' },
    ]);
  });
});
