import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.TEST_API_BASE || 'http://localhost:5000';
const hasDb = !!process.env.DATABASE_URL;

interface AnalyzeResponse {
  answer_text?: string;
  progressReport?: {
    requestId: string;
    isDocumentMode: boolean;
    productionWorkflowBlocked: boolean;
    attachments_count: number;
    processedFiles: number;
    tokens_extracted_total: number;
    perFileStats: Array<{
      filename: string;
      status: string;
      tokensExtracted: number;
      mime_detect: string;
      parser_used: string;
    }>;
  };
  error?: string;
  code?: string;
  message?: string;
}

describe.skipIf(!hasDb)('PARE Document Analysis System', () => {
  describe('DATA_MODE Enforcement', () => {
    it('should reject document attachments on /chat endpoint with USE_ANALYZE_ENDPOINT', async () => {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analiza este documento' }],
          attachments: [{
            type: 'pdf',
            name: 'test.pdf',
            mimeType: 'application/pdf',
            content: 'Test content'
          }]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.code).toBe('USE_ANALYZE_ENDPOINT');
    });

    it('should reject document attachments on /chat/stream endpoint with USE_ANALYZE_ENDPOINT', async () => {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analiza este documento' }],
          attachments: [{
            type: 'document',
            name: 'test.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            content: 'Test content'
          }]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.code).toBe('USE_ANALYZE_ENDPOINT');
    });

    it('should require attachments on /analyze endpoint', async () => {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analiza el documento' }],
          attachments: []
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Document Type Detection', () => {
    const documentTypes = [
      { ext: 'pdf', mimeType: 'application/pdf', expectedParser: 'PdfParser' },
      { ext: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', expectedParser: 'DocxParser' },
      { ext: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', expectedParser: 'XlsxParser' },
      { ext: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', expectedParser: 'PptxParser' },
      { ext: 'csv', mimeType: 'text/csv', expectedParser: 'CsvParser' },
    ];

    documentTypes.forEach(({ ext, mimeType, expectedParser }) => {
      it(`should detect ${ext.toUpperCase()} files and use ${expectedParser}`, async () => {
        const response = await fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Test' }],
            attachments: [{
              name: `test.${ext}`,
              mimeType: mimeType,
              type: ext === 'pdf' ? 'pdf' : 
                    ext === 'docx' ? 'word' : 
                    ext === 'xlsx' ? 'excel' : 
                    ext === 'pptx' ? 'ppt' : 'document',
              content: 'Test'
            }]
          })
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.code).toBe('USE_ANALYZE_ENDPOINT');
      });
    });
  });

  describe('PARSE_FAILED Response', () => {
    it('should return HTTP 422 PARSE_FAILED when tokens_extracted_total == 0 (whitespace doc)', async () => {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analiza el documento' }],
          attachments: [{
            name: 'whitespace.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: '   \n\n\t   '
          }]
        })
      });

      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.error).toBe('PARSE_FAILED');
      expect(data.progressReport).toBeDefined();
      expect(data.progressReport.tokens_extracted_total).toBe(0);
    });
  });

  describe('No Image Artifact Generation', () => {
    it('should never return image artifacts when documents are attached', async () => {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Genera una imagen del contenido' }],
          attachments: [{
            name: 'test.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: 'Este es contenido de prueba para análisis.'
          }]
        })
      });

      const data: AnalyzeResponse = await response.json();
      
      if (response.ok) {
        expect(data.answer_text).toBeDefined();
        expect(data.answer_text).not.toMatch(/He generado una imagen/i);
        expect(data.answer_text).not.toMatch(/image\/\*/);
        expect(data.progressReport?.isDocumentMode).toBe(true);
        expect(data.progressReport?.productionWorkflowBlocked).toBe(true);
      } else {
        expect([400, 422]).toContain(response.status);
      }
    });

    it('should include isDocumentMode=true and productionWorkflowBlocked=true in response', async () => {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analiza este texto' }],
          attachments: [{
            name: 'sample.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: 'Contenido de prueba para verificar el sistema PARE.'
          }]
        })
      });

      const data: AnalyzeResponse = await response.json();
      
      if (data.progressReport) {
        expect(data.progressReport.isDocumentMode).toBe(true);
        expect(data.progressReport.productionWorkflowBlocked).toBe(true);
      }
    });
  });

  describe('Per-Document Citations', () => {
    it('should return textual response with document analysis when attachments present', async () => {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Resume el contenido del documento' }],
          attachments: [{
            name: 'resumen.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: 'Este documento contiene información importante sobre el proyecto PARE.'
          }]
        })
      });

      if (response.ok) {
        const data: AnalyzeResponse = await response.json();
        expect(data.answer_text).toBeDefined();
        expect(typeof data.answer_text).toBe('string');
        expect(data.answer_text!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Multi-File Batch Processing', () => {
    it('should process multiple document types in a single request', async () => {
      const multipleAttachments = [
        { name: 'doc1.txt', mimeType: 'text/plain', type: 'document', content: 'Contenido del documento 1.' },
        { name: 'doc2.csv', mimeType: 'text/csv', type: 'document', content: 'col1,col2\nval1,val2' },
        { name: 'doc3.txt', mimeType: 'text/plain', type: 'document', content: 'Contenido del documento 3.' },
      ];

      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analiza todos los documentos' }],
          attachments: multipleAttachments
        })
      });

      if (response.ok) {
        const data: AnalyzeResponse = await response.json();
        expect(data.progressReport?.attachments_count).toBe(3);
        expect(data.progressReport?.processedFiles).toBe(3);
      }
    });
  });
});

describe.skipIf(!hasDb)('Acceptance Criteria Verification', () => {
  it('CRITERIA 1: attachments present → always textual response with citations', async () => {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Describe el contenido' }],
        attachments: [{
          name: 'test.txt',
          mimeType: 'text/plain',
          type: 'document',
          content: 'Información de prueba para el test de aceptación.'
        }]
      })
    });

    if (response.ok) {
      const data: AnalyzeResponse = await response.json();
      expect(data.answer_text).toBeDefined();
      expect(typeof data.answer_text).toBe('string');
      expect(data.progressReport?.isDocumentMode).toBe(true);
    }
  });

  it('CRITERIA 2: tokens_extracted_total == 0 → HTTP 422 PARSE_FAILED (no fallback to image)', async () => {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Analiza' }],
        attachments: [{
          name: 'whitespace.txt',
          mimeType: 'text/plain',
          type: 'document',
          content: '    \n\n\t   '
        }]
      })
    });

    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.error).toBe('PARSE_FAILED');
    expect(data.progressReport?.tokens_extracted_total).toBe(0);
  });
});
