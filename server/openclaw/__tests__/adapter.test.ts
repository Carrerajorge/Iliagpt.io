import { describe, it, expect, vi } from 'vitest';

// Mock toolRegistry before importing adapter
vi.mock('../../agent/toolRegistry', () => {
  const tools = new Map();
  return {
    ToolRegistry: class {},
    toolRegistry: {
      register: vi.fn((tool: any) => tools.set(tool.name, tool)),
      get: vi.fn((name: string) => tools.get(name)),
      list: vi.fn(() => Array.from(tools.values())),
    },
  };
});

import { registerOpenClawTools } from '../tools/adapter';
import { toolRegistry } from '../../agent/toolRegistry';
import { getOpenClawConfig } from '../config';

describe('Tool Adapter', () => {
  it('registers openclaw tools into the existing registry', () => {
    const config = {
      ...getOpenClawConfig(),
      tools: {
        enabled: true,
        safeBins: ['echo', 'ls'],
        workspaceRoot: '/tmp/oclw-test-adapter',
        execTimeout: 5000,
        execSecurity: 'allow' as const,
      },
    };
    registerOpenClawTools(config);

    // Should have registered exec + fs tools + agentic tools
    expect((toolRegistry.register as any).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('registers tools with correct names', () => {
    const registeredNames = (toolRegistry.register as any).mock.calls.map(
      (call: any[]) => call[0].name,
    );
    expect(registeredNames).toContain('openclaw_exec');
    expect(registeredNames).toContain('openclaw_read');
    expect(registeredNames).toContain('openclaw_write');
    expect(registeredNames).toContain('openclaw_edit');
    expect(registeredNames).toContain('openclaw_list');
    expect(registeredNames).toContain('openclaw_spawn_subagent');
    expect(registeredNames).toContain('openclaw_rag_search');
  });
});
