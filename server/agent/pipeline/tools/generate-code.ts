import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import OpenAI from "openai";
import crypto from "crypto";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY || "missing" 
});

function cleanCodeBlock(text: string): string {
  const codeBlockMatch = text.match(/```(?:\w+)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return text.trim();
}

const GENERATION_PROMPTS: Record<string, string> = {
  code: `You are an expert programmer. Generate clean, well-documented code based on the requirements.
Follow best practices and include necessary imports/dependencies.
Only output the code, no explanations.`,
  
  document: `You are a technical writer. Generate a well-structured Markdown document based on the requirements.
Use proper headings, lists, and formatting.
Only output the markdown, no additional explanations.`,
  
  diagram_mermaid: `You are a diagram expert. Generate a Mermaid diagram based on the requirements.
Use appropriate diagram type (flowchart, sequence, class, etc.).
Only output valid Mermaid syntax, no explanations.`,
  
  data_json: `You are a data architect. Generate valid JSON data based on the requirements.
Ensure proper structure and realistic sample data.
Only output valid JSON, no explanations.`,
  
  data_csv: `You are a data specialist. Generate CSV data based on the requirements.
Include a header row and properly formatted data.
Only output the CSV content, no explanations.`,
  
  sql_schema: `You are a database architect. Generate SQL schema based on the requirements.
Include CREATE TABLE statements with proper data types, constraints, and indexes.
Only output valid SQL, no explanations.`,
  
  api_spec: `You are an API designer. Generate an OpenAPI 3.0 specification based on the requirements.
Include proper paths, methods, request/response schemas.
Output valid YAML format.`,
  
  regex: `You are a regex expert. Generate a regular expression pattern based on the requirements.
Provide the pattern and test examples.
Format: pattern on first line, then examples.`
};

const ARTIFACT_TYPES: Record<string, { extension: string; mimeType: string }> = {
  code: { extension: ".txt", mimeType: "text/plain" },
  document: { extension: ".md", mimeType: "text/markdown" },
  diagram_mermaid: { extension: ".mmd", mimeType: "text/plain" },
  data_json: { extension: ".json", mimeType: "application/json" },
  data_csv: { extension: ".csv", mimeType: "text/csv" },
  sql_schema: { extension: ".sql", mimeType: "text/plain" },
  api_spec: { extension: ".yaml", mimeType: "text/yaml" },
  regex: { extension: ".txt", mimeType: "text/plain" }
};

export const generateCodeTool: ToolDefinition = {
  id: "generate_code",
  name: "Generate Code/Content",
  description: "Generate code, documents, diagrams, or data using LLM capabilities",
  category: "utility",
  capabilities: ["generate", "code", "document", "diagram", "json", "csv", "sql", "api", "regex", "mermaid"],
  inputSchema: {
    action: {
      type: "string",
      description: "Type of content to generate",
      enum: ["code", "document", "diagram_mermaid", "data_json", "data_csv", "sql_schema", "api_spec", "regex"],
      required: true
    },
    description: {
      type: "string",
      description: "Description of what to generate",
      required: true
    },
    language: {
      type: "string",
      description: "Programming language (for code action)",
      default: "javascript"
    },
    context: {
      type: "string",
      description: "Additional context or requirements"
    },
    filename: {
      type: "string",
      description: "Optional filename for the generated content"
    }
  },
  outputSchema: {
    content: { type: "string", description: "Generated content" },
    filename: { type: "string", description: "Suggested filename" },
    type: { type: "string", description: "Content type" }
  },

  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { action, description, language = "javascript", context: additionalContext, filename } = params;

    if (!description) {
      return { success: false, error: "Description is required" };
    }

    try {
      const systemPrompt = GENERATION_PROMPTS[action];
      if (!systemPrompt) {
        return { success: false, error: `Unknown action: ${action}` };
      }

      let userPrompt = description;
      if (action === "code" && language) {
        userPrompt = `Language: ${language}\n\nRequirements:\n${description}`;
      }
      if (additionalContext) {
        userPrompt += `\n\nAdditional context:\n${additionalContext}`;
      }

      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7
      });

      let generatedContent = response.choices[0]?.message?.content || "";
      
      if (action !== "document") {
        generatedContent = cleanCodeBlock(generatedContent);
      }

      if (action === "data_json") {
        try {
          const parsed = JSON.parse(generatedContent);
          generatedContent = JSON.stringify(parsed, null, 2);
        } catch {
        }
      }

      const artifactInfo = ARTIFACT_TYPES[action];
      let suggestedFilename = filename;
      if (!suggestedFilename) {
        const baseName = action === "code" ? `generated_${language}` : `generated_${action}`;
        suggestedFilename = baseName + artifactInfo.extension;
      }

      const artifact: Artifact = {
        id: crypto.randomUUID(),
        type: action === "data_json" ? "json" : action === "document" ? "markdown" : "text",
        name: suggestedFilename,
        content: generatedContent,
        mimeType: artifactInfo.mimeType,
        size: generatedContent.length,
        metadata: { 
          action, 
          language: action === "code" ? language : undefined 
        }
      };

      return {
        success: true,
        data: {
          content: generatedContent,
          filename: suggestedFilename,
          type: action,
          language: action === "code" ? language : undefined
        },
        artifacts: [artifact],
        metadata: {
          action,
          contentLength: generatedContent.length
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
