import { z } from "zod";

export const MissingCapabilitySchema = z.object({
  id: z.string().min(1),
  keywords: z.array(z.string()),
  toolNameAttempted: z.string().optional(),
  userMessage: z.string(),
  confidence: z.number().min(0).max(1),
});
export type MissingCapability = z.infer<typeof MissingCapabilitySchema>;

export const RepoSourceSchema = z.object({
  name: z.string().min(1),
  git: z.string().url(),
  extractPaths: z.array(z.string()),
  language: z.enum(["typescript", "javascript", "python"]),
  entryPoint: z.string().optional(),
  nativeBindings: z.boolean().optional().default(false),
});
export type RepoSource = z.infer<typeof RepoSourceSchema>;

export const CatalogEntrySchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()),
  repos: z.array(RepoSourceSchema).min(1),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogSchema = z.object({
  version: z.string().default("1.0.0"),
  capabilities: z.array(CatalogEntrySchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export const ExportedSymbolSchema = z.object({
  name: z.string(),
  kind: z.enum(["function", "class", "constant"]),
  signature: z.string(),
  sourceFile: z.string(),
  lineStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().nonnegative(),
  body: z.string(),
});
export type ExportedSymbol = z.infer<typeof ExportedSymbolSchema>;

export const AnalysisResultSchema = z.object({
  entryExports: z.array(ExportedSymbolSchema),
  dependencies: z.array(z.string()),
  hasNativeBindings: z.boolean(),
  totalLines: z.number().int().nonnegative(),
  language: z.enum(["typescript", "javascript", "python"]),
  suggestedPortStrategy: z.enum([
    "direct-copy",
    "transpile-js",
    "port-python",
    "native-binding",
  ]),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const FusedManifestSchema = z.object({
  capabilityId: z.string(),
  sourceName: z.string(),
  sourceGit: z.string(),
  sourceCommitSha: z.string(),
  extractedFiles: z.array(z.string()),
  portStrategy: z.string(),
  fusedAt: z.string(),
  registeredTools: z.array(z.string()),
  totalPortedLines: z.number().int().nonnegative(),
});
export type FusedManifest = z.infer<typeof FusedManifestSchema>;

export const SELF_EXPAND_LIMITS = {
  MAX_CLONE_SIZE_MB: 50,
  MAX_FILES_TO_ANALYZE: 50,
  MAX_LINES_PER_FILE: 2000,
  MAX_TOTAL_PORTED_LINES: 5000,
  CLONE_TIMEOUT_MS: 30_000,
  ANALYSIS_TIMEOUT_MS: 10_000,
  FUSION_TIMEOUT_MS: 10_000,
  TOTAL_TIMEOUT_MS: 60_000,
  TEMP_DIR: "/tmp/selfexpand",
} as const;
