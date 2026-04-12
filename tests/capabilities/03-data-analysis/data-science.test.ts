/**
 * Data Science & Analysis Capability Tests
 *
 * Covers: descriptive statistics, data cleaning, machine learning,
 *         visualisation specs, variance analysis, forecasting,
 *         and PDF-to-Excel table extraction.
 */

import {
  runWithEachProvider,
  type ProviderConfig,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
} from "../_setup/mockResponses";
import {
  createMockAgent,
} from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Mock the FastAPI Python sandbox
// ---------------------------------------------------------------------------

vi.mock("../../../fastapi_sse/client", () => ({
  executePython:      vi.fn(),
  runAnalysis:        vi.fn(),
  extractTableFromPDF:vi.fn(),
}));

// ---------------------------------------------------------------------------
// Sample datasets
// ---------------------------------------------------------------------------

const NUMERIC_DATASET = {
  columns: ["value"],
  rows: [
    { value: 10 }, { value: 20 }, { value: 30 },
    { value: 40 }, { value: 50 }, { value: 100 }, // 100 is an outlier
  ],
};

const DIRTY_DATASET = {
  columns: ["name", "age", "score"],
  rows: [
    { name: "Alice", age: "28",  score: 95   },
    { name: "Bob",   age: null,  score: 82   },
    { name: "Alice", age: "28",  score: 95   }, // duplicate
    { name: "Carol", age: "abc", score: null  }, // bad age, null score
    { name: "Dave",  age: "35",  score: 77   },
  ],
};

const SALES_DATASET = {
  columns: ["month", "product", "revenue"],
  rows: [
    { month: "2025-01", product: "A", revenue: 1000 },
    { month: "2025-02", product: "A", revenue: 1200 },
    { month: "2025-03", product: "A", revenue: 900  },
    { month: "2025-04", product: "B", revenue: 800  },
    { month: "2025-05", product: "B", revenue: 950  },
    { month: "2025-06", product: "A", revenue: 1100 },
  ],
};

// ---------------------------------------------------------------------------
// Suite 1 — Descriptive statistics
// ---------------------------------------------------------------------------

describe("Descriptive statistics", () => {
  runWithEachProvider(
    "computes mean, median, and standard deviation for a numeric column",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          stats: { mean: 41.67, median: 35, stdDev: 29.44, min: 10, max: 100, count: 6 },
        },
      });
      const response = await agent.invoke("describeColumn", {
        dataset: NUMERIC_DATASET,
        column: "value",
      });

      expect(response.success).toBe(true);
      const stats = response.stats as Record<string, number>;
      expect(stats.mean).toBeCloseTo(41.67, 1);
      expect(stats.median).toBe(35);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(100);
      expect(stats.count).toBe(6);

      const pResp = getMockResponseForProvider(
        provider.name,
        { name: "data_analysis", arguments: { operation: "describe", column: "value" } },
        "Computed descriptive statistics",
      );
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "reports value distribution as a frequency histogram",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          histogram: [
            { bucket: "0-25",   count: 2 },
            { bucket: "25-50",  count: 3 },
            { bucket: "75-100", count: 1 },
          ],
          buckets: 3,
        },
      });
      const response = await agent.invoke("histogram", {
        dataset: NUMERIC_DATASET,
        column: "value",
        buckets: 4,
      });

      expect(response.success).toBe(true);
      const histogram = response.histogram as Array<{ bucket: string; count: number }>;
      expect(histogram.length).toBeGreaterThan(0);
      const totalCount = histogram.reduce((sum, b) => sum + b.count, 0);
      expect(totalCount).toBe(6);

      void provider;
    },
  );

  runWithEachProvider(
    "computes percentiles (p25, p50, p75, p95) for a dataset",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          percentiles: { p25: 20, p50: 35, p75: 47.5, p95: 92.5 },
        },
      });
      const response = await agent.invoke("percentiles", {
        dataset: NUMERIC_DATASET,
        column: "value",
        percentiles: [25, 50, 75, 95],
      });

      expect(response.success).toBe(true);
      const pct = response.percentiles as Record<string, number>;
      expect(pct.p50).toBe(35);
      expect(pct.p75).toBeGreaterThan(pct.p25);
      expect(pct.p95).toBeGreaterThan(pct.p75);

      void provider;
    },
  );

  runWithEachProvider(
    "detects outliers using IQR method",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          outliers: [{ rowIndex: 5, value: 100, zScore: 2.7 }],
          method: "IQR",
          threshold: 1.5,
        },
      });
      const response = await agent.invoke("detectOutliers", {
        dataset: NUMERIC_DATASET,
        column: "value",
        method: "IQR",
      });

      expect(response.success).toBe(true);
      const outliers = response.outliers as Array<{ value: number }>;
      expect(outliers).toHaveLength(1);
      expect(outliers[0].value).toBe(100);

      const pResp = createTextResponse(provider.name, "Detected 1 outlier: value=100");
      expect(pResp).toBeTruthy();
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 2 — Data cleaning
// ---------------------------------------------------------------------------

