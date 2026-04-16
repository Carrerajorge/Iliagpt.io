/**
 * Capability: Tool Orchestration
 * Tests LLM tool calling, parallel tool execution, result merging, and error recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson, buildToolCallMock } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface ToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ToolResult {
  callId: string;
  toolName: string;
  output: unknown;
  success: boolean;
  duration_ms: number;
  error?: string;
}

interface OrchestrationRun {
  toolCallsIssued: ToolCall[];
  toolResults: ToolResult[];
  finalResponse: string;
  iterationCount: number;
  parallelCalls: number;
  provider: string;
}

class ToolOrchestrator {
  private tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  getToolDefinitions() {
    return Array.from(this.tools.values()).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: { type: 'object', properties: t.parameters },
      },
    }));
  }

  async executeToolCall(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.toolName);
    const start = Date.now();

    if (!tool) {
      return { callId: call.id, toolName: call.toolName, output: null, success: false, duration_ms: 0, error: 'Tool not found' };
    }

    try {
      const output = await tool.execute(call.args);
      return { callId: call.id, toolName: call.toolName, output, success: true, duration_ms: Date.now() - start };
    } catch (err) {
      return { callId: call.id, toolName: call.toolName, output: null, success: false, duration_ms: Date.now() - start, error: String(err) };
    }
  }

  async executeParallel(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map((c) => this.executeToolCall(c)));
  }

  async run(
    userMessage: string,
    provider: ProviderConfig,
    llmClient: ReturnType<typeof createLLMClientMock>,
    maxIterations = 5,
  ): Promise<OrchestrationRun> {
    const allToolCalls: ToolCall[] = [];
    const allResults: ToolResult[] = [];
    let finalResponse = '';
    let iteration = 0;
    let parallelCalls = 0;

    while (iteration < maxIterations) {
      const messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [
        { role: 'user', content: userMessage },
      ];

      // Add previous tool results
      for (const result of allResults) {
        messages.push({
          role: 'tool',
          content: JSON.stringify(result.output),
          tool_call_id: result.callId,
        });
      }

      const response = await llmClient.chat.completions.create({
        model: provider.model,
        messages,
        tools: this.getToolDefinitions(),
      });

      const choice = response.choices[0];

      if (choice.finish_reason === 'stop' || !choice.message.tool_calls) {
        finalResponse = choice.message.content ?? '';
        break;
      }

      // Parse tool calls from response
      const rawCalls = (choice.message.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>) ?? [];
      const toolCalls: ToolCall[] = rawCalls.map((tc) => ({
        id: tc.id,
        toolName: tc.function.name,
        args: JSON.parse(tc.function.arguments),
      }));

      allToolCalls.push(...toolCalls);

      if (toolCalls.length > 1) parallelCalls++;
      const results = await this.executeParallel(toolCalls);
      allResults.push(...results);

      iteration++;
    }

    return {
      toolCallsIssued: allToolCalls,
      toolResults: allResults,
      finalResponse,
      iterationCount: iteration,
      parallelCalls,
      provider: provider.name,
    };
  }
}

// ── Mock tools ────────────────────────────────────────────────────────────────

const MOCK_TOOLS: Tool[] = [
  {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: { location: { type: 'string' } },
    execute: async (args) => ({ temperature: 22, condition: 'sunny', location: args.location }),
  },
  {
    name: 'search_web',
    description: 'Search the web for information',
    parameters: { query: { type: 'string' } },
    execute: async (args) => ({ results: [`Result for: ${args.query}`], count: 1 }),
  },
  {
    name: 'calculate',
    description: 'Perform arithmetic calculations',
    parameters: { expression: { type: 'string' } },
    execute: async (args) => ({ result: eval(String(args.expression)) }),
  },
  {
    name: 'failing_tool',
    description: 'A tool that always fails',
    parameters: { input: { type: 'string' } },
    execute: async () => { throw new Error('Tool execution failed'); },
  },
];

runWithEachProvider('Tool Orchestration', (provider: ProviderConfig) => {
  let orchestrator: ToolOrchestrator;
  let toolCallMock: ReturnType<typeof createLLMClientMock>;
  let finalAnswerMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    orchestrator = new ToolOrchestrator();
    for (const tool of MOCK_TOOLS) orchestrator.registerTool(tool);
  });

  it('registers tools and exposes definitions', () => {
    const defs = orchestrator.getToolDefinitions();
    expect(defs.length).toBe(4);
  });

  it('executes a single tool call', async () => {
    const result = await orchestrator.executeToolCall({
      id: 'call_1',
      toolName: 'get_weather',
      args: { location: 'San Francisco' },
    });
    expect(result.success).toBe(true);
    expect(result.output).toHaveProperty('temperature');
  });

  it('returns failure for unknown tool', async () => {
    const result = await orchestrator.executeToolCall({ id: 'call_bad', toolName: 'nonexistent', args: {} });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('handles tool execution errors gracefully', async () => {
    const result = await orchestrator.executeToolCall({ id: 'call_fail', toolName: 'failing_tool', args: { input: 'x' } });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('executes multiple tools in parallel', async () => {
    const calls: ToolCall[] = [
      { id: 'c1', toolName: 'get_weather', args: { location: 'NYC' } },
      { id: 'c2', toolName: 'search_web', args: { query: 'AI news' } },
    ];
    const results = await orchestrator.executeParallel(calls);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('calculates arithmetic correctly', async () => {
    const result = await orchestrator.executeToolCall({ id: 'calc_1', toolName: 'calculate', args: { expression: '2 + 2' } });
    expect(result.success).toBe(true);
    expect((result.output as { result: number }).result).toBe(4);
  });

  it('measures tool execution duration', async () => {
    const result = await orchestrator.executeToolCall({ id: 'timed', toolName: 'get_weather', args: { location: 'LA' } });
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('full orchestration run completes', async () => {
    const llmMock = createLLMClientMock({
      content: 'The weather in SF is 22°C and sunny.',
      model: provider.model,
    });
    const run = await orchestrator.run('What is the weather in SF?', provider, llmMock);
    expect(run.finalResponse.length).toBeGreaterThan(0);
    expect(run.provider).toBe(provider.name);
  });

  it('orchestration run with tool calls uses correct model', async () => {
    const llmMock = createLLMClientMock({
      content: 'Answer based on tool results.',
      model: provider.model,
    });
    await orchestrator.run('Search for AI news', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('parallel tool execution returns correct number of results', async () => {
    const calls: ToolCall[] = Array.from({ length: 3 }, (_, i) => ({
      id: `call_${i}`,
      toolName: 'get_weather',
      args: { location: `City ${i}` },
    }));
    const results = await orchestrator.executeParallel(calls);
    expect(results.length).toBe(3);
  });

  it('tool definitions have correct structure', () => {
    const defs = orchestrator.getToolDefinitions();
    for (const def of defs) {
      expect(def.type).toBe('function');
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
    }
  });

  it('result includes callId matching the tool call id', async () => {
    const result = await orchestrator.executeToolCall({ id: 'id_xyz', toolName: 'search_web', args: { query: 'test' } });
    expect(result.callId).toBe('id_xyz');
  });
});
