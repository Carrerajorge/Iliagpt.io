import { z } from "zod";

export const SourceReferenceSchema = z.object({
  id: z.string(),
  type: z.enum(["sheet", "page", "section", "range"]),
  location: z.string(),
  sheetName: z.string().optional(),
  pageNumber: z.number().optional(),
  range: z.string().optional(),
  previewText: z.string().optional(),
});

export const TableCellSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  type: z.enum(["text", "number", "date", "boolean", "formula", "empty"]),
  formula: z.string().optional(),
  format: z.string().optional(),
});

export const TableSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  sourceRef: z.string(),
  sheetName: z.string().optional(),
  pageNumber: z.number().optional(),
  range: z.string().optional(),
  headers: z.array(z.string()),
  columnTypes: z.array(z.enum(["text", "number", "date", "boolean", "mixed"])),
  rows: z.array(z.array(TableCellSchema)),
  rowCount: z.number(),
  columnCount: z.number(),
  previewRows: z.array(z.array(TableCellSchema)).optional(),
  stats: z.object({
    nullCount: z.record(z.string(), z.number()).optional(),
    duplicateCount: z.number().optional(),
    numericStats: z.record(z.string(), z.object({
      min: z.number().optional(),
      max: z.number().optional(),
      avg: z.number().optional(),
      sum: z.number().optional(),
      median: z.number().optional(),
    })).optional(),
  }).optional(),
});

export const MetricSchema = z.object({
  id: z.string(),
  name: z.string(),
  value: z.union([z.string(), z.number()]),
  type: z.enum(["kpi", "total", "average", "count", "percentage", "trend"]),
  sourceRef: z.string(),
  trend: z.enum(["up", "down", "stable"]).optional(),
  change: z.number().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

export const AnomalySchema = z.object({
  id: z.string(),
  type: z.enum(["outlier", "null", "duplicate", "inconsistent", "error", "warning"]),
  severity: z.enum(["low", "medium", "high"]),
  description: z.string(),
  sourceRef: z.string(),
  affectedRows: z.array(z.number()).optional(),
  affectedColumns: z.array(z.string()).optional(),
  suggestedAction: z.string().optional(),
});

export const SectionSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(["heading", "paragraph", "list", "table", "image", "code", "quote", "metadata"]),
    level: z.number().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    sourceRef: z.string(),
    children: z.array(SectionSchema).optional(),
    style: z.string().optional(),
    listItems: z.array(z.string()).optional(),
    tableRef: z.string().optional(),
  })
);


export const SheetSummarySchema = z.object({
  name: z.string(),
  index: z.number(),
  rowCount: z.number(),
  columnCount: z.number(),
  usedRange: z.string(),
  headers: z.array(z.string()),
  tables: z.array(z.string()),
  metrics: z.array(z.string()),
  anomalies: z.array(z.string()),
  summary: z.string().optional(),
  topValues: z.record(z.string(), z.array(z.object({
    value: z.union([z.string(), z.number()]),
    count: z.number().optional(),
  }))).optional(),
  bottomValues: z.record(z.string(), z.array(z.object({
    value: z.union([z.string(), z.number()]),
    count: z.number().optional(),
  }))).optional(),
});

export const SuggestedQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  category: z.enum(["analysis", "clarification", "action", "deep-dive"]),
  relatedSources: z.array(z.string()),
});

export const InsightSchema = z.object({
  id: z.string(),
  type: z.enum(["finding", "risk", "opportunity", "recommendation", "summary"]),
  title: z.string(),
  description: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  sourceRefs: z.array(z.string()),
  priority: z.enum(["low", "medium", "high"]).optional(),
  actionable: z.boolean().optional(),
});

export const ExtractionDiagnosticsSchema = z.object({
  extractedAt: z.string(),
  durationMs: z.number(),
  parserUsed: z.string(),
  mimeTypeDetected: z.string(),
  mimeTypeDeclared: z.string().optional(),
  ocrApplied: z.boolean().optional(),
  ocrConfidence: z.number().optional(),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  bytesProcessed: z.number().optional(),
  chunksGenerated: z.number().optional(),
});

export const DocumentMetaSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  documentType: z.enum(["excel", "csv", "word", "pdf", "text", "unknown"]),
  createdAt: z.string().optional(),
  modifiedAt: z.string().optional(),
  author: z.string().optional(),
  title: z.string().optional(),
  pageCount: z.number().optional(),
  sheetCount: z.number().optional(),
  wordCount: z.number().optional(),
  language: z.string().optional(),
});

export const DocumentSemanticModelSchema = z.object({
  version: z.literal("1.0"),
  documentMeta: DocumentMetaSchema,
  sections: z.array(SectionSchema),
  tables: z.array(TableSchema),
  metrics: z.array(MetricSchema),
  anomalies: z.array(AnomalySchema),
  insights: z.array(InsightSchema),
  sources: z.array(SourceReferenceSchema),
  sheets: z.array(SheetSummarySchema).optional(),
  suggestedQuestions: z.array(SuggestedQuestionSchema),
  extractionDiagnostics: ExtractionDiagnosticsSchema,
  llmSummary: z.object({
    executive: z.string(),
    detailed: z.string().optional(),
    keyFindings: z.array(z.string()),
    risks: z.array(z.string()),
    recommendations: z.array(z.string()),
    citationsUsed: z.array(z.string()),
  }).optional(),
});

export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export type TableCell = z.infer<typeof TableCellSchema>;
export type Table = z.infer<typeof TableSchema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Anomaly = z.infer<typeof AnomalySchema>;
export type Section = z.infer<typeof SectionSchema>;
export type SheetSummary = z.infer<typeof SheetSummarySchema>;
export type SuggestedQuestion = z.infer<typeof SuggestedQuestionSchema>;
export type Insight = z.infer<typeof InsightSchema>;
export type ExtractionDiagnostics = z.infer<typeof ExtractionDiagnosticsSchema>;
export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;
export type DocumentSemanticModel = z.infer<typeof DocumentSemanticModelSchema>;
