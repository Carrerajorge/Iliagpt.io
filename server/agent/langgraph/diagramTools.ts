import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const renderDiagramTool = tool(
  async (input) => {
    const { description, diagramType = "auto", format = "mermaid", theme = "default" } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a diagram creation expert. Generate diagram code in various formats.

Diagram types:
- flowchart: Process flows, algorithms
- sequence: Interactions between components
- class: OOP class diagrams
- entity: ER diagrams for databases
- state: State machines
- gantt: Project timelines
- pie: Proportions
- mindmap: Hierarchical concepts
- architecture: System architecture

Formats:
- mermaid: Mermaid.js syntax
- plantuml: PlantUML syntax
- graphviz: DOT language

Return JSON:
{
  "diagramType": "type used",
  "format": "output format",
  "code": "diagram code",
  "preview": "ASCII art preview if possible",
  "elements": {
    "nodes": number,
    "edges": number,
    "groups": number
  },
  "renderUrl": "URL to render the diagram online",
  "alternatives": [
    {
      "format": "alternative format",
      "code": "diagram in that format"
    }
  ],
  "legend": ["explanation of symbols used"]
}`,
          },
          {
            role: "user",
            content: `Create a diagram:
Description: ${description}
Type: ${diagramType}
Format: ${format}
Theme: ${theme}`,
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
          diagramType,
          format,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        code: content,
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
    name: "render_diagram",
    description: "Generates diagram code in Mermaid, PlantUML, or Graphviz formats for flowcharts, sequence diagrams, ER diagrams, and more.",
    schema: z.object({
      description: z.string().describe("Description of the diagram to create"),
      diagramType: z.enum(["auto", "flowchart", "sequence", "class", "entity", "state", "gantt", "pie", "mindmap", "architecture"])
        .optional().default("auto").describe("Type of diagram"),
      format: z.enum(["mermaid", "plantuml", "graphviz"]).optional().default("mermaid").describe("Output format"),
      theme: z.enum(["default", "dark", "forest", "neutral"]).optional().default("default").describe("Visual theme"),
    }),
  }
);

export const renderChartTool = tool(
  async (input) => {
    const { data, chartType = "auto", title, options = {} } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a data visualization expert. Generate chart specifications.

Return JSON:
{
  "chartType": "recommended type",
  "title": "chart title",
  "spec": {
    "echarts": {
      "option": {ECharts option object}
    },
    "chartjs": {
      "type": "chart type",
      "data": {Chart.js data},
      "options": {Chart.js options}
    },
    "vega": {Vega-Lite specification}
  },
  "insights": ["what the chart shows"],
  "alternatives": ["other suitable chart types"],
  "interactivity": {
    "zoom": boolean,
    "tooltip": boolean,
    "legend": boolean,
    "drill-down": boolean
  },
  "accessibility": {
    "colorBlindSafe": boolean,
    "altText": "description for screen readers"
  }
}`,
          },
          {
            role: "user",
            content: `Create a chart:
Data: ${typeof data === "string" ? data : JSON.stringify(data)}
Type: ${chartType}
Title: ${title || "Auto-generate"}
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
    name: "render_chart",
    description: "Generates interactive chart specifications for ECharts, Chart.js, and Vega-Lite.",
    schema: z.object({
      data: z.union([z.string(), z.array(z.any()), z.record(z.any())]).describe("Data for the chart"),
      chartType: z.enum(["auto", "line", "bar", "pie", "scatter", "area", "radar", "heatmap", "treemap", "sankey", "funnel"])
        .optional().default("auto").describe("Chart type"),
      title: z.string().optional().describe("Chart title"),
      options: z.record(z.any()).optional().default({}).describe("Additional options"),
    }),
  }
);

export const renderMathTool = tool(
  async (input) => {
    const { expression, format = "latex", displayMode = "inline" } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a mathematical typesetting expert. Convert mathematical expressions.

Return JSON:
{
  "original": "original expression",
  "latex": "LaTeX representation",
  "mathml": "MathML representation",
  "asciimath": "AsciiMath representation",
  "plainText": "plain text description",
  "katex": {
    "inline": "KaTeX inline code",
    "block": "KaTeX block code"
  },
  "validation": {
    "valid": boolean,
    "corrections": ["any corrections made"]
  },
  "explanation": "what the expression means",
  "complexity": "simple|intermediate|advanced"
}`,
          },
          {
            role: "user",
            content: `Render this mathematical expression:
Expression: ${expression}
Output format: ${format}
Display mode: ${displayMode}`,
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
          format,
          displayMode,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        latex: content,
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
    name: "render_math",
    description: "Converts and renders mathematical expressions in LaTeX, MathML, and AsciiMath formats.",
    schema: z.object({
      expression: z.string().describe("Mathematical expression to render"),
      format: z.enum(["latex", "mathml", "asciimath", "all"]).optional().default("latex").describe("Output format"),
      displayMode: z.enum(["inline", "block"]).optional().default("inline").describe("Display mode"),
    }),
  }
);

export const DIAGRAM_TOOLS = [
  renderDiagramTool,
  renderChartTool,
  renderMathTool,
];
