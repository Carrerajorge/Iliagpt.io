import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class DocumentAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "DocumentAgent",
      description: "Specialized agent for document processing, conversion, analysis, and manipulation. Expert at working with PDFs, Word docs, spreadsheets, and presentations.",
      model: DEFAULT_MODEL,
      temperature: 0.2,
      maxTokens: 8192,
      systemPrompt: `You are the DocumentAgent - an expert document processor and analyst.

Your capabilities:
1. Document Parsing: Extract text, tables, images from documents
2. Format Conversion: Convert between PDF, DOCX, XLSX, PPTX, HTML, MD
3. Document Analysis: Summarize, extract key information, compare documents
4. Template Processing: Fill templates, mail merge, batch processing
5. PDF Operations: Merge, split, annotate, extract pages
6. OCR: Extract text from scanned documents and images

Document handling:
- Preserve formatting when possible
- Handle multi-language documents
- Extract metadata
- Maintain document structure
- Handle large files efficiently

Output formats:
- Structured JSON for extracted data
- Markdown for text content
- Base64 for binary outputs
- Download links for generated files`,
      tools: ["doc_create", "pdf_manipulate", "spreadsheet_create", "slides_create", "ocr_extract"],
      timeout: 180000,
      maxIterations: 20,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const docTaskType = this.determineDocumentTaskType(task);
      console.log(`[DocumentAgent] Task: "${task.description}" -> Type: "${docTaskType}"`);
      let result: any;

      switch (docTaskType) {
        case "parse":
          result = await this.parseDocument(task);
          break;
        case "convert":
          result = await this.convertDocument(task);
          break;
        case "analyze":
          result = await this.analyzeDocument(task);
          break;
        case "create":
          console.log(`[DocumentAgent] Calling createDocument...`);
          result = await this.createDocument(task);
          console.log(`[DocumentAgent] createDocument returned: content_len=${result?.content?.length || 0}`);
          break;
        case "manipulate":
          result = await this.manipulateDocument(task);
          break;
        default:
          console.log(`[DocumentAgent] Calling handleGeneralDocument (fallback)...`);
          result = await this.handleGeneralDocument(task);
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

  private determineDocumentTaskType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("parse") || description.includes("extract")) return "parse";
    if (description.includes("convert") || description.includes("transform")) return "convert";
    if (description.includes("analyze") || description.includes("summarize") || description.includes("compare")) return "analyze";
    if (description.includes("create") || description.includes("generate") || description.includes("write") || description.includes("draft")) return "create";
    if (description.includes("merge") || description.includes("split") || description.includes("manipulate")) return "manipulate";
    return "general";
  }

  private async parseDocument(task: AgentTask): Promise<any> {
    const documentType = task.input.type || "unknown";
    const content = task.input.content || "";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Parse this ${documentType} document:
${content.substring(0, 10000)}

Task: ${task.description}

Return JSON:
{
  "metadata": {"title": "", "author": "", "pages": 0, "wordCount": 0},
  "structure": {"sections": [], "headings": [], "tables": [], "images": []},
  "extractedText": "full text content",
  "keyInformation": ["important extracted items"],
  "entities": {"people": [], "organizations": [], "dates": [], "amounts": []}
}`,
        },
      ],
      temperature: 0.1,
    });

    const responseContent = response.choices[0].message.content || "{}";
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);

    return {
      type: "document_parsing",
      parsed: jsonMatch ? JSON.parse(jsonMatch[0]) : { text: responseContent },
      timestamp: new Date().toISOString(),
    };
  }

  private async convertDocument(task: AgentTask): Promise<any> {
    const sourceFormat = task.input.sourceFormat || "text";
    const targetFormat = task.input.targetFormat || "markdown";
    const content = task.input.content || "";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Convert document from ${sourceFormat} to ${targetFormat}:
${content.substring(0, 10000)}

Maintain formatting and structure as much as possible.
Provide the converted content and any conversion notes.`,
        },
      ],
      temperature: 0.1,
    });

    return {
      type: "document_conversion",
      sourceFormat,
      targetFormat,
      converted: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async analyzeDocument(task: AgentTask): Promise<any> {
    const content = task.input.content || "";
    const analysisType = task.input.analysisType || "summary";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Analyze this document (${analysisType}):
${content.substring(0, 10000)}

Task: ${task.description}

Provide:
1. Executive Summary
2. Key Points
3. Main Topics
4. Important Data/Numbers
5. Recommendations/Actions`,
        },
      ],
      temperature: 0.2,
    });

    return {
      type: "document_analysis",
      analysisType,
      analysis: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async createDocument(task: AgentTask): Promise<any> {
    const docType = task.input.docType || "document";
    const template = task.input.template || null;
    const section = task.input.section || null;
    const tone = task.input.tone || "formal";

    // Build a targeted prompt based on available information
    let userPrompt = "";

    if (section && section.title) {
      // This is a section writing task from the production pipeline
      const sectionTitle = section.title || "Untitled Section";
      const sectionObjective = section.objective || "";
      const targetWords = section.targetWordCount || 200;

      userPrompt = `Escribe el contenido para la sección "${sectionTitle}" de un documento profesional.

Objetivo de la sección: ${sectionObjective || "Desarrollar el tema de manera completa y profesional."}

Tono: ${tone}
Extensión objetivo: Aproximadamente ${targetWords} palabras.

INSTRUCCIONES:
1. Escribe contenido sustancial y profesional en español
2. Usa formato markdown cuando sea apropiado (listas, énfasis)
3. NO incluyas el título de la sección (ya está agregado)
4. Enfócate solo en el CONTENIDO del cuerpo de la sección
5. Sé específico y detallado

Genera el contenido ahora:`;
    } else {
      // Generic document creation
      userPrompt = `Create a ${docType} document:
Task: ${task.description}
Template: ${template ? JSON.stringify(template) : "none"}
Requirements: ${JSON.stringify(task.input)}

Generate complete document content with proper formatting in markdown.`;
    }

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
    });

    const generatedContent = response.choices[0].message.content || "";
    console.log(`[DocumentAgent] createDocument generated ${generatedContent.length} chars for "${section?.title || 'generic'}"`);

    return {
      type: "document_creation",
      docType,
      content: generatedContent,
      timestamp: new Date().toISOString(),
    };
  }

  private async manipulateDocument(task: AgentTask): Promise<any> {
    const operation = task.input.operation || "modify";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Document manipulation (${operation}):
Task: ${task.description}
Details: ${JSON.stringify(task.input)}

Provide step-by-step instructions and code if applicable.`,
        },
      ],
      temperature: 0.2,
    });

    return {
      type: "document_manipulation",
      operation,
      instructions: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async handleGeneralDocument(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `Document task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.2,
    });

    return {
      type: "general_document",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "parse_document",
        description: "Parse and extract content from documents",
        inputSchema: z.object({ content: z.string(), type: z.string().optional() }),
        outputSchema: z.object({ text: z.string(), metadata: z.any(), structure: z.any() }),
      },
      {
        name: "convert_document",
        description: "Convert documents between formats",
        inputSchema: z.object({ content: z.string(), sourceFormat: z.string(), targetFormat: z.string() }),
        outputSchema: z.object({ converted: z.string() }),
      },
      {
        name: "analyze_document",
        description: "Analyze and summarize documents",
        inputSchema: z.object({ content: z.string(), analysisType: z.string().optional() }),
        outputSchema: z.object({ analysis: z.string(), keyPoints: z.array(z.string()) }),
      },
    ];
  }
}

export const documentAgent = new DocumentAgent();
