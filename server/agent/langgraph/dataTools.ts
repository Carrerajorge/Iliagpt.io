import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import * as fs from "fs/promises";
import * as path from "path";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const dataAnalyzeTool = tool(
  async (input) => {
    const { data, analysisType = "descriptive", targetColumn, groupBy } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a statistical analysis expert. Perform comprehensive data analysis.

Analysis types:
- descriptive: Mean, median, mode, std, quartiles, distribution
- correlation: Correlation matrix, relationships between variables
- regression: Linear/polynomial regression analysis
- hypothesis: Statistical tests (t-test, chi-square, ANOVA)
- outlier: Detect anomalies and outliers
- trend: Time series analysis and trend detection

Return JSON:
{
  "summary": {
    "rowCount": number,
    "columnCount": number,
    "dataTypes": { "column": "type" },
    "missingValues": { "column": number }
  },
  "descriptiveStats": {
    "column": {
      "mean": number,
      "median": number,
      "std": number,
      "min": number,
      "max": number,
      "q1": number,
      "q3": number,
      "skewness": number
    }
  },
  "correlations": [
    { "var1": "col1", "var2": "col2", "correlation": 0.85, "significance": 0.001 }
  ],
  "outliers": [
    { "column": "col", "indices": [], "method": "IQR|zscore" }
  ],
  "insights": [
    { "finding": "description", "importance": "high|medium|low", "actionable": boolean }
  ],
  "recommendations": ["suggested next steps"],
  "visualizations": ["suggested chart types"]
}`,
          },
          {
            role: "user",
            content: `Analyze this data:
${typeof data === "string" ? data : JSON.stringify(data, null, 2)}

Analysis type: ${analysisType}
${targetColumn ? `Target column: ${targetColumn}` : ""}
${groupBy ? `Group by: ${groupBy}` : ""}`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          analysisType,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        analysis: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "data_analyze",
    description: "Performs statistical analysis: descriptive stats, correlations, hypothesis tests, outlier detection, and trend analysis.",
    schema: z.object({
      data: z.union([z.string(), z.array(z.any()), z.record(z.any())]).describe("Data to analyze (JSON, CSV string, or array)"),
      analysisType: z.enum(["descriptive", "correlation", "regression", "hypothesis", "outlier", "trend"]).optional().default("descriptive")
        .describe("Type of analysis"),
      targetColumn: z.string().optional().describe("Target variable for regression/prediction"),
      groupBy: z.string().optional().describe("Column to group by for aggregations"),
    }),
  }
);

export const dataVisualizeTool = tool(
  async (input) => {
    const { data, chartType = "auto", title, xAxis, yAxis, options = {} } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a data visualization expert. Create specifications for data visualizations.

Chart types:
- auto: Automatically select best chart type
- line: Time series, trends
- bar: Comparisons, categories
- scatter: Correlations, distributions
- pie: Proportions (< 7 categories)
- histogram: Distributions
- heatmap: Correlation matrices, 2D data
- box: Distribution comparisons
- area: Cumulative data, stacked values

Return JSON:
{
  "chartType": "recommended chart type",
  "reason": "why this chart type",
  "spec": {
    "type": "chart type",
    "data": {
      "labels": [],
      "datasets": [
        {
          "label": "series name",
          "data": [],
          "color": "#hex"
        }
      ]
    },
    "options": {
      "title": "chart title",
      "xAxis": { "label": "", "type": "linear|category|time" },
      "yAxis": { "label": "", "type": "linear|log" },
      "legend": { "position": "top|bottom|left|right" },
      "annotations": []
    }
  },
  "alternativeCharts": ["other suitable chart types"],
  "insights": ["what the visualization reveals"],
  "code": {
    "matplotlib": "Python code for matplotlib",
    "plotly": "Python code for plotly",
    "echarts": "JavaScript config for ECharts"
  }
}`,
          },
          {
            role: "user",
            content: `Create visualization for:
Data: ${typeof data === "string" ? data : JSON.stringify(data, null, 2)}

Chart type: ${chartType}
Title: ${title || "Auto-generate"}
X-Axis: ${xAxis || "Auto-detect"}
Y-Axis: ${yAxis || "Auto-detect"}
Options: ${JSON.stringify(options)}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          requestedType: chartType,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        chartSpec: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "data_visualize",
    description: "Creates data visualization specifications for various chart types. Generates code for matplotlib, plotly, and ECharts.",
    schema: z.object({
      data: z.union([z.string(), z.array(z.any()), z.record(z.any())]).describe("Data to visualize"),
      chartType: z.enum(["auto", "line", "bar", "scatter", "pie", "histogram", "heatmap", "box", "area", "radar"]).optional().default("auto")
        .describe("Chart type"),
      title: z.string().optional().describe("Chart title"),
      xAxis: z.string().optional().describe("X-axis column or label"),
      yAxis: z.string().optional().describe("Y-axis column or label"),
      options: z.record(z.any()).optional().default({}).describe("Additional chart options"),
    }),
  }
);

export const dataTransformTool = tool(
  async (input) => {
    const { data, operations, outputFormat = "json" } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a data transformation expert. Apply ETL operations to transform data.

Available operations:
- filter: { column: "col", operator: "eq|ne|gt|lt|gte|lte|in|contains", value: any }
- select: { columns: ["col1", "col2"] }
- rename: { mappings: { "old": "new" } }
- sort: { column: "col", order: "asc|desc" }
- group: { by: ["col1"], aggregations: { "col2": "sum|mean|count|min|max" } }
- join: { right: data, on: "col", type: "inner|left|right|outer" }
- pivot: { index: "col1", columns: "col2", values: "col3", aggfunc: "sum" }
- unpivot: { id_vars: ["col1"], value_vars: ["col2", "col3"] }
- fill_na: { column: "col", value: any, method: "value|mean|median|forward|backward" }
- drop_na: { columns: ["col1"], how: "any|all" }
- dedupe: { columns: ["col1"], keep: "first|last" }
- cast: { column: "col", type: "string|number|date|boolean" }
- derive: { name: "new_col", expression: "col1 + col2" }

Return JSON:
{
  "originalShape": { "rows": number, "columns": number },
  "transformedShape": { "rows": number, "columns": number },
  "operationsApplied": ["list of operations"],
  "transformedData": [transformed data array],
  "changes": {
    "rowsRemoved": number,
    "rowsAdded": number,
    "columnsAdded": ["cols"],
    "columnsRemoved": ["cols"]
  },
  "dataQuality": {
    "missingValues": number,
    "duplicates": number,
    "dataTypes": { "col": "type" }
  },
  "code": {
    "pandas": "Python pandas code to replicate",
    "sql": "SQL equivalent if applicable"
  }
}`,
          },
          {
            role: "user",
            content: `Transform this data:
${typeof data === "string" ? data : JSON.stringify(data, null, 2)}

Operations: ${JSON.stringify(operations, null, 2)}
Output format: ${outputFormat}`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          outputFormat,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        transformation: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "data_transform",
    description: "Applies ETL transformations: filter, select, rename, sort, group, join, pivot, fill missing, deduplicate, and derive new columns.",
    schema: z.object({
      data: z.union([z.string(), z.array(z.any())]).describe("Data to transform"),
      operations: z.array(z.record(z.any())).describe("List of transformation operations to apply"),
      outputFormat: z.enum(["json", "csv", "array"]).optional().default("json").describe("Output format"),
    }),
  }
);