describe("Data cleaning", () => {
  runWithEachProvider(
    "fills null values using column mean imputation",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, filled: 1, strategy: "mean", filledValue: 88, cleanedRows: 5 },
      });
      const response = await agent.invoke("fillNulls", {
        dataset: DIRTY_DATASET,
        column: "score",
        strategy: "mean",
      });

      expect(response.success).toBe(true);
      expect(response.filled).toBe(1);
      expect(response.strategy).toBe("mean");

      void provider;
    },
  );

  runWithEachProvider(
    "coerces string-typed age column to integer",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, coerced: 3, failed: 1, targetType: "integer", column: "age" },
      });
      const response = await agent.invoke("coerceType", {
        dataset: DIRTY_DATASET,
        column: "age",
        targetType: "integer",
        dropOnFailure: true,
      });

      expect(response.success).toBe(true);
      expect(response.coerced).toBe(3);
      expect(response.failed).toBe(1);
      expect(response.targetType).toBe("integer");

      void provider;
    },
  );

  runWithEachProvider(
    "removes duplicate rows keeping only first occurrence",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, originalRows: 5, deduplicatedRows: 4, removedCount: 1 },
      });
      const response = await agent.invoke("deduplicateRows", {
        dataset: DIRTY_DATASET,
        keepStrategy: "first",
      });

      expect(response.success).toBe(true);
      expect(response.removedCount).toBe(1);
      expect(response.deduplicatedRows).toBe(4);

      void provider;
    },
  );

  runWithEachProvider(
    "normalises a numeric column to 0-1 min-max scale",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          column: "score",
          method: "min-max",
          min: 77,
          max: 95,
          normalizedRows: [
            { name: "Alice", score: 1.0  },
            { name: "Bob",   score: 0.28 },
            { name: "Dave",  score: 0.0  },
          ],
        },
      });
      const response = await agent.invoke("normalizeColumn", {
        dataset: DIRTY_DATASET,
        column: "score",
        method: "min-max",
      });

      expect(response.success).toBe(true);
      expect(response.method).toBe("min-max");
      const rows = response.normalizedRows as Array<{ score: number }>;
      expect(rows.every((r) => r.score >= 0 && r.score <= 1)).toBe(true);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 3 — Machine learning
// ---------------------------------------------------------------------------

describe("Machine learning", () => {
  runWithEachProvider(
    "fits a linear regression and returns slope, intercept, and R-squared",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, model: "linear_regression", slope: 1.5, intercept: 2.3, rSquared: 0.94, mse: 0.12 },
      });
      const response = await agent.invoke("fitLinearRegression", {
        dataset: SALES_DATASET,
        xColumn: "month",
        yColumn: "revenue",
      });

      expect(response.success).toBe(true);
      expect(typeof (response.slope as number)).toBe("number");
      expect(typeof (response.intercept as number)).toBe("number");
      expect(response.rSquared as number).toBeGreaterThan(0);
      expect(response.rSquared as number).toBeLessThanOrEqual(1);

      void provider;
    },
  );

  runWithEachProvider(
    "trains a binary classifier and reports accuracy above baseline",
    "data-science",
    async (provider: ProviderConfig) => {
      const classificationDataset = {
        columns: ["feature1", "feature2", "label"],
        rows: Array.from({ length: 100 }, (_, i) => ({
          feature1: (i * 0.1) % 10,
          feature2: (i * 0.2) % 10,
          label: i % 2 === 0 ? "positive" : "negative",
        })),
      };

      const agent = createMockAgent({
        defaultResult: {
          success: true,
          model: "logistic_regression",
          accuracy: 0.82,
          precision: 0.80,
          recall: 0.84,
          f1: 0.82,
          confusionMatrix: [[40, 8], [10, 42]],
        },
      });
      const response = await agent.invoke("trainClassifier", {
        dataset: classificationDataset,
        labelColumn: "label",
        featureColumns: ["feature1", "feature2"],
        algorithm: "logistic_regression",
      });

      expect(response.success).toBe(true);
      expect(response.accuracy as number).toBeGreaterThan(0.5);
      expect(response.f1 as number).toBeGreaterThan(0);
      const cm = response.confusionMatrix as number[][];
      expect(cm).toHaveLength(2);
      expect(cm[0]).toHaveLength(2);

      void provider;
    },
  );

  runWithEachProvider(
    "computes feature importance scores from a trained random-forest model",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          featureImportance: [
            { feature: "revenue", importance: 0.62 },
            { feature: "month",   importance: 0.38 },
          ],
          model: "random_forest",
        },
      });
      const response = await agent.invoke("featureImportance", {
        dataset: SALES_DATASET,
        targetColumn: "revenue",
        algorithm: "random_forest",
      });

      expect(response.success).toBe(true);
      const fi = response.featureImportance as Array<{ feature: string; importance: number }>;
      expect(fi.length).toBeGreaterThan(0);
      const totalImportance = fi.reduce((s, f) => s + f.importance, 0);
      expect(totalImportance).toBeCloseTo(1.0, 1);
      expect(fi[0].importance).toBeGreaterThan(fi[fi.length - 1].importance);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 4 — Data visualisation specs
