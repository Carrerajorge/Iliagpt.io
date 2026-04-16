import { getGeminiClientOrThrow, GEMINI_MODELS } from "../lib/gemini";
import { 
  validateExcelSpec, 
  validateDocSpec,
  validateGeneratedExcelBuffer,
  validateGeneratedWordBuffer,
  type PostRenderValidationResult,
} from "./documentValidators";
import {
  validateExcelSpec as qualityGateExcelSpec,
  validateDocSpec as qualityGateDocSpec,
  type QualityReport,
} from "./documentQualityGates";
import { renderExcelFromSpec } from "./excelSpecRenderer";
import { renderWordFromSpec } from "./wordSpecRenderer";
import { renderCvFromSpec } from "./cvRenderer";
import { selectCvTemplate } from "./documentMappingService";
import {
  getDocumentSystemPrompt,
  getDocumentJsonSchema,
} from "./documentPrompts";
import {
  ExcelSpec,
  DocSpec,
  CvSpec,
  ReportSpec,
  LetterSpec,
  excelSpecJsonSchema,
  docSpecJsonSchema,
  cvSpecSchema,
  reportSpecSchema,
  letterSpecSchema,
  cvSpecJsonSchema,
  reportSpecJsonSchema,
  letterSpecJsonSchema,
} from "../../shared/documentSpecs";

const MAX_RETRIES = 3;

// ============================================
// SECURITY LIMITS
// ============================================

/** Maximum user prompt length (characters) to prevent abuse */
const MAX_PROMPT_LENGTH = 50_000;

/** Maximum LLM response length (characters) */
const MAX_RESPONSE_LENGTH = 500_000;

/** LLM call timeout (ms) */
const LLM_CALL_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Security: sanitize user prompt to prevent resource abuse
 */
function sanitizePrompt(prompt: string): string {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("Prompt is required and must be a string");
  }
  // Strip control characters except newline/tab
  const cleaned = prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  if (cleaned.length > MAX_PROMPT_LENGTH) {
    console.warn(`[DocumentOrchestrator] Prompt truncated from ${cleaned.length} to ${MAX_PROMPT_LENGTH} chars`);
    return cleaned.substring(0, MAX_PROMPT_LENGTH);
  }
  return cleaned;
}

