import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const getOrFetchMock = vi.fn();
const listMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('../../tasks/BackgroundTaskManager', () => ({
  backgroundTaskManager: {
    spawn: spawnMock,
    getOrFetch: getOrFetchMock,
    list: listMock,
    cancel: cancelMock,
  },
}));

describe('openclawSubagentService', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    getOrFetchMock.mockReset();
    listMock.mockReset();
    cancelMock.mockReset();
  });

  it('spawns a persistent background task with openclaw metadata', async () => {
    spawnMock.mockResolvedValue({
      id: 'task_123',
      userId: 'user-1',
      chatId: 'chat-1',
      objective: 'inspect repo',
      status: 'queued',
      createdAt: 100,
      metadata: {
        source: 'openclaw_subagent',
        permissionProfile: 'full_agent',
        planHint: ['use:bash'],
      },
    });

    const { openclawSubagentService } = await import('../agents/subagentService');
    const run = await openclawSubagentService.spawn({
      requesterUserId: 'user-1',
      chatId: 'chat-1',
      objective: 'inspect repo',
      planHint: ['use:bash'],
      permissionProfile: 'full_agent',
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        chatId: 'chat-1',
        objective: 'inspect repo',
        instructions: expect.stringContaining('1. use:bash'),
        metadata: expect.objectContaining({
          source: 'openclaw_subagent',
          permissionProfile: 'full_agent',
          planHint: ['use:bash'],
        }),
      }),
    );

    expect(run).toMatchObject({
      id: 'task_123',
      requesterUserId: 'user-1',
      chatId: 'chat-1',
      objective: 'inspect repo',
      planHint: ['use:bash'],
      permissionProfile: 'full_agent',
      status: 'queued',
    });
  });

  it('filters non-openclaw tasks and maps timeout to failed', async () => {
    listMock.mockReturnValue([
      {
        id: 'task_timeout',
        userId: 'user-1',
        chatId: 'chat-1',
        objective: 'slow task',
        status: 'timeout',
        createdAt: 10,
        updatedAt: 25,
        progress: 72,
        output: 'step 1\nstep 2\nfinal partial output',
        steps: [
          { summary: 'Investigated repo', timestamp: 20 },
          { summary: 'Waiting for network', timestamp: 25 },
        ],
        metadata: {
          source: 'openclaw_subagent',
          permissionProfile: 'safe_coding',
          planHint: ['research'],
        },
      },
      {
        id: 'task_other',
        userId: 'user-1',
        chatId: 'chat-1',
        objective: 'ignore me',
        status: 'running',
        createdAt: 11,
        metadata: {
          source: 'other',
        },
      },
    ]);

    const { openclawSubagentService } = await import('../agents/subagentService');
    const runs = await openclawSubagentService.list({ requesterUserId: 'user-1', chatId: 'chat-1' });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        chatId: 'chat-1',
      }),
    );

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: 'task_timeout',
      status: 'failed',
      permissionProfile: 'safe_coding',
      planHint: ['research'],
      progress: 72,
      stepCount: 2,
      lastStepSummary: 'Waiting for network',
      updatedAt: 25,
    });
    expect(runs[0]?.outputExcerpt).toContain('final partial output');
  });
});
