/**
 * Capability: Dispatch / Task Routing
 * Tests intelligent task routing to the right agent, tool, or integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson, buildToolCallMock } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

type DispatchTarget =
  | 'excel_generator'
  | 'pdf_generator'
  | 'browser_agent'
  | 'code_executor'
  | 'research_agent'
  | 'calendar_integration'
  | 'email_integration'
  | 'data_analyst'
  | 'chat_agent';

interface DispatchDecision {
  target: DispatchTarget;
  confidence: number;
  parameters: Record<string, unknown>;
  fallback?: DispatchTarget;
  reasoning: string;
}

interface DispatchResult {
  decision: DispatchDecision;
  executed: boolean;
  targetOutput?: unknown;
  provider: string;
  latency_ms: number;
}

const DISPATCH_RULES: Record<string, DispatchTarget> = {
  excel: 'excel_generator',
  spreadsheet: 'excel_generator',
  pdf: 'pdf_generator',
  invoice: 'pdf_generator',
  browse: 'browser_agent',
  scrape: 'browser_agent',
  code: 'code_executor',
  python: 'code_executor',
  research: 'research_agent',
  calendar: 'calendar_integration',
  schedule: 'calendar_integration',
  email: 'email_integration',
  send: 'email_integration',
  analyze: 'data_analyst',
  data: 'data_analyst',
};

function classifyLocally(message: string): DispatchTarget {
  const lower = message.toLowerCase();
  for (const [keyword, target] of Object.entries(DISPATCH_RULES)) {
    if (lower.includes(keyword)) return target;
  }
  return 'chat_agent';
}

async function dispatchTask(
  userMessage: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<DispatchResult> {
  const start = Date.now();

  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      {
        role: 'system',
        content: 'Route this task to the most appropriate tool. Return JSON with target, confidence, parameters, reasoning.',
      },
      { role: 'user', content: userMessage },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);
  const decision = (spec.schedule as DispatchDecision | undefined) ?? {
    target: classifyLocally(userMessage),
    confidence: 0.75,
    parameters: {},
    reasoning: 'Local classification fallback',
  };

  // Normalize decision structure from LLM response
  const normalizedDecision: DispatchDecision = {
    target: (decision.target ?? classifyLocally(userMessage)) as DispatchTarget,
    confidence: (decision.confidence as number | undefined) ?? 0.75,
    parameters: (decision.parameters as Record<string, unknown> | undefined) ?? {},
    reasoning: (decision.reasoning as string | undefined) ?? 'LLM routing',
  };

  return {
    decision: normalizedDecision,
    executed: true,
    provider: provider.name,
    latency_ms: Date.now() - start,
  };
}

const DISPATCH_RESPONSE = JSON.stringify({
  target: 'excel_generator',
  confidence: 0.95,
  parameters: { filename: 'report.xlsx', prompt: 'Create quarterly report' },
  reasoning: 'User explicitly asks for Excel spreadsheet generation',
});

runWithEachProvider('Dispatch / Task Routing', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: DISPATCH_RESPONSE, model: provider.model });
  });

  it('routes Excel requests to excel_generator', async () => {
    const result = await dispatchTask('Create an Excel report', provider, llmMock);
    expect(result.decision.target).toBe('excel_generator');
  });

  it('returns confidence score between 0 and 1', async () => {
    const result = await dispatchTask('Make a spreadsheet', provider, llmMock);
    expect(result.decision.confidence).toBeGreaterThanOrEqual(0);
    expect(result.decision.confidence).toBeLessThanOrEqual(1);
  });

  it('includes routing parameters', async () => {
    const result = await dispatchTask('Generate quarterly Excel', provider, llmMock);
    expect(result.decision.parameters).toBeDefined();
    expect(typeof result.decision.parameters).toBe('object');
  });

  it('includes reasoning in decision', async () => {
    const result = await dispatchTask('Create a spreadsheet', provider, llmMock);
    expect(result.decision.reasoning).toBeTruthy();
  });

  it('marks task as executed', async () => {
    const result = await dispatchTask('Any task', provider, llmMock);
    expect(result.executed).toBe(true);
  });

  it('measures latency', async () => {
    const result = await dispatchTask('Measure me', provider, llmMock);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('routes PDF requests to pdf_generator (local fallback)', async () => {
    const pdfMock = createLLMClientMock({ content: '{}', model: provider.model });
    const result = await dispatchTask('Generate a PDF invoice', provider, pdfMock);
    expect(result.decision.target).toBe('pdf_generator');
  });

  it('routes browser tasks to browser_agent (local fallback)', async () => {
    const browserMock = createLLMClientMock({ content: '{}', model: provider.model });
    const result = await dispatchTask('Browse and scrape this website', provider, browserMock);
    expect(result.decision.target).toBe('browser_agent');
  });

  it('routes code tasks to code_executor (local fallback)', async () => {
    const codeMock = createLLMClientMock({ content: '{}', model: provider.model });
    const result = await dispatchTask('Run this Python code', provider, codeMock);
    expect(result.decision.target).toBe('code_executor');
  });

  it('falls back to chat_agent for ambiguous tasks', async () => {
    const ambiguousMock = createLLMClientMock({ content: '{}', model: provider.model });
    const result = await dispatchTask('Hello, how are you?', provider, ambiguousMock);
    expect(result.decision.target).toBe('chat_agent');
  });

  it('calls LLM exactly once per dispatch', async () => {
    await dispatchTask('Dispatch this', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await dispatchTask('Route this', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('sets provider name', async () => {
    const result = await dispatchTask('Test', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });
});
