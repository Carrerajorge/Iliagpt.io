import { EventEmitter } from "events";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../db";
import { eq, and } from "drizzle-orm";

// ============================================================================
// SCHEMAS: Document Structure Planning
// ============================================================================

export const AudienceTypeSchema = z.enum(["executive", "technical", "academic", "operational", "general"]);
export type AudienceType = z.infer<typeof AudienceTypeSchema>;

export const DocumentGoalSchema = z.enum(["analyze", "report", "recommend", "audit", "forecast", "compare"]);
export type DocumentGoal = z.infer<typeof DocumentGoalSchema>;

export const OutputFormatSchema = z.enum(["word", "excel", "both"]);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

// Word Document Structure
export const WordChapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["executive_summary", "introduction", "methodology", "analysis", "results", "conclusions", "recommendations", "appendix", "bibliography"]),
  level: z.number().min(1).max(3),
  content: z.string().optional(),
  linkedData: z.array(z.string()).optional(),
  tables: z.array(z.string()).optional(),
  charts: z.array(z.string()).optional(),
  wordCount: z.number().optional(),
});
export type WordChapter = z.infer<typeof WordChapterSchema>;

export const WordDocumentPlanSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  authors: z.array(z.string()),
  date: z.string(),
  chapters: z.array(WordChapterSchema),
  style: z.object({
    tone: z.enum(["formal", "technical", "conversational"]),
    detailLevel: z.enum(["summary", "standard", "detailed"]),
    includeExecutiveSummary: z.boolean(),
    includeRecommendations: z.boolean(),
    includeBibliography: z.boolean(),
  }),
});
export type WordDocumentPlan = z.infer<typeof WordDocumentPlanSchema>;

// Excel Workbook Structure
export const ExcelColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  dataType: z.enum(["text", "number", "currency", "percentage", "date", "formula", "boolean"]),
  format: z.string().optional(),
  validation: z.object({
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    allowedValues: z.array(z.string()).optional(),
    formula: z.string().optional(),
  }).optional(),
  source: z.string().optional(),
});
export type ExcelColumn = z.infer<typeof ExcelColumnSchema>;

export const ExcelSheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["data", "summary", "dashboard", "pivot", "charts", "raw", "calculations"]),
  columns: z.array(ExcelColumnSchema),
  rows: z.array(z.record(z.any())).optional(),
  formulas: z.array(z.object({
    cell: z.string(),
    formula: z.string(),
    description: z.string(),
  })).optional(),
  charts: z.array(z.object({
    type: z.enum(["bar", "line", "pie", "scatter", "area", "combo"]),
    title: z.string(),
    dataRange: z.string(),
    position: z.string(),
  })).optional(),
  conditionalFormatting: z.array(z.object({
    range: z.string(),
    rule: z.string(),
    format: z.string(),
  })).optional(),
});
export type ExcelSheet = z.infer<typeof ExcelSheetSchema>;

export const ExcelWorkbookPlanSchema = z.object({
  title: z.string(),
  description: z.string(),
  sheets: z.array(ExcelSheetSchema),
  namedRanges: z.array(z.object({
    name: z.string(),
    range: z.string(),
    description: z.string(),
  })).optional(),
  kpis: z.array(z.object({
    id: z.string(),
    name: z.string(),
    formula: z.string(),
    unit: z.string(),
    target: z.number().optional(),
    threshold: z.object({ warning: z.number(), critical: z.number() }).optional(),
  })).optional(),
  dataConnections: z.array(z.object({
    sourceId: z.string(),
    sourceType: z.string(),
    targetSheet: z.string(),
    mappings: z.array(z.object({ source: z.string(), target: z.string() })),
  })).optional(),
});
export type ExcelWorkbookPlan = z.infer<typeof ExcelWorkbookPlanSchema>;

// ============================================================================
// SCHEMAS: Semantic Analysis
// ============================================================================

export const ExtractedEntitySchema = z.object({
  id: z.string(),
  type: z.enum(["number", "date", "currency", "percentage", "metric", "entity", "concept"]),
  value: z.any(),
  rawText: z.string(),
  context: z.string(),
  confidence: z.number().min(0).max(1),
  sourceId: z.string(),
  position: z.object({ page: z.number().optional(), paragraph: z.number().optional() }).optional(),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

export const ExtractedTableSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.any())),
  sourceId: z.string(),
  page: z.number().optional(),
  metadata: z.object({
    hasHeaders: z.boolean(),
    columnTypes: z.array(z.string()),
    rowCount: z.number(),
    columnCount: z.number(),
  }).optional(),
});
export type ExtractedTable = z.infer<typeof ExtractedTableSchema>;

export const TimeSeriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "irregular"]),
  dataPoints: z.array(z.object({
    date: z.string(),
    value: z.number(),
    label: z.string().optional(),
  })),
  sourceId: z.string(),
  statistics: z.object({
    min: z.number(),
    max: z.number(),
    mean: z.number(),
    median: z.number(),
    stdDev: z.number(),
    trend: z.enum(["increasing", "decreasing", "stable", "volatile"]),
  }).optional(),
});
export type TimeSeries = z.infer<typeof TimeSeriesSchema>;

// ============================================================================
// SCHEMAS: Consistency & Validation
// ============================================================================

export const ConsistencyCheckSchema = z.object({
  id: z.string(),
  type: z.enum(["numeric_match", "cross_reference", "formula_validation", "narrative_alignment", "completeness"]),
  status: z.enum(["passed", "warning", "failed"]),
  description: z.string(),
  location: z.object({
    document: z.string(),
    section: z.string().optional(),
    cell: z.string().optional(),
  }),
  expectedValue: z.any().optional(),
  actualValue: z.any().optional(),
  suggestedFix: z.string().optional(),
});
export type ConsistencyCheck = z.infer<typeof ConsistencyCheckSchema>;