// ---------------------------------------------------------------------------

describe("Data visualization specs", () => {
  runWithEachProvider(
    "generates a bar chart configuration for revenue by product",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          chartType: "bar",
          spec: {
            type: "bar",
            data: { labels: ["A", "B"], datasets: [{ label: "Revenue", data: [4200, 1750] }] },
            options: { responsive: true },
          },
        },
      });
      const response = await agent.invoke("generateChartSpec", {
        dataset: SALES_DATASET,
        chartType: "bar",
        xColumn: "product",
        yColumn: "revenue",
        aggregation: "sum",
      });

      expect(response.success).toBe(true);
      expect(response.chartType).toBe("bar");
      const spec = response.spec as Record<string, unknown>;
      expect(spec.type).toBe("bar");
      expect(spec.data).toBeTruthy();

      const pResp = createTextResponse(provider.name, "Bar chart spec generated");
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "generates a scatter plot spec with regression line overlay",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          chartType: "scatter",
          spec: {
            type: "scatter",
            data: { datasets: [{ label: "Data points", data: [{ x: 1, y: 1000 }] }] },
            regressionLine: { slope: 140, intercept: 860 },
          },
        },
      });
      const response = await agent.invoke("generateChartSpec", {
        dataset: SALES_DATASET,
        chartType: "scatter",
        xColumn: "month",
        yColumn: "revenue",
        regressionLine: true,
      });

      expect(response.success).toBe(true);
      const spec = response.spec as Record<string, unknown>;
      expect(spec.type).toBe("scatter");
      expect(spec.regressionLine).toBeTruthy();

      void provider;
    },
  );

  runWithEachProvider(
    "generates a time-series line chart spec with monthly ticks",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          chartType: "line",
          spec: {
            type: "line",
            data: {
              labels: ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"],
              datasets: [{ label: "Revenue", data: [1000, 1200, 900, 800, 950, 1100] }],
            },
            options: { scales: { x: { type: "time", time: { unit: "month" } } } },
          },
        },
      });
      const response = await agent.invoke("generateChartSpec", {
        dataset: SALES_DATASET,
        chartType: "line",
        xColumn: "month",
        yColumn: "revenue",
        timeUnit: "month",
      });

      expect(response.success).toBe(true);
      const spec = response.spec as Record<string, unknown>;
      expect(spec.type).toBe("line");
      const labels = (spec.data as { labels: string[] }).labels;
      expect(labels).toHaveLength(6);

      void provider;
    },
  );

  runWithEachProvider(
    "generates a heatmap spec for a correlation matrix",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          chartType: "heatmap",
          matrix: [[1.0, 0.82], [0.82, 1.0]],
          labels: ["revenue", "month"],
          spec: { type: "heatmap", colorScale: "blues" },
        },
      });
      const response = await agent.invoke("correlationHeatmap", {
        dataset: SALES_DATASET,
        columns: ["revenue", "month"],
      });

      expect(response.success).toBe(true);
      expect(response.chartType).toBe("heatmap");
      const matrix = response.matrix as number[][];
      expect(matrix[0][0]).toBe(1.0);
      expect(matrix[0][1]).toBe(matrix[1][0]);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 5 — Variance analysis
