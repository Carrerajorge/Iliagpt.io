import { llmGateway } from "../lib/llmGateway";
import type { ColumnTypeInfo } from "./spreadsheetAnalyzer";

export type AnalysisMode = "full" | "text_only" | "numbers_only";

export interface GenerateAnalysisCodeParams {
  sheetName: string;
  headers: string[];
  columnTypes: ColumnTypeInfo[];
  sampleData: any[][];
  mode: AnalysisMode;
  userPrompt?: string;
}

export interface GenerateAnalysisCodeResult {
  code: string;
  intent: string;
}

export interface ValidatePythonCodeResult {
  valid: boolean;
  errors: string[];
}

const ALLOWED_MODULES = ["pandas", "numpy", "json", "datetime", "math"];

const DANGEROUS_PATTERNS = [
  { pattern: /import\s+os\b/, message: "Import of 'os' module is not allowed" },
  { pattern: /from\s+os\s+import/, message: "Import from 'os' module is not allowed" },
  { pattern: /import\s+subprocess\b/, message: "Import of 'subprocess' module is not allowed" },
  { pattern: /from\s+subprocess\s+import/, message: "Import from 'subprocess' module is not allowed" },
  { pattern: /import\s+sys\b/, message: "Import of 'sys' module is not allowed" },
  { pattern: /from\s+sys\s+import/, message: "Import from 'sys' module is not allowed" },
  { pattern: /import\s+shutil\b/, message: "Import of 'shutil' module is not allowed" },
  { pattern: /from\s+shutil\s+import/, message: "Import from 'shutil' module is not allowed" },
  { pattern: /\beval\s*\(/, message: "Use of 'eval()' is not allowed" },
  { pattern: /\bexec\s*\(/, message: "Use of 'exec()' is not allowed" },
  { pattern: /\bcompile\s*\(/, message: "Use of 'compile()' is not allowed" },
  { pattern: /open\s*\([^)]*['"][wa]\+?['"]/, message: "Opening files in write mode is not allowed" },
  { pattern: /open\s*\([^)]*,\s*mode\s*=\s*['"][wa]/, message: "Opening files in write mode is not allowed" },
  { pattern: /import\s+socket\b/, message: "Import of 'socket' module is not allowed" },
  { pattern: /from\s+socket\s+import/, message: "Import from 'socket' module is not allowed" },
  { pattern: /import\s+urllib\b/, message: "Import of 'urllib' module is not allowed" },
  { pattern: /from\s+urllib\s+import/, message: "Import from 'urllib' module is not allowed" },
  { pattern: /import\s+requests\b/, message: "Import of 'requests' module is not allowed" },
  { pattern: /from\s+requests\s+import/, message: "Import from 'requests' module is not allowed" },
  { pattern: /import\s+http\b/, message: "Import of 'http' module is not allowed" },
  { pattern: /from\s+http\s+import/, message: "Import from 'http' module is not allowed" },
  { pattern: /__import__\s*\(/, message: "Use of '__import__()' is not allowed" },
  { pattern: /getattr\s*\([^)]*,\s*['"]__/, message: "Access to dunder attributes via getattr is not allowed" },
  { pattern: /\.\s*__class__/, message: "Access to '__class__' is not allowed" },
  { pattern: /\.\s*__bases__/, message: "Access to '__bases__' is not allowed" },
  { pattern: /\.\s*__subclasses__/, message: "Access to '__subclasses__' is not allowed" },
  { pattern: /\.\s*__globals__/, message: "Access to '__globals__' is not allowed" },
];

function buildSystemPrompt(params: GenerateAnalysisCodeParams): string {
  const { sheetName, headers, columnTypes, sampleData, mode, userPrompt } = params;

  const columnInfo = columnTypes
    .map((col, idx) => `  - ${col.name}: ${col.type}${col.nullCount ? ` (${col.nullCount} nulls)` : ""}`)
    .join("\n");

  const samplePreview = sampleData
    .slice(0, 5)
    .map((row) => `  ${JSON.stringify(row)}`)
    .join("\n");

  const modeInstructions = {
    full: `Perform a comprehensive analysis including:
- Descriptive statistics for all numeric columns
- Value counts and frequency analysis for categorical/text columns
- Data quality assessment (missing values, duplicates, outliers)
- Correlation analysis for numeric columns
- Generate summary metrics and optional chart configurations`,
    text_only: `Focus on text/categorical column analysis:
- Word frequency analysis
- Text length statistics
- Unique value counts and patterns
- Most common values
- Text quality metrics (empty strings, whitespace issues)`,
    numbers_only: `Focus on numeric column analysis:
- Descriptive statistics (mean, median, std, min, max, quartiles)
- Distribution analysis
- Outlier detection using IQR method
- Correlation matrix
- Generate histogram/distribution chart configurations`,
  };

  return `You are a Python data analyst expert. Generate clean, reproducible Python code to analyze spreadsheet data.

## CONSTRAINTS
- ONLY use these modules: pandas, numpy, json, datetime, math
- DO NOT use: os, subprocess, socket, requests, or any network/file-write operations
- Read the Excel file using: pd.read_excel(file_path, sheet_name="${sheetName}")
- The variables 'file_path' and 'sheet_name' will be provided at runtime
- Output MUST be valid JSON printed to stdout using print(json.dumps(result))

## SPREADSHEET INFO
Sheet Name: ${sheetName}
Headers: ${headers.join(", ")}

Column Types:
${columnInfo}

Sample Data (first 5 rows):
${samplePreview}

## ANALYSIS MODE: ${mode.toUpperCase()}
${modeInstructions[mode]}

${userPrompt ? `## USER REQUEST\n${userPrompt}\n` : ""}

## OUTPUT FORMAT
Your code must produce JSON output with this structure:
{
  "tables": [
    {
      "name": "Table Name",
      "data": [{col1: val1, col2: val2, ...}, ...]
    }
  ],
  "metrics": {
    "total_rows": number,
    "total_columns": number,
    "missing_values": number,
    "duplicate_rows": number,
    ...additional metrics...
  },
  "charts": [
    {
      "type": "bar|line|pie|histogram|scatter",
      "title": "Chart Title",
      "data": {...chart-specific data...}
    }
  ],
  "logs": ["Log message 1", "Log message 2", ...],
  "summary": "Brief text summary of findings"
}

## IMPORTANT
The generated code will be shown to the user as 'Generated Code', so make it readable and well-commented.

## CODE TEMPLATE
Generate code following this ChatGPT-style pattern with helper functions:

\`\`\`python
import pandas as pd
import numpy as np
import json

def analyze_spreadsheet(file_path: str, sheet_name: str) -> dict:
    """
    Analyze spreadsheet data and return structured results.
    """
    # Helpers to register outputs
    tables = []
    metrics = {}
    charts = []
    logs = []
    
    def register_table(name: str, df: pd.DataFrame, max_rows: int = 50):
        """Register a DataFrame as a result table."""
        tables.append({
            "name": name,
            "data": df.head(max_rows).to_dict(orient='records')
        })
    
    def register_metric(key: str, value):
        """Register a metric value."""
        metrics[key] = value
    
    def log(message: str):
        """Log a message during analysis."""
        logs.append(message)
    
    # Load the workbook and explore sheets
    xlsx = pd.ExcelFile(file_path)
    log(f"Available sheets: {xlsx.sheet_names}")
    
    # Read the target sheet
    # Use df.head() and df.info() for exploration
    df = pd.read_excel(xlsx, sheet_name=sheet_name)
    log(f"Loaded {len(df)} rows and {len(df.columns)} columns")
    
    # Basic data overview
    register_metric("total_rows", len(df))
    register_metric("total_columns", len(df.columns))
    register_metric("missing_values", int(df.isnull().sum().sum()))
    register_metric("duplicate_rows", int(df.duplicated().sum()))
    
    # Register first rows preview
    register_table("Data Preview", df.head(10))
    
    # YOUR ANALYSIS CODE HERE...
    # Use register_table(), register_metric(), and log() to record results
    
    return {
        "tables": tables,
        "metrics": metrics,
        "charts": charts,
        "logs": logs,
        "summary": "Analysis completed successfully."
    }

if __name__ == "__main__":
    import sys
    file_path = sys.argv[1] if len(sys.argv) > 1 else "data.xlsx"
    sheet_name = sys.argv[2] if len(sys.argv) > 2 else "Sheet1"
    result = analyze_spreadsheet(file_path, sheet_name)
    print(json.dumps(result, default=str, ensure_ascii=False))
\`\`\`

Generate ONLY the Python code. Do not include markdown fences or explanations.`;
}

function extractIntent(response: string, mode: AnalysisMode, userPrompt?: string): string {
  if (userPrompt) {
    return `Custom analysis: ${userPrompt.slice(0, 100)}${userPrompt.length > 100 ? "..." : ""}`;
  }

  const intents: Record<AnalysisMode, string> = {
    full: "Comprehensive spreadsheet analysis including statistics, data quality, and correlations",
    text_only: "Text and categorical data analysis with word frequency and pattern detection",
    numbers_only: "Numeric data analysis with statistics, distributions, and outlier detection",
  };

  return intents[mode];
}

function extractCodeFromResponse(response: string): string {
  const codeBlockMatch = response.match(/```python\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const altCodeBlockMatch = response.match(/```\s*([\s\S]*?)```/);
  if (altCodeBlockMatch) {
    return altCodeBlockMatch[1].trim();
  }

  if (response.includes("import pandas") || response.includes("import json")) {
    return response.trim();
  }

  return response.trim();
}

export async function generateAnalysisCode(
  params: GenerateAnalysisCodeParams
): Promise<GenerateAnalysisCodeResult> {
  const systemPrompt = buildSystemPrompt(params);

  const userMessage = params.userPrompt
    ? `Generate Python analysis code for the spreadsheet. User request: ${params.userPrompt}`
    : `Generate Python analysis code for the spreadsheet using ${params.mode} mode.`;

  const response = await llmGateway.chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    {
      temperature: 0.3,
      maxTokens: 4000,
    }
  );

  const code = extractCodeFromResponse(response.content);
  const intent = extractIntent(response.content, params.mode, params.userPrompt);

  return { code, intent };
}

export function validatePythonCode(code: string): ValidatePythonCodeResult {
  const errors: string[] = [];

  for (const { pattern, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(message);
    }
  }

  const importRegex = /(?:^|\n)\s*(?:import|from)\s+(\w+)/g;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const moduleName = match[1];
    const isAllowed = ALLOWED_MODULES.some(
      (allowed) => moduleName === allowed || moduleName.startsWith(allowed + ".")
    );
    if (!isAllowed && !["sys"].includes(moduleName)) {
      errors.push(`Import of '${moduleName}' module is not in the allowed list`);
    }
  }

  if (!code.includes("json.dumps")) {
    errors.push("Code should output JSON using json.dumps()");
  }

  if (!code.includes("pd.read_excel")) {
    errors.push("Code should read Excel file using pd.read_excel()");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function generateAndValidateAnalysisCode(
  params: GenerateAnalysisCodeParams
): Promise<GenerateAnalysisCodeResult & { validation: ValidatePythonCodeResult }> {
  const result = await generateAnalysisCode(params);
  const validation = validatePythonCode(result.code);

  if (!validation.valid) {
    console.warn(
      `[SpreadsheetLlmAgent] Generated code has validation issues: ${validation.errors.join(", ")}`
    );
  }

  return {
    ...result,
    validation,
  };
}

export const spreadsheetLlmAgent = {
  generateAnalysisCode,
  validatePythonCode,
  generateAndValidateAnalysisCode,
};

export default spreadsheetLlmAgent;
