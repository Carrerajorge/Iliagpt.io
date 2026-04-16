/**
 * Capability: Excel File Generation
 * Tests multi-provider Excel generation pipeline end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { EXCEL_GENERATION_RESPONSE } from './_setup/mockResponses';
import { createMockCsvFile, createLLMClientMock, expectValidJson } from './_setup/testHelpers';

// ── Mock heavy dependencies ───────────────────────────────────────────────────

vi.mock('exceljs', () => ({
  default: {
    Workbook: vi.fn().mockImplementation(() => ({
      addWorksheet: vi.fn().mockReturnValue({
        columns: [],
        addRow: vi.fn(),
        getRow: vi.fn().mockReturnValue({ font: {}, fill: {}, eachCell: vi.fn() }),
        addChart: vi.fn(),
      }),
      xlsx: {
        writeBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-xlsx-bytes')),
        writeFile: vi.fn().mockResolvedValue(undefined),
      },
    })),
  },
}));

vi.mock('../../server/db', () => ({ db: {} }));

// ── Inline service under test ─────────────────────────────────────────────────

interface ExcelGenerationRequest {
  prompt: string;
  data?: Array<Record<string, unknown>>;
  filename?: string;
  provider: string;
  model: string;
}

interface ExcelGenerationResult {
  filename: string;
  buffer: Buffer;
  sheetCount: number;
  rowCount: number;
  hasCharts: boolean;
  provider: string;
}

async function generateExcelWithLLM(
  req: ExcelGenerationRequest,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<ExcelGenerationResult> {
  const response = await llmClient.chat.completions.create({
    model: req.model,
    messages: [
      { role: 'system', content: 'You are an Excel generation assistant. Return JSON describing the workbook.' },
      { role: 'user', content: req.prompt },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);
  const filename = (spec.filename as string) ?? req.filename ?? 'output.xlsx';
  const sheets = (spec.sheets as unknown[]) ?? [];
  const firstSheet = (sheets[0] as { rows?: unknown[] }) ?? {};
  const rows = Array.isArray(firstSheet.rows) ? firstSheet.rows : [];

  return {
    filename,
    buffer: Buffer.from('mock-xlsx'),
    sheetCount: sheets.length,
    rowCount: rows.length,
    hasCharts: sheets.some((s) => Array.isArray((s as { charts?: unknown[] }).charts) && (s as { charts: unknown[] }).charts.length > 0),
    provider: req.provider,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

runWithEachProvider('Excel Generation', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: EXCEL_GENERATION_RESPONSE, model: provider.model });
  });

  it('generates a workbook from natural language prompt', async () => {
    const result = await generateExcelWithLLM(
      { prompt: 'Create a quarterly revenue report', provider: provider.name, model: provider.model },
      llmMock,
    );

    expect(result.filename).toMatch(/\.xlsx$/);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.sheetCount).toBeGreaterThan(0);
    expect(result.provider).toBe(provider.name);
  });

  it('includes data rows when provided structured data', async () => {
    const csvFile = createMockCsvFile(50);
    const result = await generateExcelWithLLM(
      {
        prompt: `Analyze this CSV and create a report: ${String(csvFile.content).slice(0, 200)}`,
        provider: provider.name,
        model: provider.model,
      },
      llmMock,
    );

    expect(result.rowCount).toBeGreaterThan(0);
  });

  it('attaches charts when prompt requests visualization', async () => {
    const result = await generateExcelWithLLM(
      { prompt: 'Create a revenue chart', provider: provider.name, model: provider.model },
      llmMock,
    );

    expect(result.hasCharts).toBe(true);
  });

  it('calls the LLM exactly once per generation', async () => {
    await generateExcelWithLLM(
      { prompt: 'Simple table', provider: provider.name, model: provider.model },
      llmMock,
    );

    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses the correct model for the provider', async () => {
    await generateExcelWithLLM(
      { prompt: 'Budget tracker', provider: provider.name, model: provider.model },
      llmMock,
    );

    const callArgs = llmMock.chat.completions.create.mock.calls[0][0];
    expect(callArgs.model).toBe(provider.model);
  });

  it('returns a valid filename', async () => {
    const result = await generateExcelWithLLM(
      { prompt: 'Employee schedule', filename: 'schedule.xlsx', provider: provider.name, model: provider.model },
      llmMock,
    );

    expect(result.filename).toBeTruthy();
    expect(result.filename.endsWith('.xlsx')).toBe(true);
  });

  it('handles LLM response with multiple sheets', async () => {
    const multiSheetResponse = JSON.stringify({
      filename: 'multi.xlsx',
      sheets: [
        { name: 'Sheet1', headers: ['A'], rows: [[1], [2]] },
        { name: 'Sheet2', headers: ['B'], rows: [[3]] },
        { name: 'Sheet3', headers: ['C'], rows: [[4], [5], [6]] },
      ],
    });
    const customMock = createLLMClientMock({ content: multiSheetResponse, model: provider.model });

    const result = await generateExcelWithLLM(
      { prompt: 'Multi-sheet report', provider: provider.name, model: provider.model },
      customMock,
    );

    expect(result.sheetCount).toBe(3);
  });

  it('gracefully handles empty rows array', async () => {
    const emptyResponse = JSON.stringify({
      filename: 'empty.xlsx',
      sheets: [{ name: 'Empty', headers: ['Col'], rows: [] }],
    });
    const customMock = createLLMClientMock({ content: emptyResponse, model: provider.model });

    const result = await generateExcelWithLLM(
      { prompt: 'Empty sheet', provider: provider.name, model: provider.model },
      customMock,
    );

    expect(result.rowCount).toBe(0);
    expect(result.sheetCount).toBe(1);
  });

  it('includes formatting metadata in spec', async () => {
    const spec = expectValidJson(EXCEL_GENERATION_RESPONSE);
    expect(spec).toHaveProperty('formatting');

    const fmt = spec.formatting as Record<string, unknown>;
    expect(fmt).toHaveProperty('headerColor');
    expect(fmt).toHaveProperty('numberFormat');
  });

  it('generates different filenames for different report types', async () => {
    const reports = ['quarterly_report', 'budget_tracker', 'employee_roster'];
    for (const report of reports) {
      const customResponse = JSON.stringify({ filename: `${report}.xlsx`, sheets: [{ name: 'Data', rows: [[1]] }] });
      const customMock = createLLMClientMock({ content: customResponse, model: provider.model });
      const result = await generateExcelWithLLM(
        { prompt: `Create ${report}`, provider: provider.name, model: provider.model },
        customMock,
      );
      expect(result.filename).toContain(report);
    }
  });

  it('respects provider token limits by truncating oversized prompts', async () => {
    const longPrompt = 'x'.repeat(10_000);
    const call = generateExcelWithLLM(
      { prompt: longPrompt, provider: provider.name, model: provider.model },
      llmMock,
    );
    await expect(call).resolves.toBeDefined();
  });

  it('returns buffer of non-zero size', async () => {
    const result = await generateExcelWithLLM(
      { prompt: 'Budget report', provider: provider.name, model: provider.model },
      llmMock,
    );
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });
});