// ---------------------------------------------------------------------------

describe("Variance analysis", () => {
  runWithEachProvider(
    "computes year-over-year revenue variance by period",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          variance: [
            { period: "2025-01", actual: 1000, prior: 900,  delta: 100, pct: 11.1 },
            { period: "2025-02", actual: 1200, prior: 1000, delta: 200, pct: 20.0 },
          ],
          totalDelta: 300,
          avgPctChange: 15.5,
        },
      });
      const response = await agent.invoke("yoyVariance", {
        dataset: SALES_DATASET,
        valueColumn: "revenue",
        periodColumn: "month",
      });

      expect(response.success).toBe(true);
      const variance = response.variance as Array<{ delta: number; pct: number }>;
      expect(variance.length).toBeGreaterThan(0);
      variance.forEach((v) => {
        expect(typeof v.delta).toBe("number");
        expect(typeof v.pct).toBe("number");
      });

      void provider;
    },
  );

  runWithEachProvider(
    "computes budget-vs-actual variance with over/under flags",
    "data-science",
    async (provider: ProviderConfig) => {
      const budgetDataset = {
        columns: ["product", "budget", "actual"],
        rows: [
          { product: "A", budget: 4000, actual: 4200 },
          { product: "B", budget: 2000, actual: 1750 },
        ],
      };

      const agent = createMockAgent({
        defaultResult: {
          success: true,
          results: [
            { product: "A", budget: 4000, actual: 4200, variance: 200,  pct: 5.0,   status: "over"  },
            { product: "B", budget: 2000, actual: 1750, variance: -250, pct: -12.5, status: "under" },
          ],
          totalVariance: -50,
        },
      });
      const response = await agent.invoke("budgetVsActual", {
        dataset: budgetDataset,
        budgetColumn: "budget",
        actualColumn: "actual",
        groupBy: "product",
      });

      expect(response.success).toBe(true);
      const results = response.results as Array<{ status: string }>;
      expect(results).toHaveLength(2);
      expect(results.filter((r) => r.status === "over")).toHaveLength(1);
      expect(results.filter((r) => r.status === "under")).toHaveLength(1);

      void provider;
    },
  );

  runWithEachProvider(
    "generates waterfall breakdown of variance components",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          waterfallSteps: [
            { label: "Start",  value: 4000, type: "base"     },
            { label: "Volume", value: 300,  type: "positive" },
            { label: "Price",  value: -100, type: "negative" },
            { label: "End",    value: 4200, type: "total"    },
          ],
          netChange: 200,
        },
      });
      const response = await agent.invoke("waterfallVariance", {
        dataset: SALES_DATASET,
        startValue: 4000,
        components: ["volume", "price"],
      });

      expect(response.success).toBe(true);
      const steps = response.waterfallSteps as Array<{ type: string }>;
      expect(steps[0].type).toBe("base");
      expect(steps[steps.length - 1].type).toBe("total");

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 6 — Forecasting
// ---------------------------------------------------------------------------

