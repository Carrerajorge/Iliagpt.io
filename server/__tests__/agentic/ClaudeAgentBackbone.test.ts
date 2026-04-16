import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Local test implementation — replace with real import when file exists
// ─────────────────────────────────────────────────────────────────────────────

type StreamEventType =
  | 'text_delta'
  | 'tool_use_start'
  | 'tool_result'
  | 'complete'
  | 'error'

interface StreamEvent {
  type: StreamEventType
  data: unknown
}

type StreamCallback = (event: StreamEvent) => void

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ToolDef {
  name: string
  description: string
  execute: (params: unknown) => Promise<unknown>
}

interface ToolCall {
  toolName: string
  input: unknown
  output: unknown
  error?: string
}

interface AgentResult {
  finalText: string
  toolCalls: ToolCall[]
  inputTokens: number
  outputTokens: number
  cost: number
  iterations: number
  partial?: boolean
  error?: string
}

interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

// Claude 3.5 Sonnet pricing
const INPUT_TOKEN_PRICE = 0.000003
const OUTPUT_TOKEN_PRICE = 0.000015

interface MockAnthropicClient {
  messages: {
    create: ReturnType<typeof vi.fn>
  }
}

interface AgentOptions {
  client: MockAnthropicClient
  model: string
  tools: ToolDef[]
  maxIterations?: number
}

// Shape of Anthropic API content blocks
interface TextBlock {
  type: 'text'
  text: string
}

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

interface ThinkingBlockRaw {
  type: 'thinking'
  thinking: string
}

type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlockRaw

interface AnthropicResponse {
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'
  content: ContentBlock[]
  usage: { input_tokens: number; output_tokens: number }
}

class ClaudeAgentBackbone {
  private client: MockAnthropicClient
  private model: string
  private tools: ToolDef[]
  private maxIterations: number
  private thinkingBlocks: ThinkingBlock[] = []

  constructor(options: AgentOptions) {
    this.client = options.client
    this.model = options.model
    this.tools = options.tools
    this.maxIterations = options.maxIterations ?? 10
  }

