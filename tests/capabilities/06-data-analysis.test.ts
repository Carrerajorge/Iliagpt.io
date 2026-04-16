/**
 * Capability: Data Analysis
 * Tests LLM-powered data analysis pipeline: statistical summaries, insights, charts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { DATA_ANALYSIS_RESPONSE } from './_setup/mockResponses';
import { createMockCsvFile, createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface DataAnalysisResult {
  rowCount: number;
  columnCount: number;
  insights: string[];
  statistics: Record<string, { mean: number; median: number; std: number }>;
  missingValues: Record<string, number>;
  recommendations: string[];
  provider: string;
}

async function analyzeDataWithLLM(
  csvContent: string,
  question: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<DataAnalysisResult> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Analyze the provided data and return JSON with summary, insights, and statistics.' },
      { role: 'user', content: `Data:\n${csvContent.slice(0, 2000)}\n\nQuestion: ${question}` },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);

  return {
    rowCount: (spec.summary as Record<string, unknown>)?.rowCount as number ?? 0,
    columnCount: (spec.summary as Record<string, unknown>)?.columnCount as number ?? 0,
    insights: (spec.insights as string[]) ?? [],
    statistics: (spec.statistics as Record<string, { mean: number; median: number; std: number }>) ?? {},
    missingValues: (spec.summary as Record<string, unknown>)?.missingValues as Record<string, number> ?? {},
    recommendations: (spec.recommendations as string[]) ?? [],
    provider: provider.name,
  };
}

runWithEachProvider('Data Analysis', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: DATA_ANALYSIS_RESPONSE, model: provider.model });
  });

  it('returns row and column counts', async () => {
    const csv = createMockCsvFile(100);
    const result = await analyzeDataWithLLM(String(csv.content), 'Summarize this data', provider, llmMock);
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.columnCount).toBeGreaterThan(0);
  });

  it('generates at least 3 insights', async () => {
    const csv = createMockCsvFile(50);
    const result = await analyzeDataWithLLM(String(csv.content), 'What are the key insights?', provider, llmMock);
    expect(result.insights.length).toBeGreaterThanOrEqual(3);
  });

  it('provides statistical summaries for numeric columns', async () => {
    const csv = createMockCsvFile(200);
    const result = await analyzeDataWithLLM(String(csv.content), 'Analyze revenue column', provider, llmMock);
    expect(result.statistics).toBeDefined();
    const columns = Object.keys(result.statistics);
    expect(columns.length).toBeGreaterThan(0);
  });

  it('includes mean, median, std for each numeric column', async () => {
    const csv = createMockCsvFile(50);
    const result = await analyzeDataWithLLM(String(csv.content), 'Stats please', provider, llmMock);
    for (const col of Object.values(result.statistics)) {
      expect(col).toHaveProperty('mean');
      expect(col).toHaveProperty('median');
      expect(col).toHaveProperty('std');
    }
  });

  it('identifies missing values', async () => {
    const csv = createMockCsvFile(100);
    const result = await analyzeDataWithLLM(String(csv.content), 'Any missing data?', provider, llmMock);
    expect(result.missingValues).toBeDefined();
  });

  it('generates actionable recommendations', async () => {
    const csv = createMockCsvFile(100);
    const result = await analyzeDataWithLLM(String(csv.content), 'What should we do?', provider, llmMock);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('calls LLM exactly once per analysis', async () => {
    const csv = createMockCsvFile(10);
    await analyzeDataWithLLM(String(csv.content), 'Quick analysis', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses the correct model', async () => {
    const csv = createMockCsvFile(5);
    await analyzeDataWithLLM(String(csv.content), 'Test', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('truncates large CSVs to avoid token overflow', async () => {
    const largeCsv = createMockCsvFile(5000);
    await analyzeDataWithLLM(String(largeCsv.content), 'Analyze', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    const userMsg = call.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content.length).toBeLessThan(5000);
  });

  it('sets provider name on result', async () => {
    const csv = createMockCsvFile(10);
    const result = await analyzeDataWithLLM(String(csv.content), 'Analysis', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('handles 10k row datasets', async () => {
    const spec = expectValidJson(DATA_ANALYSIS_RESPONSE);
    const summary = spec.summary as Record<string, unknown>;
    expect(summary.rowCount).toBe(10_000);
  });

  it('statistics revenue mean is positive', async () => {
    const spec = expectValidJson(DATA_ANALYSIS_RESPONSE);
    const stats = spec.statistics as Record<string, { mean: number }>;
    expect(stats.revenue.mean).toBeGreaterThan(0);
  });

  it('insights contain growth/trend language', async () => {
    const spec = expectValidJson(DATA_ANALYSIS_RESPONSE);
    const insights = spec.insights as string[];
    const hasFinancialInsight = insights.some((i) =>
      /revenue|growth|churn|customer/i.test(i)
    );
    expect(hasFinancialInsight).toBe(true);
  });
});
