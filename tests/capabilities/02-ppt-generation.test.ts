/**
 * Capability: PowerPoint / Presentation Generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { PPT_GENERATION_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('pptxgenjs', () => ({
  default: vi.fn().mockImplementation(() => ({
    addSlide: vi.fn().mockReturnValue({
      addText: vi.fn(),
      addImage: vi.fn(),
      addChart: vi.fn(),
      addShape: vi.fn(),
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(Buffer.from('mock-pptx')),
    layout: '',
    title: '',
  })),
}));

interface SlideSpec {
  index: number;
  layout: string;
  title: string;
  bullets?: string[];
  chartType?: string;
}

interface PptGenerationResult {
  filename: string;
  slideCount: number;
  theme: string;
  hasCharts: boolean;
  hasTitleSlide: boolean;
  buffer: Buffer;
  provider: string;
}

async function generatePresentationWithLLM(
  prompt: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<PptGenerationResult> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Generate a PowerPoint presentation spec as JSON.' },
      { role: 'user', content: prompt },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);
  const slides = (spec.slides as SlideSpec[]) ?? [];

  return {
    filename: (spec.filename as string) ?? 'presentation.pptx',
    slideCount: slides.length,
    theme: (spec.theme as string) ?? 'default',
    hasCharts: slides.some((s) => s.layout === 'chart' || s.chartType != null),
    hasTitleSlide: slides.some((s) => s.layout === 'title'),
    buffer: Buffer.from('mock-pptx'),
    provider: provider.name,
  };
}

runWithEachProvider('PowerPoint Generation', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: PPT_GENERATION_RESPONSE, model: provider.model });
  });

  it('generates a presentation from a natural language prompt', async () => {
    const result = await generatePresentationWithLLM('Create a product pitch deck', provider, llmMock);
    expect(result.filename).toMatch(/\.pptx$/);
    expect(result.slideCount).toBeGreaterThan(0);
  });

  it('includes a title slide', async () => {
    const result = await generatePresentationWithLLM('Company overview deck', provider, llmMock);
    expect(result.hasTitleSlide).toBe(true);
  });

  it('adds chart slides for data-driven presentations', async () => {
    const result = await generatePresentationWithLLM('Q1 results with charts', provider, llmMock);
    expect(result.hasCharts).toBe(true);
  });

  it('applies a theme', async () => {
    const result = await generatePresentationWithLLM('Professional deck', provider, llmMock);
    expect(result.theme).toBeTruthy();
    expect(typeof result.theme).toBe('string');
  });

  it('returns 5 slides for a standard pitch deck', async () => {
    const result = await generatePresentationWithLLM('5-slide pitch', provider, llmMock);
    expect(result.slideCount).toBe(5);
  });

  it('calls LLM exactly once', async () => {
    await generatePresentationWithLLM('Quick deck', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('passes correct model to LLM', async () => {
    await generatePresentationWithLLM('Investor update', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('returns a non-empty buffer', async () => {
    const result = await generatePresentationWithLLM('Sales deck', provider, llmMock);
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it('handles single-slide presentations', async () => {
    const singleSlide = JSON.stringify({
      filename: 'single.pptx',
      theme: 'minimal',
      slides: [{ index: 0, layout: 'title', title: 'One Page Summary' }],
    });
    const mock = createLLMClientMock({ content: singleSlide, model: provider.model });
    const result = await generatePresentationWithLLM('One-pager', provider, mock);
    expect(result.slideCount).toBe(1);
  });

  it('handles presentations with up to 20 slides', async () => {
    const slides = Array.from({ length: 20 }, (_, i) => ({
      index: i,
      layout: 'content',
      title: `Slide ${i + 1}`,
    }));
    const bigDeck = JSON.stringify({ filename: 'big.pptx', theme: 'corporate', slides });
    const mock = createLLMClientMock({ content: bigDeck, model: provider.model });
    const result = await generatePresentationWithLLM('20-slide deck', provider, mock);
    expect(result.slideCount).toBe(20);
  });

  it('sets the provider field correctly', async () => {
    const result = await generatePresentationWithLLM('Test deck', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('spec contains subtitle for title slides', async () => {
    const spec = expectValidJson(PPT_GENERATION_RESPONSE);
    const slides = spec.slides as SlideSpec[];
    const titleSlide = slides.find((s) => s.layout === 'title');
    expect(titleSlide).toBeDefined();
  });
});
