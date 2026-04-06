/**
 * Document Skill Handler
 *
 * Wraps the existing production pipeline to create Word, Excel, PowerPoint,
 * PDF, and CSV documents from natural-language requests.
 */

import { handleProductionRequest, isProductionIntent } from '../productionHandler';
import { professionalFileGenerator } from './professionalFileGenerator';
import { llmGateway } from '../../lib/llmGateway';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillHandlerResult {
  handled: boolean;
  skillId: string;
  skillName: string;
  category: string;
  artifacts: Array<{
    type: string;
    filename: string;
    buffer: Buffer;
    mimeType: string;
    size: number;
    metadata?: Record<string, unknown>;
  }>;
  textResponse: string;
  suggestions?: string[];
}

interface SkillHandlerRequest {
  message: string;
  userId: string;
  chatId: string;
  locale: string;
  attachments?: Array<{ name?: string; mimeType?: string; storagePath?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function errorResult(outputFormat: string, errorMsg: string): SkillHandlerResult {
  return {
    handled: false,
    skillId: `create-${outputFormat}`,
    skillName: `Create ${outputFormat.toUpperCase()}`,
    category: 'document-creation',
    artifacts: [],
    textResponse: `I was unable to generate the ${outputFormat.toUpperCase()} document. ${errorMsg}`,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleDocument(
  request: SkillHandlerRequest,
  outputFormat: string,
): Promise<SkillHandlerResult> {
  const format = outputFormat.toLowerCase().trim();

  try {
    // ----- CSV -----
    if (format === 'csv') {
      return await handleCSV(request);
    }

    // ----- Word / DOCX -----
    if (format === 'word' || format === 'docx') {
      return await handleWord(request);
    }

    // ----- Excel / XLSX -----
    if (format === 'excel' || format === 'xlsx' || format === 'spreadsheet') {
      return await handleExcel(request);
    }

    // ----- PowerPoint / PPTX -----
    if (format === 'powerpoint' || format === 'pptx' || format === 'presentation') {
      return await handlePowerPoint(request);
    }

    // ----- PDF (generate Word as fallback) -----
    if (format === 'pdf') {
      return await handlePDF(request);
    }

    return errorResult(format, 'Unsupported output format. Supported: word, excel, powerpoint, csv, pdf.');
  } catch (error: any) {
    console.warn('[SkillHandler:document]', error);
    return errorResult(format, error?.message ?? 'An unexpected error occurred.');
  }
}

// ---------------------------------------------------------------------------
// Format-specific generators
// ---------------------------------------------------------------------------

async function generateContentWithLLM(
  systemPrompt: string,
  userMessage: string,
  userId: string,
): Promise<string> {
  const response = await llmGateway.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { model: 'gpt-4o-mini', userId },
  );
  return response.content;
}

async function handleWord(request: SkillHandlerRequest): Promise<SkillHandlerResult> {
  const content = await generateContentWithLLM(
    `You are a professional document writer. Based on the user's request, generate structured document content in Markdown format. Include headings, paragraphs, bullet points, and any relevant tables. Provide thorough, professional content. Respond ONLY with the Markdown content, no preamble.`,
    request.message,
    request.userId,
  );

  const buffer = await professionalFileGenerator.generateWord(content, {
    title: extractTitle(request.message),
    locale: request.locale,
  });

  const filename = `document_${timestamp()}.docx`;

  return {
    handled: true,
    skillId: 'create-document',
    skillName: 'Create Word Document',
    category: 'document-creation',
    artifacts: [
      {
        type: 'document',
        filename,
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        metadata: { format: 'docx', generatedAt: new Date().toISOString() },
      },
    ],
    textResponse: `Your Word document has been created successfully. The document contains the content you requested, formatted professionally.`,
    suggestions: [
      'Convert this document to PDF',
      'Create a presentation from this content',
      'Modify the document structure',
    ],
  };
}

async function handleExcel(request: SkillHandlerRequest): Promise<SkillHandlerResult> {
  const rawData = await generateContentWithLLM(
    `You are a data specialist. Based on the user's request, generate spreadsheet data as a valid JSON object with this structure:
{
  "sheetName": "Sheet1",
  "headers": ["Column1", "Column2", ...],
  "rows": [["val1", "val2", ...], ...],
  "title": "Spreadsheet Title"
}
Include realistic, professional data. Respond ONLY with JSON, no markdown fences.`,
    request.message,
    request.userId,
  );

  let data: { sheetName?: string; headers: string[]; rows: string[][]; title?: string };
  try {
    data = JSON.parse(rawData.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    // Fallback: single-cell sheet noting the error
    data = { headers: ['Info'], rows: [['Content could not be parsed. Please try again.']] };
  }

  const buffer = await professionalFileGenerator.generateExcel(data.headers, data.rows, {
    sheetName: data.sheetName ?? 'Sheet1',
    title: data.title ?? extractTitle(request.message),
  });

  const filename = `spreadsheet_${timestamp()}.xlsx`;

  return {
    handled: true,
    skillId: 'create-spreadsheet',
    skillName: 'Create Excel Spreadsheet',
    category: 'document-creation',
    artifacts: [
      {
        type: 'spreadsheet',
        filename,
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
        metadata: { format: 'xlsx', rowCount: data.rows.length, generatedAt: new Date().toISOString() },
      },
    ],
    textResponse: `Your Excel spreadsheet has been created with ${data.rows.length} rows of data across ${data.headers.length} columns.`,
    suggestions: [
      'Add charts to this spreadsheet',
      'Export this data as CSV',
      'Create a summary report from this data',
    ],
  };
}

async function handlePowerPoint(request: SkillHandlerRequest): Promise<SkillHandlerResult> {
  const rawSlides = await generateContentWithLLM(
    `You are a presentation designer. Based on the user's request, generate slide content as a valid JSON array with this structure:
[
  { "title": "Slide Title", "bullets": ["Point 1", "Point 2"], "notes": "Speaker notes" }
]
Generate 6-12 professional slides. Respond ONLY with JSON, no markdown fences.`,
    request.message,
    request.userId,
  );

  let slides: Array<{ title: string; bullets: string[]; notes?: string }>;
  try {
    slides = JSON.parse(rawSlides.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    slides = [{ title: 'Presentation', bullets: ['Content generation error. Please try again.'] }];
  }

  const buffer = await professionalFileGenerator.generatePowerPoint(slides, {
    title: extractTitle(request.message),
  });

  const filename = `presentation_${timestamp()}.pptx`;

  return {
    handled: true,
    skillId: 'create-presentation',
    skillName: 'Create PowerPoint Presentation',
    category: 'document-creation',
    artifacts: [
      {
        type: 'presentation',
        filename,
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        size: buffer.length,
        metadata: { format: 'pptx', slideCount: slides.length, generatedAt: new Date().toISOString() },
      },
    ],
    textResponse: `Your PowerPoint presentation has been created with ${slides.length} slides.`,
    suggestions: [
      'Add more slides to this presentation',
      'Convert to a Word document outline',
      'Create a handout version',
    ],
  };
}

async function handleCSV(request: SkillHandlerRequest): Promise<SkillHandlerResult> {
  const rawCSV = await generateContentWithLLM(
    `You are a data specialist. Based on the user's request, generate CSV data. The first row must be headers. Use commas as delimiters. Provide realistic, professional data. Respond ONLY with the raw CSV content, no markdown fences or explanation.`,
    request.message,
    request.userId,
  );

  const csvContent = rawCSV.replace(/```csv?\n?/g, '').replace(/```/g, '').trim();
  const buffer = await professionalFileGenerator.generateCSV(csvContent);
  const filename = `data_${timestamp()}.csv`;
  const rowCount = csvContent.split('\n').length - 1;

  return {
    handled: true,
    skillId: 'create-csv',
    skillName: 'Create CSV File',
    category: 'document-creation',
    artifacts: [
      {
        type: 'data',
        filename,
        buffer,
        mimeType: 'text/csv',
        size: buffer.length,
        metadata: { format: 'csv', rowCount, generatedAt: new Date().toISOString() },
      },
    ],
    textResponse: `Your CSV file has been created with ${rowCount} data rows.`,
    suggestions: [
      'Convert this to Excel with formatting',
      'Visualize this data in a chart',
      'Add more data columns',
    ],
  };
}

async function handlePDF(request: SkillHandlerRequest): Promise<SkillHandlerResult> {
  // PDF conversion from Word requires LibreOffice or similar tooling.
  // We generate a professional Word document and inform the user.
  const content = await generateContentWithLLM(
    `You are a professional document writer. Based on the user's request, generate structured document content in Markdown format. Include headings, paragraphs, bullet points, and tables where appropriate. Respond ONLY with the Markdown content.`,
    request.message,
    request.userId,
  );

  const buffer = await professionalFileGenerator.generateWord(content, {
    title: extractTitle(request.message),
    locale: request.locale,
  });

  const filename = `document_${timestamp()}.docx`;

  return {
    handled: true,
    skillId: 'create-pdf',
    skillName: 'Create PDF Document',
    category: 'document-creation',
    artifacts: [
      {
        type: 'document',
        filename,
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        metadata: { format: 'docx', note: 'PDF conversion requires additional server tooling; Word document provided as equivalent.', generatedAt: new Date().toISOString() },
      },
    ],
    textResponse: `Your document has been created as a Word file. Direct PDF generation requires additional server-side tooling (e.g., LibreOffice). The Word document is fully formatted and can be converted to PDF in any office application.`,
    suggestions: [
      'Open in Google Docs and export as PDF',
      'Create a presentation from this content',
    ],
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function extractTitle(message: string): string {
  // Take the first meaningful segment (up to 60 chars) as a title
  const cleaned = message
    .replace(/^(crea|genera|haz|hazme|make|create|generate|write|produce)\s*/i, '')
    .replace(/^(un|una?|a|an|the)\s*/i, '')
    .replace(/^(documento?|word|excel|spreadsheet|presentaci[oó]n|powerpoint|csv|pdf)\s*(de|about|on|sobre|para)?\s*/i, '')
    .trim();
  if (cleaned.length === 0) return 'Document';
  return cleaned.length > 60 ? cleaned.slice(0, 57) + '...' : cleaned;
}