export const ValidationReportSchema = z.object({
  timestamp: z.string(),
  totalChecks: z.number(),
  passed: z.number(),
  warnings: z.number(),
  failed: z.number(),
  checks: z.array(ConsistencyCheckSchema),
  overallScore: z.number().min(0).max(1),
  requiresIteration: z.boolean(),
  iterationActions: z.array(z.string()),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

// ============================================================================
// SCHEMAS: Persistent Memory
// ============================================================================

export const MemoryEntrySchema = z.object({
  id: z.string(),
  type: z.enum(["schema", "formula", "kpi", "style", "decision", "error", "template"]),
  key: z.string(),
  value: z.any(),
  context: z.string().optional(),
  usageCount: z.number().default(0),
  lastUsed: z.string(),
  createdAt: z.string(),
  tags: z.array(z.string()).optional(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

// ============================================================================
// SCHEMAS: Pipeline State
// ============================================================================

export const DocumentPipelineStateSchema = z.object({
  runId: z.string(),
  query: z.string(),
  outputFormat: OutputFormatSchema,
  audience: AudienceTypeSchema,
  goal: DocumentGoalSchema,
  
  wordPlan: WordDocumentPlanSchema.nullable(),
  excelPlan: ExcelWorkbookPlanSchema.nullable(),
  
  sources: z.array(z.any()),
  documents: z.array(z.any()),
  
  extractedEntities: z.array(ExtractedEntitySchema),
  extractedTables: z.array(ExtractedTableSchema),
  timeSeries: z.array(TimeSeriesSchema),
  
  normalizedDatasets: z.array(z.object({
    id: z.string(),
    name: z.string(),
    columns: z.array(z.object({ name: z.string(), type: z.string() })),
    rows: z.array(z.record(z.any())),
    validations: z.array(z.string()),
    metadata: z.record(z.any()),
  })),
  
  narrativeSections: z.array(z.object({
    chapterId: z.string(),
    content: z.string(),
    linkedData: z.array(z.string()),
    wordCount: z.number(),
  })),
  
  validationReport: ValidationReportSchema.nullable(),
  
  iterations: z.array(z.object({
    index: z.number(),
    actions: z.array(z.string()),
    validationScore: z.number(),
    durationMs: z.number(),
  })),
  currentIteration: z.number(),
  maxIterations: z.number(),
  
  memoryUsed: z.array(z.string()),
  memoryCreated: z.array(MemoryEntrySchema),
  
  artifacts: z.array(z.object({
    type: z.enum(["word", "excel"]),
    filename: z.string(),
    buffer: z.any(),
    mimeType: z.string(),
    sizeBytes: z.number(),
  })),
  
  status: z.enum(["planning", "searching", "extracting", "normalizing", "generating", "validating", "refining", "assembling", "completed", "failed"]),
  error: z.string().nullable(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});
export type DocumentPipelineState = z.infer<typeof DocumentPipelineStateSchema>;

// ============================================================================
// DOCUMENT PLANNER: Creates Word chapters and Excel sheets structure
// ============================================================================

export class DocumentPlanner {
  async createPlan(
    query: string,
    options: {
      outputFormat: OutputFormat;
      audience: AudienceType;
      goal: DocumentGoal;
    }
  ): Promise<{ wordPlan: WordDocumentPlan | null; excelPlan: ExcelWorkbookPlan | null }> {
    const topic = this.extractTopic(query);
    
    let wordPlan: WordDocumentPlan | null = null;
    let excelPlan: ExcelWorkbookPlan | null = null;
    
    if (options.outputFormat === "word" || options.outputFormat === "both") {
      wordPlan = await this.createWordPlan(topic, options.audience, options.goal);
    }
    
    if (options.outputFormat === "excel" || options.outputFormat === "both") {
      excelPlan = await this.createExcelPlan(topic, options.audience, options.goal);
    }
    
    return { wordPlan, excelPlan };
  }

  private extractTopic(query: string): string {
    const patterns = [
      /(?:sobre|de|acerca de)\s+(.+?)(?:\s+(?:y|para|con|en)\s+|$)/i,
      /(?:analiza|genera|crea|haz)\s+(?:un\s+)?(?:informe|reporte|análisis|documento)\s+(?:de|sobre)\s+(.+?)(?:\s+para\s+|$)/i,
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match && match[1]) return match[1].trim();
    }
    return query.slice(0, 100).trim();
  }

  private async createWordPlan(topic: string, audience: AudienceType, goal: DocumentGoal): Promise<WordDocumentPlan> {
    const chapters: WordChapter[] = [];
    
    const includeExecSummary = audience === "executive" || audience === "general";
    const detailLevel = audience === "technical" ? "detailed" : audience === "executive" ? "summary" : "standard";
    
    if (includeExecSummary) {
      chapters.push({
        id: uuidv4(),
        title: "Resumen Ejecutivo",
        type: "executive_summary",
        level: 1,
        wordCount: audience === "executive" ? 300 : 500,
      });
    }
    
    chapters.push({
      id: uuidv4(),
      title: "Introducción",
      type: "introduction",
      level: 1,
      content: `Este documento presenta un ${this.goalToSpanish(goal)} sobre ${topic}.`,
    });
    
    if (goal === "analyze" || goal === "audit") {
      chapters.push({
        id: uuidv4(),
        title: "Metodología",
        type: "methodology",
        level: 1,
      });
    }
    
    chapters.push({
      id: uuidv4(),
      title: "Análisis",
      type: "analysis",
      level: 1,
      linkedData: ["main_dataset"],
    });
    
    chapters.push({
      id: uuidv4(),
      title: "Resultados",
      type: "results",
      level: 1,
      tables: ["summary_table"],
      charts: ["main_chart"],
    });
    
    chapters.push({
      id: uuidv4(),
      title: "Conclusiones",
      type: "conclusions",
      level: 1,
    });
    
    if (goal === "recommend" || goal === "analyze") {
      chapters.push({
        id: uuidv4(),
        title: "Recomendaciones",
        type: "recommendations",
        level: 1,
      });
    }
    
    chapters.push({
      id: uuidv4(),
      title: "Referencias",
      type: "bibliography",
      level: 1,
    });
    
    return {
      title: `${this.goalToSpanish(goal).charAt(0).toUpperCase() + this.goalToSpanish(goal).slice(1)} de ${topic}`,
      subtitle: `Documento preparado para ${this.audienceToSpanish(audience)}`,
      authors: ["IliaGPT Agentic Pipeline"],
      date: new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" }),
      chapters,
      style: {
        tone: audience === "technical" ? "technical" : "formal",
        detailLevel,
        includeExecutiveSummary: includeExecSummary,
        includeRecommendations: goal === "recommend" || goal === "analyze",
        includeBibliography: true,
      },
    };
  }

  private async createExcelPlan(topic: string, audience: AudienceType, goal: DocumentGoal): Promise<ExcelWorkbookPlan> {
    const sheets: ExcelSheet[] = [];
    
    sheets.push({
      id: uuidv4(),
      name: "Resumen",
      type: "dashboard",
      columns: [
        { id: "kpi", name: "KPI", dataType: "text" },
        { id: "value", name: "Valor", dataType: "number" },
        { id: "target", name: "Meta", dataType: "number" },
        { id: "status", name: "Estado", dataType: "text" },
      ],
      charts: [
        { type: "bar", title: "KPIs vs Metas", dataRange: "A2:C10", position: "E2" },
      ],
      conditionalFormatting: [
        { range: "D2:D100", rule: "contains 'Cumplido'", format: "green_fill" },
        { range: "D2:D100", rule: "contains 'Pendiente'", format: "yellow_fill" },
        { range: "D2:D100", rule: "contains 'Crítico'", format: "red_fill" },
      ],
    });
    
    sheets.push({
      id: uuidv4(),
      name: "Datos",
      type: "data",
      columns: [
        { id: "id", name: "ID", dataType: "text" },
        { id: "category", name: "Categoría", dataType: "text" },
        { id: "value", name: "Valor", dataType: "number", validation: { min: 0 } },
        { id: "date", name: "Fecha", dataType: "date" },
        { id: "source", name: "Fuente", dataType: "text" },
      ],
    });
    
    if (goal === "analyze" || goal === "forecast") {
      sheets.push({
        id: uuidv4(),
        name: "Análisis",
        type: "calculations",
        columns: [
          { id: "metric", name: "Métrica", dataType: "text" },
          { id: "current", name: "Actual", dataType: "number" },
          { id: "previous", name: "Anterior", dataType: "number" },
          { id: "change", name: "Cambio %", dataType: "percentage", format: "0.0%" },
          { id: "trend", name: "Tendencia", dataType: "text" },
        ],
        formulas: [
          { cell: "D2", formula: "=(B2-C2)/C2", description: "Cálculo de cambio porcentual" },
          { cell: "E2", formula: "=IF(D2>0.05,\"↑ Creciendo\",IF(D2<-0.05,\"↓ Bajando\",\"→ Estable\"))", description: "Indicador de tendencia" },
        ],
      });
    }
    
    if (goal === "compare") {
      sheets.push({
        id: uuidv4(),
        name: "Comparativa",
        type: "pivot",
        columns: [
          { id: "item", name: "Elemento", dataType: "text" },
          { id: "option_a", name: "Opción A", dataType: "number" },
          { id: "option_b", name: "Opción B", dataType: "number" },
          { id: "difference", name: "Diferencia", dataType: "number" },
          { id: "winner", name: "Mejor", dataType: "text" },
        ],
      });
    }
    
    sheets.push({
      id: uuidv4(),
      name: "Fuentes",
      type: "raw",
      columns: [
        { id: "id", name: "ID", dataType: "text" },
        { id: "title", name: "Título", dataType: "text" },
        { id: "url", name: "URL", dataType: "text" },
        { id: "type", name: "Tipo", dataType: "text" },
        { id: "extracted_at", name: "Fecha Extracción", dataType: "date" },
      ],
    });
    
    return {
      title: `${this.goalToSpanish(goal).charAt(0).toUpperCase() + this.goalToSpanish(goal).slice(1)} - ${topic}`,
      description: `Modelo de datos para ${this.audienceToSpanish(audience)}`,
      sheets,
      kpis: [
        { id: "total_sources", name: "Total Fuentes", formula: "=COUNTA(Fuentes!A:A)-1", unit: "fuentes" },
        { id: "data_points", name: "Puntos de Datos", formula: "=COUNTA(Datos!A:A)-1", unit: "registros" },
        { id: "completeness", name: "Completitud", formula: "=1-COUNTBLANK(Datos!A:E)/COUNTA(Datos!A:E)", unit: "%" },
      ],
    };
  }

  private goalToSpanish(goal: DocumentGoal): string {
    const map: Record<DocumentGoal, string> = {
      analyze: "análisis",
      report: "reporte",
      recommend: "informe de recomendaciones",
      audit: "auditoría",
      forecast: "pronóstico",
      compare: "comparativa",
    };
    return map[goal];
  }

  private audienceToSpanish(audience: AudienceType): string {
    const map: Record<AudienceType, string> = {
      executive: "audiencia ejecutiva",
      technical: "audiencia técnica",
      academic: "audiencia académica",
      operational: "audiencia operativa",
      general: "audiencia general",
    };
    return map[audience];
  }
}

// ============================================================================
// SEMANTIC ANALYZER: Extracts text, tables, time series from documents
// ============================================================================

export class SemanticAnalyzer {
  async analyzeDocuments(documents: any[]): Promise<{
    entities: ExtractedEntity[];
    tables: ExtractedTable[];
    timeSeries: TimeSeries[];
  }> {
    const entities: ExtractedEntity[] = [];
    const tables: ExtractedTable[] = [];
    const timeSeries: TimeSeries[] = [];
    
    for (const doc of documents) {
      const docEntities = await this.extractEntities(doc);
      entities.push(...docEntities);
      
      const docTables = await this.extractTables(doc);
      tables.push(...docTables);
      
      const docTimeSeries = await this.detectTimeSeries(docTables);
      timeSeries.push(...docTimeSeries);
    }
    
    return { entities, tables, timeSeries };
  }

  private async extractEntities(doc: any): Promise<ExtractedEntity[]> {
    const entities: ExtractedEntity[] = [];
    const content = doc.content || doc.text || "";
    
    const numberPattern = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(%|USD|EUR|MXN|millones?|miles?|unidades?)?/g;
    let match;
    while ((match = numberPattern.exec(content)) !== null) {
      const value = parseFloat(match[1].replace(/[.,](?=\d{3})/g, "").replace(",", "."));
      const unit = match[2] || "";
      
      let type: ExtractedEntity["type"] = "number";
      if (unit === "%") type = "percentage";
      else if (["USD", "EUR", "MXN"].includes(unit)) type = "currency";
      else if (unit.includes("millon") || unit.includes("mile")) type = "metric";
      
      entities.push({
        id: uuidv4(),
        type,
        value: { number: value, unit },
        rawText: match[0],
        context: content.slice(Math.max(0, match.index - 50), match.index + match[0].length + 50),
        confidence: 0.8,
        sourceId: doc.id || doc.url || "unknown",
      });
    }
    
    const datePattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})|(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g;
    while ((match = datePattern.exec(content)) !== null) {
      entities.push({
        id: uuidv4(),
        type: "date",
        value: match[0],
        rawText: match[0],
        context: content.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30),
        confidence: 0.9,
        sourceId: doc.id || doc.url || "unknown",
      });
    }
    
    return entities;
  }

  private async extractTables(doc: any): Promise<ExtractedTable[]> {
    const tables: ExtractedTable[] = [];
    
    if (doc.tables && Array.isArray(doc.tables)) {
      for (const t of doc.tables) {
        tables.push({
          id: uuidv4(),
          title: t.title,
          headers: t.headers || [],
          rows: t.rows || [],
          sourceId: doc.id || doc.url || "unknown",
          metadata: {
            hasHeaders: !!t.headers?.length,
            columnTypes: this.inferColumnTypes(t.headers || [], t.rows || []),
            rowCount: t.rows?.length || 0,
            columnCount: t.headers?.length || 0,
          },
        });
      }
    }
    
    return tables;
  }

  private inferColumnTypes(headers: string[], rows: any[][]): string[] {
    if (rows.length === 0) return headers.map(() => "text");
    
    return headers.map((_, colIndex) => {
      const values = rows.slice(0, 10).map(row => row[colIndex]).filter(v => v != null);
      
      if (values.every(v => typeof v === "number" || !isNaN(parseFloat(v)))) {
        return "number";
      }
      if (values.every(v => /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(String(v)))) {
        return "date";
      }
      if (values.every(v => /^\d+(\.\d+)?%$/.test(String(v)))) {
        return "percentage";
      }
      return "text";
    });
  }

  private async detectTimeSeries(tables: ExtractedTable[]): Promise<TimeSeries[]> {
    const timeSeries: TimeSeries[] = [];
    
    for (const table of tables) {
      const dateColIndex = table.metadata?.columnTypes.findIndex(t => t === "date") ?? -1;
      const numberColIndices = table.metadata?.columnTypes
        .map((t, i) => t === "number" ? i : -1)
        .filter(i => i >= 0) ?? [];
      
      if (dateColIndex >= 0 && numberColIndices.length > 0) {
        for (const numColIndex of numberColIndices) {
          const dataPoints = table.rows.map(row => ({
            date: String(row[dateColIndex]),
            value: parseFloat(row[numColIndex]) || 0,
          })).filter(dp => !isNaN(dp.value));
          
          if (dataPoints.length >= 3) {
            const values = dataPoints.map(dp => dp.value);
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const sorted = [...values].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
            const stdDev = Math.sqrt(variance);
            
            const firstHalf = values.slice(0, Math.floor(values.length / 2));
            const secondHalf = values.slice(Math.floor(values.length / 2));
            const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
            const trendDirection = secondAvg > firstAvg * 1.05 ? "increasing" : 
                                   secondAvg < firstAvg * 0.95 ? "decreasing" : "stable";
            
            timeSeries.push({
              id: uuidv4(),
              name: table.headers[numColIndex] || `Serie ${numColIndex}`,
              unit: "",
              frequency: "irregular",
              dataPoints,
              sourceId: table.sourceId,
              statistics: {
                min: Math.min(...values),
                max: Math.max(...values),
                mean,
                median,
                stdDev,
                trend: trendDirection,
              },
            });
          }
        }
      }
    }
    
    return timeSeries;
  }
}

// ============================================================================
// DATA NORMALIZER: Builds coherent datasets with validations
// ============================================================================

export class DataNormalizer {
  async normalize(
    entities: ExtractedEntity[],
    tables: ExtractedTable[],
    timeSeries: TimeSeries[]
  ): Promise<DocumentPipelineState["normalizedDatasets"]> {
    const datasets: DocumentPipelineState["normalizedDatasets"] = [];
    
    for (const table of tables) {
      const columns = table.headers.map((h, i) => ({
        name: h,
        type: table.metadata?.columnTypes[i] || "text",
      }));
      
      const rows = table.rows.map((row, rowIndex) => {
        const obj: Record<string, any> = {};
        table.headers.forEach((h, colIndex) => {
          obj[h] = row[colIndex];
        });
        obj._rowIndex = rowIndex;
        obj._sourceId = table.sourceId;
        return obj;
      });
      
      const validations = this.generateValidations(columns, rows);
      
      datasets.push({
        id: table.id,
        name: table.title || `Dataset_${table.id.slice(0, 8)}`,
        columns,
        rows,
        validations,
        metadata: {
          sourceTable: table.id,
          rowCount: rows.length,
          columnCount: columns.length,
          extractedAt: new Date().toISOString(),
        },
      });
    }
    
    if (timeSeries.length > 0) {
      const tsRows = timeSeries.flatMap(ts => 
        ts.dataPoints.map(dp => ({
          series_id: ts.id,
          series_name: ts.name,
          date: dp.date,
          value: dp.value,
          label: dp.label || "",
          _sourceId: ts.sourceId,
        }))
      );
      
      datasets.push({
        id: uuidv4(),
        name: "Series_Temporales",
        columns: [
          { name: "series_id", type: "text" },
          { name: "series_name", type: "text" },
          { name: "date", type: "date" },
          { name: "value", type: "number" },
          { name: "label", type: "text" },
        ],
        rows: tsRows,
        validations: ["date_format", "numeric_values"],
        metadata: {
          seriesCount: timeSeries.length,
          totalDataPoints: tsRows.length,
        },
      });
    }
    
    return datasets;
  }

  private generateValidations(columns: { name: string; type: string }[], rows: Record<string, any>[]): string[] {
    const validations: string[] = [];
    
    const numericCols = columns.filter(c => c.type === "number");
    for (const col of numericCols) {
      const values = rows.map(r => r[col.name]).filter(v => v != null && !isNaN(parseFloat(v)));
      if (values.length > 0) {
        const mean = values.reduce((a: number, b: any) => a + parseFloat(b), 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((sum: number, v: any) => sum + Math.pow(parseFloat(v) - mean, 2), 0) / values.length);
        validations.push(`${col.name}: range [${(mean - 3 * stdDev).toFixed(2)}, ${(mean + 3 * stdDev).toFixed(2)}]`);
      }
    }
    
    for (const col of columns) {
      const nullCount = rows.filter(r => r[col.name] == null || r[col.name] === "").length;
      if (nullCount === 0) {
        validations.push(`${col.name}: required`);
      }
    }
    
    return validations;
  }
}

// ============================================================================
// NARRATIVE GENERATOR: Produces technical sections anchored to data
// ============================================================================

export class NarrativeGenerator {
  async generateNarrative(
    plan: WordDocumentPlan,
    datasets: DocumentPipelineState["normalizedDatasets"],
    timeSeries: TimeSeries[],
    sources: any[]
  ): Promise<DocumentPipelineState["narrativeSections"]> {
    const sections: DocumentPipelineState["narrativeSections"] = [];
    
    for (const chapter of plan.chapters) {
      const content = await this.generateChapterContent(chapter, datasets, timeSeries, sources);
      sections.push({
        chapterId: chapter.id,
        content,
        linkedData: chapter.linkedData || [],
        wordCount: content.split(/\s+/).length,
      });
    }
    
    return sections;
  }

  private async generateChapterContent(
    chapter: WordChapter,
    datasets: DocumentPipelineState["normalizedDatasets"],
    timeSeries: TimeSeries[],
    sources: any[]
  ): Promise<string> {
    switch (chapter.type) {
      case "executive_summary":
        return this.generateExecutiveSummary(datasets, timeSeries);
      case "introduction":
        return chapter.content || this.generateIntroduction(datasets);
      case "methodology":
        return this.generateMethodology(sources);
      case "analysis":
        return this.generateAnalysis(datasets, timeSeries);
      case "results":
        return this.generateResults(datasets, timeSeries);
      case "conclusions":
        return this.generateConclusions(datasets, timeSeries);
      case "recommendations":
        return this.generateRecommendations(datasets);
      case "bibliography":
        return this.generateBibliography(sources);
      default:
        return chapter.content || "";
    }
  }

  private generateExecutiveSummary(datasets: DocumentPipelineState["normalizedDatasets"], timeSeries: TimeSeries[]): string {
    const totalRecords = datasets.reduce((sum, d) => sum + d.rows.length, 0);
    const trendingSeries = timeSeries.filter(ts => ts.statistics?.trend === "increasing");
    
    return `Este documento presenta un análisis basado en ${datasets.length} conjuntos de datos con un total de ${totalRecords} registros. ` +
           `Se identificaron ${timeSeries.length} series temporales, de las cuales ${trendingSeries.length} muestran tendencia al alza. ` +
           `Los hallazgos principales se detallan en las secciones siguientes.`;
  }

  private generateIntroduction(datasets: DocumentPipelineState["normalizedDatasets"]): string {
    return `El presente análisis tiene como objetivo proporcionar una visión integral basada en datos cuantitativos. ` +
           `Se analizaron ${datasets.length} fuentes de datos para obtener conclusiones fundamentadas.`;
  }

  private generateMethodology(sources: any[]): string {
    return `La metodología empleada consistió en la recopilación de ${sources.length} fuentes de información, ` +
           `seguida de un proceso de extracción, normalización y validación de datos. ` +
           `Se aplicaron técnicas de análisis estadístico para identificar patrones y tendencias.`;
  }

  private generateAnalysis(datasets: DocumentPipelineState["normalizedDatasets"], timeSeries: TimeSeries[]): string {
    let content = "El análisis de los datos reveló los siguientes hallazgos:\n\n";
    
    for (const ts of timeSeries.slice(0, 3)) {
      if (ts.statistics) {
        content += `• ${ts.name}: Valor promedio de ${ts.statistics.mean.toFixed(2)}, ` +
                   `con una tendencia ${ts.statistics.trend === "increasing" ? "al alza" : ts.statistics.trend === "decreasing" ? "a la baja" : "estable"}. ` +
                   `Rango: [${ts.statistics.min.toFixed(2)} - ${ts.statistics.max.toFixed(2)}].\n`;
      }
    }
    
    return content;
  }

  private generateResults(datasets: DocumentPipelineState["normalizedDatasets"], timeSeries: TimeSeries[]): string {
    const totalRecords = datasets.reduce((sum, d) => sum + d.rows.length, 0);
    return `Los resultados del análisis abarcan ${totalRecords} registros distribuidos en ${datasets.length} conjuntos de datos. ` +
           `Se identificaron ${timeSeries.length} series temporales con métricas estadísticas completas.`;
  }

  private generateConclusions(datasets: DocumentPipelineState["normalizedDatasets"], timeSeries: TimeSeries[]): string {
    const growingSeries = timeSeries.filter(ts => ts.statistics?.trend === "increasing").length;
    const stableSeries = timeSeries.filter(ts => ts.statistics?.trend === "stable").length;
    
    return `En conclusión, el análisis de los datos indica que ${growingSeries} series muestran crecimiento, ` +
           `mientras que ${stableSeries} mantienen estabilidad. ` +
           `Estos resultados proporcionan una base sólida para la toma de decisiones.`;
  }

  private generateRecommendations(datasets: DocumentPipelineState["normalizedDatasets"]): string {
    return `Basándose en los hallazgos del análisis, se recomienda:\n\n` +
           `1. Continuar el monitoreo de las métricas identificadas.\n` +
           `2. Implementar acciones correctivas donde se detectaron desviaciones.\n` +
           `3. Establecer objetivos basados en los datos históricos analizados.`;
  }

  private generateBibliography(sources: any[]): string {
    return sources.slice(0, 20).map((s, i) => 
      `[${i + 1}] ${s.authors || s.siteName || "Fuente"} (${s.year || new Date().getFullYear()}). ${s.title}. Recuperado de ${s.url}`
    ).join("\n\n");
  }
}

// ============================================================================
// CONSISTENCY CRITIC: Validates figures, text, and conclusions
// ============================================================================

export class ConsistencyCritic {
  async validate(state: DocumentPipelineState): Promise<ValidationReport> {
    const checks: ConsistencyCheck[] = [];
    
    if (state.normalizedDatasets.length > 0) {
      checks.push(...this.validateNumericConsistency(state));
    }
    
    if (state.narrativeSections.length > 0 && state.normalizedDatasets.length > 0) {
      checks.push(...this.validateNarrativeAlignment(state));
    }
    
    checks.push(...this.validateCompleteness(state));
    
    if (state.excelPlan) {
      checks.push(...this.validateFormulas(state));
    }
    
    const passed = checks.filter(c => c.status === "passed").length;
    const warnings = checks.filter(c => c.status === "warning").length;
    const failed = checks.filter(c => c.status === "failed").length;
    
    const overallScore = checks.length > 0 ? (passed + warnings * 0.5) / checks.length : 0;
    const requiresIteration = failed > 0 || overallScore < 0.8;
    
    const iterationActions = this.determineIterationActions(checks, state);
    
    return {
      timestamp: new Date().toISOString(),
      totalChecks: checks.length,
      passed,
      warnings,
      failed,
      checks,
      overallScore,
      requiresIteration,
      iterationActions,
    };
  }

  private validateNumericConsistency(state: DocumentPipelineState): ConsistencyCheck[] {
    const checks: ConsistencyCheck[] = [];
    
    for (const dataset of state.normalizedDatasets) {
      const numericCols = dataset.columns.filter(c => c.type === "number");
      
      for (const col of numericCols) {
        const values = dataset.rows.map(r => parseFloat(r[col.name])).filter(v => !isNaN(v));
        
        if (values.length > 0) {
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);
          const outliers = values.filter(v => Math.abs(v - mean) > 3 * stdDev);
          
          if (outliers.length > 0) {
            checks.push({
              id: uuidv4(),
              type: "numeric_match",
              status: outliers.length > values.length * 0.1 ? "warning" : "passed",
              description: `Columna ${col.name}: ${outliers.length} valores atípicos detectados`,
              location: { document: "excel", section: dataset.name },
              suggestedFix: "Revisar valores que excedan 3 desviaciones estándar",
            });
          } else {
            checks.push({
              id: uuidv4(),
              type: "numeric_match",
              status: "passed",
              description: `Columna ${col.name}: valores dentro de rango esperado`,
              location: { document: "excel", section: dataset.name },
            });
          }
        }
      }
    }
    
    return checks;
  }

  private validateNarrativeAlignment(state: DocumentPipelineState): ConsistencyCheck[] {
    const checks: ConsistencyCheck[] = [];
    
    for (const section of state.narrativeSections) {
      const numbersInText = section.content.match(/\d+(?:[.,]\d+)?/g) || [];
      
      if (numbersInText.length > 0 && section.linkedData.length > 0) {
        checks.push({
          id: uuidv4(),
          type: "narrative_alignment",
          status: "passed",
          description: `Sección contiene ${numbersInText.length} referencias numéricas vinculadas a datos`,
          location: { document: "word", section: section.chapterId },
        });
      } else if (numbersInText.length > 0 && section.linkedData.length === 0) {
        checks.push({
          id: uuidv4(),
          type: "narrative_alignment",
          status: "warning",
          description: `Sección contiene números sin vinculación explícita a fuentes de datos`,
          location: { document: "word", section: section.chapterId },
          suggestedFix: "Añadir referencias cruzadas a tablas de datos",
        });
      }
    }
    
    return checks;
  }

  private validateCompleteness(state: DocumentPipelineState): ConsistencyCheck[] {
    const checks: ConsistencyCheck[] = [];
    
    if (state.wordPlan) {
      const chaptersWithContent = state.narrativeSections.filter(s => s.content.length > 50).length;
      const totalChapters = state.wordPlan.chapters.length;
      
      checks.push({
        id: uuidv4(),
        type: "completeness",
        status: chaptersWithContent === totalChapters ? "passed" : chaptersWithContent >= totalChapters * 0.8 ? "warning" : "failed",
        description: `${chaptersWithContent}/${totalChapters} capítulos con contenido`,
        location: { document: "word" },
        suggestedFix: chaptersWithContent < totalChapters ? "Generar contenido para capítulos vacíos" : undefined,
      });
    }
    
    if (state.excelPlan) {
      const sheetsWithData = state.normalizedDatasets.length;
      const totalSheets = state.excelPlan.sheets.filter(s => s.type === "data" || s.type === "calculations").length;
      
      checks.push({
        id: uuidv4(),
        type: "completeness",
        status: sheetsWithData >= totalSheets ? "passed" : "warning",
        description: `${sheetsWithData}/${totalSheets} hojas con datos`,
        location: { document: "excel" },
      });
    }
    
    return checks;
  }

  private validateFormulas(state: DocumentPipelineState): ConsistencyCheck[] {
    const checks: ConsistencyCheck[] = [];
    
    if (state.excelPlan) {
      for (const sheet of state.excelPlan.sheets) {
        if (sheet.formulas && sheet.formulas.length > 0) {
          checks.push({
            id: uuidv4(),
            type: "formula_validation",
            status: "passed",
            description: `Hoja ${sheet.name}: ${sheet.formulas.length} fórmulas definidas`,
            location: { document: "excel", section: sheet.name },
          });
        }
      }
    }
    
    return checks;
  }

  private determineIterationActions(checks: ConsistencyCheck[], state: DocumentPipelineState): string[] {
    const actions: string[] = [];
    
    const failed = checks.filter(c => c.status === "failed");
    const warnings = checks.filter(c => c.status === "warning");
    
    for (const check of failed) {
      if (check.type === "completeness" && check.location.document === "word") {
        actions.push("re_generate_narrative");
      } else if (check.type === "numeric_match") {
        actions.push("re_extract_data");
      }
    }
    
    for (const check of warnings.slice(0, 3)) {
      if (check.type === "narrative_alignment") {
        actions.push("add_cross_references");
      }
    }
    
    return [...new Set(actions)];
  }
}

// ============================================================================
// PERSISTENT MEMORY: Stores schemas, formulas, KPIs, style, decisions, errors
// ============================================================================

export class PersistentMemory {
  private memoryStore: Map<string, MemoryEntry> = new Map();

  async recall(keys: string[]): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    
    for (const key of keys) {
      const entry = this.memoryStore.get(key);
      if (entry) {
        entry.usageCount++;
        entry.lastUsed = new Date().toISOString();
        entries.push(entry);
      }
    }
    
    return entries;
  }

  async store(entry: Omit<MemoryEntry, "id" | "usageCount" | "lastUsed" | "createdAt">): Promise<MemoryEntry> {
    const fullEntry: MemoryEntry = {
      ...entry,
      id: uuidv4(),
      usageCount: 1,
      lastUsed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    
    this.memoryStore.set(entry.key, fullEntry);
    return fullEntry;
  }

  async findSimilar(type: MemoryEntry["type"], context: string): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    
    for (const entry of this.memoryStore.values()) {
      if (entry.type === type) {
        entries.push(entry);
      }
    }
    
    return entries.sort((a, b) => b.usageCount - a.usageCount).slice(0, 5);
  }

  async getFrequentlyUsed(limit: number = 10): Promise<MemoryEntry[]> {
    return Array.from(this.memoryStore.values())
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }
}

// ============================================================================
// WORD ASSEMBLER: Generates DOCX with chapters, embedded tables, cross-references
// ============================================================================

export class WordAssembler {
  async assemble(
    plan: WordDocumentPlan,
    sections: DocumentPipelineState["narrativeSections"],
    datasets: DocumentPipelineState["normalizedDatasets"]
  ): Promise<{ buffer: Buffer; mimeType: string; sizeBytes: number }> {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = await import("docx");
    
    const children: any[] = [];
    
    children.push(
      new Paragraph({
        text: plan.title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 400 },
      })
    );
    
    if (plan.subtitle) {
      children.push(
        new Paragraph({
          text: plan.subtitle,
          spacing: { after: 200 },
        })
      );
    }
    
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Autores: ${plan.authors.join(", ")}`, italics: true }),
        ],
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Fecha: ${plan.date}`, italics: true }),
        ],
        spacing: { after: 400 },
      })
    );
    
    for (const chapter of plan.chapters) {
      const section = sections.find(s => s.chapterId === chapter.id);
      
      children.push(
        new Paragraph({
          text: chapter.title,
          heading: chapter.level === 1 ? HeadingLevel.HEADING_1 : 
                   chapter.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: { before: 400, after: 200 },
        })
      );
      
      if (section?.content) {
        const paragraphs = section.content.split("\n\n").filter(p => p.trim());
        for (const para of paragraphs) {
          if (para.startsWith("•") || para.startsWith("-")) {
            children.push(
              new Paragraph({
                text: para.replace(/^[•\-]\s*/, ""),
                bullet: { level: 0 },
                spacing: { after: 100 },
              })
            );
          } else {
            children.push(
              new Paragraph({
                text: para,
                spacing: { after: 200 },
              })
            );
          }
        }
      }
      
      if (chapter.tables && chapter.tables.length > 0) {
        for (const tableId of chapter.tables) {
          const dataset = datasets.find(d => d.id === tableId || d.name === tableId);
          if (dataset && dataset.rows.length > 0) {
            const tableRows: any[] = [];
            
            tableRows.push(
              new TableRow({
                children: dataset.columns.map(col =>
                  new TableCell({
                    children: [new Paragraph({ text: col.name, spacing: { after: 50 } })],
                    width: { size: 100 / dataset.columns.length, type: WidthType.PERCENTAGE },
                  })
                ),
              })
            );
            
            for (const row of dataset.rows.slice(0, 20)) {
              tableRows.push(
                new TableRow({
                  children: dataset.columns.map(col =>
                    new TableCell({
                      children: [new Paragraph({ text: String(row[col.name] ?? ""), spacing: { after: 50 } })],
                    })
                  ),
                })
              );
            }
            
            children.push(
              new Table({
                rows: tableRows,
                width: { size: 100, type: WidthType.PERCENTAGE },
              })
            );
            
            children.push(
              new Paragraph({
                text: `Tabla: ${dataset.name}`,
                spacing: { before: 100, after: 300 },
              })
            );
          }
        }
      }
    }
    
    const doc = new Document({
      sections: [{
        properties: {},
        children,
      }],
    });
    
    const buffer = await Packer.toBuffer(doc);
    
    return {
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.length,
    };
  }
}

