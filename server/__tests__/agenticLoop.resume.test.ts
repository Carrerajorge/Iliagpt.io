import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { AgenticLoop } from '../agentic/core/AgenticLoop';
import { ToolRegistry } from '../agentic/toolCalling/ToolRegistry';

const streamChatMock = vi.fn();

vi.mock('../lib/llmGateway', () => ({
  llmGateway: {
    streamChat: streamChatMock,
  },
}));

const GENERIC_TOOL_INSTRUCTION = `
When you want to use a tool, respond with ONLY a JSON block (no other text):
{"tool":"<name>","input":{...}}

After you get the tool result, continue reasoning naturally.
When you're done with tools and have the final answer, just reply normally.
`.trim();

describe('AgenticLoop generic resume handling', () => {
  beforeEach(() => {
    streamChatMock.mockReset();
  });

  it('does not duplicate the generic tool prompt when resuming from a system snapshot', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    streamChatMock.mockImplementation(async function* (messages: Array<{ role: string; content: string }>) {
      capturedMessages = messages;
      yield { content: 'All set.', done: true };
    });

    const registry = new ToolRegistry();
    registry.register({
      name: 'test_lookup',
      description: 'Lookup test data',
      category: 'web',
      permissions: ['network'],
      parameters: [],
      inputSchema: z.object({ query: z.string().optional() }),
      execute: async () => ({
        success: true,
        output: { ok: true },
        durationMs: 1,
      }),
    });

    const loop = new AgenticLoop();
    const finalAnswer = await loop.run(
      [
        { role: 'system', content: `Recovered task context\n\n${GENERIC_TOOL_INSTRUCTION}` },
        { role: 'user', content: 'continua la tarea' },
      ],
      {
        model: 'gemini-2.5-flash',
        provider: 'generic',
        forceGenericMode: true,
        toolRegistry: registry,
        userId: 'user_test',
        chatId: 'chat_resume',
        runId: 'run_resume',
        workspaceRoot: '/tmp/ilia-resume-test',
      },
    );

    expect(finalAnswer).toBe('All set.');
    expect(capturedMessages[0]?.role).toBe('system');
    expect(capturedMessages[0]?.content.match(/When you want to use a tool, respond with ONLY a JSON block/g)).toHaveLength(1);
  });
});
