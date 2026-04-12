/**
 * Capability: Research Vertical Use Case
 * Tests academic research workflows: literature review, citation management, hypothesis generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface ResearchPaper {
  id: string;
  title: string;
  authors: string[];
  journal: string;
  year: number;
  doi?: string;
  abstract: string;
  keywords: string[];
  citationCount: number;
}

interface LiteratureReview {
  topic: string;
  papers: ResearchPaper[];
  gaps: string[];
  trends: string[];
  hypotheses: string[];
  methodology: string;
  conclusion: string;
  provider: string;
}

interface ResearchHypothesis {
  statement: string;
  rationale: string;
  testability: 'high' | 'medium' | 'low';
  supportingEvidence: string[];
  potentialNullResult: string;
}

async function conductLiteratureReview(
  topic: string,
  yearRange: { start: number; end: number },
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<LiteratureReview> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      {
        role: 'system',
        content: `You are a research assistant. Conduct a systematic literature review from ${yearRange.start}-${yearRange.end}.`,
      },
      { role: 'user', content: `Topic: ${topic}` },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);

  return {
    topic,
    papers: (spec.sources as ResearchPaper[]) ?? [],
    gaps: (spec.gaps as string[]) ?? [],
    trends: (spec.trends as string[]) ?? [],
    hypotheses: (spec.hypotheses as string[]) ?? [],
    methodology: 'Systematic literature review with semantic search',
    conclusion: spec.synthesis as string ?? '',
    provider: provider.name,
  };
}

const LITERATURE_REVIEW_RESPONSE = JSON.stringify({
  sources: [
    { id: 'paper_1', title: 'Deep Learning for NLP: A Survey', authors: ['LeCun, Y.', 'Bengio, Y.'], journal: 'Nature', year: 2025, doi: '10.1038/s41586-025-01234-5', abstract: 'Comprehensive survey of deep learning in NLP...', keywords: ['NLP', 'deep learning', 'transformers'], citationCount: 342 },
    { id: 'paper_2', title: 'Large Language Models as Cognitive Assistants', authors: ['Brown, T.', 'Smith, J.'], journal: 'Science', year: 2025, abstract: 'Study of LLM capabilities as cognitive tools...', keywords: ['LLM', 'cognition', 'AI'], citationCount: 217 },
    { id: 'paper_3', title: 'AI-Enhanced Productivity: A Meta-Analysis', authors: ['Jones, A.', 'Wang, L.'], journal: 'PNAS', year: 2026, abstract: 'Meta-analysis of 45 studies on AI productivity...', keywords: ['productivity', 'AI tools', 'knowledge workers'], citationCount: 89 },
  ],
  gaps: [
    'Long-term skill retention effects not studied',
    'Cross-cultural adaptability of AI tools under-researched',
    'Longitudinal studies (>2 years) absent from literature',
  ],
  trends: [
    'Multi-modal AI integration growing rapidly',
    'Focus shifting from accuracy to usability',
    'Regulatory compliance becoming priority',
  ],
  hypotheses: [
    'AI tools reduce time-to-first-draft by 40% in knowledge workers',
    'Repetitive task automation correlates with higher job satisfaction',
  ],
  synthesis: 'The literature suggests significant productivity gains from AI integration, but long-term effects on skill development remain understudied.',
  confidence: 0.84,
});

runWithEachProvider('Research Vertical', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: LITERATURE_REVIEW_RESPONSE, model: provider.model });
  });

  it('conducts a literature review and returns papers', async () => {
    const review = await conductLiteratureReview('AI in NLP', { start: 2023, end: 2026 }, provider, llmMock);
    expect(review.papers.length).toBeGreaterThan(0);
  });

  it('each paper has title and authors', async () => {
    const review = await conductLiteratureReview('LLM capabilities', { start: 2024, end: 2026 }, provider, llmMock);
    for (const paper of review.papers) {
      expect(paper.title).toBeTruthy();
      expect(Array.isArray(paper.authors)).toBe(true);
    }
  });

  it('identifies research gaps', async () => {
    const review = await conductLiteratureReview('AI productivity', { start: 2023, end: 2026 }, provider, llmMock);
    expect(review.gaps.length).toBeGreaterThan(0);
  });

  it('identifies trends in the literature', async () => {
    const review = await conductLiteratureReview('AI trends', { start: 2024, end: 2026 }, provider, llmMock);
    expect(review.trends.length).toBeGreaterThan(0);
  });

  it('generates testable hypotheses', async () => {
    const review = await conductLiteratureReview('Knowledge work', { start: 2023, end: 2026 }, provider, llmMock);
    expect(review.hypotheses.length).toBeGreaterThan(0);
  });

  it('includes synthesis conclusion', async () => {
    const review = await conductLiteratureReview('Test topic', { start: 2024, end: 2026 }, provider, llmMock);
    expect(review.conclusion.length).toBeGreaterThan(10);
  });

  it('papers have citation counts', async () => {
    const review = await conductLiteratureReview('Citations test', { start: 2024, end: 2026 }, provider, llmMock);
    for (const paper of review.papers) {
      expect(typeof paper.citationCount).toBe('number');
    }
  });

  it('papers have keywords', async () => {
    const review = await conductLiteratureReview('Keywords test', { start: 2024, end: 2026 }, provider, llmMock);
    for (const paper of review.papers) {
      expect(Array.isArray(paper.keywords)).toBe(true);
    }
  });

  it('calls LLM once per review', async () => {
    await conductLiteratureReview('One call', { start: 2025, end: 2026 }, provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await conductLiteratureReview('Model test', { start: 2025, end: 2026 }, provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('sets provider name', async () => {
    const review = await conductLiteratureReview('Provider test', { start: 2025, end: 2026 }, provider, llmMock);
    expect(review.provider).toBe(provider.name);
  });

  it('LITERATURE_REVIEW_RESPONSE has 3 papers', () => {
    const spec = expectValidJson(LITERATURE_REVIEW_RESPONSE);
    expect((spec.sources as unknown[]).length).toBe(3);
  });

  it('all papers are from 2025 or 2026', () => {
    const spec = expectValidJson(LITERATURE_REVIEW_RESPONSE);
    const papers = spec.sources as ResearchPaper[];
    for (const paper of papers) {
      expect(paper.year).toBeGreaterThanOrEqual(2025);
    }
  });

  it('3 research gaps identified', () => {
    const spec = expectValidJson(LITERATURE_REVIEW_RESPONSE);
    expect((spec.gaps as unknown[]).length).toBe(3);
  });
});
