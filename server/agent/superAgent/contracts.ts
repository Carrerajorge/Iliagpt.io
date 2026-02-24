import { z } from "zod";

export const IntentTypeSchema = z.enum([
  "answer",
  "research",
  "create_docx",
  "create_xlsx",
  "create_pptx",
  "mixed"
]);

export type IntentType = z.infer<typeof IntentTypeSchema>;

export const RequirementsSchema = z.object({
  min_sources: z.number().int().min(0).default(0),
  must_create: z.array(z.enum(["docx", "xlsx", "pptx"])).default([]),
  language: z.string().default("es"),
  verify_facts: z.boolean().default(false),
  include_citations: z.boolean().default(true),
  max_depth: z.number().int().min(1).max(5).default(3),
});

export type Requirements = z.infer<typeof RequirementsSchema>;

export const PlanStepSchema = z.object({
  id: z.string(),
  action: z.string(),
  tool: z.string().optional(),
  input: z.record(z.unknown()).optional(),
  depends_on: z.array(z.string()).default([]),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]).default("pending"),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  tool: z.string(),
  input: z.record(z.unknown()),
  phase: z.enum(["signals", "deep", "create", "verify"]).optional(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

export const AcceptanceCheckSchema = z.object({
  id: z.string(),
  condition: z.string(),
  threshold: z.number().optional(),
  required: z.boolean().default(true),
  passed: z.boolean().optional(),
  reason: z.string().optional(),
});

export type AcceptanceCheck = z.infer<typeof AcceptanceCheckSchema>;

export const AgentContractSchema = z.object({
  contract_id: z.string(),
  timestamp: z.number(),
  intent: IntentTypeSchema,
  requirements: RequirementsSchema,
  plan: z.array(PlanStepSchema),
  tool_calls: z.array(ToolCallSchema),
  acceptance_checks: z.array(AcceptanceCheckSchema),
  original_prompt: z.string(),
  parsed_entities: z.array(z.string()).default([]),
  language_detected: z.string().default("es"),
});

export type AgentContract = z.infer<typeof AgentContractSchema>;

export const SourceSignalSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  snippet: z.string(),
  domain: z.string(),
  score: z.number().min(0).max(1),
  fetched: z.boolean().default(false),
  content: z.string().optional(),
  claims: z.array(z.string()).optional(),
  verified: z.boolean().optional(),
  scopusData: z.record(z.unknown()).optional(),
});

export type SourceSignal = z.infer<typeof SourceSignalSchema>;

export const ExecutionStateSchema = z.object({
  contract: AgentContractSchema,
  phase: z.enum(["planning", "signals", "deep", "creating", "verifying", "finalizing", "completed", "error"]),
  sources: z.array(SourceSignalSchema).default([]),
  sources_count: z.number().default(0),
  deep_sources: z.array(SourceSignalSchema).default([]),
  artifacts: z.array(z.object({
    id: z.string(),
    type: z.enum(["docx", "xlsx", "pptx"]),
    name: z.string(),
    download_url: z.string().optional(),
    path: z.string().optional(),
    size: z.number().optional(),
    created_at: z.number().optional(),
  })).default([]),
  tool_results: z.array(z.object({
    tool_call_id: z.string(),
    success: z.boolean(),
    output: z.unknown(),
    error: z.string().optional(),
  })).default([]),
  iteration: z.number().default(0),
  max_iterations: z.number().default(3),
  acceptance_results: z.array(AcceptanceCheckSchema).default([]),
  final_response: z.string().optional(),
  error: z.string().optional(),
  started_at: z.number(),
  completed_at: z.number().optional(),
});

export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

// ... (previous lines)
export const SSEEventTypeSchema = z.enum([
  "brief",
  "contract",
  "plan",
  "tool_call",
  "tool_result",
  "source_signal",
  "source_deep",
  "artifact",
  "verify",
  "iterate",
  "final",
  "error",
  "heartbeat",
  "progress",
  "search_progress",
  "artifact_generating",
  "phase_started",
  "filter_progress",
  "export_progress",
  "accepted_progress",
  "verify_progress",
  "thought"
]);
// ...

export type SSEEventType = z.infer<typeof SSEEventTypeSchema>;

export const SSEEventSchema = z.object({
  event_id: z.string(),
  event_type: SSEEventTypeSchema,
  timestamp: z.number(),
  data: z.unknown(),
  session_id: z.string(),
});

export type SSEEvent = z.infer<typeof SSEEventSchema>;