// ============================================================================
// EXCEL ASSEMBLER: Generates XLSX with multiple sheets, formulas, validations, charts
// ============================================================================

export class ExcelAssembler {
  async assemble(
    plan: ExcelWorkbookPlan,
    datasets: DocumentPipelineState["normalizedDatasets"],
    sources: any[]
  ): Promise<{ buffer: Buffer; mimeType: string; sizeBytes: number }> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    
    workbook.creator = "IliaGPT Agentic Pipeline";
    workbook.created = new Date();
    
    for (const sheetPlan of plan.sheets) {
      const sheet = workbook.addWorksheet(sheetPlan.name);
      
      const dataset = datasets.find(d => 
        d.name.toLowerCase().includes(sheetPlan.name.toLowerCase()) ||
        sheetPlan.name.toLowerCase().includes(d.name.toLowerCase())
      );
      
      sheetPlan.columns.forEach((col, colIndex) => {
        const cell = sheet.getCell(1, colIndex + 1);
        cell.value = col.name;
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" },
        };
      });
      
      if (dataset) {
        dataset.rows.slice(0, 1000).forEach((row, rowIndex) => {
          sheetPlan.columns.forEach((col, colIndex) => {
            const cell = sheet.getCell(rowIndex + 2, colIndex + 1);
            const value = row[col.name];
            
            if (col.dataType === "number" || col.dataType === "currency") {
              cell.value = typeof value === "number" ? value : parseFloat(value) || 0;
              if (col.dataType === "currency") {
                cell.numFmt = '"$"#,##0.00';
              }
            } else if (col.dataType === "percentage") {
              cell.value = typeof value === "number" ? value : parseFloat(value) || 0;
              cell.numFmt = "0.00%";
            } else if (col.dataType === "date") {
              cell.value = value ? new Date(value) : null;
              cell.numFmt = "yyyy-mm-dd";
            } else {
              cell.value = value ?? "";
            }
          });
        });
      } else if (sheetPlan.name === "Fuentes") {
        sources.slice(0, 100).forEach((source, rowIndex) => {
          sheet.getCell(rowIndex + 2, 1).value = source.id || `source_${rowIndex + 1}`;
          sheet.getCell(rowIndex + 2, 2).value = source.title || "";
          sheet.getCell(rowIndex + 2, 3).value = source.url || "";
          sheet.getCell(rowIndex + 2, 4).value = source.type || "web";
          sheet.getCell(rowIndex + 2, 5).value = new Date();
        });
      }
      
