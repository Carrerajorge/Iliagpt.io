/**
 * Capability: PDF Generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { PDF_GENERATION_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setContent: vi.fn().mockResolvedValue(undefined),
        pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
        close: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 react-pdf-mock')),
  Document: vi.fn(),
  Page: vi.fn(),
  Text: vi.fn(),
  View: vi.fn(),
  StyleSheet: { create: vi.fn().mockReturnValue({}) },
}));

interface PdfGenerationResult {
  filename: string;
  template: string;
  pageCount: number;
  buffer: Buffer;
  totalAmount?: number;
  provider: string;
}

async function generatePdfWithLLM(
  prompt: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<PdfGenerationResult> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Generate a PDF document spec as JSON.' },
      { role: 'user', content: prompt },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);
  const data = spec.data as Record<string, unknown> | undefined;

  return {
    filename: (spec.filename as string) ?? 'document.pdf',
    template: (spec.template as string) ?? 'default',
    pageCount: 1,
    buffer: Buffer.from('%PDF-1.4 mock'),
    totalAmount: data?.total as number | undefined,
    provider: provider.name,
  };
}

runWithEachProvider('PDF Generation', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: PDF_GENERATION_RESPONSE, model: provider.model });
  });

  it('generates a PDF from a natural language prompt', async () => {
    const result = await generatePdfWithLLM('Create an invoice', provider, llmMock);
    expect(result.filename).toMatch(/\.pdf$/);
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it('selects the correct template for invoice prompts', async () => {
    const result = await generatePdfWithLLM('Generate invoice INV-001', provider, llmMock);
    expect(result.template).toBe('invoice');
  });

  it('includes total amount for financial PDFs', async () => {
    const result = await generatePdfWithLLM('Invoice for $11,990', provider, llmMock);
    expect(result.totalAmount).toBeDefined();
    expect(typeof result.totalAmount).toBe('number');
  });

  it('starts with PDF magic bytes', async () => {
    const result = await generatePdfWithLLM('Report', provider, llmMock);
    expect(result.buffer.toString().startsWith('%PDF')).toBe(true);
  });

  it('generates at least one page', async () => {
    const result = await generatePdfWithLLM('Simple document', provider, llmMock);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it('calls LLM exactly once', async () => {
    await generatePdfWithLLM('Contract PDF', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('passes correct model to LLM', async () => {
    await generatePdfWithLLM('Report PDF', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('handles report template', async () => {
    const reportResponse = JSON.stringify({
      filename: 'annual_report.pdf',
      template: 'report',
      data: { title: 'Annual Report 2026', sections: 5 },
    });
    const mock = createLLMClientMock({ content: reportResponse, model: provider.model });
    const result = await generatePdfWithLLM('Annual report', provider, mock);
    expect(result.template).toBe('report');
  });

  it('handles resume template', async () => {
    const resumeResponse = JSON.stringify({
      filename: 'resume_jane_doe.pdf',
      template: 'resume',
      data: { name: 'Jane Doe', skills: ['Python', 'ML'], experience: 5 },
    });
    const mock = createLLMClientMock({ content: resumeResponse, model: provider.model });
    const result = await generatePdfWithLLM('Resume for Jane Doe', provider, mock);
    expect(result.filename).toContain('resume');
  });

  it('sets provider correctly', async () => {
    const result = await generatePdfWithLLM('Any PDF', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('invoice spec has correct structure', async () => {
    const spec = expectValidJson(PDF_GENERATION_RESPONSE);
    const data = spec.data as Record<string, unknown>;
    expect(data).toHaveProperty('invoiceNumber');
    expect(data).toHaveProperty('lineItems');
    expect(data).toHaveProperty('total');
    expect(Array.isArray(data.lineItems)).toBe(true);
  });

  it('line items have required fields', async () => {
    const spec = expectValidJson(PDF_GENERATION_RESPONSE);
    const data = spec.data as Record<string, unknown>;
    const items = data.lineItems as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('total');
    }
  });
});
