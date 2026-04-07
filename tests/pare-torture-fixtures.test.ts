/**
 * PARE Torture Fixtures & Regression Tests
 * 
 * Tests for edge cases:
 * - Empty/scanned documents (no text → 422)
 * - CSV with row/col citations
 * - Corrupt files
 * - Multi-language content
 * - Tables and notes
 * - Kill-switch validation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CsvParser } from '../server/parsers/csvParser';
import { validateDataModeResponse, DataModeOutputViolationError } from '../server/lib/dataModeValidator';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'http://localhost:5000/api';
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('PARE Torture Fixtures', () => {
  describe('CSVParser with Row/Column Citations', () => {
    it('should parse CSV and generate row/col citations', async () => {
      const csvParser = new CsvParser();
      const csvContent = `name,value,category
Item1,100,A
Item2,200,B
Item3,300,C`;
      
      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await csvParser.parse(buffer, 'test.csv');
      
      expect(result.headers).toEqual(['name', 'value', 'category']);
      expect(result.totalRows).toBe(3);
      expect(result.totalColumns).toBe(3);
      expect(result.text).toContain('[doc:test.csv row:1 col:name]');
      expect(result.text).toContain('[doc:test.csv row:2 col:value]');
      expect(result.metadata.parser_used).toBe('CsvParser');
    });

    it('should handle quoted values with commas', async () => {
      const csvParser = new CsvParser();
      const csvContent = `product,description,price
"Widget, Pro","A great, wonderful item",99.99`;
      
      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await csvParser.parse(buffer, 'quoted.csv');
      
      expect(result.rows[0].values['product']).toBe('Widget, Pro');
      expect(result.rows[0].values['description']).toBe('A great, wonderful item');
    });

    it('should handle escaped quotes in CSV', async () => {
      const csvParser = new CsvParser();
      const csvContent = `name,quote
Test,"He said ""Hello""!"`;
      
      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await csvParser.parse(buffer, 'escaped.csv');
      
      expect(result.rows[0].values['quote']).toBe('He said "Hello"!');
    });

    it('should return empty result for empty CSV', async () => {
      const csvParser = new CsvParser();
      const buffer = Buffer.from('', 'utf-8');
      const result = await csvParser.parse(buffer, 'empty.csv');
      
      expect(result.totalRows).toBe(0);
      expect(result.headers).toEqual([]);
    });
  });

  describe.skipIf(!hasDb)('Empty/Scanned Document Handling', () => {
    it('should return 400 VALIDATION_ERROR for empty document (content required)', async () => {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analyze this document' }],
          conversationId: 'test-empty-doc',
          attachments: [{
            name: 'empty.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: ''
          }]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 422 PARSE_FAILED for whitespace-only document', async () => {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analyze this document' }],
          conversationId: 'test-whitespace-doc',
          attachments: [{
            name: 'whitespace.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: '   \n\n\t\t   \n   '
          }]
        })
      });

      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.error).toBe('PARSE_FAILED');
    });
  });

  describe.skipIf(!hasDb)('CSV Document Processing via API', () => {
    it('should use CsvParser for CSV files and include row/col citations', async () => {
      const csvContent = `product_id,name,price
P001,Widget,29.99
P002,Gadget,49.99`;

      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'List all products and their prices' }],
          conversationId: 'test-csv-processing',
          attachments: [{
            name: 'products.csv',
            mimeType: 'text/csv',
            type: 'document',
            content: csvContent
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.progressReport.perFileStats[0].parser_used).toBe('CsvParser');
      expect(data.progressReport.perFileStats[0].mime_detect).toBe('text/csv');
    });
  });

  describe.skipIf(!hasDb)('Multi-File Batch with Coverage Check', () => {
    it('should process multiple document types and verify coverage', async () => {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Analiza todos los documentos y resume su contenido' }],
          conversationId: 'test-multi-coverage',
          attachments: [
            {
              name: 'doc1.txt',
              mimeType: 'text/plain',
              type: 'document',
              content: 'First document content about sales.'
            },
            {
              name: 'data.csv',
              mimeType: 'text/csv',
              type: 'document',
              content: 'item,value\nA,100\nB,200'
            },
            {
              name: 'notes.txt',
              mimeType: 'text/plain',
              type: 'document',
              content: 'Third document with meeting notes.'
            }
          ]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.progressReport.attachments_count).toBe(3);
      expect(data.progressReport.processedFiles).toBe(3);
      expect(data.progressReport.coverageCheck.passed).toBe(true);
      expect(data.citations.length).toBeGreaterThan(0);
    });
  });

  describe.skipIf(!hasDb)('Bilingual Content Handling', () => {
    it('should process Spanish and English content correctly', async () => {
      const bilingualContent = `
ESPAÑOL: Este documento contiene información importante.
ENGLISH: This document contains important information.
DATOS: valor1=100, valor2=200
DATA: value1=100, value2=200`;

      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Resume el contenido en español y en inglés' }],
          conversationId: 'test-bilingual',
          attachments: [{
            name: 'bilingual.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: bilingualContent
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.answer_text.length).toBeGreaterThan(50);
      expect(data.citations).toContain('[doc:bilingual.txt]');
    });
  });
});

describe.skipIf(!hasDb)('DATA_MODE Kill-Switch Validation', () => {
  it('should detect forbidden image key in response', () => {
    const payload = {
      success: true,
      answer_text: 'Here is your analysis',
      image: 'data:image/png;base64,abc123'  // FORBIDDEN
    };

    const result = validateDataModeResponse(payload, 'test-123');
    
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some(v => v.includes('image'))).toBe(true);
  });

  it('should detect forbidden artifact key in response', () => {
    const payload = {
      success: true,
      answer_text: 'Document processed',
      artifacts: [{ type: 'image', data: 'abc' }]  // FORBIDDEN
    };

    const result = validateDataModeResponse(payload, 'test-456');
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes('artifact'))).toBe(true);
  });

  it('should detect forbidden text pattern "He generado una imagen"', () => {
    const payload = {
      success: true,
      answer_text: 'He analizado el documento. He generado una imagen para ilustrar los datos.'
    };

    const result = validateDataModeResponse(payload, 'test-789');
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes('generado una imagen'))).toBe(true);
  });

  it('should detect base64 image data pattern', () => {
    const payload = {
      success: true,
      answer_text: 'Aquí está el análisis con la imagen embebida: data:image/png;base64,iVBORw0KGgo...'
    };

    const result = validateDataModeResponse(payload, 'test-b64');
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes('data:image'))).toBe(true);
  });

  it('should pass validation for clean DATA_MODE response', () => {
    const payload = {
      success: true,
      requestId: 'clean-123',
      mode: 'DATA_MODE',
      answer_text: 'El documento contiene información sobre ventas Q4. [doc:report.pdf p#2]',
      citations: ['[doc:report.pdf p#2]'],
      progressReport: {
        isDocumentMode: true,
        productionWorkflowBlocked: true,
        attachments_count: 1,
        tokens_extracted_total: 500
      }
    };

    const result = validateDataModeResponse(payload, 'clean-123');
    
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('should detect forbidden content-type header', () => {
    const payload = {
      success: true,
      answer_text: 'Analysis complete',
      response: {
        contentType: 'image/png',  // FORBIDDEN
        data: 'abc'
      }
    };

    const result = validateDataModeResponse(payload, 'test-ct');
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes('image/png'))).toBe(true);
  });

  it('should detect nested image artifacts', () => {
    const payload = {
      success: true,
      answer_text: 'Done',
      metadata: {
        result: {
          generated_image: 'http://example.com/image.png'  // FORBIDDEN
        }
      }
    };

    const result = validateDataModeResponse(payload, 'test-nested');
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes('generated_image'))).toBe(true);
  });
});

describe.skipIf(!hasDb)('Coverage Enforcement', () => {
  it('should include citation for each document in batch', async () => {
    const response = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Analiza todos los documentos adjuntos' }],
        conversationId: 'test-coverage-all',
        attachments: [
          {
            name: 'report.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: 'Q4 report shows 15% growth in revenue.'
          },
          {
            name: 'summary.txt',
            mimeType: 'text/plain',
            type: 'document',
            content: 'Executive summary: targets exceeded.'
          }
        ]
      })
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    
    // Verify coverage check passed (required when "todos" in message)
    expect(data.progressReport.coverageCheck.required).toBe(true);
    expect(data.progressReport.coverageCheck.passed).toBe(true);
    
    // All files should be processed
    expect(data.progressReport.processedFiles).toBe(2);
    expect(data.progressReport.failedFiles).toBe(0);
  });
});