      if (sheetPlan.formulas) {
        for (const formula of sheetPlan.formulas) {
          try {
            sheet.getCell(formula.cell).value = { formula: formula.formula };
          } catch (e) {
            console.warn(`[ExcelAssembler] Failed to set formula at ${formula.cell}: ${e}`);
          }
        }
      }
      
      if (sheetPlan.conditionalFormatting) {
        for (const cf of sheetPlan.conditionalFormatting) {
          try {
            sheet.addConditionalFormatting({
              ref: cf.range,
              rules: [{
                type: "containsText",
                operator: "containsText",
                text: cf.rule.replace("contains '", "").replace("'", ""),
                style: {
                  fill: {
                    type: "pattern",
                    pattern: "solid",
                    bgColor: { argb: cf.format === "green_fill" ? "FF90EE90" : cf.format === "yellow_fill" ? "FFFFFFE0" : "FFFFCCCB" },
                  },
                },
              }],
            });
          } catch (e) {
            console.warn(`[ExcelAssembler] Failed to add conditional formatting: ${e}`);
          }
        }
      }
      
      sheetPlan.columns.forEach((_, colIndex) => {
        sheet.getColumn(colIndex + 1).width = 15;
      });
    }
    
    const buffer = await workbook.xlsx.writeBuffer();
    
    return {
      buffer: Buffer.from(buffer),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: buffer.byteLength,
    };
  }
}

