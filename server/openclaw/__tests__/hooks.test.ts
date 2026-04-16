import { describe, it, expect, vi } from 'vitest';
import { HookSystem } from '../plugins/hookSystem';

describe('Hook System', () => {
  it('dispatches hooks to registered handlers', async () => {
    const hooks = new HookSystem();
    const handler = vi.fn();

    hooks.register('before_tool_call', handler);

    await hooks.dispatch('before_tool_call', {
      toolName: 'openclaw_exec',
      toolInput: { command: 'echo test' },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].toolName).toBe('openclaw_exec');
  });

  it('supports multiple handlers per hook point', async () => {
    const hooks = new HookSystem();
    const h1 = vi.fn();
    const h2 = vi.fn();

    hooks.register('agent_end', h1);
    hooks.register('agent_end', h2);

    await hooks.dispatch('agent_end', { runId: 'r1' });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('catches handler errors without stopping dispatch', async () => {
    const hooks = new HookSystem();
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const passing = vi.fn();

    hooks.register('before_tool_call', failing);
    hooks.register('before_tool_call', passing);

    await hooks.dispatch('before_tool_call', {});

    expect(failing).toHaveBeenCalled();
    expect(passing).toHaveBeenCalled(); // Should still run
  });

  it('tracks registered hook points', () => {
    const hooks = new HookSystem();
    hooks.register('session_start', vi.fn());
    hooks.register('session_end', vi.fn());
    hooks.register('error', vi.fn());

    const points = hooks.getRegisteredPoints();
    expect(points).toContain('session_start');
    expect(points).toContain('session_end');
    expect(points).toContain('error');
    expect(points).toHaveLength(3);
  });

  it('supports unregister', async () => {
    const hooks = new HookSystem();
    const handler = vi.fn();

    hooks.register('message_received', handler);
    expect(hooks.getHandlerCount('message_received')).toBe(1);

    hooks.unregister('message_received', handler);
    expect(hooks.getHandlerCount('message_received')).toBe(0);

    await hooks.dispatch('message_received', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('clears all hooks', () => {
    const hooks = new HookSystem();
    hooks.register('gateway_start', vi.fn());
    hooks.register('gateway_stop', vi.fn());

    hooks.clear();

    expect(hooks.getRegisteredPoints()).toHaveLength(0);
  });
});
