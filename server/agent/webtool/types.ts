import { z } from "zod";

export const QualityScoreSchema = z.object({
  domain: z.number().min(0).max(100),
  recency: z.number().min(0).max(100),
  https: z.number().min(0).max(100),
  authoritativeness: z.number().min(0).max(100),
  contentLength: z.number().min(0).max(100),
  total: z.number().min(0).max(500),
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const ContentHashSchema = z.string().length(64);
export type ContentHash = z.infer<typeof ContentHashSchema>;

export const CanonicalUrlSchema = z.string().url();
export type CanonicalUrl = z.infer<typeof CanonicalUrlSchema>;

export const WebSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(20).default(5),
  includeScholar: z.boolean().default(false),
  locale: z.string().optional(),
});
export type WebSearchRequest = z.infer<typeof WebSearchRequestSchema>;

export const WebSearchResultSchema = z.object({
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  title: z.string(),
  snippet: z.string(),
  authors: z.string().optional(),
  year: z.string().optional(),
  citation: z.string().optional(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export const FetchOptionsSchema = z.object({
  timeout: z.number().int().positive().default(30000),
  retries: z.number().int().min(0).max(5).default(3),
  respectRobotsTxt: z.boolean().default(true),
  followRedirects: z.boolean().default(true),
  maxRedirects: z.number().int().min(0).max(10).default(5),
  headers: z.record(z.string()).optional(),
});
export type FetchOptions = z.infer<typeof FetchOptionsSchema>;

export const FetchRequestSchema = z.object({
  url: z.string().url(),
  options: FetchOptionsSchema.optional(),
});
export type FetchRequest = z.infer<typeof FetchRequestSchema>;

export const FetchResultSchema = z.object({
  success: z.boolean(),
  url: z.string().url(),
  finalUrl: z.string().url(),
  status: z.number().int(),
  statusText: z.string(),
  headers: z.record(z.string()),
  content: z.string().optional(),
  contentType: z.string().optional(),
  contentLength: z.number().int().nonnegative(),
  timing: z.object({
    startMs: z.number(),
    endMs: z.number(),
    durationMs: z.number(),
  }),
  retryCount: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type FetchResult = z.infer<typeof FetchResultSchema>;

export const WaitStrategySchema = z.enum(["networkidle", "domcontentloaded", "load", "commit"]);
export type WaitStrategy = z.infer<typeof WaitStrategySchema>;

export const ScrollPaginationOptionsSchema = z.object({
  enabled: z.boolean().default(false),
  maxScrolls: z.number().int().min(1).max(50).default(10),
  scrollDelayMs: z.number().int().min(100).max(5000).default(500),
  scrollDirection: z.enum(["down", "up", "both"]).default("down"),
});
export type ScrollPaginationOptions = z.infer<typeof ScrollPaginationOptionsSchema>;

export const BrowseOptionsSchema = z.object({
  timeout: z.number().int().positive().default(30000),
  takeScreenshot: z.boolean().default(false),
  waitForNetworkIdle: z.boolean().default(true),
  waitStrategy: WaitStrategySchema.default("networkidle"),
  waitForSelector: z.string().optional(),
  extractContent: z.boolean().default(true),
  scrollPagination: ScrollPaginationOptionsSchema.optional(),
  viewport: z.object({
    width: z.number().int().positive().default(1920),
    height: z.number().int().positive().default(1080),
  }).optional(),
});
export type BrowseOptions = z.infer<typeof BrowseOptionsSchema>;

export const BrowseRequestSchema = z.object({
  url: z.string().url(),
  options: BrowseOptionsSchema.optional(),
});
export type BrowseRequest = z.infer<typeof BrowseRequestSchema>;

export const BrowseResultSchema = z.object({
  success: z.boolean(),
  url: z.string().url(),
  finalUrl: z.string().url(),
  title: z.string(),
  content: z.string().optional(),
  html: z.string().optional(),
  screenshot: z.instanceof(Buffer).optional(),
  timing: z.object({
    navigationMs: z.number(),
    renderMs: z.number(),
    totalMs: z.number(),
  }),
  error: z.string().optional(),
});
export type BrowseResult = z.infer<typeof BrowseResultSchema>;

export const RetrievalRequestSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(20).default(5),
  includeScholar: z.boolean().default(false),
  preferBrowser: z.boolean().default(false),
  allowBrowser: z.boolean().default(true),
  extractReadable: z.boolean().default(true),
  deduplicateByContent: z.boolean().default(true),
  minQualityScore: z.number().min(0).max(500).default(0),
  allowedDomains: z.array(z.string()).optional(),
  blockedDomains: z.array(z.string()).optional(),
  correlationId: z.string().uuid().optional(),
});
export type RetrievalRequest = z.infer<typeof RetrievalRequestSchema>;

export const RetrievalResultSchema = z.object({
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  title: z.string(),
  snippet: z.string(),
  content: z.string(),
  contentHash: ContentHashSchema,
  qualityScore: QualityScoreSchema,
  fetchMethod: z.enum(["fetch", "browser"]),
  timing: z.object({
    searchMs: z.number().optional(),
    fetchMs: z.number(),
    extractMs: z.number().optional(),
    totalMs: z.number(),
  }),
  metadata: z.object({
    contentType: z.string().optional(),
    lastModified: z.string().optional(),
    contentLength: z.number().optional(),
    authors: z.string().optional(),
    year: z.string().optional(),
  }).optional(),
});
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;

export const RetrievalPipelineResultSchema = z.object({
  success: z.boolean(),
  query: z.string(),
  results: z.array(RetrievalResultSchema),
  totalFound: z.number().int().nonnegative(),
  totalProcessed: z.number().int().nonnegative(),
  totalDeduped: z.number().int().nonnegative(),
  timing: z.object({
    totalMs: z.number(),
    searchMs: z.number(),
    fetchMs: z.number(),
    processMs: z.number(),
  }),
  errors: z.array(z.object({
    url: z.string(),
    error: z.string(),
    stage: z.enum(["search", "fetch", "browse", "extract", "score"]),
  })).default([]),
});
export type RetrievalPipelineResult = z.infer<typeof RetrievalPipelineResultSchema>;

export const HeadingSchema = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string(),
});
export type Heading = z.infer<typeof HeadingSchema>;

export const ExtractedLinkSchema = z.object({
  href: z.string(),
  text: z.string(),
  isExternal: z.boolean(),
});
export type ExtractedLink = z.infer<typeof ExtractedLinkSchema>;

export const ExtractedDocumentSchema = z.object({
  title: z.string(),
  content: z.string(),
  headings: z.array(HeadingSchema),
  links: z.array(ExtractedLinkSchema),
  wordCount: z.number().int().nonnegative(),
  readTimeMinutes: z.number().nonnegative(),
  language: z.string().optional(),
  hasAuthor: z.boolean().default(false),
  hasCitations: z.boolean().default(false),
  hasReferences: z.boolean().default(false),
});
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

export const QualityWeightsSchema = z.object({
  domain: z.number().min(0).max(2).default(1),
  recency: z.number().min(0).max(2).default(1),
  https: z.number().min(0).max(2).default(1),
  authoritativeness: z.number().min(0).max(2).default(1),
  contentLength: z.number().min(0).max(2).default(1),
});
export type QualityWeights = z.infer<typeof QualityWeightsSchema>;

export const ContentMetadataSchema = z.object({
  publishedDate: z.string().optional(),
  modifiedDate: z.string().optional(),
  author: z.string().optional(),
  hasCitations: z.boolean().optional(),
  hasReferences: z.boolean().optional(),
  dateFromContent: z.string().optional(),
});
export type ContentMetadata = z.infer<typeof ContentMetadataSchema>;