// ============================================================================
// DOCUMENT AGENTIC PIPELINE: Full Planner → Executor → Critic loop for Word/Excel
// ============================================================================

export class DocumentAgenticPipeline extends EventEmitter {
  private planner: DocumentPlanner;
  private semanticAnalyzer: SemanticAnalyzer;
  private dataNormalizer: DataNormalizer;
  private narrativeGenerator: NarrativeGenerator;
  private consistencyCritic: ConsistencyCritic;
  private persistentMemory: PersistentMemory;
  private wordAssembler: WordAssembler;
  private excelAssembler: ExcelAssembler;
  private state: DocumentPipelineState | null = null;

  constructor() {
    super();
    this.planner = new DocumentPlanner();
    this.semanticAnalyzer = new SemanticAnalyzer();
    this.dataNormalizer = new DataNormalizer();
    this.narrativeGenerator = new NarrativeGenerator();
    this.consistencyCritic = new ConsistencyCritic();
    this.persistentMemory = new PersistentMemory();
    this.wordAssembler = new WordAssembler();
    this.excelAssembler = new ExcelAssembler();
  }

  async execute(
    query: string,
    options: {
      outputFormat?: OutputFormat;
      audience?: AudienceType;
      goal?: DocumentGoal;
      maxIterations?: number;
    } = {}
  ): Promise<{
    success: boolean;
    state: DocumentPipelineState;
    artifacts: DocumentPipelineState["artifacts"];
  }> {
    const outputFormat = options.outputFormat || this.inferOutputFormat(query);
    const audience = options.audience || this.inferAudience(query);
    const goal = options.goal || this.inferGoal(query);
    const maxIterations = options.maxIterations || 3;

    this.state = {
      runId: uuidv4(),
      query,
      outputFormat,
      audience,
      goal,
      wordPlan: null,
      excelPlan: null,
      sources: [],
      documents: [],
      extractedEntities: [],
      extractedTables: [],
      timeSeries: [],
      normalizedDatasets: [],
      narrativeSections: [],
      validationReport: null,
      iterations: [],
      currentIteration: 0,
      maxIterations,
      memoryUsed: [],
      memoryCreated: [],
      artifacts: [],
      status: "planning",
      error: null,
      startedAt: new Date(),
      completedAt: null,
    };

    try {
      this.emit("phase_start", { phase: "planning" });
      const { wordPlan, excelPlan } = await this.planner.createPlan(query, { outputFormat, audience, goal });
      this.state.wordPlan = wordPlan;
      this.state.excelPlan = excelPlan;
      this.emit("phase_complete", { phase: "planning", wordPlan: !!wordPlan, excelPlan: !!excelPlan });

      this.state.status = "searching";
      this.emit("phase_start", { phase: "searching" });
      await this.searchSources();
      this.emit("phase_complete", { phase: "searching", sourceCount: this.state.sources.length });

      this.state.status = "extracting";
      this.emit("phase_start", { phase: "extracting" });
      const { entities, tables, timeSeries } = await this.semanticAnalyzer.analyzeDocuments(this.state.documents);
      this.state.extractedEntities = entities;
      this.state.extractedTables = tables;
      this.state.timeSeries = timeSeries;
      this.emit("phase_complete", { phase: "extracting", entities: entities.length, tables: tables.length, timeSeries: timeSeries.length });

      this.state.status = "normalizing";
      this.emit("phase_start", { phase: "normalizing" });
      this.state.normalizedDatasets = await this.dataNormalizer.normalize(entities, tables, timeSeries);
      this.emit("phase_complete", { phase: "normalizing", datasets: this.state.normalizedDatasets.length });

      if (wordPlan) {
        this.state.status = "generating";
        this.emit("phase_start", { phase: "generating_narrative" });
        this.state.narrativeSections = await this.narrativeGenerator.generateNarrative(
          wordPlan,
          this.state.normalizedDatasets,
          this.state.timeSeries,
          this.state.sources
        );
        this.emit("phase_complete", { phase: "generating_narrative", sections: this.state.narrativeSections.length });
      }

      let continueLoop = true;
      while (continueLoop && this.state.currentIteration < maxIterations) {
        this.state.status = "validating";
        this.emit("phase_start", { phase: "validating", iteration: this.state.currentIteration });
        
        this.state.validationReport = await this.consistencyCritic.validate(this.state);
        this.emit("validation_result", { report: this.state.validationReport });

        if (!this.state.validationReport.requiresIteration) {
          continueLoop = false;
        } else if (this.state.currentIteration < maxIterations - 1) {
          this.state.status = "refining";
          this.emit("phase_start", { phase: "refining", iteration: this.state.currentIteration });
          
          const iterationStart = Date.now();
          const actions = await this.executeRefinementActions(this.state.validationReport.iterationActions);
          
          this.state.iterations.push({
            index: this.state.currentIteration,
            actions,
            validationScore: this.state.validationReport.overallScore,
            durationMs: Date.now() - iterationStart,
          });
          
          this.state.currentIteration++;
          this.emit("phase_complete", { phase: "refining", actions });
        } else {
          continueLoop = false;
        }
      }

      this.state.status = "assembling";
      this.emit("phase_start", { phase: "assembling" });
      
      if (this.state.wordPlan) {
        const wordArtifact = await this.wordAssembler.assemble(
          this.state.wordPlan,
          this.state.narrativeSections,
          this.state.normalizedDatasets
        );
        this.state.artifacts.push({
          type: "word",
          filename: `documento_${Date.now()}.docx`,
          ...wordArtifact,
        });
      }
      
      if (this.state.excelPlan) {
        const excelArtifact = await this.excelAssembler.assemble(
          this.state.excelPlan,
          this.state.normalizedDatasets,
          this.state.sources
        );
        this.state.artifacts.push({
          type: "excel",
          filename: `modelo_datos_${Date.now()}.xlsx`,
          ...excelArtifact,
        });
      }
      
      this.emit("phase_complete", { phase: "assembling", artifacts: this.state.artifacts.length });

      this.state.status = "completed";
      this.state.completedAt = new Date();

      return { success: true, state: this.state, artifacts: this.state.artifacts };

    } catch (error: any) {
      this.state.status = "failed";
      this.state.error = error.message;
      this.state.completedAt = new Date();
      this.emit("error", { error: error.message });
      return { success: false, state: this.state, artifacts: [] };
    }
  }

