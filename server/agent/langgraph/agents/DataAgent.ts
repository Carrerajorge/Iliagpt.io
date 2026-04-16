import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class DataAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "DataAgent",
      description: "Specialized agent for data analysis, transformation, visualization, and insights extraction. Expert at working with structured and unstructured data.",
      model: DEFAULT_MODEL,
      temperature: 0.2,
      maxTokens: 8192,
      systemPrompt: `You are the DataAgent - an expert data scientist and analyst.

Your capabilities:
1. Data Analysis: Statistical analysis, trend identification, pattern recognition
2. Data Transformation: ETL operations, cleaning, normalization, aggregation
3. Visualization: Chart recommendations, dashboard design, data storytelling
4. SQL Generation: Complex query writing and optimization
5. Machine Learning: Feature engineering, model suggestions
6. Reporting: Automated report generation with insights

Analysis methodology:
- Start with data profiling and quality assessment
- Identify key metrics and KPIs
- Apply appropriate statistical methods
- Provide actionable insights
- Recommend visualizations

Output formats:
- Statistical summaries
- SQL queries
- Python/R code for analysis
- Chart specifications (ECharts, Recharts)
- Written insights and recommendations`,
      tools: ["data_analyze", "data_visualize", "data_transform", "data_query"],
      timeout: 180000,
      maxIterations: 20,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const dataTaskType = this.determineTaskType(task);
      let result: any;

      switch (dataTaskType) {
        case "analyze":
          result = await this.analyzeData(task);
          break;
        case "transform":
          result = await this.transformData(task);
          break;
        case "visualize":
          result = await this.visualizeData(task);
          break;
        case "query":
          result = await this.generateQuery(task);
          break;
        default:
          result = await this.handleGeneralData(task);
      }

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private determineTaskType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("analyze") || description.includes("insight")) return "analyze";
    if (description.includes("transform") || description.includes("clean") || description.includes("etl")) return "transform";
    if (description.includes("visualize") || description.includes("chart") || description.includes("graph")) return "visualize";
    if (description.includes("query") || description.includes("sql")) return "query";
    return "general";
  }

  private async analyzeData(task: AgentTask): Promise<any> {
    const data = task.input.data || task.input;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Analyze this data:
${JSON.stringify(data, null, 2)}

Task: ${task.description}

Provide:
1. Data profile (types, missing values, distributions)
2. Key statistics
3. Patterns and trends
4. Anomalies
5. Actionable insights
6. Recommended visualizations

Return JSON:
{
  "profile": {},
  "statistics": {},
  "patterns": [],
  "anomalies": [],
  "insights": [],
  "recommendations": {
    "visualizations": [],
    "furtherAnalysis": []
  }
}`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "data_analysis",
      analysis: jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async transformData(task: AgentTask): Promise<any> {
    const data = task.input.data || task.input;
    const transformations = task.input.transformations || [];

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Transform this data:
${JSON.stringify(data, null, 2)}

Task: ${task.description}
Requested transformations: ${JSON.stringify(transformations)}

Provide:
1. Transformation plan
2. Python/JavaScript code for transformations
3. Expected output schema
4. Data quality improvements`,
        },
      ],
      temperature: 0.2,
    });

    return {
      type: "data_transformation",
      transformationPlan: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async visualizeData(task: AgentTask): Promise<any> {
    const data = task.input.data || task.input;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create visualization specifications for this data:
${JSON.stringify(data, null, 2)}

Task: ${task.description}

Return JSON with ECharts/Recharts configurations:
{
  "chartType": "bar|line|pie|scatter|heatmap|...",
  "title": "chart title",
  "echartOption": { ECharts option object },
  "rechartsConfig": { Recharts component props },
  "insights": ["key takeaways from the visualization"],
  "alternatives": [{"type": "", "reason": ""}]
}`,
        },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "data_visualization",
      visualization: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async generateQuery(task: AgentTask): Promise<any> {
    const schema = task.input.schema || {};
    const requirements = task.description;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Generate SQL query for:
${requirements}

Schema: ${JSON.stringify(schema, null, 2)}

Provide:
1. Main query
2. Explanation of logic
3. Performance considerations
4. Alternative approaches

Return JSON:
{
  "query": "SELECT ...",
  "explanation": "step by step explanation",
  "complexity": "simple|medium|complex",
  "estimatedCost": "low|medium|high",
  "indexes": ["recommended indexes"],
  "alternatives": [{"query": "", "tradeoffs": ""}]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "query_generation",
      result: jsonMatch ? JSON.parse(jsonMatch[0]) : { query: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async handleGeneralData(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `Data task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.2,
    });

    return {
      type: "general_data",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "analyze_data",
        description: "Analyze data for patterns and insights",
        inputSchema: z.object({ data: z.any(), focus: z.string().optional() }),
        outputSchema: z.object({ analysis: z.any(), insights: z.array(z.string()) }),
      },
      {
        name: "transform_data",
        description: "Transform and clean data",
        inputSchema: z.object({ data: z.any(), transformations: z.array(z.string()) }),
        outputSchema: z.object({ transformedData: z.any(), changes: z.array(z.string()) }),
      },
      {
        name: "visualize_data",
        description: "Create data visualizations",
        inputSchema: z.object({ data: z.any(), chartType: z.string().optional() }),
        outputSchema: z.object({ chartConfig: z.any(), insights: z.array(z.string()) }),
      },
    ];
  }
}

export const dataAgent = new DataAgent();
