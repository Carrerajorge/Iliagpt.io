import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "DataAnalysisAgent" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type DataFormat = "csv" | "json" | "excel" | "sql" | "text";

export type AnalysisType =
  | "descriptive"
  | "correlation"
  | "trend"
  | "anomaly"
  | "distribution"
  | "comparison"
  | "custom";

export type ChartType =
  | "bar" | "line" | "scatter" | "pie" | "heatmap"
  | "histogram" | "box" | "area" | "waterfall";

export interface DataColumn {
  name: string;
  type: "numeric" | "categorical" | "datetime" | "boolean" | "text";
  nullCount: number;
  uniqueCount: number;
  sample: unknown[];
}

export interface DataProfile {
  rowCount: number;
  columnCount: number;
  columns: DataColumn[];
  missingValueRate: number;
  duplicateRowCount: number;
  memorySizeKB: number;
  detectedEncoding?: string;
  detectedDelimiter?: string;
}

export interface StatisticalSummary {
  column: string;
  type: "numeric" | "categorical";
  count: number;
  // Numeric
  mean?: number;
  median?: number;
  std?: number;
  min?: number;
  max?: number;
  q1?: number;
  q3?: number;
  skewness?: number;
  // Categorical
  topValues?: Array<{ value: string; count: number; pct: number }>;
  uniqueRate?: number;
}

export interface CorrelationResult {
  columnA: string;
  columnB: string;
  coefficient: number; // -1 to 1
  method: "pearson" | "spearman";
  significant: boolean;
  interpretation: string;
}

export interface Anomaly {
  rowIndex?: number;
  column: string;
  value: unknown;
  expectedRange: string;
  zscore?: number;
  reason: string;
}

export interface ChartSpec {
  chartId: string;
  type: ChartType;
  title: string;
  description: string;
  library: "recharts" | "plotly" | "d3";
  data: unknown[];
  config: Record<string, unknown>;
  insights: string[];
}

export interface AnalysisResult {
  analysisId: string;
  query?: string; // natural language query if given
  type: AnalysisType;
  summary: string;
  keyFindings: string[];
  statistics: StatisticalSummary[];
  correlations: CorrelationResult[];
  anomalies: Anomaly[];
  charts: ChartSpec[];
  recommendations: string[];
  confidenceLevel: number; // 0-1
  limitations: string[];
  pythonCode?: string; // generated pandas/numpy code
  executionResult?: string; // output from code execution
  tokensUsed: number;
  durationMs: number;
}

// ─── Data parser ──────────────────────────────────────────────────────────────

function parseCSV(csvText: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };

  // Detect delimiter (comma, semicolon, tab)
  const firstLine = lines[0];
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const semiCount = (firstLine.match(/;/g) ?? []).length;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const delim = tabCount > commaCount && tabCount > semiCount ? "\t" : semiCount > commaCount ? ";" : ",";

  const headers = firstLine.split(delim).map((h) => h.trim().replace(/^"|"$/g, ""));

  const rows = lines.slice(1).map((line) => {
    const values = line.split(delim).map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const raw = values[i] ?? "";
      const num = Number(raw);
      row[headers[i]] = raw === "" ? null : !isNaN(num) && raw !== "" ? num : raw;
    }
    return row;
  });

  return { headers, rows };
}

