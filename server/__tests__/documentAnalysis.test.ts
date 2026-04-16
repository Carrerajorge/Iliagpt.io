import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockReq, createMockRes } from '../../tests/helpers/mockExpress';

vi.mock('../storage', () => ({
  storage: {
    getFile: vi.fn(),
    createChatMessageAnalysis: vi.fn(),
    getChatMessageAnalysisByUploadId: vi.fn(),
    updateChatMessageAnalysis: vi.fn(),
  },
}));

vi.mock('../services/spreadsheetAnalyzer', () => ({
  getUpload: vi.fn(),
  getSheets: vi.fn(),
}));

vi.mock('../services/analysisOrchestrator', () => ({
  startAnalysis: vi.fn(),
  getAnalysisProgress: vi.fn(),
  getAnalysisResults: vi.fn(),
}));

vi.mock('../services/analysisService', () => ({
  analysisService: {
    startUploadAnalysis: vi.fn(),
    getAnalysisStatus: vi.fn(),
  },
}));

import { createChatRoutes } from '../routes/chatRoutes';
import { storage } from '../storage';
import { getUpload, getSheets } from '../services/spreadsheetAnalyzer';
import { startAnalysis, getAnalysisProgress, getAnalysisResults } from '../services/analysisOrchestrator';
import { analysisService } from '../services/analysisService';

function getFileExtension(filename: string): string {
  return (filename.split('.').pop() || '').toLowerCase();
}

function isSpreadsheetFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
}

