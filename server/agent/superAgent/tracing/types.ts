import { z } from "zod";

export const TraceEventSchema = z.object({
  schema_version: z.literal("v1"),
  run_id: z.string(),
  seq: z.number(),
  trace_id: z.string(),
  span_id: z.string(),
  parent_span_id: z.string().nullable(),
  node_id: z.string(),
  attempt_id: z.number().default(1),
  agent: z.string(),
  event_type: z.enum([
    "run_started",
    "run_completed",
    "run_failed",
    "phase_started",
    "phase_completed",
    "phase_failed",
    "tool_start",
    "tool_progress",
    "tool_stdout_chunk",
    "tool_end",
    "tool_error",
    "checkpoint",
    "contract_violation",
    "heartbeat",
    "retry_scheduled",
    "fallback_activated",
    "source_collected",
    "source_verified",
    "source_rejected",
    "artifact_created",
    "progress_update",
    "search_progress",
    "filter_progress",
    "verify_progress",
    "accepted_progress",
    "export_progress",
    "thought",
  ]),
  phase: z.enum([
    "planning",
    "signals",
    "verification",
    "enrichment",
    "export",
    "finalization",
    "idle",
  ]).optional(),
  message: z.string(),
  status: z.enum(["pending", "running", "success", "failed", "skipped"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  metrics: z.object({
    latency_ms: z.number().optional(),
    tokens: z.number().optional(),
    cost: z.number().optional(),
    http_status: z.number().optional(),
    bytes_in: z.number().optional(),
    bytes_out: z.number().optional(),
    articles_collected: z.number().optional(),
    articles_verified: z.number().optional(),
    articles_accepted: z.number().optional(),
    queries_current: z.number().optional(),
    queries_total: z.number().optional(),
    pages_searched: z.number().optional(),
    candidates_found: z.number().optional(),
  }).optional(),
  evidence: z.object({
    doi: z.string().optional(),
    doi_url: z.string().optional(),
    final_url: z.string().optional(),
    title_similarity: z.number().optional(),
    relevance_score: z.number().optional(),
    fail_reason: z.string().optional(),
    error_code: z.string().optional(),
    stacktrace_redacted: z.string().optional(),
    missing_fields: z.array(z.string()).optional(),
  }).optional(),
  data: z.record(z.any()).optional(),
  ts: z.number(),
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;

export interface RunState {
  run_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  progress: number;
  started_at: number;
  completed_at?: number;
  error?: string;
  metrics: {
    total_collected: number;
    total_verified: number;
    total_accepted: number;
    total_rejected: number;
  };
  artifacts: Array<{
    id: string;
    type: string;
    name: string;
    url: string;
  }>;
}

export interface SpanNode {
  span_id: string;
  parent_span_id: string | null;
  node_id: string;
  agent: string;
  status: "pending" | "running" | "success" | "failed";
  started_at: number;
  ended_at?: number;
  latency_ms?: number;
  children: SpanNode[];
  events: TraceEvent[];
}

export interface ProgressWeights {
  collection: number;
  verification: number;
  export: number;
}

export const DEFAULT_PROGRESS_WEIGHTS: ProgressWeights = {
  collection: 0.4,
  verification: 0.4,
  export: 0.2,
};

export interface ContractRequirements {
  min_articles: number;
  required_fields: string[];
  year_range: { start: number; end: number };
  must_have_doi: boolean;
  must_have_access_url: boolean;
}

export const DEFAULT_CONTRACT: ContractRequirements = {
  min_articles: 50,
  required_fields: [
    "Authors",
    "Title",
    "Year",
    "Journal",
    "Abstract",
    "Keywords",
    "Language",
    "Document Type",
    "DOI",
    "City of publication",
    "Country of study",
    "Scopus",
    "WOS",
    "Access_URL",
    "Source",
  ],
  year_range: { start: new Date().getFullYear() - 5, end: new Date().getFullYear() },
  must_have_doi: true,
  must_have_access_url: true,
};
