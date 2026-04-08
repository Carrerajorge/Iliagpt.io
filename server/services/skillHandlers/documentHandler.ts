/**
 * Document Skill Handler
 *
 * Wraps the existing production pipeline to create Word, Excel, PowerPoint,
 * PDF, and CSV documents from natural-language requests.
 */

import { handleProductionRequest, isProductionIntent } from '../productionHandler';
import { professionalFileGenerator } from './professionalFileGenerator';
import { llmGateway } from '../../lib/llmGateway';
import { generatePdfFromHtml } from '../pdfGeneration';

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

/**
 * Detect if the user's message is primarily in Spanish.
 * Returns "es" for Spanish, "en" for English (default).
 */
function detectLanguage(message: string): 'es' | 'en' {
  const spanishIndicators = /\b(crea|genera|haz|hazme|sobre|para|del|los|las|una?|escrib[ea]|elabor[ae]|prepar[ae]|presentaci[oó]n|documento|informe|reporte|artículos?|investigaci[oó]n|contenido|introducci[oó]n|conclusi[oó]n|resumen|análisis|también|además|porque|según|ejemplo|datos|información|profesional|empresarial|administrativ[ao]|gesti[oó]n)\b/i;
  const matches = (message.match(spanishIndicators) || []).length;
  return matches >= 2 ? 'es' : 'en';
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
  const lang = detectLanguage(request.message);
  const langInstruction = lang === 'es'
    ? 'Write ALL content in Spanish. Use formal, professional Spanish throughout.'
    : 'Write ALL content in English. Use formal, professional English throughout.';

  const content = await generateContentWithLLM(
    `You are an expert document writer. Create a comprehensive, professional document based on the user's request.

Structure your response in Markdown with:
- A clear title (# heading)
- Executive summary (2-3 paragraphs)
- 4-6 well-organized sections with ## headings
- Use ### for subsections where appropriate
- Bullet points for key items
- At least one data table (| Header | ... |) if relevant to the topic
- Conclusion section

QUALITY REQUIREMENTS:
- Provide thorough, substantive content (not placeholder text)
- Each section should have 2-4 detailed paragraphs
- Use professional, formal tone appropriate for business/academic contexts
- Include specific details, examples, data points, and actionable insights
- Ensure logical flow between sections
- Be thorough - aim for 800-1500 words of substantive content.

LANGUAGE: ${langInstruction}
Write in the same language as the user's request.

Respond ONLY with the Markdown content, no preamble or explanation.`,
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
  const lang = detectLanguage(request.message);
  const langInstruction = lang === 'es'
    ? 'All column headers, sheet name, and title MUST be in Spanish.'
    : 'All column headers, sheet name, and title MUST be in English.';

  const rawData = await generateContentWithLLM(
    `You are a data specialist. Generate realistic, professional spreadsheet data.
Return ONLY valid JSON with this structure:
{
  "sheetName": "descriptive name",
  "headers": ["Column1", "Column2", ...],
  "rows": [["val1", 42, ...], ...],
  "title": "Spreadsheet Title"
}

Requirements:
- At least 15 rows of realistic data
- Use appropriate data types (numbers for quantities/prices, dates for dates)
- Include a summary/total row at the end (prefix the first cell with "TOTAL" or "RESUMEN")
- Headers should be clear and descriptive (4-8 columns)
- Include numeric values where appropriate (prices, quantities, percentages, scores)
- Make data realistic and internally consistent (totals should add up, percentages should be reasonable)
- Vary the data - avoid repetitive or placeholder values
- All text in the same language as the user's request

${langInstruction}

Respond ONLY with valid JSON, no markdown fences, no explanation.`,
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
  const lang = detectLanguage(request.message);
  const langInstruction = lang === 'es'
    ? 'ALL slide titles, bullet points, and speaker notes MUST be in Spanish.'
    : 'ALL slide titles, bullet points, and speaker notes MUST be in English.';
  const conclusionTitle = lang === 'es' ? 'Conclusiones y Próximos Pasos' : 'Conclusions and Next Steps';

  const rawSlides = await generateContentWithLLM(
    `You are a professional presentation designer. Create slide content.
Return ONLY valid JSON array:
[
  { "title": "Slide Title", "bullets": ["Key point 1", "Key point 2"], "notes": "Speaker notes" }
]

Requirements:
- First slide: title + subtitle (subtitle as first bullet)
- 8-10 content slides with varied content
- Each slide: 3-5 bullet points
- Last slide: key takeaways / conclusion ("${conclusionTitle}")
- Include speaker notes for each slide (2-3 sentences of additional context)
- All text in the same language as the user's request

CONTENT QUALITY:
- Bullets should be concise but informative (15-40 words each)
- Vary content types: some slides with data/statistics, some with concepts, some with recommendations
- Include specific details, numbers, and examples where relevant
- Avoid generic filler content - every bullet should add value

${langInstruction}

Respond ONLY with valid JSON array, no markdown fences, no explanation.`,
    request.message,
    request.userId,
  );

  let slides: Array<{ title: string; bullets: string[]; notes?: string }>;
  try {
    slides = JSON.parse(rawSlides.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    const errorMsg = lang === 'es' ? 'Error al generar contenido. Por favor intente de nuevo.' : 'Content generation error. Please try again.';
    const presTitle = lang === 'es' ? 'Presentación' : 'Presentation';
    slides = [{ title: presTitle, bullets: [errorMsg] }];
  }

  // Ensure a conclusion slide exists
  const hasConclusion = slides.some(s =>
    /(conclusi[oó]n|conclusion|pr[oó]ximos pasos|next step|cierre|closing|resumen final|summary)/i.test(s.title)
  );
  if (!hasConclusion && slides.length > 0) {
    slides.push({
      title: conclusionTitle,
      bullets: lang === 'es'
        ? [
            'Resumen de los puntos clave presentados',
            'Recomendaciones principales basadas en el análisis',
            'Próximos pasos concretos y responsables',
            'Cronograma sugerido de implementación',
          ]
        : [
            'Summary of key points presented',
            'Main recommendations based on the analysis',
            'Concrete next steps and responsible parties',
            'Suggested implementation timeline',
          ],
      notes: lang === 'es'
        ? 'Cerrar con un resumen ejecutivo y pasos accionables claros.'
        : 'Close with an executive summary and clear actionable steps.',
    });
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
  const content = await generateContentWithLLM(
    `You are a professional document writer. Based on the user's request, generate the document content as valid HTML with proper structure: use <h1>, <h2>, <h3> for headings, <p> for paragraphs, <ul>/<ol> for lists, <table> for tables. Use professional styling. Respond ONLY with the HTML content (no <html>/<body> wrapper needed).`,
    request.message,
    request.userId,
  );

  const title = extractTitle(request.message);

  // Wrap content in a styled HTML page for PDF rendering
  const htmlDocument = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1a202c; max-width: 800px; margin: 0 auto; padding: 20px; }
  h1 { color: #1f4e79; border-bottom: 2px solid #4472c4; padding-bottom: 8px; }
  h2 { color: #2b7a78; margin-top: 1.5em; }
  h3 { color: #4472c4; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d2d6dc; padding: 8px 12px; text-align: left; }
  th { background-color: #1f4e79; color: white; }
  tr:nth-child(even) { background-color: #f7fafc; }
  ul, ol { padding-left: 2em; }
  blockquote { border-left: 4px solid #4472c4; margin: 1em 0; padding: 0.5em 1em; background: #f7fafc; }
</style>
</head>
<body>
<h1>${title}</h1>
${content}
</body>
</html>`;

  const buffer = await generatePdfFromHtml(htmlDocument);
  const filename = `document_${timestamp()}.pdf`;

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
        mimeType: 'application/pdf',
        size: buffer.length,
        metadata: { format: 'pdf', generatedAt: new Date().toISOString() },
      },
    ],
    textResponse: `Your PDF document has been created successfully with professional formatting.`,
    suggestions: [
      'Convert this to a Word document',
      'Create a presentation from this content',
      'Modify the document structure',
    ],
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function extractTitle(message: string): string {
  // Iteratively strip verb prefixes, articles, document types, and connecting words
  // until the topic is exposed. We loop because patterns can appear in any order.
  let cleaned = message.trim();
  let previous = "";

  while (cleaned !== previous) {
    previous = cleaned;

    // Spanish command verbs (including reflexive / "me" forms)
    cleaned = cleaned.replace(/^(crea|creame|cr[eé]ame|genera|gen[eé]rame|generame|haz|hazme|escribe|escr[ií]beme|escribeme|prepara|prep[aá]rame|preparame|elabora|elaborame|elab[oó]rame|redacta|red[aá]ctame|dise[nñ]a|dise[nñ]ame|produce|produceme)\s*/i, '');

    // English command verbs (with optional "me" / "a" after)
    cleaned = cleaned.replace(/^(make|create|generate|write|produce|build|draft|compose|prepare)\s*(me)?\s*/i, '');

    // Articles (Spanish and English)
    cleaned = cleaned.replace(/^(un|uno|una|el|la|los|las|a|an|the)\s*/i, '');

    // Document type keywords (Spanish and English)
    cleaned = cleaned.replace(/^(documento?|archivo|word|docx|excel|xlsx|spreadsheet|hoja\s*de\s*c[aá]lculo|presentaci[oó]n|powerpoint|pptx?|csv|pdf|informe|reporte|report)\s*/i, '');

    // Connecting prepositions (Spanish and English)
    cleaned = cleaned.replace(/^(de|del|sobre|acerca\s*de|para|con|en|about|on|for|with|regarding)\s*/i, '');

    cleaned = cleaned.trim();
  }

  if (cleaned.length === 0) return 'Document';

  // Capitalize first letter of each significant word (title case)
  const titleCased = cleaned
    .split(/\s+/)
    .map((word, i) => {
      // Keep short connecting words lowercase unless first word
      const lowerWord = word.toLowerCase();
      const minorWords = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "o", "u", "en", "a", "the", "of", "and", "or", "in", "for", "on", "to", "with"]);
      if (i > 0 && minorWords.has(lowerWord)) return lowerWord;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");

  return titleCased.length > 60 ? titleCased.slice(0, 57) + '...' : titleCased;
}