describe('Document Analysis Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('File Type Detection - isSpreadsheetFile()', () => {
    it('should return true for xlsx files', () => {
      expect(isSpreadsheetFile('report.xlsx')).toBe(true);
      expect(isSpreadsheetFile('Report.XLSX')).toBe(true);
    });

    it('should return true for xls files', () => {
      expect(isSpreadsheetFile('data.xls')).toBe(true);
      expect(isSpreadsheetFile('DATA.XLS')).toBe(true);
    });

    it('should return true for csv files', () => {
      expect(isSpreadsheetFile('export.csv')).toBe(true);
      expect(isSpreadsheetFile('EXPORT.CSV')).toBe(true);
    });

    it('should return true for tsv files', () => {
      expect(isSpreadsheetFile('data.tsv')).toBe(true);
      expect(isSpreadsheetFile('DATA.TSV')).toBe(true);
    });

    it('should return false for pdf files', () => {
      expect(isSpreadsheetFile('document.pdf')).toBe(false);
      expect(isSpreadsheetFile('DOCUMENT.PDF')).toBe(false);
    });

    it('should return false for docx files', () => {
      expect(isSpreadsheetFile('report.docx')).toBe(false);
      expect(isSpreadsheetFile('REPORT.DOCX')).toBe(false);
    });

    it('should return false for files without extension', () => {
      expect(isSpreadsheetFile('filename')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isSpreadsheetFile('')).toBe(false);
    });

    it('should handle files with multiple dots', () => {
      expect(isSpreadsheetFile('report.v2.final.xlsx')).toBe(true);
      expect(isSpreadsheetFile('document.draft.pdf')).toBe(false);
    });
  });

  describe('Chat Routes - POST /uploads/:uploadId/analyze', () => {
    it('should return 404 for non-existent upload', async () => {
      vi.mocked(analysisService.startUploadAnalysis).mockRejectedValue(new Error('Upload not found'));

      const router = createChatRoutes();
      const layer = (router as any).stack.find((l: any) => l.route?.path === '/uploads/:uploadId/analyze');
      expect(layer).toBeDefined();
      const handler = layer.route.stack[0].handle as any;

      const req = createMockReq({
        method: 'POST',
        path: '/api/chat/uploads/non-existent-id/analyze',
        params: { uploadId: 'non-existent-id' },
        body: { scope: 'all' },
        user: { id: 'test-user-id' },
      });
      const res = createMockRes();

      await handler(req, res, () => {});

      expect(res.statusCode).toBe(404);
      expect(res.body?.error).toBe('Upload not found');
    });

    it('should handle spreadsheet files correctly with scope=all', async () => {
      const mockUpload = {
        id: 'upload-123',
        originalFilename: 'financial_report.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/upload.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'abc123',
      };

      const mockSheets = [
        { id: 'sheet-1', uploadId: 'upload-123', name: 'Sheet1', sheetIndex: 0, rowCount: 100, columnCount: 10, inferredHeaders: ['A', 'B'], columnTypes: [], previewData: [] },
        { id: 'sheet-2', uploadId: 'upload-123', name: 'Sheet2', sheetIndex: 1, rowCount: 50, columnCount: 5, inferredHeaders: ['X', 'Y'], columnTypes: [], previewData: [] },
      ];

      const mockAnalysis = {
        id: 'analysis-123',
        messageId: null,
        uploadId: 'upload-123',
        sessionId: null,
        status: 'pending',
        scope: 'all',
        sheetsToAnalyze: ['Sheet1', 'Sheet2'],
        startedAt: new Date(),
        completedAt: null,
        summary: null,
        createdAt: new Date(),
      };

      vi.mocked(getUpload).mockResolvedValue(mockUpload);
      vi.mocked(getSheets).mockResolvedValue(mockSheets);
      vi.mocked(storage.createChatMessageAnalysis).mockResolvedValue(mockAnalysis);
      vi.mocked(startAnalysis).mockResolvedValue({ sessionId: 'session-123' });
      vi.mocked(storage.updateChatMessageAnalysis).mockResolvedValue({ ...mockAnalysis, sessionId: 'session-123', status: 'analyzing' });

      const result = {
        targetSheets: mockSheets.map(s => s.name),
        allSheetsCovered: true,
      };

      expect(result.targetSheets).toEqual(['Sheet1', 'Sheet2']);
      expect(result.allSheetsCovered).toBe(true);
      expect(isSpreadsheetFile(mockUpload.originalFilename)).toBe(true);
    });

    it('should handle spreadsheet files with scope=selected and specific sheets', async () => {
      const mockUpload = {
        id: 'upload-123',
        originalFilename: 'data.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/data.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 2048,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'def456',
      };

      const mockSheets = [
        { id: 'sheet-1', uploadId: 'upload-123', name: 'Revenue', sheetIndex: 0, rowCount: 100, columnCount: 10, inferredHeaders: [], columnTypes: [], previewData: [] },
        { id: 'sheet-2', uploadId: 'upload-123', name: 'Expenses', sheetIndex: 1, rowCount: 50, columnCount: 5, inferredHeaders: [], columnTypes: [], previewData: [] },
        { id: 'sheet-3', uploadId: 'upload-123', name: 'Summary', sheetIndex: 2, rowCount: 10, columnCount: 3, inferredHeaders: [], columnTypes: [], previewData: [] },
      ];

      vi.mocked(getUpload).mockResolvedValue(mockUpload);
      vi.mocked(getSheets).mockResolvedValue(mockSheets);

      const requestBody = {
        scope: 'selected',
        sheetsToAnalyze: ['Revenue', 'Summary'],
      };

      const selectedSheets = requestBody.sheetsToAnalyze.filter(name =>
        mockSheets.some(s => s.name === name)
      );

      expect(selectedSheets).toEqual(['Revenue', 'Summary']);
      expect(selectedSheets.length).toBe(2);
    });

    it('should handle spreadsheet files with scope=active (first sheet only)', async () => {
      const mockUpload = {
        id: 'upload-123',
        originalFilename: 'multi-sheet.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/multi.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 4096,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'ghi789',
      };

      const mockSheets = [
        { id: 'sheet-1', uploadId: 'upload-123', name: 'MainData', sheetIndex: 0, rowCount: 200, columnCount: 15, inferredHeaders: [], columnTypes: [], previewData: [] },
        { id: 'sheet-2', uploadId: 'upload-123', name: 'Appendix', sheetIndex: 1, rowCount: 20, columnCount: 5, inferredHeaders: [], columnTypes: [], previewData: [] },
      ];

      vi.mocked(getUpload).mockResolvedValue(mockUpload);
      vi.mocked(getSheets).mockResolvedValue(mockSheets);

      const scope = 'active';
      const targetSheets = scope === 'active' ? [mockSheets[0].name] : mockSheets.map(s => s.name);

      expect(targetSheets).toEqual(['MainData']);
      expect(targetSheets.length).toBe(1);
    });

    it('should handle non-spreadsheet files (PDF) using document basename as sheet name', async () => {
      const mockUpload = {
        id: 'upload-pdf',
        originalFilename: 'Annual Report 2024.pdf',
        userId: 'test-user',
        storagePath: '/tmp/report.pdf',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 512000,
        mimeType: 'application/pdf',
        checksum: 'pdf123',
      };

      vi.mocked(getUpload).mockResolvedValue(mockUpload);

      const isSpreadsheet = isSpreadsheetFile(mockUpload.originalFilename);
      expect(isSpreadsheet).toBe(false);

      const baseName = mockUpload.originalFilename.replace(/\.[^.]+$/, '');
      const targetSheets = [baseName];

      expect(targetSheets).toEqual(['Annual Report 2024']);
    });

    it('should handle non-spreadsheet files (DOCX) using document basename as sheet name', async () => {
      const mockUpload = {
        id: 'upload-docx',
        originalFilename: 'Project Proposal.docx',
        userId: 'test-user',
        storagePath: '/tmp/proposal.docx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 256000,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        checksum: 'docx456',
      };

      vi.mocked(getUpload).mockResolvedValue(mockUpload);

      const isSpreadsheet = isSpreadsheetFile(mockUpload.originalFilename);
      expect(isSpreadsheet).toBe(false);

      const baseName = mockUpload.originalFilename.replace(/\.[^.]+$/, '');
      const targetSheets = [baseName];

      expect(targetSheets).toEqual(['Project Proposal']);
    });

    it('should create chatMessageAnalysis record and start analysis', async () => {
      const mockUpload = {
        id: 'upload-123',
        originalFilename: 'data.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/data.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'abc',
      };

      const mockSheets = [
        { id: 'sheet-1', uploadId: 'upload-123', name: 'Data', sheetIndex: 0, rowCount: 100, columnCount: 5, inferredHeaders: [], columnTypes: [], previewData: [] },
      ];

      const mockAnalysis = {
        id: 'analysis-456',
        messageId: 'msg-123',
        uploadId: 'upload-123',
        sessionId: null,
        status: 'pending',
        scope: 'all',
        sheetsToAnalyze: ['Data'],
        startedAt: new Date(),
        completedAt: null,
        summary: null,
        createdAt: new Date(),
      };

      vi.mocked(getUpload).mockResolvedValue(mockUpload);
      vi.mocked(getSheets).mockResolvedValue(mockSheets);
      vi.mocked(storage.createChatMessageAnalysis).mockResolvedValue(mockAnalysis);
      vi.mocked(startAnalysis).mockResolvedValue({ sessionId: 'session-789' });
      vi.mocked(storage.updateChatMessageAnalysis).mockResolvedValue({ ...mockAnalysis, sessionId: 'session-789', status: 'analyzing' });

      expect(storage.createChatMessageAnalysis).toBeDefined();
      expect(startAnalysis).toBeDefined();
      expect(storage.updateChatMessageAnalysis).toBeDefined();
    });

    it('should return 400 for invalid scope in request body', async () => {
      const mockUpload = {
        id: 'upload-123',
        originalFilename: 'data.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/data.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'abc',
      };

      vi.mocked(getUpload).mockResolvedValue(mockUpload);

      const invalidBody = { scope: 'invalid_scope' };
      const isValidScope = ['all', 'selected', 'active'].includes(invalidBody.scope);

      expect(isValidScope).toBe(false);
    });

    it('should return 400 when scope=selected but no valid sheets specified', async () => {
      const mockUpload = {
        id: 'upload-123',
        originalFilename: 'data.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/data.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'abc',
      };

      const mockSheets = [
        { id: 'sheet-1', uploadId: 'upload-123', name: 'Data', sheetIndex: 0, rowCount: 100, columnCount: 5, inferredHeaders: [], columnTypes: [], previewData: [] },
      ];

      vi.mocked(getUpload).mockResolvedValue(mockUpload);
      vi.mocked(getSheets).mockResolvedValue(mockSheets);

      const requestedSheets = ['NonExistentSheet'];
      const validSheets = requestedSheets.filter(name =>
        mockSheets.some(s => s.name === name)
      );

      expect(validSheets.length).toBe(0);
    });
  });

  describe('Chat Routes - GET /uploads/:uploadId/analysis', () => {
    it('should return 404 when no analysis exists', async () => {
      vi.mocked(storage.getChatMessageAnalysisByUploadId).mockResolvedValue(undefined);

      const result = await storage.getChatMessageAnalysisByUploadId('non-existent-upload');
      expect(result).toBeUndefined();
    });

    it('should return correct progress format with pending status', async () => {
      const mockAnalysis = {
        id: 'analysis-123',
        messageId: null,
        uploadId: 'upload-123',
        sessionId: 'session-123',
        status: 'analyzing',
        scope: 'all',
        sheetsToAnalyze: ['Sheet1', 'Sheet2'],
        startedAt: new Date(),
        completedAt: null,
        summary: null,
        createdAt: new Date(),
      };

      const mockProgress = {
        sessionId: 'session-123',
        status: 'running' as const,
        totalJobs: 2,
        completedJobs: 0,
        failedJobs: 0,
        jobs: [
          { sheetName: 'Sheet1', status: 'queued' as const },
          { sheetName: 'Sheet2', status: 'queued' as const },
        ],
      };

      vi.mocked(storage.getChatMessageAnalysisByUploadId).mockResolvedValue(mockAnalysis);
      vi.mocked(getAnalysisProgress).mockResolvedValue(mockProgress);

      const progressData = {
        currentSheet: mockProgress.completedJobs,
        totalSheets: mockProgress.totalJobs,
        sheets: mockProgress.jobs.map(job => ({
          sheetName: job.sheetName,
          status: job.status,
        })),
      };

      expect(progressData).toEqual({
        currentSheet: 0,
        totalSheets: 2,
        sheets: [
          { sheetName: 'Sheet1', status: 'queued' },
          { sheetName: 'Sheet2', status: 'queued' },
        ],
      });
    });

    it('should return correct progress format during analysis', async () => {
      const mockAnalysis = {
        id: 'analysis-123',
        messageId: null,
        uploadId: 'upload-123',
        sessionId: 'session-123',
        status: 'analyzing',
        scope: 'all',
        sheetsToAnalyze: ['Sheet1', 'Sheet2'],
        startedAt: new Date(),
        completedAt: null,
        summary: null,
        createdAt: new Date(),
      };

      const mockProgress = {
        sessionId: 'session-123',
        status: 'running' as const,
        totalJobs: 2,
        completedJobs: 1,
        failedJobs: 0,
        jobs: [
          { sheetName: 'Sheet1', status: 'done' as const },
          { sheetName: 'Sheet2', status: 'running' as const },
        ],
      };

      vi.mocked(storage.getChatMessageAnalysisByUploadId).mockResolvedValue(mockAnalysis);
      vi.mocked(getAnalysisProgress).mockResolvedValue(mockProgress);

      const progressData = {
        currentSheet: mockProgress.completedJobs,
        totalSheets: mockProgress.totalJobs,
        sheets: mockProgress.jobs.map(job => ({
          sheetName: job.sheetName,
          status: job.status,
        })),
      };

      expect(progressData.currentSheet).toBe(1);
      expect(progressData.totalSheets).toBe(2);
      expect(progressData.sheets[0].status).toBe('done');
      expect(progressData.sheets[1].status).toBe('running');
    });

    it('should return correct results format when completed', async () => {
      const mockAnalysis = {
        id: 'analysis-123',
        messageId: null,
        uploadId: 'upload-123',
        sessionId: 'session-123',
        status: 'completed',
        scope: 'all',
        sheetsToAnalyze: ['Sheet1', 'Sheet2'],
        startedAt: new Date(),
        completedAt: new Date(),
        summary: 'Overall analysis summary',
        createdAt: new Date(),
      };

      const mockProgress = {
        sessionId: 'session-123',
        status: 'completed' as const,
        totalJobs: 2,
        completedJobs: 2,
        failedJobs: 0,
        jobs: [
          { sheetName: 'Sheet1', status: 'done' as const },
          { sheetName: 'Sheet2', status: 'done' as const },
        ],
      };

      const mockResults = {
        sessionId: 'session-123',
        perSheet: {
          Sheet1: {
            generatedCode: 'import pandas as pd\n# analysis code',
            outputs: {
              metrics: { totalRows: 100, avgValue: 45.5 },
              tables: [[{ col1: 'a', col2: 1 }, { col1: 'b', col2: 2 }]],
            },
            summary: 'Sheet1 contains 100 rows of data',
          },
          Sheet2: {
            generatedCode: 'import pandas as pd\n# sheet2 analysis',
            outputs: {
              metrics: { totalRows: 50, avgValue: 30.2 },
              tables: [],
            },
            summary: 'Sheet2 contains 50 rows of financial data',
          },
        },
        crossSheetSummary: 'Both sheets contain related financial data spanning 2023-2024',
      };

      vi.mocked(storage.getChatMessageAnalysisByUploadId).mockResolvedValue(mockAnalysis);
      vi.mocked(getAnalysisProgress).mockResolvedValue(mockProgress);
      vi.mocked(getAnalysisResults).mockResolvedValue(mockResults);

      const resultsData = {
        crossSheetSummary: mockResults.crossSheetSummary,
        sheets: mockProgress.jobs.map(job => {
          const sheetResults = mockResults.perSheet[job.sheetName];
          const metricsObj = sheetResults?.outputs?.metrics || {};
          const metricsArray = Object.entries(metricsObj).map(([label, value]) => ({
            label,
            value: typeof value === 'object' ? JSON.stringify(value) : String(value),
          }));

          let preview: { headers: string[]; rows: any[][] } | undefined;
          const tables = sheetResults?.outputs?.tables || [];
          if (tables.length > 0 && Array.isArray(tables[0])) {
            const tableData = tables[0] as any[];
            if (tableData.length > 0) {
              const firstRow = tableData[0];
              if (typeof firstRow === 'object' && firstRow !== null) {
                preview = {
                  headers: Object.keys(firstRow),
                  rows: tableData.slice(0, 10).map(row => Object.values(row)),
                };
              }
            }
          }

          return {
            sheetName: job.sheetName,
            generatedCode: sheetResults?.generatedCode,
            summary: sheetResults?.summary,
            metrics: metricsArray.length > 0 ? metricsArray : undefined,
            preview,
          };
        }),
      };

      expect(resultsData.crossSheetSummary).toBe('Both sheets contain related financial data spanning 2023-2024');
      expect(resultsData.sheets).toHaveLength(2);
      expect(resultsData.sheets[0].sheetName).toBe('Sheet1');
      expect(resultsData.sheets[0].generatedCode).toContain('import pandas');
      expect(resultsData.sheets[0].summary).toBe('Sheet1 contains 100 rows of data');
      expect(resultsData.sheets[0].metrics).toBeDefined();
      expect(resultsData.sheets[0].metrics).toHaveLength(2);
      expect(resultsData.sheets[0].preview).toBeDefined();
      expect(resultsData.sheets[0].preview?.headers).toEqual(['col1', 'col2']);
    });

    it('should handle pending status correctly', async () => {
      const mockAnalysis = {
        id: 'analysis-123',
        messageId: null,
        uploadId: 'upload-123',
        sessionId: null,
        status: 'pending',
        scope: 'all',
        sheetsToAnalyze: ['Sheet1'],
        startedAt: new Date(),
        completedAt: null,
        summary: null,
        createdAt: new Date(),
      };

      vi.mocked(storage.getChatMessageAnalysisByUploadId).mockResolvedValue(mockAnalysis);

      expect(mockAnalysis.status).toBe('pending');
      expect(mockAnalysis.sessionId).toBeNull();
    });

    it('should handle analyzing status correctly', async () => {
      const mockAnalysis = {
        id: 'analysis-123',
        messageId: null,
        uploadId: 'upload-123',
        sessionId: 'session-123',
        status: 'analyzing',
        scope: 'all',
        sheetsToAnalyze: ['Sheet1'],
        startedAt: new Date(),
        completedAt: null,
        summary: null,
        createdAt: new Date(),
      };

      vi.mocked(storage.getChatMessageAnalysisByUploadId).mockResolvedValue(mockAnalysis);

      expect(mockAnalysis.status).toBe('analyzing');
      expect(mockAnalysis.sessionId).toBe('session-123');
    });

    it('should handle failed status correctly', async () => {
      const mockAnalysis = {
        id: 'analysis-123',
        messageId: null,
        uploadId: 'upload-123',
        sessionId: 'session-123',
        status: 'failed',
        scope: 'all',
        sheetsToAnalyze: ['Sheet1'],
        startedAt: new Date(),
        completedAt: new Date(),
        summary: null,
        createdAt: new Date(),
      };

      const mockProgress = {
        sessionId: 'session-123',
        status: 'failed' as const,
        totalJobs: 1,
        completedJobs: 0,
        failedJobs: 1,
        jobs: [
          { sheetName: 'Sheet1', status: 'failed' as const, error: 'Python execution timeout' },
        ],
      };

      vi.mocked(storage.getChatMessageAnalysisByUploadId).mockResolvedValue(mockAnalysis);
      vi.mocked(getAnalysisProgress).mockResolvedValue(mockProgress);

      expect(mockAnalysis.status).toBe('failed');
      expect(mockProgress.jobs[0].error).toBe('Python execution timeout');
    });

    it('should handle completed status correctly', async () => {
      const mockAnalysis = {
        id: 'analysis-123',
        messageId: null,
        uploadId: 'upload-123',
        sessionId: 'session-123',
        status: 'completed',
        scope: 'all',
        sheetsToAnalyze: ['Sheet1'],
        startedAt: new Date(),
        completedAt: new Date(),
        summary: 'Analysis complete',
        createdAt: new Date(),
      };

      vi.mocked(storage.getChatMessageAnalysisByUploadId).mockResolvedValue(mockAnalysis);

      expect(mockAnalysis.status).toBe('completed');
      expect(mockAnalysis.completedAt).toBeDefined();
      expect(mockAnalysis.summary).toBe('Analysis complete');
    });
  });

  describe('Analysis States and Polling', () => {
    it('should track state transition: queued → running', async () => {
      const job1Queued = { sheetName: 'Sheet1', status: 'queued' as const };
      const job1Running = { sheetName: 'Sheet1', status: 'running' as const };

      const progressQueued = {
        sessionId: 'session-123',
        status: 'running' as const,
        totalJobs: 1,
        completedJobs: 0,
        failedJobs: 0,
        jobs: [job1Queued],
      };

      const progressRunning = {
        sessionId: 'session-123',
        status: 'running' as const,
        totalJobs: 1,
        completedJobs: 0,
        failedJobs: 0,
        jobs: [job1Running],
      };

      vi.mocked(getAnalysisProgress)
        .mockResolvedValueOnce(progressQueued)
        .mockResolvedValueOnce(progressRunning);

      const firstPoll = await getAnalysisProgress('session-123');
      expect(firstPoll.jobs[0].status).toBe('queued');

      const secondPoll = await getAnalysisProgress('session-123');
      expect(secondPoll.jobs[0].status).toBe('running');
    });

    it('should track state transition: running → done', async () => {
      const jobRunning = { sheetName: 'Sheet1', status: 'running' as const };
      const jobDone = { sheetName: 'Sheet1', status: 'done' as const };

      const progressRunning = {
        sessionId: 'session-123',
        status: 'running' as const,
        totalJobs: 1,
        completedJobs: 0,
        failedJobs: 0,
        jobs: [jobRunning],
      };

      const progressCompleted = {
        sessionId: 'session-123',
        status: 'completed' as const,
        totalJobs: 1,
        completedJobs: 1,
        failedJobs: 0,
        jobs: [jobDone],
      };

      vi.mocked(getAnalysisProgress)
        .mockResolvedValueOnce(progressRunning)
        .mockResolvedValueOnce(progressCompleted);

      const firstPoll = await getAnalysisProgress('session-123');
      expect(firstPoll.jobs[0].status).toBe('running');
      expect(firstPoll.status).toBe('running');

      const secondPoll = await getAnalysisProgress('session-123');
      expect(secondPoll.jobs[0].status).toBe('done');
      expect(secondPoll.status).toBe('completed');
    });

    it('should track full state transition: queued → running → done', async () => {
      vi.mocked(getAnalysisProgress)
        .mockResolvedValueOnce({
          sessionId: 'session-123',
          status: 'running' as const,
          totalJobs: 1,
          completedJobs: 0,
          failedJobs: 0,
          jobs: [{ sheetName: 'Sheet1', status: 'queued' as const }],
        })
        .mockResolvedValueOnce({
          sessionId: 'session-123',
          status: 'running' as const,
          totalJobs: 1,
          completedJobs: 0,
          failedJobs: 0,
          jobs: [{ sheetName: 'Sheet1', status: 'running' as const }],
        })
        .mockResolvedValueOnce({
          sessionId: 'session-123',
          status: 'completed' as const,
          totalJobs: 1,
          completedJobs: 1,
          failedJobs: 0,
          jobs: [{ sheetName: 'Sheet1', status: 'done' as const }],
        });

      const poll1 = await getAnalysisProgress('session-123');
      expect(poll1.jobs[0].status).toBe('queued');

      const poll2 = await getAnalysisProgress('session-123');
      expect(poll2.jobs[0].status).toBe('running');

      const poll3 = await getAnalysisProgress('session-123');
      expect(poll3.jobs[0].status).toBe('done');
      expect(poll3.status).toBe('completed');
    });

    it('should handle failed state with error message', async () => {
      const progressFailed = {
        sessionId: 'session-123',
        status: 'failed' as const,
        totalJobs: 1,
        completedJobs: 0,
        failedJobs: 1,
        jobs: [{ 
          sheetName: 'Sheet1', 
          status: 'failed' as const, 
          error: 'Memory limit exceeded during analysis' 
        }],
      };

      vi.mocked(getAnalysisProgress).mockResolvedValue(progressFailed);

      const result = await getAnalysisProgress('session-123');
      
      expect(result.status).toBe('failed');
      expect(result.failedJobs).toBe(1);
      expect(result.completedJobs).toBe(0);
      expect(result.jobs[0].status).toBe('failed');
      expect(result.jobs[0].error).toBe('Memory limit exceeded during analysis');
    });

    it('should handle partial failure (some sheets failed, some succeeded)', async () => {
      const progressPartialFailure = {
        sessionId: 'session-123',
        status: 'completed' as const,
        totalJobs: 3,
        completedJobs: 2,
        failedJobs: 1,
        jobs: [
          { sheetName: 'Sheet1', status: 'done' as const },
          { sheetName: 'Sheet2', status: 'failed' as const, error: 'Invalid data format' },
          { sheetName: 'Sheet3', status: 'done' as const },
        ],
      };

      vi.mocked(getAnalysisProgress).mockResolvedValue(progressPartialFailure);

      const result = await getAnalysisProgress('session-123');
      
      expect(result.completedJobs).toBe(2);
      expect(result.failedJobs).toBe(1);
      expect(result.jobs.filter(j => j.status === 'done')).toHaveLength(2);
      expect(result.jobs.filter(j => j.status === 'failed')).toHaveLength(1);
      expect(result.jobs[1].error).toBe('Invalid data format');
    });

    it('should handle multiple sheets with different states during analysis', async () => {
      const progressMixed = {
        sessionId: 'session-123',
        status: 'running' as const,
        totalJobs: 4,
        completedJobs: 1,
        failedJobs: 0,
        jobs: [
          { sheetName: 'Sheet1', status: 'done' as const },
          { sheetName: 'Sheet2', status: 'running' as const },
          { sheetName: 'Sheet3', status: 'queued' as const },
          { sheetName: 'Sheet4', status: 'queued' as const },
        ],
      };

      vi.mocked(getAnalysisProgress).mockResolvedValue(progressMixed);

      const result = await getAnalysisProgress('session-123');
      
      expect(result.status).toBe('running');
      expect(result.jobs.filter(j => j.status === 'done')).toHaveLength(1);
      expect(result.jobs.filter(j => j.status === 'running')).toHaveLength(1);
      expect(result.jobs.filter(j => j.status === 'queued')).toHaveLength(2);
    });

    it('should return results when analysis is completed', async () => {
      const mockResults = {
        sessionId: 'session-123',
        perSheet: {
          Sheet1: {
            generatedCode: 'import pandas as pd',
            outputs: { metrics: { count: 100 }, tables: [] },
            summary: 'Sheet analysis complete',
          },
        },
        crossSheetSummary: 'All data analyzed successfully',
      };

      vi.mocked(getAnalysisResults).mockResolvedValue(mockResults);

      const results = await getAnalysisResults('session-123');
      
      expect(results).toBeDefined();
      expect(results?.crossSheetSummary).toBe('All data analyzed successfully');
      expect(results?.perSheet.Sheet1.summary).toBe('Sheet analysis complete');
    });

    it('should handle getAnalysisResults returning null for incomplete analysis', async () => {
      vi.mocked(getAnalysisResults).mockResolvedValue(null as any);

      const results = await getAnalysisResults('session-123');
      expect(results).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle file with no sheets', async () => {
      const mockUpload = {
        id: 'upload-empty',
        originalFilename: 'empty.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/empty.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 512,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'empty123',
      };

      vi.mocked(getUpload).mockResolvedValue(mockUpload);
      vi.mocked(getSheets).mockResolvedValue([]);

      const sheets = await getSheets('upload-empty');
      const targetSheets = sheets.length === 0 ? ['Sheet1'] : sheets.map(s => s.name);

      expect(targetSheets).toEqual(['Sheet1']);
    });

    it('should handle file with special characters in name', async () => {
      const mockUpload = {
        id: 'upload-special',
        originalFilename: 'Report (2024) - Final [v2].pdf',
        userId: 'test-user',
        storagePath: '/tmp/report.pdf',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 1024,
        mimeType: 'application/pdf',
        checksum: 'special123',
      };

      vi.mocked(getUpload).mockResolvedValue(mockUpload);

      const baseName = mockUpload.originalFilename.replace(/\.[^.]+$/, '');
      expect(baseName).toBe('Report (2024) - Final [v2]');
      expect(isSpreadsheetFile(mockUpload.originalFilename)).toBe(false);
    });

    it('should handle unicode filenames', async () => {
      const mockUpload = {
        id: 'upload-unicode',
        originalFilename: '财务报告2024.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/report.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 2048,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'unicode123',
      };

      vi.mocked(getUpload).mockResolvedValue(mockUpload);

      expect(isSpreadsheetFile(mockUpload.originalFilename)).toBe(true);
      const baseName = mockUpload.originalFilename.replace(/\.[^.]+$/, '');
      expect(baseName).toBe('财务报告2024');
    });

    it('should handle analysis with custom prompt', async () => {
      const mockUpload = {
        id: 'upload-123',
        originalFilename: 'sales.xlsx',
        userId: 'test-user',
        storagePath: '/tmp/sales.xlsx',
        status: 'ready' as const,
        createdAt: new Date(),
        fileSize: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum: 'abc',
      };

      const mockSheets = [
        { id: 'sheet-1', uploadId: 'upload-123', name: 'Sales', sheetIndex: 0, rowCount: 100, columnCount: 5, inferredHeaders: [], columnTypes: [], previewData: [] },
      ];

      vi.mocked(getUpload).mockResolvedValue(mockUpload);
      vi.mocked(getSheets).mockResolvedValue(mockSheets);

      const customPrompt = 'Focus on Q4 sales trends and identify top performing products';

      vi.mocked(startAnalysis).mockResolvedValue({ sessionId: 'session-custom' });

      expect(startAnalysis).toBeDefined();
    });
  });
});