/**
 * Security: wrap an LLM call with a timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

const REPAIR_SYSTEM_PROMPT = `You are a JSON repair specialist. Fix validation errors in the provided JSON.

CRITICAL INSTRUCTIONS:
- Analyze each validation error carefully
- Fix ONLY the specific issues mentioned
- Preserve all valid parts unchanged
- Return ONLY valid JSON, no markdown, no explanations`;

export interface RepairLoopResult<T> {
  ok: boolean;
  iterations: number;
  errors: string[];
  finalSpec: T | null;
}

export interface GenerationResult<T> {
  buffer: Buffer;
  spec: T;
  qualityReport: QualityReport;
  postRenderValidation: PostRenderValidationResult;
  attemptsUsed: number;
  repairLoop: RepairLoopResult<T>;
}

function buildRepairPrompt(
  originalPrompt: string,
  lastBadJson: string,
  errors: string[],
  schemaContext: string,
  docType: "excel" | "word"
): string {
  const specificRules = docType === "excel"
    ? `EXCEL-SPECIFIC REPAIR RULES:
- Range format must be A1:B10 (start:end), not A1-B10
- Each table row array length MUST equal headers array length
- Chart ranges (categories_range, values_range) must match table data extent
- Anchor cell uses A1 notation (column letters + row number)`
    : `WORD-SPECIFIC REPAIR RULES:
- blocks is an array of objects with "type" field
- Valid block types: heading, paragraph, bullets, numbered, table, title, toc, page_break
- Each table row array length MUST equal columns array length
- Heading level must be 1-6`;

  return `${schemaContext}

${specificRules}

=== REPAIR REQUEST ===

ORIGINAL USER REQUEST:
${originalPrompt}

YOUR PREVIOUS (INVALID) RESPONSE:
\`\`\`json
${lastBadJson}
\`\`\`

VALIDATION ERRORS (fix each one):
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

REQUIRED ACTIONS:
1. Fix each validation error listed above
2. Preserve all valid content unchanged
3. Return ONLY the corrected JSON, no markdown, no explanations

Respond with the fixed JSON now:`;
}

const EXCEL_SYSTEM_PROMPT = `You are a JSON generator that creates Excel workbook specifications.

CRITICAL VALIDATION RULES (MUST FOLLOW):
1. Each table row array length MUST equal headers array length exactly
2. Chart ranges must use A1:B10 format (start:end) NOT A1-B10
3. Range consistency: categories_range and values_range must reference cells within table data extent
   - If table anchor is A1 with 3 headers and 5 rows, data is A2:C6 (row 2-6 for data, columns A-C)
4. Sheet names: 1-31 chars, no special characters: \\ / : * ? [ ]

RICH TEXT FORMATTING (IMPORTANT):
Use these formatting conventions in cell content - they will be rendered with native Excel styles:
- **bold text** for bold (double asterisks)
- *italic text* for italics (single asterisks)
- \`code\` for inline code (backticks)
- [link text](url) for hyperlinks
- $LaTeX$ for math formulas (will be rendered with formatting)

MATH FORMULAS - Use LaTeX syntax:
- Fractions: $\\frac{a}{b}$
- Exponents: $x^2$, $x^{n+1}$
- Subscripts: $x_1$, $a_{ij}$
- Greek letters: $\\alpha$, $\\beta$, $\\pi$

You MUST respond with ONLY valid JSON that conforms to this schema:
${JSON.stringify(excelSpecJsonSchema, null, 2)}

Example valid response (note how ranges match data):
{
  "workbook_title": "Sales Report",
  "sheets": [
    {
      "name": "Data",
      "tables": [
        {
          "anchor": "A1",
          "headers": ["Product", "Sales", "Revenue"],
          "rows": [
            ["Widget A", 100, 5000],
            ["Widget B", 150, 7500]
          ],
          "table_style": "TableStyleMedium9",
          "autofilter": true,
          "freeze_header": true
        }
      ],
      "charts": [
        {
          "type": "bar",
          "title": "Sales by Product",
          "categories_range": "A2:A3",
          "values_range": "B2:B3",
          "position": "E2"
        }
      ]
    }
  ]
}

Respond with ONLY the JSON, no markdown, no explanations.`;

const DOC_SYSTEM_PROMPT = `You are a JSON generator that creates Word document specifications.

CRITICAL VALIDATION RULES (MUST FOLLOW):
1. blocks is an array of objects, each with a "type" field
2. Valid block types: heading, paragraph, bullets, numbered, table, title, toc, page_break
3. Each table row array length MUST equal columns array length exactly
4. Heading level must be integer 1-6
5. bullets and numbered blocks require non-empty "items" array

RICH TEXT FORMATTING (IMPORTANT):
Use these formatting conventions in text content - they will be rendered as native Office styles:
- **bold text** for bold (double asterisks)
- *italic text* for italics (single asterisks)
- \`code\` for inline code (backticks)
- [link text](url) for hyperlinks
- $LaTeX$ for inline math formulas (single dollar signs)
- $$LaTeX$$ for block math formulas (double dollar signs)

MATH FORMULAS - Use LaTeX syntax:
- Fractions: $\\frac{a}{b}$
- Exponents: $x^2$, $x^{n+1}$
- Subscripts: $x_1$, $a_{ij}$
- Square roots: $\\sqrt{x}$, $\\sqrt[n]{x}$
- Greek letters: $\\alpha$, $\\beta$, $\\pi$
- Sums/integrals: $\\sum_{i=1}^{n}$, $\\int_{a}^{b}$
- Derivatives: $\\frac{d}{dx}$, $f'(x)$

You MUST respond with ONLY valid JSON that conforms to this schema:
${JSON.stringify(docSpecJsonSchema, null, 2)}

Example valid response with rich text and math:
{
  "title": "Math Exercise",
  "author": "Teacher",
  "blocks": [
    { "type": "title", "text": "Calculus Exercise" },
    { "type": "heading", "level": 1, "text": "Derivatives" },
    { "type": "paragraph", "text": "Calculate the derivative of $f(x) = x^3 + 2x^2 - 5x + 1$" },
    { "type": "paragraph", "text": "**Solution:** Using the power rule $\\frac{d}{dx}[x^n] = nx^{n-1}$:" },
    { "type": "paragraph", "text": "$$f'(x) = 3x^2 + 4x - 5$$" },
    { "type": "bullets", "items": ["The *derivative* of $x^3$ is $3x^2$", "The derivative of $2x^2$ is $4x$"] },
    {
      "type": "table",
      "columns": ["Function", "Derivative"],
      "rows": [
        ["$x^3$", "$3x^2$"],
        ["$2x^2$", "$4x$"],
        ["$-5x$", "$-5$"]
      ]
    }
  ]
}

Respond with ONLY the JSON, no markdown, no explanations.`;

export async function callGeminiForSpec(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const geminiClient = getGeminiClientOrThrow();
  const result: any = await withTimeout(
    geminiClient.models.generateContent({
      model: GEMINI_MODELS.FLASH,
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2,
        maxOutputTokens: 8192,
      },
    }),
    LLM_CALL_TIMEOUT_MS,
    "Gemini API call"
  );

  const text = result.text ?? "";
  // Security: limit response length
  if (text.length > MAX_RESPONSE_LENGTH) {
    console.warn(`[DocumentOrchestrator] LLM response truncated from ${text.length} to ${MAX_RESPONSE_LENGTH} chars`);
    return text.substring(0, MAX_RESPONSE_LENGTH);
  }
  return text;
}

function extractJsonFromResponse(response: string): string {
  let cleaned = response.trim();
  
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  
  return cleaned.trim();
}

export async function generateExcelFromPrompt(
  prompt: string
): Promise<GenerationResult<ExcelSpec>> {
  prompt = sanitizePrompt(prompt);
  let lastErrors: string[] = [];
  let lastBadJson: string = "";
  let lastQualityReport: QualityReport | null = null;
  const allAttemptErrors: string[][] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] Excel generation attempt ${attempt}/${MAX_RETRIES}`);

    let systemPrompt: string;
    let userPrompt: string;

    if (attempt === 1 || lastErrors.length === 0) {
      systemPrompt = EXCEL_SYSTEM_PROMPT;
      userPrompt = prompt;
    } else {
      systemPrompt = REPAIR_SYSTEM_PROMPT;
      userPrompt = buildRepairPrompt(
        prompt,
        lastBadJson,
        lastErrors,
        `SCHEMA REFERENCE:\n${JSON.stringify(excelSpecJsonSchema, null, 2)}`,
        "excel"
      );
    }

    const response = await callGeminiForSpec(systemPrompt, userPrompt);
    const jsonStr = extractJsonFromResponse(response);
    lastBadJson = jsonStr;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    // Basic schema validation
    const schemaValidation = validateExcelSpec(parsed);
    if (!schemaValidation.valid) {
      lastErrors = schemaValidation.errors;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Schema validation failed:`, schemaValidation.errors);
      continue;
    }

    const spec = parsed as ExcelSpec;

    // Run quality gate validation (DoS protection, limits, best practices)
    const qualityReport = qualityGateExcelSpec(spec);
    lastQualityReport = qualityReport;
    
    if (!qualityReport.valid) {
      const errorMessages = qualityReport.errors.map(e => `[${e.code}] ${e.message} at ${e.path}`);
      lastErrors = errorMessages;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Quality gate failed:`, errorMessages);
      continue;
    }

    // Log warnings but continue
    if (qualityReport.warnings.length > 0) {
      console.warn(`[DocumentOrchestrator] Quality warnings:`, qualityReport.warnings);
    }
    
    try {
      const buffer = await renderExcelFromSpec(spec);
      
      // Post-render validation - verify the generated buffer is valid
      const postRenderValidation = await validateGeneratedExcelBuffer(buffer);
      if (!postRenderValidation.valid) {
        lastErrors = postRenderValidation.errors;
        allAttemptErrors.push([...lastErrors]);
        console.error(`[DocumentOrchestrator] Post-render validation failed:`, postRenderValidation.errors);
        continue;
      }
      
      console.log(`[DocumentOrchestrator] Excel generated successfully on attempt ${attempt}`);
      return { 
        buffer, 
        spec, 
        qualityReport,
        postRenderValidation,
        attemptsUsed: attempt,
        repairLoop: {
          ok: true,
          iterations: attempt,
          errors: allAttemptErrors.flat(),
          finalSpec: spec,
        },
      };
    } catch (renderError) {
      lastErrors = [`Render error: ${(renderError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Render failed:`, lastErrors[0]);
      continue;
    }
  }

  const allErrors = allAttemptErrors.flat();
  const error = new Error(
    `Failed to generate valid Excel spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
  (error as any).repairLoopResult = {
    ok: false,
    iterations: MAX_RETRIES,
    errors: allErrors,
    finalSpec: null,
  } as RepairLoopResult<ExcelSpec>;
  throw error;
}

export async function generateWordFromPrompt(
  prompt: string
): Promise<GenerationResult<DocSpec>> {
  prompt = sanitizePrompt(prompt);
  let lastErrors: string[] = [];
  let lastBadJson: string = "";
  let lastQualityReport: QualityReport | null = null;
  const allAttemptErrors: string[][] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] Word generation attempt ${attempt}/${MAX_RETRIES}`);

    let systemPrompt: string;
    let userPrompt: string;

    if (attempt === 1 || lastErrors.length === 0) {
      systemPrompt = DOC_SYSTEM_PROMPT;
      userPrompt = prompt;
    } else {
      systemPrompt = REPAIR_SYSTEM_PROMPT;
      userPrompt = buildRepairPrompt(
        prompt,
        lastBadJson,
        lastErrors,
        `SCHEMA REFERENCE:\n${JSON.stringify(docSpecJsonSchema, null, 2)}`,
        "word"
      );
    }

    const response = await callGeminiForSpec(systemPrompt, userPrompt);
    const jsonStr = extractJsonFromResponse(response);
    lastBadJson = jsonStr;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    // Basic schema validation
    const schemaValidation = validateDocSpec(parsed);
    if (!schemaValidation.valid) {
      lastErrors = schemaValidation.errors;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Schema validation failed:`, schemaValidation.errors);
      continue;
    }

    const spec = parsed as DocSpec;

    // Run quality gate validation (DoS protection, limits, best practices)
    const qualityReport = qualityGateDocSpec(spec);
    lastQualityReport = qualityReport;
    
    if (!qualityReport.valid) {
      const errorMessages = qualityReport.errors.map(e => `[${e.code}] ${e.message} at ${e.path}`);
      lastErrors = errorMessages;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Quality gate failed:`, errorMessages);
      continue;
    }

    // Log warnings but continue
    if (qualityReport.warnings.length > 0) {
      console.warn(`[DocumentOrchestrator] Quality warnings:`, qualityReport.warnings);
    }
    
    try {
      const buffer = await renderWordFromSpec(spec);
      
      // Post-render validation - verify the generated buffer is valid
      const postRenderValidation = await validateGeneratedWordBuffer(buffer);
      if (!postRenderValidation.valid) {
        lastErrors = postRenderValidation.errors;
        allAttemptErrors.push([...lastErrors]);
        console.error(`[DocumentOrchestrator] Post-render validation failed:`, postRenderValidation.errors);
        continue;
      }
      
      console.log(`[DocumentOrchestrator] Word generated successfully on attempt ${attempt}`);
      return { 
        buffer, 
        spec, 
        qualityReport,
        postRenderValidation,
        attemptsUsed: attempt,
        repairLoop: {
          ok: true,
          iterations: attempt,
          errors: allAttemptErrors.flat(),
          finalSpec: spec,
        },
      };
    } catch (renderError) {
      lastErrors = [`Render error: ${(renderError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Render failed:`, lastErrors[0]);
      continue;
    }
  }

  const allErrors = allAttemptErrors.flat();
  const error = new Error(
    `Failed to generate valid Word spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
  (error as any).repairLoopResult = {
    ok: false,
    iterations: MAX_RETRIES,
    errors: allErrors,
    finalSpec: null,
  } as RepairLoopResult<DocSpec>;
  throw error;
}

function buildDocumentRepairPrompt(
  originalPrompt: string,
  lastBadJson: string,
  errors: string[],
  schemaContext: string,
  docType: "cv" | "report" | "letter"
): string {
  const specificRules: Record<string, string> = {
    cv: `CV-SPECIFIC REPAIR RULES:
- header object is REQUIRED with name, phone, email, address fields
- Skill proficiency MUST be integer 1-5
- Language proficiency MUST be integer 1-5
- work_experience and education should be in reverse chronological order
- end_date can be null for current positions`,
    report: `REPORT-SPECIFIC REPAIR RULES:
- header object is REQUIRED with at least title field
- Each table row array length MUST equal columns array length
- Chart data.labels and data.values arrays must have same length
- Heading levels are 1-4`,
    letter: `LETTER-SPECIFIC REPAIR RULES:
- sender object is REQUIRED with name and address
- recipient object is REQUIRED with name and address
- date field is REQUIRED
- body_paragraphs array is REQUIRED with at least one paragraph
- signature_name is REQUIRED`,
  };

  return `${schemaContext}

${specificRules[docType]}

=== REPAIR REQUEST ===

ORIGINAL USER REQUEST:
${originalPrompt}

YOUR PREVIOUS (INVALID) RESPONSE:
\`\`\`json
${lastBadJson}
\`\`\`

VALIDATION ERRORS (fix each one):
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

REQUIRED ACTIONS:
1. Fix each validation error listed above
2. Preserve all valid content unchanged
3. Return ONLY the corrected JSON, no markdown, no explanations

Respond with the fixed JSON now:`;
}

function validateCvSpec(spec: unknown): { valid: boolean; errors: string[] } {
  const result = cvSpecSchema.safeParse(spec);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { valid: false, errors };
}

function validateReportSpec(spec: unknown): { valid: boolean; errors: string[] } {
  const result = reportSpecSchema.safeParse(spec);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { valid: false, errors };
}

function validateLetterSpec(spec: unknown): { valid: boolean; errors: string[] } {
  const result = letterSpecSchema.safeParse(spec);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { valid: false, errors };
}

function createDefaultQualityReport(): QualityReport {
  return {
    valid: true,
    errors: [],
    warnings: [],
    info: [],
  };
}

export async function generateCvFromPrompt(
  prompt: string
): Promise<GenerationResult<CvSpec>> {
  prompt = sanitizePrompt(prompt);
  let lastErrors: string[] = [];
  let lastBadJson: string = "";
  const allAttemptErrors: string[][] = [];

  const systemPrompt = getDocumentSystemPrompt("cv");
  const jsonSchema = getDocumentJsonSchema("cv");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] CV generation attempt ${attempt}/${MAX_RETRIES}`);

    let currentSystemPrompt: string;
    let userPrompt: string;

    if (attempt === 1 || lastErrors.length === 0) {
      currentSystemPrompt = systemPrompt;
      userPrompt = prompt;
    } else {
      currentSystemPrompt = REPAIR_SYSTEM_PROMPT;
      userPrompt = buildDocumentRepairPrompt(
        prompt,
        lastBadJson,
        lastErrors,
        `SCHEMA REFERENCE:\n${JSON.stringify(jsonSchema, null, 2)}`,
        "cv"
      );
    }

    const response = await callGeminiForSpec(currentSystemPrompt, userPrompt);
    const jsonStr = extractJsonFromResponse(response);
    lastBadJson = jsonStr;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    const schemaValidation = validateCvSpec(parsed);
    if (!schemaValidation.valid) {
      lastErrors = schemaValidation.errors;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Schema validation failed:`, schemaValidation.errors);
      continue;
    }

    const spec = parsed as CvSpec;
    const templateConfig = selectCvTemplate(spec.template_style || "modern");
    const qualityReport = createDefaultQualityReport();

    try {
      const buffer = await renderCvFromSpec(spec, templateConfig);
      
      const postRenderValidation = await validateGeneratedWordBuffer(buffer);
      if (!postRenderValidation.valid) {
        lastErrors = postRenderValidation.errors;
        allAttemptErrors.push([...lastErrors]);
        console.error(`[DocumentOrchestrator] Post-render validation failed:`, postRenderValidation.errors);
        continue;
      }
      
      console.log(`[DocumentOrchestrator] CV generated successfully on attempt ${attempt}`);
      return { 
        buffer, 
        spec, 
        qualityReport,
        postRenderValidation,
        attemptsUsed: attempt,
        repairLoop: {
          ok: true,
          iterations: attempt,
          errors: allAttemptErrors.flat(),
          finalSpec: spec,
        },
      };
    } catch (renderError) {
      lastErrors = [`Render error: ${(renderError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Render failed:`, lastErrors[0]);
      continue;
    }
  }

  const allErrors = allAttemptErrors.flat();
  const error = new Error(
    `Failed to generate valid CV spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
  (error as any).repairLoopResult = {
    ok: false,
    iterations: MAX_RETRIES,
    errors: allErrors,
    finalSpec: null,
  } as RepairLoopResult<CvSpec>;
  throw error;
}

export async function generateReportFromPrompt(
  prompt: string
): Promise<GenerationResult<ReportSpec>> {
  prompt = sanitizePrompt(prompt);
  let lastErrors: string[] = [];
  let lastBadJson: string = "";
  const allAttemptErrors: string[][] = [];

  const systemPrompt = getDocumentSystemPrompt("report");
  const jsonSchema = getDocumentJsonSchema("report");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] Report generation attempt ${attempt}/${MAX_RETRIES}`);

    let currentSystemPrompt: string;
    let userPrompt: string;

    if (attempt === 1 || lastErrors.length === 0) {
      currentSystemPrompt = systemPrompt;
      userPrompt = prompt;
    } else {
      currentSystemPrompt = REPAIR_SYSTEM_PROMPT;
      userPrompt = buildDocumentRepairPrompt(
        prompt,
        lastBadJson,
        lastErrors,
        `SCHEMA REFERENCE:\n${JSON.stringify(jsonSchema, null, 2)}`,
        "report"
      );
      console.log(`[DocumentOrchestrator] Retry with ${lastErrors.length} error(s) to fix`);
    }

    const response = await callGeminiForSpec(currentSystemPrompt, userPrompt);
    const jsonStr = extractJsonFromResponse(response);
    lastBadJson = jsonStr;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    const schemaValidation = validateReportSpec(parsed);
    if (!schemaValidation.valid) {
      lastErrors = schemaValidation.errors;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Schema validation failed:`, schemaValidation.errors);
      continue;
    }

    const spec = parsed as ReportSpec;
    const qualityReport = createDefaultQualityReport();

    try {
      const buffer = await renderWordFromSpec({
        title: spec.header.title,
        author: spec.header.author || undefined,
        styleset: spec.template_style === "academic" ? "classic" : "modern",
        add_toc: spec.show_toc,
        blocks: convertReportToDocBlocks(spec),
      });
      
      const postRenderValidation = await validateGeneratedWordBuffer(buffer);
      if (!postRenderValidation.valid) {
        lastErrors = postRenderValidation.errors;
        allAttemptErrors.push([...lastErrors]);
        console.error(`[DocumentOrchestrator] Post-render validation failed:`, postRenderValidation.errors);
        continue;
      }
      
      console.log(`[DocumentOrchestrator] Report generated successfully on attempt ${attempt}`);
      return { 
        buffer, 
        spec, 
        qualityReport,
        postRenderValidation,
        attemptsUsed: attempt,
        repairLoop: {
          ok: true,
          iterations: attempt,
          errors: allAttemptErrors.flat(),
          finalSpec: spec,
        },
      };
    } catch (renderError) {
      lastErrors = [`Render error: ${(renderError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Render failed:`, lastErrors[0]);
      continue;
    }
  }

  const allErrors = allAttemptErrors.flat();
  const error = new Error(
    `Failed to generate valid Report spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
  (error as any).repairLoopResult = {
    ok: false,
    iterations: MAX_RETRIES,
    errors: allErrors,
    finalSpec: null,
  } as RepairLoopResult<ReportSpec>;
  throw error;
}

function convertReportToDocBlocks(spec: ReportSpec): DocSpec["blocks"] {
  const blocks: DocSpec["blocks"] = [];
  
  blocks.push({ type: "title", text: spec.header.title });
  
  if (spec.executive_summary) {
    blocks.push({ type: "heading", level: 1, text: "Executive Summary" });
    blocks.push({ type: "paragraph", text: spec.executive_summary });
  }
  
  for (const section of spec.sections) {
    blocks.push({ type: "heading", level: 1, text: section.title });
    
    for (const content of section.content) {
      switch (content.type) {
        case "text":
          blocks.push({ type: "paragraph", text: content.content });
          break;
        case "heading":
          blocks.push({ type: "heading", level: Math.min(content.level + 1, 6), text: content.text });
          break;
        case "bullets":
          blocks.push({ type: "bullets", items: content.items });
          break;
        case "numbered":
          blocks.push({ type: "numbered", items: content.items });
          break;
        case "table":
          blocks.push({
            type: "table",
            columns: content.columns,
            rows: content.rows || [],
            style: "Table Grid",
            header: true,
          });
          break;
        case "quote":
          const quoteText = content.attribution
            ? `"${content.text}" — ${content.attribution}`
            : `"${content.text}"`;
          blocks.push({ type: "paragraph", text: quoteText, style: "Quote" });
          break;
      }
    }
  }
  
  return blocks;
}

export async function generateLetterFromPrompt(
  prompt: string
): Promise<GenerationResult<LetterSpec>> {
  prompt = sanitizePrompt(prompt);
  let lastErrors: string[] = [];
  let lastBadJson: string = "";
  const allAttemptErrors: string[][] = [];

  const systemPrompt = getDocumentSystemPrompt("letter");
  const jsonSchema = getDocumentJsonSchema("letter");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[DocumentOrchestrator] Letter generation attempt ${attempt}/${MAX_RETRIES}`);

    let currentSystemPrompt: string;
    let userPrompt: string;

    if (attempt === 1 || lastErrors.length === 0) {
      currentSystemPrompt = systemPrompt;
      userPrompt = prompt;
    } else {
      currentSystemPrompt = REPAIR_SYSTEM_PROMPT;
      userPrompt = buildDocumentRepairPrompt(
        prompt,
        lastBadJson,
        lastErrors,
        `SCHEMA REFERENCE:\n${JSON.stringify(jsonSchema, null, 2)}`,
        "letter"
      );
      console.log(`[DocumentOrchestrator] Retry with ${lastErrors.length} error(s) to fix`);
    }

    const response = await callGeminiForSpec(currentSystemPrompt, userPrompt);
    const jsonStr = extractJsonFromResponse(response);
    lastBadJson = jsonStr;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      lastErrors = [`JSON parse error: ${(parseError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] JSON parse failed:`, lastErrors[0]);
      continue;
    }

    const schemaValidation = validateLetterSpec(parsed);
    if (!schemaValidation.valid) {
      lastErrors = schemaValidation.errors;
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Schema validation failed:`, schemaValidation.errors);
      continue;
    }

    const spec = parsed as LetterSpec;
    const qualityReport = createDefaultQualityReport();

    try {
      const buffer = await renderWordFromSpec({
        title: spec.subject || "Letter",
        styleset: spec.template_style === "formal" ? "classic" : "modern",
        add_toc: false,
        blocks: convertLetterToDocBlocks(spec),
      });
      
      const postRenderValidation = await validateGeneratedWordBuffer(buffer);
      if (!postRenderValidation.valid) {
        lastErrors = postRenderValidation.errors;
        allAttemptErrors.push([...lastErrors]);
        console.error(`[DocumentOrchestrator] Post-render validation failed:`, postRenderValidation.errors);
        continue;
      }
      
      console.log(`[DocumentOrchestrator] Letter generated successfully on attempt ${attempt}`);
      return { 
        buffer, 
        spec, 
        qualityReport,
        postRenderValidation,
        attemptsUsed: attempt,
        repairLoop: {
          ok: true,
          iterations: attempt,
          errors: allAttemptErrors.flat(),
          finalSpec: spec,
        },
      };
    } catch (renderError) {
      lastErrors = [`Render error: ${(renderError as Error).message}`];
      allAttemptErrors.push([...lastErrors]);
      console.error(`[DocumentOrchestrator] Render failed:`, lastErrors[0]);
      continue;
    }
  }

  const allErrors = allAttemptErrors.flat();
  const error = new Error(
    `Failed to generate valid Letter spec after ${MAX_RETRIES} attempts. Last errors: ${lastErrors.join("; ")}`
  );
  (error as any).repairLoopResult = {
    ok: false,
    iterations: MAX_RETRIES,
    errors: allErrors,
    finalSpec: null,
  } as RepairLoopResult<LetterSpec>;
  throw error;
}

function convertLetterToDocBlocks(spec: LetterSpec): DocSpec["blocks"] {
  const blocks: DocSpec["blocks"] = [];
  
  const senderAddress = spec.sender.address.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  blocks.push({ type: "paragraph", text: spec.sender.name });
  for (const line of senderAddress) {
    blocks.push({ type: "paragraph", text: line });
  }
  if (spec.sender.phone) {
    blocks.push({ type: "paragraph", text: spec.sender.phone });
  }
  if (spec.sender.email) {
    blocks.push({ type: "paragraph", text: spec.sender.email });
  }
  
  blocks.push({ type: "paragraph", text: "" });
  blocks.push({ type: "paragraph", text: spec.date });
  blocks.push({ type: "paragraph", text: "" });
  
  blocks.push({ type: "paragraph", text: spec.recipient.name });
  if (spec.recipient.title) {
    blocks.push({ type: "paragraph", text: spec.recipient.title });
  }
  if (spec.recipient.organization) {
    blocks.push({ type: "paragraph", text: spec.recipient.organization });
  }
  const recipientAddress = spec.recipient.address.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  for (const line of recipientAddress) {
    blocks.push({ type: "paragraph", text: line });
  }
  
  blocks.push({ type: "paragraph", text: "" });
  
  if (spec.subject) {
    blocks.push({ type: "paragraph", text: `Re: ${spec.subject}` });
    blocks.push({ type: "paragraph", text: "" });
  }
  
  blocks.push({ type: "paragraph", text: `${spec.salutation},` });
  blocks.push({ type: "paragraph", text: "" });
  
  for (const paragraph of spec.body_paragraphs) {
    blocks.push({ type: "paragraph", text: paragraph });
    blocks.push({ type: "paragraph", text: "" });
  }
  
  blocks.push({ type: "paragraph", text: `${spec.closing},` });
  blocks.push({ type: "paragraph", text: "" });
  blocks.push({ type: "paragraph", text: "" });
  blocks.push({ type: "paragraph", text: spec.signature_name });
  
  return blocks;
}
