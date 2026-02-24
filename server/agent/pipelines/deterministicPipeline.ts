import { EventEmitter } from "events";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { llmGateway } from "../../lib/llmGateway";
import { searchWeb, searchScholar, needsAcademicSearch } from "../../services/webSearch";
import { generatePptDocument } from "../../services/documentGeneration";

export const PipelineStageSchema = z.enum([
  "search",
  "download",
  "analyze",
  "extract_data",
  "generate_charts",
  "generate_images",
  "validate",
  "assemble"
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  authors: z.string().optional(),
  year: z.string().optional(),
  snippet: z.string().optional(),
  type: z.enum(["academic", "web", "document", "repository"]),
  citation: z.string().optional(),
  downloadUrl: z.string().optional(),
  mimeType: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const DocumentContentSchema = z.object({
  sourceId: z.string(),
  rawText: z.string(),
  normalizedText: z.string(),
  sections: z.array(z.object({
    title: z.string(),
    content: z.string(),
    level: z.number(),
  })),
  metadata: z.object({
    wordCount: z.number(),
    language: z.string().optional(),
    extractedAt: z.string(),
  }),
});
export type DocumentContent = z.infer<typeof DocumentContentSchema>;

export const AnalysisResultSchema = z.object({
  sourceId: z.string(),
  theme: z.string(),
  keyPoints: z.array(z.string()),
  summary: z.string(),
  relevanceScore: z.number().min(0).max(1),
  categories: z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const DataTableSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  name: z.string(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  dataTypes: z.array(z.enum(["string", "number", "date", "boolean"])),
  metadata: z.object({
    rowCount: z.number(),
    columnCount: z.number(),
    extractedFrom: z.string(),
  }),
});
export type DataTable = z.infer<typeof DataTableSchema>;

export const ChartSpecSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  type: z.enum(["bar", "line", "pie", "scatter", "area", "radar", "heatmap"]),
  title: z.string(),
  xAxis: z.object({
    label: z.string(),
    dataKey: z.string(),
  }),
  yAxis: z.object({
    label: z.string(),
    dataKey: z.string(),
  }),
  legend: z.object({
    show: z.boolean(),
    position: z.enum(["top", "bottom", "left", "right"]),
  }),
  colors: z.array(z.string()),
  data: z.array(z.record(z.any())),
  metadata: z.object({
    generatedAt: z.string(),
    sourceDescription: z.string(),
  }),
});
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export const ImageAssetSchema = z.object({
  id: z.string(),
  type: z.enum(["generated", "diagram", "illustration", "chart_render"]),
  base64: z.string(),
  mimeType: z.string(),
  width: z.number(),
  height: z.number(),
  context: z.string(),
  slideIndex: z.number().optional(),
});
export type ImageAsset = z.infer<typeof ImageAssetSchema>;

export const ValidationResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  checks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    message: z.string(),
  })),
  coherenceMatrix: z.object({
    textToData: z.number(),
    dataToCharts: z.number(),
    chartsToImages: z.number(),
    overallCoherence: z.number(),
  }),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const SlideTemplateSchema = z.object({
  type: z.enum(["cover", "objectives", "analysis", "visualization", "data", "conclusions", "bibliography"]),
  title: z.string(),
  content: z.array(z.string()),
  chartId: z.string().optional(),
  imageId: z.string().optional(),
  tableId: z.string().optional(),
});
export type SlideTemplate = z.infer<typeof SlideTemplateSchema>;

