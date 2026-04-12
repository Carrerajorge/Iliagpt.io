/**
 * Capability: Word Document Generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { WORD_GENERATION_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('docx', () => ({
  Document: vi.fn(),
  Paragraph: vi.fn(),
  TextRun: vi.fn(),
  HeadingLevel: { HEADING_1: 1, HEADING_2: 2, HEADING_3: 3 },
  AlignmentType: { CENTER: 'center', LEFT: 'left' },
  Packer: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-docx-bytes')),
  },
}));

interface WordSection {
  heading: string;
  level: number;
  content: string;
}

interface WordGenerationResult {
  filename: string;
  sectionCount: number;
  wordCount: number;
  hasHeadings: boolean;
  buffer: Buffer;
  provider: string;
  template?: string;
}

async function generateWordDocWithLLM(
  prompt: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<WordGenerationResult> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Generate a Word document spec as JSON with sections array.' },
      { role: 'user', content: prompt },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);
  const sections = (spec.sections as WordSection[]) ?? [];
  const allText = sections.map((s) => s.content).join(' ');
  const wordCount = allText.split(/\s+/).filter(Boolean).length;

  return {
    filename: (spec.filename as string) ?? 'document.docx',
    sectionCount: sections.length,
    wordCount,
    hasHeadings: sections.some((s) => s.level === 1),
    buffer: Buffer.from('mock-docx'),
    provider: provider.name,
    template: (spec.metadata as { template?: string } | undefined)?.template,
  };
}

runWithEachProvider('Word Document Generation', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: WORD_GENERATION_RESPONSE, model: provider.model });
  });

  it('generates a Word document from a prompt', async () => {
    const result = await generateWordDocWithLLM('Draft a legal contract', provider, llmMock);
    expect(result.filename).toMatch(/\.docx$/);
    expect(result.sectionCount).toBeGreaterThan(0);
  });

  it('includes top-level headings', async () => {
    const result = await generateWordDocWithLLM('Business proposal', provider, llmMock);
    expect(result.hasHeadings).toBe(true);
  });

  it('produces meaningful word count', async () => {
    const result = await generateWordDocWithLLM('Annual report', provider, llmMock);
    expect(result.wordCount).toBeGreaterThan(5);
  });

  it('uses template when specified in spec', async () => {
    const result = await generateWordDocWithLLM('Contract from template', provider, llmMock);
    expect(result.template).toBeTruthy();
  });

  it('returns non-empty buffer', async () => {
    const result = await generateWordDocWithLLM('NDA draft', provider, llmMock);
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it('calls LLM exactly once per generation', async () => {
    await generateWordDocWithLLM('Meeting notes', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('passes correct model', async () => {
    await generateWordDocWithLLM('Test doc', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('handles multi-level heading hierarchy', async () => {
    const hierarchyDoc = JSON.stringify({
      filename: 'hierarchy.docx',
      sections: [
        { heading: 'Chapter 1', level: 1, content: 'Introduction text.' },
        { heading: 'Section 1.1', level: 2, content: 'Sub-section text.' },
        { heading: 'Section 1.2', level: 2, content: 'Another sub-section.' },
        { heading: 'Chapter 2', level: 1, content: 'Second chapter text.' },
      ],
    });
    const mock = createLLMClientMock({ content: hierarchyDoc, model: provider.model });
    const result = await generateWordDocWithLLM('Hierarchical doc', provider, mock);
    expect(result.sectionCount).toBe(4);
    expect(result.hasHeadings).toBe(true);
  });

  it('generates report filename matching content type', async () => {
    const contractResponse = JSON.stringify({
      filename: 'nda_agreement.docx',
      sections: [{ heading: 'NDA', level: 1, content: 'This Non-Disclosure Agreement...' }],
    });
    const mock = createLLMClientMock({ content: contractResponse, model: provider.model });
    const result = await generateWordDocWithLLM('NDA document', provider, mock);
    expect(result.filename).toContain('nda');
  });

  it('sets provider name correctly', async () => {
    const result = await generateWordDocWithLLM('Test', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('handles empty sections gracefully', async () => {
    const emptyDoc = JSON.stringify({ filename: 'empty.docx', sections: [] });
    const mock = createLLMClientMock({ content: emptyDoc, model: provider.model });
    const result = await generateWordDocWithLLM('Empty doc', provider, mock);
    expect(result.sectionCount).toBe(0);
    expect(result.wordCount).toBe(0);
  });

  it('spec metadata contains author', async () => {
    const spec = expectValidJson(WORD_GENERATION_RESPONSE);
    const meta = spec.metadata as Record<string, unknown>;
    expect(meta).toHaveProperty('author');
  });
});