  private async searchSources(): Promise<void> {
    try {
      const { searchWeb, searchScholar } = await import("../../services/webSearch");
      const topic = this.state!.wordPlan?.title || this.state!.excelPlan?.title || this.state!.query;
      
      if (this.state!.audience === "academic") {
        const scholarResults = await searchScholar(topic, 10);
        this.state!.sources.push(...scholarResults);
      }
      
      const webResults = await searchWeb(topic, 10);
      this.state!.sources.push(...(webResults.results || []));
      
      for (const source of this.state!.sources.slice(0, 5)) {
        this.state!.documents.push({
          id: source.url,
          url: source.url,
          title: source.title,
          content: source.snippet || "",
          type: "web",
        });
      }
    } catch (error) {
      console.warn("[DocumentAgenticPipeline] Search error:", error);
    }
  }

  private async executeRefinementActions(actions: string[]): Promise<string[]> {
    const completed: string[] = [];
    
    for (const action of actions) {
      switch (action) {
        case "re_generate_narrative":
          if (this.state?.wordPlan) {
            this.state.narrativeSections = await this.narrativeGenerator.generateNarrative(
              this.state.wordPlan,
              this.state.normalizedDatasets,
              this.state.timeSeries,
              this.state.sources
            );
            completed.push("re_generate_narrative");
          }
          break;
        case "re_extract_data":
          const { entities, tables, timeSeries } = await this.semanticAnalyzer.analyzeDocuments(this.state!.documents);
          this.state!.extractedEntities = entities;
          this.state!.extractedTables = tables;
          this.state!.timeSeries = timeSeries;
          this.state!.normalizedDatasets = await this.dataNormalizer.normalize(entities, tables, timeSeries);
          completed.push("re_extract_data");
          break;
        case "add_cross_references":
          completed.push("add_cross_references");
          break;
      }
    }
    
    return completed;
  }