function profileData(
  headers: string[],
  rows: Record<string, unknown>[]
): DataProfile {
  const columns: DataColumn[] = headers.map((name) => {
    const values = rows.map((r) => r[name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
    const unique = new Set(nonNull).size;

    const numericCount = nonNull.filter((v) => typeof v === "number").length;
    let type: DataColumn["type"] = "text";
    if (numericCount / Math.max(nonNull.length, 1) > 0.8) type = "numeric";
    else if (unique / Math.max(nonNull.length, 1) < 0.2) type = "categorical";
    else if (nonNull.some((v) => /\d{4}-\d{2}-\d{2}/.test(String(v)))) type = "datetime";

    return {
      name,
      type,
      nullCount: values.length - nonNull.length,
      uniqueCount: unique,
      sample: nonNull.slice(0, 5),
    };
  });

  const duplicates = rows.length - new Set(rows.map((r) => JSON.stringify(r))).size;

  return {
    rowCount: rows.length,
    columnCount: headers.length,
    columns,
    missingValueRate:
      columns.reduce((s, c) => s + c.nullCount, 0) /
      Math.max(rows.length * headers.length, 1),
    duplicateRowCount: duplicates,
    memorySizeKB: Math.round(JSON.stringify(rows).length / 1024),
  };
}

function computeStats(
  col: DataColumn,
  rows: Record<string, unknown>[]
): StatisticalSummary {
  const values = rows
    .map((r) => r[col.name])
    .filter((v) => v !== null && v !== undefined && v !== "");

  if (col.type === "numeric") {
    const nums = values.map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
    if (nums.length === 0) return { column: col.name, type: "numeric", count: 0 };

    const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
    const variance = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
    const q1 = nums[Math.floor(nums.length * 0.25)];
    const q3 = nums[Math.floor(nums.length * 0.75)];
    const median = nums[Math.floor(nums.length / 2)];
    const skewness =
      nums.length >= 3
        ? (3 * (mean - median)) / (Math.sqrt(variance) || 1)
        : 0;

    return {
      column: col.name,
      type: "numeric",
      count: nums.length,
      mean: +mean.toFixed(4),
      median: +median.toFixed(4),
      std: +Math.sqrt(variance).toFixed(4),
      min: nums[0],
      max: nums[nums.length - 1],
      q1, q3,
      skewness: +skewness.toFixed(3),
    };
  }

  // Categorical
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const topValues = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count, pct: +(count / values.length).toFixed(3) }));

  return {
    column: col.name,
    type: "categorical",
    count: values.length,
    topValues,
    uniqueRate: +(col.uniqueCount / Math.max(values.length, 1)).toFixed(3),
  };
}

// ─── DataAnalysisAgent ────────────────────────────────────────────────────────

export class DataAnalysisAgent extends EventEmitter {
  private analysisHistory: AnalysisResult[] = [];
  private dataCache = new Map<string, { headers: string[]; rows: Record<string, unknown>[] }>();

  constructor(
    private readonly backbone = getClaudeAgentBackbone(),
    private readonly pythonExecutor?: (code: string) => Promise<{ output: string; error?: string }>
  ) {
    super();
    logger.info("[DataAnalysisAgent] Initialized");
  }

  // ── Main analysis entry point ─────────────────────────────────────────────────

  async analyze(
    data: string | Record<string, unknown>[],
    format: DataFormat = "csv",
    opts: {
      query?: string;
      analysisType?: AnalysisType;
      columns?: string[];
      generateCharts?: boolean;
      executePython?: boolean;
    } = {}
  ): Promise<AnalysisResult> {
    const analysisId = randomUUID();
    const startedAt = Date.now();

    logger.info({ analysisId, format, query: opts.query?.slice(0, 60) }, "[DataAnalysisAgent] Analysis started");
    this.emit("analysis:started", { analysisId });

    // Parse data
    let headers: string[] = [];
    let rows: Record<string, unknown>[] = [];

    if (Array.isArray(data)) {
      rows = data;
      headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    } else if (format === "csv") {
      const parsed = parseCSV(data);
      headers = parsed.headers;
      rows = parsed.rows;
    } else if (format === "json") {
      try {
        const parsed = JSON.parse(data as string);
        rows = Array.isArray(parsed) ? parsed : [parsed];
        headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      } catch {
        throw new Error("Invalid JSON data");
      }
    }

    const cacheKey = randomUUID();
    this.dataCache.set(cacheKey, { headers, rows });

    // Profile the data
    const profile = profileData(headers, rows);

    // Compute statistics for all numeric/categorical columns
    const selectedCols = opts.columns
      ? profile.columns.filter((c) => opts.columns!.includes(c.name))
      : profile.columns;

    const statistics = selectedCols.map((col) => computeStats(col, rows));

    // Detect anomalies in numeric columns
    const anomalies = this.detectAnomalies(statistics, rows);

    // Compute correlations between numeric columns
    const numericCols = selectedCols.filter((c) => c.type === "numeric");
    const correlations = this.computeCorrelations(numericCols, rows);

    // AI-powered analysis
    const aiAnalysis = await this.runAIAnalysis(
      profile,
      statistics,
      correlations,
      anomalies,
      opts.query,
      opts.analysisType ?? "descriptive"
    );

    // Generate chart specs
    let charts: ChartSpec[] = [];
    if (opts.generateCharts !== false) {
      charts = await this.generateCharts(profile, statistics, correlations, opts.query);
    }

    // Generate Python code if requested
    let pythonCode: string | undefined;
    let executionResult: string | undefined;

    if (opts.executePython !== false) {
      pythonCode = this.generatePythonCode(profile, statistics, opts.query);

      if (this.pythonExecutor && pythonCode) {
        try {
          const result = await this.pythonExecutor(pythonCode);
          executionResult = result.output;
        } catch {
          // Python not available
        }
      }
    }

    const result: AnalysisResult = {
      analysisId,
      query: opts.query,
      type: opts.analysisType ?? "descriptive",
      summary: aiAnalysis.summary,
      keyFindings: aiAnalysis.keyFindings,
      statistics,
      correlations,
      anomalies,
      charts,
      recommendations: aiAnalysis.recommendations,
      confidenceLevel: aiAnalysis.confidence,
      limitations: this.buildLimitations(profile, statistics),
      pythonCode,
      executionResult,
      tokensUsed: aiAnalysis.tokensUsed,
      durationMs: Date.now() - startedAt,
    };

    this.analysisHistory.push(result);
    this.emit("analysis:completed", result);

    logger.info(
      {
        analysisId,
        rows: rows.length,
        cols: headers.length,
        findings: result.keyFindings.length,
        durationMs: result.durationMs,
      },
      "[DataAnalysisAgent] Analysis complete"
    );

    return result;
  }

