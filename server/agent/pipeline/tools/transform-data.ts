import { ToolDefinition, ExecutionContext, ToolResult } from "../types";
import OpenAI from "openai";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY || "missing" 
});

export const transformDataTool: ToolDefinition = {
  id: "transform_data",
  name: "Transform Data",
  description: "Transform, filter, or restructure data using natural language instructions or code",
  category: "transform",
  capabilities: ["transform", "convert", "filter", "map", "restructure", "format", "process"],
  inputSchema: {
    data: { type: "object", description: "The data to transform", required: true },
    instruction: { type: "string", description: "Natural language instruction for transformation", required: true },
    outputFormat: { 
      type: "string", 
      description: "Desired output format",
      enum: ["json", "text", "csv", "markdown", "table"],
      default: "json"
    }
  },
  outputSchema: {
    result: { type: "object", description: "The transformed data" },
    format: { type: "string", description: "The output format used" }
  },
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { data, instruction, outputFormat = "json" } = params;
    
    if (!data) {
      return {
        success: false,
        error: "No data provided"
      };
    }

    try {
      const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        messages: [
          {
            role: "system",
            content: `You are a data transformation assistant. Transform the input data according to the instruction.
Output format: ${outputFormat}

For JSON output, respond with valid JSON only.
For text output, respond with plain text.
For CSV output, respond with comma-separated values.
For markdown output, respond with formatted markdown.
For table output, respond with a markdown table.

Be precise and only output the transformed data, no explanations.`
          },
          {
            role: "user",
            content: `Input data:
${dataStr.slice(0, 50000)}

Transformation instruction: ${instruction}

Transform and output as ${outputFormat}.`
          }
        ]
      });

      const result = response.choices[0]?.message?.content || "";

      let parsedResult: any = result;
      if (outputFormat === "json") {
        try {
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/) || 
                           result.match(/```\s*([\s\S]*?)\s*```/);
          const jsonStr = jsonMatch ? jsonMatch[1] : result;
          parsedResult = JSON.parse(jsonStr.trim());
        } catch {
          parsedResult = result;
        }
      }

      return {
        success: true,
        data: {
          result: parsedResult,
          format: outputFormat
        },
        metadata: {
          inputSize: dataStr.length,
          outputSize: result.length,
          format: outputFormat
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