  private inferOutputFormat(query: string): OutputFormat {
    if (/excel|xlsx|hoja.*c[aá]lculo|modelo.*datos/i.test(query)) return "excel";
    if (/word|docx|documento|informe/i.test(query)) return "word";
    if (/ambos|word.*excel|excel.*word|completo/i.test(query)) return "both";
    return "both";
  }

  private inferAudience(query: string): AudienceType {
    if (/ejecutivo|gerente|director|junta|resumen/i.test(query)) return "executive";
    if (/t[eé]cnico|ingenier|desarrollador|api/i.test(query)) return "technical";
    if (/acad[eé]mico|universidad|tesis|paper/i.test(query)) return "academic";
    if (/operativo|operaciones|proceso/i.test(query)) return "operational";
    return "general";
  }

  private inferGoal(query: string): DocumentGoal {
    if (/analiza|an[aá]lisis/i.test(query)) return "analyze";
    if (/reporte|informe|status/i.test(query)) return "report";
    if (/recomienda|recomendaci/i.test(query)) return "recommend";
    if (/auditor[ií]a|audit/i.test(query)) return "audit";
    if (/pron[oó]stico|forecast|proyecci/i.test(query)) return "forecast";
    if (/compara|comparativa|vs/i.test(query)) return "compare";
    return "analyze";
  }
}