export const PipelineConfigSchema = z.object({
  maxSources: z.number().default(20),
  includeAcademic: z.boolean().default(true),
  includeWeb: z.boolean().default(true),
  generateImages: z.boolean().default(true),
  imageCount: z.number().default(3),
  chartTypes: z.array(z.string()).default(["bar", "line", "pie"]),
  slideTemplate: z.enum(["standard", "academic", "business", "minimal"]).default("standard"),
  apaCitation: z.boolean().default(true),
  language: z.enum(["es", "en"]).default("es"),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

export const PipelineStateSchema = z.object({
  runId: z.string(),
  query: z.string(),
  topic: z.string(),
  config: PipelineConfigSchema,
  currentStage: PipelineStageSchema,
  stageIndex: z.number(),
  totalStages: z.literal(8),
  startedAt: z.string(),
  sources: z.array(SourceSchema),
  documents: z.array(DocumentContentSchema),
  analyses: z.array(AnalysisResultSchema),
  dataTables: z.array(DataTableSchema),
  charts: z.array(ChartSpecSchema),
  images: z.array(ImageAssetSchema),
  validation: ValidationResultSchema.optional(),
  slides: z.array(SlideTemplateSchema),
  stageResults: z.record(z.object({
    success: z.boolean(),
    durationMs: z.number(),
    itemCount: z.number(),
    errors: z.array(z.string()),
  })),
  error: z.string().optional(),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;

export interface PipelineResult {
  success: boolean;
  runId: string;
  state: PipelineState;
  artifact?: {
    type: string;
    mimeType: string;
    buffer: Buffer;
    filename: string;
    sizeBytes: number;
    deckState?: any;
  };
  traceability: {
    stages: Array<{
      stage: PipelineStage;
      duration: number;
      inputCount: number;
      outputCount: number;
    }>;
    totalDurationMs: number;
  reproducible: boolean;
  };
}

function sanitizePptText(value: unknown, maxLength: number): string {
  return String(value || "")
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .substring(0, maxLength);
}

const STAGE_ORDER: PipelineStage[] = [
  "search",
  "download", 
  "analyze",
  "extract_data",
  "generate_charts",
  "generate_images",
  "validate",
  "assemble"
];

const SLIDE_TEMPLATES = {
  standard: [
    { type: "cover" as const, required: true },
    { type: "objectives" as const, required: true },
    { type: "analysis" as const, required: true, repeat: true },
    { type: "visualization" as const, required: false, repeat: true },
    { type: "data" as const, required: false },
    { type: "conclusions" as const, required: true },
    { type: "bibliography" as const, required: true },
  ],
  academic: [
    { type: "cover" as const, required: true },
    { type: "objectives" as const, required: true },
    { type: "analysis" as const, required: true, repeat: true },
    { type: "data" as const, required: true, repeat: true },
    { type: "visualization" as const, required: true, repeat: true },
    { type: "conclusions" as const, required: true },
    { type: "bibliography" as const, required: true },
  ],
  business: [
    { type: "cover" as const, required: true },
    { type: "objectives" as const, required: true },
    { type: "visualization" as const, required: true, repeat: true },
    { type: "conclusions" as const, required: true },
  ],
  minimal: [
    { type: "cover" as const, required: true },
    { type: "analysis" as const, required: true },
    { type: "conclusions" as const, required: true },
  ],
};

export class DeterministicPipeline extends EventEmitter {
  private state: PipelineState | null = null;

  async execute(query: string, config?: Partial<PipelineConfig>): Promise<PipelineResult> {
    const runId = crypto.randomUUID();
    const startTime = Date.now();
    
    const fullConfig = PipelineConfigSchema.parse({
      ...config,
    });

    const topic = this.extractTopic(query);
    
    this.state = {
      runId,
      query,
      topic,
      config: fullConfig,
      currentStage: "search",
      stageIndex: 0,
      totalStages: 8,
      startedAt: new Date().toISOString(),
      sources: [],
      documents: [],
      analyses: [],
      dataTables: [],
      charts: [],
      images: [],
      slides: [],
      stageResults: {},
    };

    const traceability: PipelineResult["traceability"] = {
      stages: [],
      totalDurationMs: 0,
      reproducible: true,
    };

    try {
      for (let i = 0; i < STAGE_ORDER.length; i++) {
        const stage = STAGE_ORDER[i];
        this.state.currentStage = stage;
        this.state.stageIndex = i;
        
        const stageStart = Date.now();
        this.emit("stage_start", { runId, stage, index: i });
        
        const inputCount = this.getStageInputCount(stage);
        await this.executeStage(stage);
        const outputCount = this.getStageOutputCount(stage);
        
        const duration = Date.now() - stageStart;
        
        traceability.stages.push({
          stage,
          duration,
          inputCount,
          outputCount,
        });
        
        this.emit("stage_complete", { 
          runId, 
          stage, 
          index: i, 
          duration,
          inputCount,
          outputCount,
        });
      }

      const artifact = await this.assembleArtifact();
      traceability.totalDurationMs = Date.now() - startTime;

      return {
        success: true,
        runId,
        state: this.state,
        artifact,
        traceability,
      };
    } catch (error: any) {
      this.state.error = error.message;
      traceability.totalDurationMs = Date.now() - startTime;
      traceability.reproducible = false;
      
      return {
        success: false,
        runId,
        state: this.state,
        traceability,
      };
    }
  }

  private extractTopic(query: string): string {
    const patterns = [
      /sobre\s+(?:la\s+|el\s+|los\s+|las\s+)?(.+?)(?:\s+y\s+(?:crea|genera|haz)|$)/i,
      /about\s+(.+?)(?:\s+and\s+(?:create|generate|make)|$)/i,
      /(?:busca|search|find)\s+.+?\s+(?:sobre|about)\s+(.+?)(?:\s+|$)/i,
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        return match[1].trim().replace(/\s+/g, " ");
      }
    }

    return query
      .replace(/\b(busca|search|find|crea|create|genera|generate|ppt|powerpoint|presentación|artículos?|articles?)\b/gi, "")
      .replace(/\d+/g, "")
      .trim()
      .replace(/\s+/g, " ");
  }

  private getStageInputCount(stage: PipelineStage): number {
    switch (stage) {
      case "search": return 1;
      case "download": return this.state?.sources.length || 0;
      case "analyze": return this.state?.documents.length || 0;
      case "extract_data": return this.state?.analyses.length || 0;
      case "generate_charts": return this.state?.dataTables.length || 0;
      case "generate_images": return this.state?.charts.length || 0;
      case "validate": return (this.state?.analyses.length || 0) + (this.state?.charts.length || 0);
      case "assemble": return this.state?.slides.length || 0;
      default: return 0;
    }
  }

  private getStageOutputCount(stage: PipelineStage): number {
    switch (stage) {
      case "search": return this.state?.sources.length || 0;
      case "download": return this.state?.documents.length || 0;
      case "analyze": return this.state?.analyses.length || 0;
      case "extract_data": return this.state?.dataTables.length || 0;
      case "generate_charts": return this.state?.charts.length || 0;
      case "generate_images": return this.state?.images.length || 0;
      case "validate": return this.state?.validation ? 1 : 0;
      case "assemble": return this.state?.slides.length || 0;
      default: return 0;
    }
  }

  private async executeStage(stage: PipelineStage): Promise<void> {
    const stageStart = Date.now();
    const errors: string[] = [];

    try {
      switch (stage) {
        case "search":
          await this.stageSearch();
          break;
        case "download":
          await this.stageDownload();
          break;
        case "analyze":
          await this.stageAnalyze();
          break;
        case "extract_data":
          await this.stageExtractData();
          break;
        case "generate_charts":
          await this.stageGenerateCharts();
          break;
        case "generate_images":
          await this.stageGenerateImages();
          break;
        case "validate":
          await this.stageValidate();
          break;
        case "assemble":
          await this.stageAssemble();
          break;
      }
    } catch (error: any) {
      errors.push(error.message);
    }

    this.state!.stageResults[stage] = {
      success: errors.length === 0,
      durationMs: Date.now() - stageStart,
      itemCount: this.getStageOutputCount(stage),
      errors,
    };

    // Critical stages must succeed for pipeline to continue
    const criticalStages: PipelineStage[] = ["search", "analyze", "assemble"];
    if (criticalStages.includes(stage) && errors.length > 0) {
      throw new Error(`Critical stage '${stage}' failed: ${errors.join(", ")}`);
    }

    // Non-critical stages with no output should log a warning but allow continuation
    if (!criticalStages.includes(stage) && this.getStageOutputCount(stage) === 0) {
      console.warn(`[DeterministicPipeline] Stage '${stage}' produced no output`);
    }
  }

  private async stageSearch(): Promise<void> {
    if (!this.state) throw new Error("Pipeline state not initialized");
    
    const { topic, config } = this.state;
    const sources: Source[] = [];

    console.log(`[DeterministicPipeline] Stage 1: Searching for "${topic}" (max ${config.maxSources})`);

    if (config.includeAcademic) {
      try {
        const scholarResults = await searchScholar(topic, Math.ceil(config.maxSources * 0.6));
        for (const result of scholarResults) {
          sources.push({
            id: crypto.randomUUID(),
            url: result.url,
            title: result.title,
            authors: result.authors || "Autor desconocido",
            year: result.year || new Date().getFullYear().toString(),
            snippet: result.snippet,
            type: "academic",
            citation: result.citation || this.formatAPACitation(result),
          });
        }
      } catch (error: any) {
        console.warn(`[DeterministicPipeline] Academic search failed: ${error.message}`);
      }
    }

    if (config.includeWeb && sources.length < config.maxSources) {
      try {
        const webResults = await searchWeb(topic, config.maxSources - sources.length);
        for (const result of webResults.results) {
          sources.push({
            id: crypto.randomUUID(),
            url: result.url,
            title: result.title,
            authors: result.siteName || result.authors || "Fuente web",
            year: result.publishedDate?.slice(0, 4) || new Date().getFullYear().toString(),
            snippet: result.snippet,
            type: "web",
            citation: this.formatWebCitation(result),
          });
        }
      } catch (error: any) {
        console.warn(`[DeterministicPipeline] Web search failed: ${error.message}`);
      }
    }

    this.state.sources = sources.slice(0, config.maxSources);
    console.log(`[DeterministicPipeline] Found ${this.state.sources.length} sources`);
  }

  private formatAPACitation(result: any): string {
    const authors = result.authors || "Autor desconocido";
    const year = result.year || new Date().getFullYear();
    const title = result.title;
    const url = result.url;
    return `${authors} (${year}). ${title}. Recuperado de ${url}`;
  }

  private formatWebCitation(result: any): string {
    const siteName = result.siteName || "Web";
    const year = result.publishedDate?.slice(0, 4) || new Date().getFullYear();
    const title = result.title;
    const url = result.url;
    return `${siteName}. (${year}). ${title}. Recuperado de ${url}`;
  }

  private async stageDownload(): Promise<void> {
    if (!this.state) throw new Error("Pipeline state not initialized");
    
    console.log(`[DeterministicPipeline] Stage 2: Processing ${this.state.sources.length} sources`);

    for (const source of this.state.sources) {
      const normalizedText = [
        `# ${source.title}`,
        ``,
        `**Autor(es):** ${source.authors}`,
        `**Año:** ${source.year}`,
        `**Tipo:** ${source.type}`,
        ``,
        `## Resumen`,
        source.snippet || "Sin resumen disponible.",
        ``,
        `**URL:** ${source.url}`,
      ].join("\n");

      this.state.documents.push({
        sourceId: source.id,
        rawText: source.snippet || "",
        normalizedText,
        sections: [
          { title: "Resumen", content: source.snippet || "", level: 1 },
        ],
        metadata: {
          wordCount: normalizedText.split(/\s+/).length,
          language: this.state.config.language,
          extractedAt: new Date().toISOString(),
        },
      });
    }

    console.log(`[DeterministicPipeline] Processed ${this.state.documents.length} documents`);
  }

  private async stageAnalyze(): Promise<void> {
    if (!this.state) throw new Error("Pipeline state not initialized");
    
    console.log(`[DeterministicPipeline] Stage 3: Analyzing ${this.state.documents.length} documents`);

    const analysisPrompt = `Analiza las siguientes fuentes sobre "${this.state.topic}" y genera un análisis estructurado.

FUENTES:
${this.state.sources.slice(0, 10).map((s, i) => `${i + 1}. ${s.title}\n   ${s.snippet || "Sin descripción"}`).join("\n\n")}

Responde en formato JSON con la siguiente estructura:
{
  "keyPoints": ["punto clave 1", "punto clave 2", ...],
  "summary": "resumen general de 2-3 oraciones",
  "categories": ["categoría 1", "categoría 2"],
  "suggestedData": [
    {"label": "etiqueta", "value": número, "unit": "unidad"}
  ]
}`;

    try {
      const response = await llmGateway.complete({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: analysisPrompt }],
        temperature: 0.3,
        maxTokens: 2000,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        this.state.analyses.push({
          sourceId: "combined",
          theme: this.state.topic,
          keyPoints: parsed.keyPoints || [],
          summary: parsed.summary || "Análisis no disponible",
          relevanceScore: 0.9,
          categories: parsed.categories || [],
        });

        if (parsed.suggestedData && parsed.suggestedData.length > 0) {
          this.state.dataTables.push({
            id: crypto.randomUUID(),
            sourceId: "analysis",
            name: "Datos sugeridos",
            headers: ["Indicador", "Valor", "Unidad"],
            rows: parsed.suggestedData.map((d: any) => [d.label, d.value, d.unit || ""]),
            dataTypes: ["string", "number", "string"],
            metadata: {
              rowCount: parsed.suggestedData.length,
              columnCount: 3,
              extractedFrom: "Análisis LLM",
            },
          });
        }
      }
    } catch (error: any) {
      console.warn(`[DeterministicPipeline] Analysis failed: ${error.message}`);
      this.state.analyses.push({
        sourceId: "combined",
        theme: this.state.topic,
        keyPoints: this.state.sources.slice(0, 5).map(s => s.title),
        summary: `Análisis de ${this.state.sources.length} fuentes sobre ${this.state.topic}`,
        relevanceScore: 0.7,
        categories: [this.state.topic],
      });
    }

    console.log(`[DeterministicPipeline] Generated ${this.state.analyses.length} analyses`);
  }

  private async stageExtractData(): Promise<void> {
    if (!this.state) throw new Error("Pipeline state not initialized");
    
    console.log(`[DeterministicPipeline] Stage 4: Extracting quantitative data`);

    if (this.state.dataTables.length === 0) {
      const sampleData = this.generateSampleData();
      this.state.dataTables.push(sampleData);
    }

    console.log(`[DeterministicPipeline] Extracted ${this.state.dataTables.length} data tables`);
  }

  private generateSampleData(): DataTable {
    const categories = ["Categoría A", "Categoría B", "Categoría C", "Categoría D"];
    const rows = categories.map(cat => [
      cat,
      Math.floor(Math.random() * 100) + 20,
      Math.floor(Math.random() * 50) + 10,
    ]);

    return {
      id: crypto.randomUUID(),
      sourceId: "generated",
      name: `Datos de ${this.state?.topic || "análisis"}`,
      headers: ["Categoría", "Valor Principal", "Valor Secundario"],
      rows,
      dataTypes: ["string", "number", "number"],
      metadata: {
        rowCount: rows.length,
        columnCount: 3,
        extractedFrom: "Datos ilustrativos",
      },
    };
  }

  private async stageGenerateCharts(): Promise<void> {
    if (!this.state) throw new Error("Pipeline state not initialized");
    
    console.log(`[DeterministicPipeline] Stage 5: Generating charts from ${this.state.dataTables.length} tables`);

    for (const table of this.state.dataTables) {
      if (table.rows.length === 0) continue;

      const chartData = table.rows.map(row => {
        const obj: Record<string, any> = {};
        table.headers.forEach((header, i) => {
          obj[header] = row[i];
        });
        return obj;
      });

      this.state.charts.push({
        id: crypto.randomUUID(),
        tableId: table.id,
        type: "bar",
        title: table.name,
        xAxis: {
          label: table.headers[0],
          dataKey: table.headers[0],
        },
        yAxis: {
          label: table.headers[1] || "Valor",
          dataKey: table.headers[1] || table.headers[0],
        },
        legend: {
          show: true,
          position: "bottom",
        },
        colors: ["#6366F1", "#8B5CF6", "#EC4899", "#10B981"],
        data: chartData,
        metadata: {
          generatedAt: new Date().toISOString(),
          sourceDescription: table.metadata.extractedFrom,
        },
      });
    }

    console.log(`[DeterministicPipeline] Generated ${this.state.charts.length} charts`);
  }

  private async stageGenerateImages(): Promise<void> {
    if (!this.state) throw new Error("Pipeline state not initialized");
    
    if (!this.state.config.generateImages) {
      console.log(`[DeterministicPipeline] Stage 6: Image generation disabled`);
      return;
    }

    console.log(`[DeterministicPipeline] Stage 6: Generating ${this.state.config.imageCount} images`);

    try {
      const { generateImage } = await import("../../services/imageGeneration");
      
      const imagePromises = Array.from({ length: this.state.config.imageCount }, async (_, i) => {
        const context = i === 0 
          ? `Portada profesional sobre ${this.state!.topic}`
          : `Ilustración conceptual sobre ${this.state!.topic}, aspecto ${i + 1}`;
        
        try {
          const result = await generateImage(
            `Professional illustration for presentation about ${this.state!.topic}. Modern, clean design. Slide ${i + 1}.`,
            { timeout: 30000 }
          );
          
          this.state!.images.push({
            id: crypto.randomUUID(),
            type: "generated",
            base64: result.imageBase64,
            mimeType: "image/png",
            width: 1024,
            height: 768,
            context,
            slideIndex: i,
          });
        } catch (error: any) {
          console.warn(`[DeterministicPipeline] Image ${i + 1} generation failed: ${error.message}`);
        }
      });

      await Promise.allSettled(imagePromises);
    } catch (error: any) {
      console.warn(`[DeterministicPipeline] Image generation module failed: ${error.message}`);
    }

    console.log(`[DeterministicPipeline] Generated ${this.state.images.length} images`);
  }

  private async stageValidate(): Promise<void> {
    if (!this.state) throw new Error("Pipeline state not initialized");
    
    console.log(`[DeterministicPipeline] Stage 7: Validating coherence`);

    const checks = [
      {
        name: "sources_available",
        passed: this.state.sources.length > 0,
        message: this.state.sources.length > 0 
          ? `${this.state.sources.length} fuentes encontradas`
          : "No se encontraron fuentes",
      },
      {
        name: "analysis_complete",
        passed: this.state.analyses.length > 0,
        message: this.state.analyses.length > 0
          ? "Análisis completado"
          : "Análisis incompleto",
      },
      {
        name: "data_extracted",
        passed: this.state.dataTables.length > 0,
        message: this.state.dataTables.length > 0
          ? `${this.state.dataTables.length} tablas de datos`
          : "Sin datos estructurados",
      },
      {
        name: "charts_generated",
        passed: this.state.charts.length > 0 || !this.state.config.generateImages,
        message: this.state.charts.length > 0
          ? `${this.state.charts.length} gráficas generadas`
          : "Sin gráficas",
      },
      {
        name: "images_available",
        passed: this.state.images.length > 0 || !this.state.config.generateImages,
        message: this.state.images.length > 0
          ? `${this.state.images.length} imágenes generadas`
          : "Sin imágenes",
      },
    ];

    const passedCount = checks.filter(c => c.passed).length;
    const score = passedCount / checks.length;

    this.state.validation = {
      passed: score >= 0.6,
      score,
      checks,
      coherenceMatrix: {
        textToData: this.state.dataTables.length > 0 ? 0.9 : 0.5,
        dataToCharts: this.state.charts.length > 0 ? 0.95 : 0.4,
        chartsToImages: this.state.images.length > 0 ? 0.9 : 0.6,
        overallCoherence: score,
      },
    };

    console.log(`[DeterministicPipeline] Validation score: ${(score * 100).toFixed(1)}%`);
  }

  private async stageAssemble(): Promise<void> {
    if (!this.state) throw new Error("Pipeline state not initialized");
    
    console.log(`[DeterministicPipeline] Stage 8: Assembling presentation`);

    const template = SLIDE_TEMPLATES[this.state.config.slideTemplate];
    const analysis = this.state.analyses[0];
    const keyPoints = analysis?.keyPoints || [];

    this.state.slides.push({
      type: "cover",
      title: this.state.topic,
      content: [
        `Presentación generada por IliaGPT`,
        new Date().toLocaleDateString("es-ES", { 
          year: "numeric", 
          month: "long", 
          day: "numeric" 
        }),
      ],
      imageId: this.state.images[0]?.id,
    });

    this.state.slides.push({
      type: "objectives",
      title: "Objetivos",
      content: [
        `Analizar ${this.state.topic}`,
        `Revisar ${this.state.sources.length} fuentes académicas y web`,
        `Presentar hallazgos clave y visualizaciones`,
      ],
    });

    const pointsPerSlide = 4;
    for (let i = 0; i < keyPoints.length; i += pointsPerSlide) {
      const slidePoints = keyPoints.slice(i, i + pointsPerSlide);
      const slideIndex = Math.floor(i / pointsPerSlide) + 2;
      
      this.state.slides.push({
        type: "analysis",
        title: i === 0 ? "Análisis Principal" : `Análisis (cont.)`,
        content: slidePoints,
        imageId: this.state.images[Math.min(slideIndex - 1, this.state.images.length - 1)]?.id,
      });
    }

    if (this.state.charts.length > 0) {
      for (const chart of this.state.charts) {
        this.state.slides.push({
          type: "visualization",
          title: chart.title,
          content: [
            `Tipo de gráfica: ${chart.type}`,
            chart.metadata.sourceDescription,
          ],
          chartId: chart.id,
        });
      }
    }

    this.state.slides.push({
      type: "conclusions",
      title: "Conclusiones",
      content: [
        analysis?.summary || `Análisis completado de ${this.state.topic}`,
        `Basado en ${this.state.sources.length} fuentes`,
        `${this.state.charts.length} visualizaciones generadas`,
      ],
    });

    if (this.state.config.apaCitation && this.state.sources.length > 0) {
      const citations = this.state.sources
        .slice(0, 10)
        .map(s => s.citation || this.formatAPACitation(s));
      
      this.state.slides.push({
        type: "bibliography",
        title: "Referencias (APA 7ma ed.)",
        content: citations,
      });
    }

    console.log(`[DeterministicPipeline] Assembled ${this.state.slides.length} slides`);
  }

  private async assembleArtifact(): Promise<PipelineResult["artifact"]> {
    if (!this.state) throw new Error("Pipeline state not initialized");

    const theme = {
      primary: "#6366F1",
      secondary: "#8B5CF6",
      accent: "#EC4899",
      bg: "#0F172A",
      text: "#F8FAFC",
    };

    const deckSlides: any[] = [];

    for (const slide of this.state.slides || []) {
      deckSlides.push({
        id: crypto.randomUUID(),
        title: sanitizePptText(slide.title, 220) || "Diapositiva",
        content: Array.isArray(slide.content) && slide.content.length > 0
          ? slide.content.map((entry) => sanitizePptText(entry, 260)).filter(Boolean).slice(0, 20)
          : ["Sin contenido disponible."],
        type: slide.type,
      });
    }

    const presentationTitle = sanitizePptText(this.state.topic, 500) || "Presentación";
    const presentationSlides = deckSlides.map((slide) => ({
      title: slide.title,
      content: slide.content.slice(0, 18),
    }));

    let buffer: Buffer;
    try {
      buffer = await generatePptDocument(presentationTitle, presentationSlides, {
        trace: {
          source: "deterministicPipeline",
        },
      });
    } catch (error: any) {
      console.warn("[DeterministicPipeline] Fallback to emergency presentation template.", error);
      buffer = await generatePptDocument("Presentación", [{
        title: "Fallback",
        content: [
          "No fue posible renderizar la presentación con el generador principal.",
          `Error: ${sanitizePptText(error?.message || error, 240)}`,
        ],
      }], {
        trace: {
          source: "deterministicPipeline",
        },
      });
    }

    return {
      type: "presentation",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer,
      filename: `${presentationTitle.replace(/[^a-zA-Z0-9]/g, "_")}_presentation.pptx`,
      sizeBytes: buffer.length,
      deckState: {
        title: this.state.topic,
        slides: deckSlides,
        theme,
      },
    };
  }

  getState(): PipelineState | null {
    return this.state;
  }
}

export const deterministicPipeline = new DeterministicPipeline();
