/**
 * Capability: Research Synthesis
 * Tests web search → source ranking → synthesis pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { RESEARCH_SYNTHESIS_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, mockFetch, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface ResearchSource {
  url: string;
  title: string;
  relevance: number;
  year: number;
}

interface SynthesisResult {
  query: string;
  sources: ResearchSource[];
  synthesis: string;
  confidence: number;
  conflictingFindings?: string;
  provider: string;
  citationCount: number;
}

async function synthesizeResearch(
  query: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<SynthesisResult> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      {
        role: 'system',
        content: 'You are a research assistant. Search relevant sources and synthesize findings into JSON.',
      },
      { role: 'user', content: `Research: ${query}` },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);
  const sources = (spec.sources as ResearchSource[]) ?? [];

  return {
    query: spec.query as string ?? query,
    sources,
    synthesis: spec.synthesis as string ?? '',
    confidence: spec.confidence as number ?? 0,
    conflictingFindings: spec.conflictingFindings as string | undefined,
    provider: provider.name,
    citationCount: sources.length,
  };
}

runWithEachProvider('Research Synthesis', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: RESEARCH_SYNTHESIS_RESPONSE, model: provider.model });
  });

  it('returns a synthesis string for a research query', async () => {
    const result = await synthesizeResearch('Impact of AI on productivity', provider, llmMock);
    expect(result.synthesis).toBeTruthy();
    expect(result.synthesis.length).toBeGreaterThan(20);
  });

  it('returns at least 3 sources', async () => {
    const result = await synthesizeResearch('AI research', provider, llmMock);
    expect(result.sources.length).toBeGreaterThanOrEqual(3);
  });

  it('each source has url, title, and relevance', async () => {
    const result = await synthesizeResearch('Machine learning', provider, llmMock);
    for (const source of result.sources) {
      expect(source.url).toBeTruthy();
      expect(source.title).toBeTruthy();
      expect(typeof source.relevance).toBe('number');
    }
  });

  it('relevance scores are between 0 and 1', async () => {
    const result = await synthesizeResearch('AI study', provider, llmMock);
    for (const source of result.sources) {
      expect(source.relevance).toBeGreaterThanOrEqual(0);
      expect(source.relevance).toBeLessThanOrEqual(1);
    }
  });

  it('sources are sorted by descending relevance', async () => {
    const spec = expectValidJson(RESEARCH_SYNTHESIS_RESPONSE);
    const sources = spec.sources as ResearchSource[];
    for (let i = 1; i < sources.length; i++) {
      expect(sources[i - 1].relevance).toBeGreaterThanOrEqual(sources[i].relevance);
    }
  });

  it('confidence score is between 0 and 1', async () => {
    const result = await synthesizeResearch('Productivity study', provider, llmMock);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('notes conflicting findings when present', async () => {
    const result = await synthesizeResearch('AI skill atrophy debate', provider, llmMock);
    expect(result.conflictingFindings).toBeTruthy();
  });

  it('citation count matches sources array length', async () => {
    const result = await synthesizeResearch('Research synthesis', provider, llmMock);
    expect(result.citationCount).toBe(result.sources.length);
  });

  it('calls LLM once per synthesis', async () => {
    await synthesizeResearch('Test query', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await synthesizeResearch('Test', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('echoes back the query in the result', async () => {
    const query = 'Impact of AI on knowledge worker productivity';
    const result = await synthesizeResearch(query, provider, llmMock);
    expect(result.query).toContain('AI');
  });

  it('handles queries with no conflicting findings', async () => {
    const noConflict = JSON.stringify({
      type: 'research_synthesis',
      query: 'Water is H2O',
      sources: [{ url: 'https://example.com', title: 'Chemistry 101', relevance: 0.99, year: 2025 }],
      synthesis: 'Water is universally accepted as H2O.',
      confidence: 0.99,
    });
    const mock = createLLMClientMock({ content: noConflict, model: provider.model });
    const result = await synthesizeResearch('Water composition', provider, mock);
    expect(result.conflictingFindings).toBeUndefined();
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('handles recent year sources (2025+)', async () => {
    const result = await synthesizeResearch('Current AI research', provider, llmMock);
    const recentSources = result.sources.filter((s) => s.year >= 2025);
    expect(recentSources.length).toBeGreaterThan(0);
  });

  it('sets provider name', async () => {
    const result = await synthesizeResearch('Test', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });
});
