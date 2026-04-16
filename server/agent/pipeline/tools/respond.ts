import { ToolDefinition, ExecutionContext, ToolResult } from "../types";
import OpenAI from "openai";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY || "missing" 
});

export const respondTool: ToolDefinition = {
  id: "respond",
  name: "Generate Response",
  description: "Generate a natural language response based on context and gathered information",
  category: "utility",
  capabilities: ["respond", "answer", "summarize", "explain", "conclude"],
  inputSchema: {
    objective: { type: "string", description: "The original user objective", required: true },
    context: { type: "string", description: "Additional context or gathered data" },
    tone: { 
      type: "string", 
      description: "Response tone",
      enum: ["professional", "casual", "technical", "friendly"],
      default: "professional"
    },
    language: { type: "string", description: "Response language", default: "auto" }
  },
  outputSchema: {
    response: { type: "string", description: "The generated response" }
  },
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { objective, context: additionalContext, tone = "professional", language = "auto" } = params;
    
    try {
      const previousData = context.previousResults
        .filter(r => r.status === "completed" && r.output?.data)
        .map(r => {
          if (r.output?.data?.textContent) {
            return `[From ${r.toolId}]: ${r.output.data.textContent.slice(0, 5000)}`;
          }
          if (r.output?.data?.result) {
            return `[From ${r.toolId}]: ${JSON.stringify(r.output.data.result).slice(0, 5000)}`;
          }
          return `[From ${r.toolId}]: ${JSON.stringify(r.output?.data).slice(0, 3000)}`;
        })
        .join("\n\n");

      const languageInstruction = language === "auto" 
        ? "Respond in the same language as the user's objective."
        : `Respond in ${language}.`;

      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        messages: [
          {
            role: "system",
            content: `You are iliagpt, an intelligent assistant. Generate a helpful, comprehensive response.

Tone: ${tone}
${languageInstruction}

You have access to information gathered from previous steps. Use this information to provide an accurate, well-structured response.
If citing sources, mention them naturally in your response.
Be thorough but concise.`
          },
          {
            role: "user",
            content: `User objective: ${objective}

${additionalContext ? `Additional context: ${additionalContext}\n\n` : ""}${previousData ? `Information gathered:\n${previousData}` : ""}

Generate a comprehensive response addressing the user's objective.`
          }
        ]
      });

      const responseText = response.choices[0]?.message?.content || "No se pudo generar una respuesta.";

      return {
        success: true,
        data: {
          response: responseText
        },
        metadata: {
          tone,
          language,
          previousStepsUsed: context.previousResults.filter(r => r.status === "completed").length
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