export const dataQueryTool = tool(
  async (input) => {
    const { query, dataSource = "inline", connectionString, data } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a database query expert. Execute or simulate SQL/NoSQL queries.

For SQL queries, support:
- SELECT with JOINs, subqueries, CTEs
- Aggregations (COUNT, SUM, AVG, GROUP BY)
- Window functions (ROW_NUMBER, RANK, LAG, LEAD)
- Filtering (WHERE, HAVING)
- Ordering and limiting

For NoSQL queries (MongoDB-style):
- find, aggregate, match, group, project, sort, limit

Return JSON:
{
  "query": "the query executed",
  "queryType": "select|insert|update|delete|aggregate",
  "optimizedQuery": "optimized version if applicable",
  "executionPlan": {
    "steps": ["query execution steps"],
    "estimatedCost": "relative cost",
    "indexes": ["indexes that would help"]
  },
  "result": {
    "data": [query results],
    "rowCount": number,
    "columns": ["column names"],
    "dataTypes": { "col": "type" }
  },
  "statistics": {
    "executionTimeMs": number,
    "rowsScanned": number,
    "rowsReturned": number
  },
  "warnings": ["any warnings or suggestions"]
}`,
          },
          {
            role: "user",
            content: `Execute query:
Query: ${query}

Data source: ${dataSource}
${data ? `Data: ${typeof data === "string" ? data : JSON.stringify(data, null, 2)}` : ""}
${connectionString ? `Connection: [REDACTED for security]` : ""}`,
          },
        ],
        temperature: 0.1,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          dataSource,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        queryResult: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "data_query",
    description: "Executes SQL/NoSQL queries against data sources. Supports complex queries with JOINs, aggregations, and window functions.",
    schema: z.object({
      query: z.string().describe("SQL or NoSQL query to execute"),
      dataSource: z.enum(["inline", "postgresql", "mysql", "sqlite", "mongodb"]).optional().default("inline")
        .describe("Data source type"),
      connectionString: z.string().optional().describe("Database connection string (for real databases)"),
      data: z.union([z.string(), z.array(z.any())]).optional().describe("Inline data for query simulation"),
    }),
  }
);

export const DATA_TOOLS = [
  dataAnalyzeTool,
  dataVisualizeTool,
  dataTransformTool,
  dataQueryTool,
];