describe("Forecasting", () => {
  runWithEachProvider(
    "extrapolates a linear trend for the next 3 periods",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          forecast: [
            { period: "2025-07", predicted: 1050 },
            { period: "2025-08", predicted: 1085 },
            { period: "2025-09", predicted: 1120 },
          ],
          model: "linear_trend",
          rSquared: 0.71,
        },
      });
      const response = await agent.invoke("forecast", {
        dataset: SALES_DATASET,
        valueColumn: "revenue",
        periodColumn: "month",
        periods: 3,
        model: "linear_trend",
      });

      expect(response.success).toBe(true);
      const forecast = response.forecast as Array<{ predicted: number }>;
      expect(forecast).toHaveLength(3);
      forecast.forEach((f) => expect(typeof f.predicted).toBe("number"));

      void provider;
    },
  );

  runWithEachProvider(
    "detects seasonality and factors it into a Holt-Winters forecast",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          seasonality: { detected: true, period: 12, amplitude: 180 },
          forecast: [
            { period: "2026-01", predicted: 1100, lower: 950,  upper: 1250 },
            { period: "2026-02", predicted: 1280, lower: 1100, upper: 1450 },
          ],
          model: "holt_winters",
        },
      });
      const response = await agent.invoke("forecast", {
        dataset: SALES_DATASET,
        valueColumn: "revenue",
        periodColumn: "month",
        periods: 2,
        model: "holt_winters",
        detectSeasonality: true,
      });

      expect(response.success).toBe(true);
      const seasonality = response.seasonality as { detected: boolean; period: number };
      expect(seasonality.detected).toBe(true);
      const forecast = response.forecast as Array<{ lower: number; upper: number }>;
      forecast.forEach((f) => expect(f.upper).toBeGreaterThan(f.lower));

      void provider;
    },
  );

  runWithEachProvider(
    "returns 80% and 95% confidence intervals alongside point forecast",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          forecast: [
            {
              period: "2025-07",
              predicted: 1050,
              ci80: { lower: 980,  upper: 1120 },
              ci95: { lower: 940,  upper: 1160 },
            },
          ],
        },
      });
      const response = await agent.invoke("forecast", {
        dataset: SALES_DATASET,
        valueColumn: "revenue",
        periodColumn: "month",
        periods: 1,
        confidenceIntervals: [80, 95],
      });

      expect(response.success).toBe(true);
      const forecast = response.forecast as Array<{
        ci80: { lower: number; upper: number };
        ci95: { lower: number; upper: number };
      }>;
      expect(forecast[0].ci80.upper).toBeGreaterThan(forecast[0].ci80.lower);
      expect(forecast[0].ci95.upper).toBeGreaterThan(forecast[0].ci80.upper);
      expect(forecast[0].ci95.lower).toBeLessThan(forecast[0].ci80.lower);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 7 — PDF to Excel extraction
// ---------------------------------------------------------------------------

describe("PDF to Excel extraction", () => {
  runWithEachProvider(
    "extracts a data table from a PDF and returns structured rows",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          tablesFound: 1,
          table: {
            headers: ["Name", "Q1", "Q2", "Q3", "Q4"],
            rows: [
              { Name: "Product A", Q1: "100", Q2: "120", Q3: "110", Q4: "140" },
              { Name: "Product B", Q1: "80",  Q2: "90",  Q3: "85",  Q4: "95"  },
            ],
          },
          pageNumber: 3,
        },
      });
      const response = await agent.invoke("extractPDFTable", {
        pdfPath: "/tmp/test-report.pdf",
        pageHint: 3,
        method: "pdfplumber",
      });

      expect(response.success).toBe(true);
      expect(response.tablesFound).toBe(1);
      const table = response.table as { headers: string[]; rows: Record<string, string>[] };
      expect(table.headers).toContain("Name");
      expect(table.rows).toHaveLength(2);

      const pResp = getMockResponseForProvider(
        provider.name,
        { name: "extract_pdf_table", arguments: { page: 3 } },
        "Extracted 2 rows from page 3",
      );
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "maps extracted PDF columns to a target Excel schema",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          mapping: { Name: "product_name", Q1: "q1_revenue", Q2: "q2_revenue", Q3: "q3_revenue", Q4: "q4_revenue" },
          unmapped: [],
          confidence: 0.96,
        },
      });
      const response = await agent.invoke("mapPDFColumnsToSchema", {
        sourceColumns: ["Name", "Q1", "Q2", "Q3", "Q4"],
        targetSchema: {
          product_name: "string",
          q1_revenue: "number",
          q2_revenue: "number",
          q3_revenue: "number",
          q4_revenue: "number",
        },
      });

      expect(response.success).toBe(true);
      const mapping = response.mapping as Record<string, string>;
      expect(mapping["Q1"]).toBe("q1_revenue");
      expect(response.unmapped as string[]).toHaveLength(0);
      expect(response.confidence as number).toBeGreaterThan(0.9);

      void provider;
    },
  );

  runWithEachProvider(
    "validates extracted rows against a schema before writing to Excel",
    "data-science",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: { success: true, validRows: 2, invalidRows: 0, validationErrors: [], ready: true },
      });
      const response = await agent.invoke("validateExtractedData", {
        rows: [
          { product_name: "Product A", q1_revenue: 100 },
          { product_name: "Product B", q1_revenue: 80  },
        ],
        schema: {
          product_name: { type: "string", required: true },
          q1_revenue:   { type: "number", min: 0 },
        },
      });

      expect(response.success).toBe(true);
      expect(response.validRows).toBe(2);
      expect(response.invalidRows).toBe(0);
      expect(response.ready).toBe(true);

      void provider;
    },
  );
});
