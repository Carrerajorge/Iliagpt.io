import { z } from "zod";

export const SheetStatusSchema = z.object({
  sheetName: z.string(),
  status: z.enum(["queued", "running", "done", "failed"]),
  error: z.string().optional(),
});

export const MetricSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const PreviewMetaSchema = z.object({
  totalRows: z.number(),
  totalCols: z.number(),
  truncated: z.boolean(),
});

export const PreviewSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.any())),
  meta: PreviewMetaSchema.optional(),
});

export const SheetResultSchema = z.object({
  sheetName: z.string(),
  generatedCode: z.string().optional(),
  summary: z.string().optional(),
  metrics: z.array(MetricSchema).optional(),
  preview: PreviewSchema.optional(),
  error: z.string().optional(),
});

export const ProgressSchema = z.object({
  currentSheet: z.number(),
  totalSheets: z.number(),
  sheets: z.array(SheetStatusSchema),
});

export const ResultsSchema = z.object({
  crossSheetSummary: z.string().optional(),
  sheets: z.array(SheetResultSchema),
});

export const AnalysisResponseSchema = z.object({
  analysisId: z.string(),
  status: z.enum(["pending", "analyzing", "completed", "failed"]),
  progress: ProgressSchema,
  results: ResultsSchema.optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export const AnalyzeStartResponseSchema = z.object({
  analysisId: z.string(),
  sessionId: z.string(),
  status: z.literal("analyzing"),
});

export type SheetStatus = z.infer<typeof SheetStatusSchema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Preview = z.infer<typeof PreviewSchema>;
export type SheetResult = z.infer<typeof SheetResultSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type Results = z.infer<typeof ResultsSchema>;
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;
export type AnalyzeStartResponse = z.infer<typeof AnalyzeStartResponseSchema>;

export function validateAnalysisResponse(data: unknown): AnalysisResponse {
  const result = AnalysisResponseSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid analysis response shape: ${errors}`);
  }
  return result.data;
}

export function validateAnalyzeStartResponse(data: unknown): AnalyzeStartResponse {
  const result = AnalyzeStartResponseSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid analyze start response shape: ${errors}`);
  }
  return result.data;
}
