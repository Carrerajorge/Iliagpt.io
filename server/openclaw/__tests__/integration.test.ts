import { describe, it, expect, vi } from 'vitest';
import { hookSystem } from '../plugins/hookSystem';

describe('Hook Integration', () => {
  it('hookSystem is importable and functional', async () => {
    const handler = vi.fn();
    hookSystem.register('before_tool_call', handler);
    await hookSystem.dispatch('before_tool_call', { toolName: 'test' });
    expect(handler).toHaveBeenCalled();
    hookSystem.clear();
  });

  it('hookSystem survives rapid dispatch of multiple hook points', async () => {
    const handlers = {
      before_tool_call: vi.fn(),
      after_tool_call: vi.fn(),
      agent_end: vi.fn(),
      error: vi.fn(),
    };

    for (const [point, handler] of Object.entries(handlers)) {
      hookSystem.register(point as any, handler);
    }

    await Promise.all([
      hookSystem.dispatch('before_tool_call', { toolName: 'exec', userId: 'u1' }),
      hookSystem.dispatch('after_tool_call', { toolName: 'exec', userId: 'u1' }),
      hookSystem.dispatch('agent_end', { runId: 'r1' }),
    ]);

    expect(handlers.before_tool_call).toHaveBeenCalledOnce();
    expect(handlers.after_tool_call).toHaveBeenCalledOnce();
    expect(handlers.agent_end).toHaveBeenCalledOnce();
    expect(handlers.error).not.toHaveBeenCalled();

    hookSystem.clear();
  });
});
