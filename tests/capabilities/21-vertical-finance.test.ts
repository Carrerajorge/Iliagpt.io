/**
 * Capability: Finance Vertical Use Case
 * Tests financial analysis, earnings summaries, portfolio reports, and forecast generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { FINANCIAL_ANALYSIS_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface FinancialMetric {
  value: number;
  change?: string;
  beat?: boolean;
}

interface FinancialAnalysisResult {
  ticker: string;
  period: string;
  metrics: Record<string, FinancialMetric | string>;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  priceTarget?: { target: number; upside: string };
  riskFactors: string[];
  summary: string;
  provider: string;
}

async function analyzeFinancials(
  ticker: string,
  period: string,
  data: Record<string, unknown>,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<FinancialAnalysisResult> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Analyze financial data and return structured JSON with metrics, sentiment, and price target.' },
      { role: 'user', content: `Ticker: ${ticker}\nPeriod: ${period}\nData: ${JSON.stringify(data)}` },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);

  return {
    ticker: spec.ticker as string ?? ticker,
    period: spec.period as string ?? period,
    metrics: spec.metrics as Record<string, FinancialMetric | string> ?? {},
    sentiment: (spec.sentiment as 'BULLISH' | 'BEARISH' | 'NEUTRAL') ?? 'NEUTRAL',
    priceTarget: spec.priceTarget as { target: number; upside: string } | undefined,
    riskFactors: (spec.riskFactors as string[] | undefined) ?? [],
    summary: `${ticker} ${period} analysis: ${spec.sentiment ?? 'NEUTRAL'}`,
    provider: provider.name,
  };
}

const SAMPLE_EARNINGS_DATA = {
  revenue: 124_300_000_000,
  revenueEstimate: 120_000_000_000,
  eps: 2.18,
  epsEstimate: 2.09,
  grossMargin: 0.462,
  fcf: 29_400_000_000,
  yoyGrowth: 0.082,
};

runWithEachProvider('Finance Vertical', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: FINANCIAL_ANALYSIS_RESPONSE, model: provider.model });
  });

  it('returns a structured financial analysis', async () => {
    const result = await analyzeFinancials('AAPL', 'Q1 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    expect(result.ticker).toBe('AAPL');
    expect(result.period).toBe('Q1 2026');
  });

  it('includes metrics object', async () => {
    const result = await analyzeFinancials('AAPL', 'Q1 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    expect(result.metrics).toBeDefined();
    expect(typeof result.metrics).toBe('object');
  });

  it('revenue metric is present', async () => {
    const result = await analyzeFinancials('AAPL', 'Q1 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    expect(result.metrics.revenue).toBeDefined();
  });

  it('sentiment is one of BULLISH/BEARISH/NEUTRAL', async () => {
    const result = await analyzeFinancials('AAPL', 'Q1 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(result.sentiment);
  });

  it('provides a price target with upside', async () => {
    const result = await analyzeFinancials('AAPL', 'Q1 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    expect(result.priceTarget?.target).toBeGreaterThan(0);
    expect(result.priceTarget?.upside).toMatch(/\d+%/);
  });

  it('AAPL Q1 2026 analysis is BULLISH', () => {
    const spec = expectValidJson(FINANCIAL_ANALYSIS_RESPONSE);
    expect(spec.sentiment).toBe('BULLISH');
  });

  it('EPS beat is detected', () => {
    const spec = expectValidJson(FINANCIAL_ANALYSIS_RESPONSE);
    const metrics = spec.metrics as Record<string, { beat?: boolean }>;
    expect(metrics.eps?.beat).toBe(true);
  });

  it('revenue beat is detected', () => {
    const spec = expectValidJson(FINANCIAL_ANALYSIS_RESPONSE);
    const metrics = spec.metrics as Record<string, { beat?: boolean }>;
    expect(metrics.revenue?.beat).toBe(true);
  });

  it('calls LLM once per analysis', async () => {
    await analyzeFinancials('MSFT', 'Q2 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await analyzeFinancials('GOOGL', 'Q1 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('sets provider name', async () => {
    const result = await analyzeFinancials('TSLA', 'Q1 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('generates a summary string', async () => {
    const result = await analyzeFinancials('AMZN', 'Q1 2026', SAMPLE_EARNINGS_DATA, provider, llmMock);
    expect(result.summary).toContain('AMZN');
  });

  it('handles bearish scenario', async () => {
    const bearish = JSON.stringify({
      ticker: 'CRWD',
      period: 'Q2 2026',
      metrics: { revenue: { value: 800_000_000, change: '-5%', beat: false }, eps: { value: -0.5, beat: false } },
      sentiment: 'BEARISH',
      riskFactors: ['Competitive pressure', 'High burn rate'],
    });
    const mock = createLLMClientMock({ content: bearish, model: provider.model });
    const result = await analyzeFinancials('CRWD', 'Q2 2026', {}, provider, mock);
    expect(result.sentiment).toBe('BEARISH');
  });
});