  // ── Natural language query ────────────────────────────────────────────────────

  async query(
    nlQuery: string,
    dataKey?: string
  ): Promise<{ answer: string; chart?: ChartSpec; sql?: string }> {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Answer this data question in plain language.

QUESTION: ${nlQuery}

If applicable, suggest a chart type and SQL query to answer this.

Output JSON: {
  "answer": "plain language answer",
  "chartType": "bar|line|scatter|pie|null",
  "chartTitle": "...",
  "sql": "SELECT ... (if applicable)"
}
Return ONLY valid JSON.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 1024,
      system: "You answer data analysis questions clearly. Suggest visualizations when helpful.",
    });

    let answer = "Unable to answer the query";
    let chart: ChartSpec | undefined;
    let sql: string | undefined;

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          answer?: string;
          chartType?: ChartType | null;
          chartTitle?: string;
          sql?: string;
        };

        answer = parsed.answer ?? answer;
        sql = parsed.sql;

        if (parsed.chartType) {
          chart = {
            chartId: randomUUID(),
            type: parsed.chartType,
            title: parsed.chartTitle ?? nlQuery,
            description: answer,
            library: "recharts",
            data: [],
            config: { responsive: true },
            insights: [answer],
          };
        }
      }
    } catch {
      answer = response.text;
    }

    return { answer, chart, sql };
  }

  // ── Anomaly detection ─────────────────────────────────────────────────────────

  private detectAnomalies(stats: StatisticalSummary[], rows: Record<string, unknown>[]): Anomaly[] {
    const anomalies: Anomaly[] = [];

    for (const stat of stats) {
      if (stat.type !== "numeric" || !stat.mean || !stat.std) continue;

      const zThreshold = 3;
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i][stat.column];
        if (raw === null || raw === undefined) continue;

        const val = Number(raw);
        if (isNaN(val)) continue;

        const zscore = Math.abs((val - stat.mean) / (stat.std || 1));
        if (zscore > zThreshold) {
          anomalies.push({
            rowIndex: i,
            column: stat.column,
            value: val,
            expectedRange: `${(stat.mean - 2 * stat.std).toFixed(2)} – ${(stat.mean + 2 * stat.std).toFixed(2)}`,
            zscore: +zscore.toFixed(2),
            reason: `Z-score of ${zscore.toFixed(2)} exceeds threshold of ${zThreshold}`,
          });
        }
      }
    }

    return anomalies.slice(0, 50); // Cap at 50
  }

  // ── Correlation computation ───────────────────────────────────────────────────

  private computeCorrelations(
    numericCols: DataColumn[],
    rows: Record<string, unknown>[]
  ): CorrelationResult[] {
    const results: CorrelationResult[] = [];

    for (let i = 0; i < numericCols.length; i++) {
      for (let j = i + 1; j < numericCols.length; j++) {
        const colA = numericCols[i].name;
        const colB = numericCols[j].name;

        const pairs = rows
          .map((r) => [Number(r[colA]), Number(r[colB])])
          .filter(([a, b]) => !isNaN(a) && !isNaN(b));

        if (pairs.length < 3) continue;

        const n = pairs.length;
        const meanA = pairs.reduce((s, [a]) => s + a, 0) / n;
        const meanB = pairs.reduce((s, [, b]) => s + b, 0) / n;

        let cov = 0, varA = 0, varB = 0;
        for (const [a, b] of pairs) {
          cov += (a - meanA) * (b - meanB);
          varA += (a - meanA) ** 2;
          varB += (b - meanB) ** 2;
        }

        const r = cov / (Math.sqrt(varA * varB) || 1);
        const coefficient = +r.toFixed(3);
        const abs = Math.abs(coefficient);

        results.push({
          columnA: colA,
          columnB: colB,
          coefficient,
          method: "pearson",
          significant: abs > 0.5,
          interpretation:
            abs > 0.8
              ? `Strong ${coefficient > 0 ? "positive" : "negative"} correlation`
              : abs > 0.5
              ? `Moderate ${coefficient > 0 ? "positive" : "negative"} correlation`
              : "Weak or no correlation",
        });
      }
    }

    return results.sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));
  }

  // ── AI analysis ───────────────────────────────────────────────────────────────

  private async runAIAnalysis(
    profile: DataProfile,
    statistics: StatisticalSummary[],
    correlations: CorrelationResult[],
    anomalies: Anomaly[],
    query?: string,
    type: AnalysisType = "descriptive"
  ): Promise<{ summary: string; keyFindings: string[]; recommendations: string[]; confidence: number; tokensUsed: number }> {
    const statsText = statistics
      .slice(0, 8)
      .map((s) =>
        s.type === "numeric"
          ? `${s.column}: mean=${s.mean}, std=${s.std}, range=[${s.min},${s.max}]`
          : `${s.column}: top value="${s.topValues?.[0]?.value}" (${(s.topValues?.[0]?.pct ?? 0) * 100}%)`
      )
      .join("\n");

    const corrText = correlations
      .slice(0, 5)
      .map((c) => `${c.columnA} ↔ ${c.columnB}: r=${c.coefficient} (${c.interpretation})`)
      .join("\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Analyze this dataset and provide insights.

DATASET: ${profile.rowCount} rows × ${profile.columnCount} columns
MISSING VALUES: ${(profile.missingValueRate * 100).toFixed(1)}%
ANOMALIES: ${anomalies.length}

STATISTICS:
${statsText}

CORRELATIONS:
${corrText || "(none significant)"}

${query ? `USER QUESTION: ${query}` : `ANALYSIS TYPE: ${type}`}

Output JSON:
{
  "summary": "2-3 sentence executive summary",
  "keyFindings": ["finding 1", "finding 2", "finding 3"],
  "recommendations": ["actionable recommendation 1", "recommendation 2"],
  "confidence": 0.0-1.0
}
Return ONLY valid JSON.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 1024,
      system: "You are a data scientist providing clear, actionable insights from data analysis.",
    });

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          summary?: string;
          keyFindings?: string[];
          recommendations?: string[];
          confidence?: number;
        };

        return {
          summary: parsed.summary ?? "Analysis complete.",
          keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
          confidence: parsed.confidence ?? 0.7,
          tokensUsed: response.usage.inputTokens + response.usage.outputTokens,
        };
      }
    } catch {
      // Fall through
    }

    return {
      summary: response.text.slice(0, 200),
      keyFindings: [],
      recommendations: [],
      confidence: 0.5,
      tokensUsed: response.usage.inputTokens + response.usage.outputTokens,
    };
  }

  // ── Chart generation ──────────────────────────────────────────────────────────

  private async generateCharts(
    profile: DataProfile,
    statistics: StatisticalSummary[],
    correlations: CorrelationResult[],
    query?: string
  ): Promise<ChartSpec[]> {
    const charts: ChartSpec[] = [];

    // Auto-suggest chart types based on data characteristics
    const numericCols = profile.columns.filter((c) => c.type === "numeric");
    const categoricalCols = profile.columns.filter((c) => c.type === "categorical");

    if (numericCols.length >= 2 && correlations.length > 0) {
      const topCorr = correlations[0];
      charts.push({
        chartId: randomUUID(),
        type: "scatter",
        title: `${topCorr.columnA} vs ${topCorr.columnB}`,
        description: topCorr.interpretation,
        library: "recharts",
        data: [],
        config: {
          xDataKey: topCorr.columnA,
          yDataKey: topCorr.columnB,
          margin: { top: 5, right: 30, left: 20, bottom: 5 },
        },
        insights: [topCorr.interpretation],
      });
    }

    if (categoricalCols.length > 0 && numericCols.length > 0) {
      const cat = categoricalCols[0].name;
      const num = numericCols[0].name;
      charts.push({
        chartId: randomUUID(),
        type: "bar",
        title: `${num} by ${cat}`,
        description: `Distribution of ${num} across ${cat} categories`,
        library: "recharts",
        data: [],
        config: {
          xDataKey: cat,
          yDataKey: num,
          margin: { top: 5, right: 30, left: 20, bottom: 5 },
        },
        insights: [`Shows how ${num} varies by ${cat}`],
      });
    }

    return charts;
  }

  // ── Python code generation ────────────────────────────────────────────────────

  private generatePythonCode(
    profile: DataProfile,
    statistics: StatisticalSummary[],
    query?: string
  ): string {
    const numericCols = profile.columns
      .filter((c) => c.type === "numeric")
      .map((c) => `'${c.name}'`)
      .join(", ");

    return `import pandas as pd
import numpy as np

# Load data (replace with actual data source)
# df = pd.read_csv('data.csv')

# Basic info
print(f"Shape: {df.shape}")
print(f"Missing values:\\n{df.isnull().sum()}")
print(f"\\nDescriptive stats:")
print(df[[${numericCols}]].describe())

# Correlation matrix
if df.select_dtypes(include=[np.number]).shape[1] > 1:
    corr = df.select_dtypes(include=[np.number]).corr()
    print("\\nTop correlations:")
    print(corr.unstack().sort_values(ascending=False).drop_duplicates().head(10))

# Outlier detection (Z-score)
from scipy import stats
for col in [${numericCols}]:
    z = np.abs(stats.zscore(df[col].dropna()))
    outliers = (z > 3).sum()
    print(f"\\nOutliers in {col}: {outliers}")

${query ? `# Custom analysis for: ${query}\n# Add your specific analysis here` : ""}
`;
  }

  // ── Limitations ───────────────────────────────────────────────────────────────

  private buildLimitations(
    profile: DataProfile,
    statistics: StatisticalSummary[]
  ): string[] {
    const lims: string[] = [];

    if (profile.missingValueRate > 0.1) {
      lims.push(`High missing value rate (${(profile.missingValueRate * 100).toFixed(1)}%) may affect analysis accuracy`);
    }
    if (profile.rowCount < 30) {
      lims.push("Small sample size — statistical conclusions should be treated with caution");
    }
    if (profile.duplicateRowCount > 0) {
      lims.push(`${profile.duplicateRowCount} duplicate rows detected — may skew distributions`);
    }
    const skewed = statistics.filter(
      (s) => s.skewness !== undefined && Math.abs(s.skewness) > 2
    );
    if (skewed.length > 0) {
      lims.push(`Highly skewed distributions in: ${skewed.map((s) => s.column).join(", ")}`);
    }

    return lims;
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getAnalysisHistory(limit = 10): AnalysisResult[] {
    return this.analysisHistory.slice(-limit).reverse();
  }

  getStats() {
    return {
      totalAnalyses: this.analysisHistory.length,
      avgDurationMs:
        this.analysisHistory.length > 0
          ? this.analysisHistory.reduce((s, a) => s + a.durationMs, 0) / this.analysisHistory.length
          : 0,
      totalAnomaliesDetected: this.analysisHistory.reduce((s, a) => s + a.anomalies.length, 0),
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: DataAnalysisAgent | null = null;

export function getDataAnalysisAgent(
  pythonExecutor?: DataAnalysisAgent["pythonExecutor"]
): DataAnalysisAgent {
  if (!_instance) _instance = new DataAnalysisAgent(undefined, pythonExecutor);
  return _instance;
}
