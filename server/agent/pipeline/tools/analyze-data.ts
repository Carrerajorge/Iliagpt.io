import { ToolDefinition, ExecutionContext, ToolResult } from "../types";
import OpenAI from "openai";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY || "missing" 
});

export const analyzeDataTool: ToolDefinition = {
  id: "analyze_data",
  name: "Analyze Data",
  description: "Analyze data to extract insights, patterns, statistics, or specific information",
  category: "analysis",
  capabilities: ["analyze", "insights", "statistics", "patterns", "summarize", "compare"],
  inputSchema: {
    data: { type: "object", description: "The data to analyze", required: true },
    analysisType: { 
      type: "string", 
      description: "Type of analysis to perform",
      enum: ["summary", "statistics", "patterns", "comparison", "extraction", "custom"],
      default: "summary"
    },
    question: { type: "string", description: "Specific question to answer about the data" },
    outputFormat: {
      type: "string",
      description: "Format for the analysis output",
      enum: ["text", "json", "markdown"],
      default: "json"
    }
  },
  outputSchema: {
    analysis: { type: "object", description: "The analysis results" },
    insights: { type: "array", description: "Key insights extracted" },
    summary: { type: "string", description: "Text summary of the analysis" }
  },
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { data, analysisType = "summary", question, outputFormat = "json" } = params;
    
    if (!data) {
      return {
        success: false,
        error: "No data provided for analysis"
      };
    }

    try {
      const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      
      const analysisInstructions: Record<string, string> = {
        summary: "Provide a comprehensive summary of the data, highlighting key points and structure.",
        statistics: "Calculate and present relevant statistics (counts, averages, distributions, etc.).",
        patterns: "Identify patterns, trends, and anomalies in the data.",
        comparison: "Compare different elements or groups within the data.",
        extraction: "Extract specific information and organize it clearly.",
        custom: question || "Analyze the data and provide relevant insights."
      };

      const instruction = analysisInstructions[analysisType];

      const systemPrompt = `You are a data analyst. Analyze the provided data and respond in ${outputFormat} format.

${outputFormat === "json" ? `Respond with valid JSON containing:
{
  "summary": "brief text summary",
  "insights": ["insight1", "insight2", ...],
  "details": { ... relevant structured data ... }
}` : outputFormat === "markdown" ? "Respond with well-formatted markdown with headers, lists, and emphasis." : "Respond with clear, structured text."}`;

      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Data to analyze:
${dataStr.slice(0, 50000)}

Analysis task: ${instruction}
${question ? `\nSpecific question: ${question}` : ""}`
          }
        ],
        response_format: outputFormat === "json" ? { type: "json_object" } : undefined
      });

      const result = response.choices[0]?.message?.content || "";

      let parsedResult: any;
      let insights: string[] = [];
      let summary = "";

      if (outputFormat === "json") {
        try {
          parsedResult = JSON.parse(result);
          insights = parsedResult.insights || [];
          summary = parsedResult.summary || "";
        } catch {
          parsedResult = { raw: result };
          summary = result;
        }
      } else {
        parsedResult = { content: result };
        summary = result;
        
        const bulletPoints = result.match(/[-•*]\s+(.+)/g) || [];
        insights = bulletPoints.map(b => b.replace(/^[-•*]\s+/, "").trim()).slice(0, 10);
      }

      return {
        success: true,
        data: {
          analysis: parsedResult,
          insights,
          summary,
          analysisType,
          format: outputFormat
        },
        metadata: {
          analysisType,
          inputSize: dataStr.length,
          insightsCount: insights.length
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
};
