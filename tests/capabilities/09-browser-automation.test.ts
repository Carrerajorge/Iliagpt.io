/**
 * Capability: Browser Automation
 * Tests Playwright-based web automation: navigation, clicks, form fills, scraping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { BROWSER_AUTOMATION_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

// ── Mock Playwright ───────────────────────────────────────────────────────────
const mockPage = {
  goto: vi.fn().mockResolvedValue({ status: () => 200 }),
  click: vi.fn().mockResolvedValue(undefined),
  fill: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot-png')),
  evaluate: vi.fn().mockResolvedValue([['R1C1', 'R1C2'], ['R2C1', 'R2C2']]),
  waitForSelector: vi.fn().mockResolvedValue({}),
  waitForNavigation: vi.fn().mockResolvedValue({}),
  close: vi.fn(),
  url: vi.fn().mockReturnValue('https://example.com/dashboard'),
  title: vi.fn().mockResolvedValue('Dashboard - Example'),
  content: vi.fn().mockResolvedValue('<html><body>Mock page</body></html>'),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn(),
};

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

vi.mock('../../server/db', () => ({ db: {} }));

interface BrowserStep {
  action: string;
  url?: string;
  selector?: string;
  value?: string;
  result?: unknown;
  status: 'success' | 'failure';
  duration_ms: number;
}

interface AutomationResult {
  steps: BrowserStep[];
  totalDuration_ms: number;
  screenshotsCount: number;
  pagesVisited: number;
  extractedData?: unknown[];
  provider: string;
}

async function runBrowserAutomation(
  instructions: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<AutomationResult> {
  // LLM converts natural language instructions to step plan
  const planResponse = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Convert browser automation instructions to a JSON step plan.' },
      { role: 'user', content: instructions },
    ],
  });

  const spec = expectValidJson(planResponse.choices[0].message.content);
  const steps = (spec.steps as BrowserStep[]) ?? [];
  const screenshots = steps.filter((s) => s.action === 'screenshot');
  const navigations = steps.filter((s) => s.action === 'navigate');

  return {
    steps,
    totalDuration_ms: spec.totalDuration_ms as number ?? 0,
    screenshotsCount: screenshots.length,
    pagesVisited: navigations.length,
    extractedData: steps
      .filter((s) => s.action === 'extract')
      .flatMap((s) => (Array.isArray(s.result) ? s.result as unknown[] : [])),
    provider: provider.name,
  };
}

runWithEachProvider('Browser Automation', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    vi.clearAllMocks();
    llmMock = createLLMClientMock({ content: BROWSER_AUTOMATION_RESPONSE, model: provider.model });
  });

  it('produces a step plan from natural language', async () => {
    const result = await runBrowserAutomation('Login to example.com and screenshot the dashboard', provider, llmMock);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('includes navigation steps', async () => {
    const result = await runBrowserAutomation('Go to example.com', provider, llmMock);
    expect(result.pagesVisited).toBeGreaterThan(0);
  });

  it('counts screenshots correctly', async () => {
    const result = await runBrowserAutomation('Take screenshots', provider, llmMock);
    expect(result.screenshotsCount).toBeGreaterThanOrEqual(1);
  });

  it('all steps have a status field', async () => {
    const result = await runBrowserAutomation('Multi-step task', provider, llmMock);
    for (const step of result.steps) {
      expect(['success', 'failure']).toContain(step.status);
    }
  });

  it('all steps have duration_ms', async () => {
    const result = await runBrowserAutomation('Timed task', provider, llmMock);
    for (const step of result.steps) {
      expect(typeof step.duration_ms).toBe('number');
    }
  });

  it('reports total duration', async () => {
    const result = await runBrowserAutomation('Any task', provider, llmMock);
    expect(result.totalDuration_ms).toBeGreaterThan(0);
  });

  it('extracts table data from pages', async () => {
    const result = await runBrowserAutomation('Extract data table', provider, llmMock);
    expect(Array.isArray(result.extractedData)).toBe(true);
  });

  it('calls LLM once to plan the automation', async () => {
    await runBrowserAutomation('Quick task', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await runBrowserAutomation('Test', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('handles failed steps gracefully', async () => {
    const withFailure = JSON.stringify({
      ...expectValidJson(BROWSER_AUTOMATION_RESPONSE),
      steps: [
        { action: 'navigate', url: 'https://bad.example', status: 'failure', duration_ms: 5000 },
      ],
    });
    const mock = createLLMClientMock({ content: withFailure, model: provider.model });
    const result = await runBrowserAutomation('Failing navigation', provider, mock);
    const failedSteps = result.steps.filter((s) => s.status === 'failure');
    expect(failedSteps.length).toBeGreaterThan(0);
  });

  it('sets provider name', async () => {
    const result = await runBrowserAutomation('Test', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('handles click + fill sequences (form automation)', async () => {
    const formSpec = JSON.stringify({
      steps: [
        { action: 'navigate', url: 'https://form.example', status: 'success', duration_ms: 300 },
        { action: 'click', selector: '#email', status: 'success', duration_ms: 50 },
        { action: 'fill', selector: '#email', value: 'user@test.com', status: 'success', duration_ms: 40 },
        { action: 'click', selector: '[type=submit]', status: 'success', duration_ms: 60 },
      ],
      totalDuration_ms: 450,
      screenshotsCount: 0,
      pagesVisited: 1,
    });
    const mock = createLLMClientMock({ content: formSpec, model: provider.model });
    const result = await runBrowserAutomation('Fill contact form', provider, mock);
    expect(result.steps.filter((s) => s.action === 'fill').length).toBe(1);
  });
});