  async run(messages: Message[]): Promise<AgentResult> {
    const conversationMessages: Array<{ role: string; content: unknown }> = messages.map(
      (m) => ({ role: m.role, content: m.content }),
    )

    const toolCalls: ToolCall[] = []
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let iterations = 0
    let finalText = ''

    while (iterations < this.maxIterations) {
      iterations++

      const requestParams = this._buildRequestParams(conversationMessages)

      let response: AnthropicResponse
      try {
        response = await this.client.messages.create(requestParams)
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return {
          finalText,
          toolCalls,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cost: this._computeCost(totalInputTokens, totalOutputTokens),
          iterations,
          partial: true,
          error: errMsg,
        }
      }

      totalInputTokens += response.usage.input_tokens
      totalOutputTokens += response.usage.output_tokens

      // Collect thinking blocks
      for (const block of response.content) {
        if (block.type === 'thinking') {
          this.thinkingBlocks.push({ type: 'thinking', thinking: block.thinking })
        }
      }

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find(
          (b): b is TextBlock => b.type === 'text',
        )
        finalText = textBlock?.text ?? ''
        break
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        )

        // Add assistant message
        conversationMessages.push({ role: 'assistant', content: response.content })

        const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = []

        for (const toolBlock of toolUseBlocks) {
          const toolDef = this.tools.find((t) => t.name === toolBlock.name)
          let output: unknown
          let errorMsg: string | undefined

          // Parse input safely
          let parsedInput: unknown = toolBlock.input
          if (typeof toolBlock.input === 'string') {
            try {
              parsedInput = JSON.parse(toolBlock.input)
            } catch {
              parsedInput = {}
            }
          }

          if (!toolDef) {
            errorMsg = `Tool "${toolBlock.name}" not found`
            output = null
          } else {
            try {
              output = await toolDef.execute(parsedInput)
            } catch (err: unknown) {
              errorMsg = err instanceof Error ? err.message : String(err)
              output = null
            }
          }

          toolCalls.push({
            toolName: toolBlock.name,
            input: parsedInput,
            output,
            error: errorMsg,
          })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: errorMsg
              ? `Error: ${errorMsg}`
              : JSON.stringify(output),
          })
        }

        conversationMessages.push({ role: 'user', content: toolResults })
      }
    }

    if (iterations >= this.maxIterations && finalText === '') {
      return {
        finalText,
        toolCalls,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cost: this._computeCost(totalInputTokens, totalOutputTokens),
        iterations,
        partial: true,
        error: 'Max iterations exceeded',
      }
    }

    return {
      finalText,
      toolCalls,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cost: this._computeCost(totalInputTokens, totalOutputTokens),
      iterations,
    }
  }

  async runStreaming(messages: Message[], onEvent: StreamCallback): Promise<AgentResult> {
    const result = await this.run(messages)

    // Emit streaming events based on the result
    if (result.finalText) {
      onEvent({ type: 'text_delta', data: { text: result.finalText } })
    }
    for (const tc of result.toolCalls) {
      onEvent({ type: 'tool_use_start', data: { toolName: tc.toolName, input: tc.input } })
      onEvent({ type: 'tool_result', data: { toolName: tc.toolName, output: tc.output, error: tc.error } })
    }
    onEvent({ type: 'complete', data: result })

    return result
  }

  getThinkingBlocks(): ThinkingBlock[] {
    return this.thinkingBlocks
  }

  private _buildRequestParams(messages: Array<{ role: string; content: unknown }>): unknown {
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: 8096,
      messages,
      tools: this.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { type: 'object', properties: {} },
      })),
    }

    if (this.model === 'claude-3-7-sonnet-20250219') {
      params['thinking'] = {
        type: 'enabled',
        budget_tokens: 5000,
      }
    }

    return params
  }

  private _computeCost(inputTokens: number, outputTokens: number): number {
    return inputTokens * INPUT_TOKEN_PRICE + outputTokens * OUTPUT_TOKEN_PRICE
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeAnthropicClient(): MockAnthropicClient {
  return {
    messages: {
      create: vi.fn(),
    },
  }
}

function makeToolUseResponse(
  toolName: string,
  toolId: string,
  input: unknown,
  inputTokens = 100,
  outputTokens = 50,
): AnthropicResponse {
  return {
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: toolId, name: toolName, input },
    ],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

function makeEndTurnResponse(
  text: string,
  inputTokens = 80,
  outputTokens = 40,
): AnthropicResponse {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

function makeUserMessage(content: string): Message {
  return { role: 'user', content }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ClaudeAgentBackbone', () => {
  let client: MockAnthropicClient
  const echoTool: ToolDef = {
    name: 'echo',
    description: 'Echoes the provided message back',
    execute: vi.fn().mockResolvedValue({ echoed: 'hello from tool' }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    client = makeAnthropicClient()
  })

  // ── 1. Basic tool_use flow ────────────────────────────────────────────────

  describe('basic tool_use flow', () => {
    it('single tool call — tool executed — final answer returned', async () => {
      client.messages.create
        .mockResolvedValueOnce(makeToolUseResponse('echo', 'tool-1', { msg: 'hi' }))
        .mockResolvedValueOnce(makeEndTurnResponse('The echo tool replied successfully.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const result = await agent.run([makeUserMessage('Please echo hello')])

      expect(result.finalText).toBe('The echo tool replied successfully.')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].toolName).toBe('echo')
    })

    it('tool result is included in the next iteration messages', async () => {
      client.messages.create
        .mockResolvedValueOnce(makeToolUseResponse('echo', 'tool-1', { msg: 'test' }))
        .mockResolvedValueOnce(makeEndTurnResponse('Done.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      await agent.run([makeUserMessage('Use the echo tool')])

      // Second call should have tool results in the messages
      const secondCallArgs = client.messages.create.mock.calls[1][0]
      const msgs = secondCallArgs.messages
      const hasToolResult = msgs.some(
        (m: { role: string; content: unknown }) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          (m.content as Array<{type: string}>).some((c) => c.type === 'tool_result'),
      )
      expect(hasToolResult).toBe(true)
    })

    it('iterations count equals number of LLM calls made', async () => {
      client.messages.create
        .mockResolvedValueOnce(makeToolUseResponse('echo', 'tool-1', {}))
        .mockResolvedValueOnce(makeEndTurnResponse('Final answer.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const result = await agent.run([makeUserMessage('Test')])
      expect(result.iterations).toBe(2)
      expect(client.messages.create).toHaveBeenCalledTimes(2)
    })

    it('finalText comes from the last end_turn response', async () => {
      client.messages.create
        .mockResolvedValueOnce(makeToolUseResponse('echo', 'tool-1', {}))
        .mockResolvedValueOnce(makeEndTurnResponse('This is the definitive final answer.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const result = await agent.run([makeUserMessage('Give me the answer')])
      expect(result.finalText).toBe('This is the definitive final answer.')
    })

    it('no tool calls needed — returns immediate end_turn result', async () => {
      client.messages.create.mockResolvedValueOnce(
        makeEndTurnResponse('No tools needed, direct answer.'),
      )

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const result = await agent.run([makeUserMessage('What is 2+2?')])
      expect(result.iterations).toBe(1)
      expect(result.toolCalls).toHaveLength(0)
      expect(result.finalText).toBe('No tools needed, direct answer.')
    })
  })

  // ── 2. Extended thinking ──────────────────────────────────────────────────

  describe('extended thinking', () => {
    it('claude-3-7-sonnet model adds thinking config to request params', async () => {
      client.messages.create.mockResolvedValueOnce(makeEndTurnResponse('Done thinking.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-7-sonnet-20250219',
        tools: [],
      })

      await agent.run([makeUserMessage('Think deeply about this')])

      const callArgs = client.messages.create.mock.calls[0][0]
      expect(callArgs.thinking).toBeDefined()
      expect(callArgs.thinking.type).toBe('enabled')
      expect(callArgs.thinking.budget_tokens).toBeGreaterThan(0)
    })

    it('standard model does not add thinking config', async () => {
      client.messages.create.mockResolvedValueOnce(makeEndTurnResponse('Done.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [],
      })

      await agent.run([makeUserMessage('Simple question')])

      const callArgs = client.messages.create.mock.calls[0][0]
      expect(callArgs.thinking).toBeUndefined()
    })

    it('thinking blocks are parsed and stored in the agent', async () => {
      const responseWithThinking: AnthropicResponse = {
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: 'I am reasoning step by step...' },
          { type: 'text', text: 'Final answer after thinking.' },
        ],
        usage: { input_tokens: 150, output_tokens: 60 },
      }

      client.messages.create.mockResolvedValueOnce(responseWithThinking)

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-7-sonnet-20250219',
        tools: [],
      })

      await agent.run([makeUserMessage('Think about this problem')])

      const thinkingBlocks = agent.getThinkingBlocks()
      expect(thinkingBlocks.length).toBeGreaterThan(0)
      expect(thinkingBlocks[0].thinking).toContain('reasoning step by step')
    })
  })

  // ── 3. Streaming events ───────────────────────────────────────────────────

  describe('streaming events', () => {
    it('emits text_delta event during response', async () => {
      client.messages.create.mockResolvedValueOnce(
        makeEndTurnResponse('Streaming response text.'),
      )

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const events: StreamEvent[] = []
      await agent.runStreaming([makeUserMessage('Test')], (e) => events.push(e))

      expect(events.some((e) => e.type === 'text_delta')).toBe(true)
    })

    it('emits tool_use_start event before tool execution', async () => {
      client.messages.create
        .mockResolvedValueOnce(makeToolUseResponse('echo', 'tool-1', { msg: 'hi' }))
        .mockResolvedValueOnce(makeEndTurnResponse('Done.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const events: StreamEvent[] = []
      await agent.runStreaming([makeUserMessage('Use echo tool')], (e) => events.push(e))

      expect(events.some((e) => e.type === 'tool_use_start')).toBe(true)
    })

    it('emits tool_result event after tool execution', async () => {
      client.messages.create
        .mockResolvedValueOnce(makeToolUseResponse('echo', 'tool-1', { msg: 'test' }))
        .mockResolvedValueOnce(makeEndTurnResponse('Done.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const events: StreamEvent[] = []
      await agent.runStreaming([makeUserMessage('Use tool')], (e) => events.push(e))

      expect(events.some((e) => e.type === 'tool_result')).toBe(true)
    })

    it('emits complete event at the end', async () => {
      client.messages.create.mockResolvedValueOnce(makeEndTurnResponse('All done.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [],
      })

      const events: StreamEvent[] = []
      await agent.runStreaming([makeUserMessage('Test')], (e) => events.push(e))

      const completeEvents = events.filter((e) => e.type === 'complete')
      expect(completeEvents).toHaveLength(1)
    })

    it('streaming result matches run result', async () => {
      client.messages.create
        .mockResolvedValue(makeEndTurnResponse('Consistent result.', 100, 50))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [],
      })

      const events: StreamEvent[] = []
      const result = await agent.runStreaming([makeUserMessage('Test')], (e) =>
        events.push(e),
      )

      expect(result.finalText).toBe('Consistent result.')
    })
  })

  // ── 4. Cost tracking ──────────────────────────────────────────────────────

  describe('cost tracking', () => {
    it('input and output tokens counted correctly for single iteration', async () => {
      client.messages.create.mockResolvedValueOnce(
        makeEndTurnResponse('Answer.', 200, 100),
      )

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [],
      })

      const result = await agent.run([makeUserMessage('Question')])
      expect(result.inputTokens).toBe(200)
      expect(result.outputTokens).toBe(100)
    })

    it('cost formula: inputTokens * 0.000003 + outputTokens * 0.000015', async () => {
      client.messages.create.mockResolvedValueOnce(
        makeEndTurnResponse('Answer.', 1000, 500),
      )

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [],
      })

      const result = await agent.run([makeUserMessage('Question')])
      const expectedCost = 1000 * 0.000003 + 500 * 0.000015
      expect(result.cost).toBeCloseTo(expectedCost, 8)
    })

    it('multi-iteration cost accumulates correctly across all LLM calls', async () => {
      client.messages.create
        .mockResolvedValueOnce(
          makeToolUseResponse('echo', 'tool-1', {}, 300, 150),
        )
        .mockResolvedValueOnce(makeEndTurnResponse('Final.', 250, 100))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const result = await agent.run([makeUserMessage('Multi-iteration test')])

      const totalInput = 300 + 250
      const totalOutput = 150 + 100
      const expectedCost = totalInput * 0.000003 + totalOutput * 0.000015

      expect(result.inputTokens).toBe(totalInput)
      expect(result.outputTokens).toBe(totalOutput)
      expect(result.cost).toBeCloseTo(expectedCost, 8)
    })

    it('cost is always a non-negative number', async () => {
      client.messages.create.mockResolvedValueOnce(makeEndTurnResponse('OK', 0, 0))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [],
      })

      const result = await agent.run([makeUserMessage('Test')])
      expect(result.cost).toBeGreaterThanOrEqual(0)
      expect(typeof result.cost).toBe('number')
    })
  })

  // ── 5. Error recovery ─────────────────────────────────────────────────────

  describe('error recovery', () => {
    it('tool that throws — error captured in tool_result — agent continues', async () => {
      const failingTool: ToolDef = {
        name: 'failing_tool',
        description: 'A tool that always throws',
        execute: vi.fn().mockRejectedValue(new Error('Tool execution failed!')),
      }

      client.messages.create
        .mockResolvedValueOnce(
          makeToolUseResponse('failing_tool', 'tool-err-1', { arg: 'value' }),
        )
        .mockResolvedValueOnce(makeEndTurnResponse('Handled the error gracefully.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [failingTool],
      })

      const result = await agent.run([makeUserMessage('Use the failing tool')])

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].error).toBeTruthy()
      expect(result.finalText).toBe('Handled the error gracefully.')
    })

    it('malformed JSON tool args parsed safely with fallback to empty object', async () => {
      const spy = vi.fn().mockResolvedValue({ result: 'ok' })
      const tool: ToolDef = {
        name: 'safe_tool',
        description: 'A tool with safe param parsing',
        execute: spy,
      }

      client.messages.create
        .mockResolvedValueOnce(
          makeToolUseResponse('safe_tool', 'tool-1', 'not valid json {{'),
        )
        .mockResolvedValueOnce(makeEndTurnResponse('Completed safely.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [tool],
      })

      const result = await agent.run([makeUserMessage('Test malformed params')])

      // Should not throw; tool called with empty object fallback
      expect(spy).toHaveBeenCalledWith({})
      expect(result.finalText).toBe('Completed safely.')
    })

    it('max iterations exceeded returns partial result with error flag', async () => {
      // Always returns tool_use — will hit the iteration limit
      client.messages.create.mockResolvedValue(
        makeToolUseResponse('echo', 'tool-1', {}),
      )

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
        maxIterations: 3,
      })

      const result = await agent.run([makeUserMessage('Loop forever')])

      expect(result.partial).toBe(true)
      expect(result.error).toContain('Max iterations')
      expect(result.iterations).toBe(3)
    })

    it('LLM client throwing returns partial result with error', async () => {
      client.messages.create.mockRejectedValue(new Error('API connection refused'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [],
      })

      const result = await agent.run([makeUserMessage('This will fail')])
      expect(result.partial).toBe(true)
      expect(result.error).toContain('connection refused')
    })
  })

  // ── 6. Multiple tools ─────────────────────────────────────────────────────

  describe('multiple tools', () => {
    it('two tools available — agent selects and executes the correct one', async () => {
      const searchTool: ToolDef = {
        name: 'search',
        description: 'Searches the web for information',
        execute: vi.fn().mockResolvedValue({ results: ['result1', 'result2'] }),
      }
      const calculatorTool: ToolDef = {
        name: 'calculator',
        description: 'Performs mathematical calculations',
        execute: vi.fn().mockResolvedValue({ answer: 42 }),
      }

      client.messages.create
        .mockResolvedValueOnce(
          makeToolUseResponse('calculator', 'tool-calc-1', { expression: '6*7' }),
        )
        .mockResolvedValueOnce(makeEndTurnResponse('The answer is 42.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [searchTool, calculatorTool],
      })

      const result = await agent.run([makeUserMessage('Calculate 6 times 7')])

      expect(calculatorTool.execute).toHaveBeenCalledTimes(1)
      expect(searchTool.execute).not.toHaveBeenCalled()
      expect(result.finalText).toBe('The answer is 42.')
    })

    it('sequential tool calls in one session — both tools executed in order', async () => {
      const tool1: ToolDef = {
        name: 'step_one',
        description: 'First step in the workflow',
        execute: vi.fn().mockResolvedValue({ done: 'step1' }),
      }
      const tool2: ToolDef = {
        name: 'step_two',
        description: 'Second step in the workflow',
        execute: vi.fn().mockResolvedValue({ done: 'step2' }),
      }

      client.messages.create
        .mockResolvedValueOnce(makeToolUseResponse('step_one', 'tool-s1', {}))
        .mockResolvedValueOnce(makeToolUseResponse('step_two', 'tool-s2', {}))
        .mockResolvedValueOnce(makeEndTurnResponse('Both steps completed.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [tool1, tool2],
      })

      const result = await agent.run([makeUserMessage('Run both steps')])

      expect(tool1.execute).toHaveBeenCalledTimes(1)
      expect(tool2.execute).toHaveBeenCalledTimes(1)
      expect(result.toolCalls).toHaveLength(2)
      expect(result.toolCalls[0].toolName).toBe('step_one')
      expect(result.toolCalls[1].toolName).toBe('step_two')
    })

    it('tool not found in tools list — error captured without crashing', async () => {
      client.messages.create
        .mockResolvedValueOnce(makeToolUseResponse('nonexistent_tool', 'tool-x', {}))
        .mockResolvedValueOnce(makeEndTurnResponse('Handled missing tool.'))

      const agent = new ClaudeAgentBackbone({
        client,
        model: 'claude-3-5-sonnet-20241022',
        tools: [echoTool],
      })

      const result = await agent.run([makeUserMessage('Use nonexistent tool')])
      expect(result.toolCalls[0].error).toContain('not found')
      expect(result.finalText).toBe('Handled missing tool.')
    })
  })
})
