/**
 * Data Analysis Skill Handler
 *
 * Handles data analysis, statistics, and visualization requests.
 * Uses LLM to generate analysis data and produces Excel files with
 * formatted tables, charts, and statistical summaries.
 */

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

interface AnalysisResult {
  title: string;
  summary: string;
  insights: string[];
  tables: Array<{
    name: string;
    headers: string[];
    rows: string[][];
  }>;
  statistics?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function errorResult(errorMsg: string): SkillHandlerResult {
  return {
    handled: false,
    skillId: 'data-analysis',
    skillName: 'Data Analysis',
    category: 'analysis',
    artifacts: [],
    textResponse: `I was unable to complete the data analysis. ${errorMsg}`,
  };
}

async function generateWithLLM(
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

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleDataAnalysis(
  request: SkillHandlerRequest,
): Promise<SkillHandlerResult> {
  try {
    // Step 1: Use LLM to generate structured analysis data
    const rawAnalysis = await generateWithLLM(
      `You are a senior data analyst. Based on the user's request, generate a comprehensive data analysis as a valid JSON object with this structure:
{
  "title": "Analysis Title",
  "summary": "Executive summary of findings (2-4 sentences)",
  "insights": ["Key insight 1", "Key insight 2", "Key insight 3"],
  "tables": [
    {
      "name": "Main Data",
      "headers": ["Column1", "Column2", "Column3"],
      "rows": [["val1", "val2", "val3"], ...]
    }
  ],
  "statistics": {
    "Total Records": 100,
    "Average": 45.3,
    "Median": 42,
    "Std Deviation": 12.1,
    "Min": 10,
    "Max": 95
  }
}
Generate realistic, professional data with at least 10-20 rows. Include multiple tables if the analysis warrants it: one for raw data and one for summary statistics. Respond ONLY with JSON, no markdown fences.`,
      request.message,
      request.userId,
    );

    const analysis = parseJSON<AnalysisResult>(rawAnalysis, {
      title: 'Data Analysis',
      summary: 'Analysis could not be parsed. Please try again with a more specific request.',
      insights: ['Unable to generate insights from the provided request.'],
      tables: [{ name: 'Data', headers: ['Info'], rows: [['No data generated']] }],
    });

    // Step 2: Generate Excel file with analysis results
    const primaryTable = analysis.tables[0] ?? { name: 'Data', headers: ['Info'], rows: [['No data']] };
    const excelBuffer = await professionalFileGenerator.generateExcel(
      primaryTable.headers,
      primaryTable.rows,
      {
        sheetName: primaryTable.name,
        title: analysis.title,
        additionalSheets: analysis.tables.slice(1).map((t) => ({
          name: t.name,
          headers: t.headers,
          rows: t.rows,
        })),
      },
    );

    const excelFilename = `analysis_${timestamp()}.xlsx`;

    // Step 3: Build text summary
    const totalRows = analysis.tables.reduce((sum, t) => sum + t.rows.length, 0);
    const statsText = analysis.statistics
      ? Object.entries(analysis.statistics)
          .map(([k, v]) => `  • ${k}: ${v}`)
          .join('\n')
      : '';

    const insightsText = analysis.insights.map((i, idx) => `${idx + 1}. ${i}`).join('\n');

    const textResponse = [
      `**${analysis.title}**`,
      '',
      analysis.summary,
      '',
      '**Key Insights:**',
      insightsText,
      statsText ? '\n**Statistics:**\n' + statsText : '',
      '',
      `The full analysis has been exported to an Excel file with ${analysis.tables.length} sheet(s) and ${totalRows} total data rows.`,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      handled: true,
      skillId: 'data-analysis',
      skillName: 'Data Analysis',
      category: 'analysis',
      artifacts: [
        {
          type: 'spreadsheet',
          filename: excelFilename,
          buffer: excelBuffer,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: excelBuffer.length,
          metadata: {
            format: 'xlsx',
            tableCount: analysis.tables.length,
            totalRows,
            generatedAt: new Date().toISOString(),
          },
        },
      ],
      textResponse,
      suggestions: [
        'Visualize this data as a chart',
        'Run a deeper statistical analysis',
        'Export this analysis as a Word report',
        'Compare with another dataset',
      ],
    };
  } catch (error: any) {
    console.warn('[SkillHandler:dataAnalysis]', error);
    return errorResult(error?.message ?? 'An unexpected error occurred.');
  }
}
