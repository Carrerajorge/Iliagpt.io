import { z } from "zod";

export const BriefIntentSchema = z.object({
  primary_intent: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const BriefSubTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});

export const BriefDeliverableSchema = z.object({
  description: z.string().min(1),
  format: z.string().min(1),
});

export const BriefAudienceSchema = z.object({
  audience: z.string().min(1).default("general"),
  tone: z.string().min(1).default("direct"),
  language: z.string().min(1).default("es"),
});

export const BriefConstraintSchema = z.object({
  constraint: z.string().min(1),
  hard: z.boolean().default(true),
});

export const BriefDataPointSchema = z.object({
  key: z.string().default("unknown"),
  value: z.any(),
  source: z.enum(["provided", "extracted", "assumed"]).default("provided"),
});

export const BriefRiskSchema = z.object({
  risk: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

export const BriefScopeSchema = z.object({
  in_scope: z.array(z.string()).default([]),
  out_of_scope: z.array(z.string()).default([]),
});

export const BriefRequiredInputSchema = z.object({
  input: z.string().min(1),
  required: z.boolean().default(true),
  reason: z.string().default(""),
  source: z.enum(["user", "memory", "rag", "assumption"]).default("user"),
});

export const BriefExpectedOutputSchema = z.object({
  description: z.string().min(1),
  format: z.string().min(1),
  structure: z.array(z.string()).default([]),
});

export const BriefValidationSchema = z.object({
  check: z.string().min(1),
  type: z.enum(["policy", "privacy", "security", "quality", "consistency"]).default("quality"),
  required: z.boolean().default(true),
});

export const BriefToolRoutingSchema = z.object({
  suggested_tools: z.array(z.string()).default([]),
  blocked_tools: z.array(z.string()).default([]),
  rationale: z.string().default(""),
});

export const BriefGuardrailsSchema = z.object({
  policy_ok: z.boolean().default(true),
  privacy_ok: z.boolean().default(true),
  security_ok: z.boolean().default(true),
  pii_detected: z.boolean().default(false),
  flags: z.array(z.string()).default([]),
});

export const BriefSelfCheckSchema = z.object({
  passed: z.boolean().default(true),
  score: z.number().min(0).max(1).default(0.5),
  issues: z.array(z.string()).default([]),
});

export const BriefStageTraceSchema = z.object({
  stage: z.string().min(1),
  duration_ms: z.number().min(0).default(0),
  status: z.enum(["ok", "warning", "error"]).default("ok"),
});

export const BriefTraceSchema = z.object({
  planner_model: z.string().default("unknown"),
  planner_mode: z.enum(["function_calling", "json", "heuristic"]).default("heuristic"),
  total_duration_ms: z.number().min(0).default(0),
  stages: z.array(BriefStageTraceSchema).default([]),
});

export const RequestBriefSchema = z.object({
  intent: BriefIntentSchema,

  objective: z.string().min(1).default("Resolver la solicitud del usuario"),
  scope: BriefScopeSchema.default({ in_scope: [], out_of_scope: [] }),

  // 2–5 subtasks required by spec
  subtasks: z.array(BriefSubTaskSchema).min(2).max(5),

  deliverable: BriefDeliverableSchema,
  audience: BriefAudienceSchema,

  restrictions: z.array(BriefConstraintSchema).default([]),

  data_provided: z.array(BriefDataPointSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  required_inputs: z.array(BriefRequiredInputSchema).default([]),
  expected_output: BriefExpectedOutputSchema.default({
    description: "Respuesta accionable",
    format: "markdown",
    structure: [],
  }),
  validations: z.array(BriefValidationSchema).default([]),

  success_criteria: z.array(z.string()).default([]),
  definition_of_done: z.array(z.string()).default([]),

  risks: z.array(BriefRiskSchema).default([]),
  ambiguities: z.array(z.string()).default([]),

  tool_routing: BriefToolRoutingSchema.default({
    suggested_tools: [],
    blocked_tools: [],
    rationale: "",
  }),
  guardrails: BriefGuardrailsSchema.default({
    policy_ok: true,
    privacy_ok: true,
    security_ok: true,
    pii_detected: false,
    flags: [],
  }),
  self_check: BriefSelfCheckSchema.default({
    passed: true,
    score: 0.5,
    issues: [],
  }),
  trace: BriefTraceSchema.default({
    planner_model: "unknown",
    planner_mode: "heuristic",
    total_duration_ms: 0,
    stages: [],
  }),

  blocker: z
    .object({
      is_blocked: z.boolean().default(false),
      question: z.string().optional(),
    })
    .default({ is_blocked: false }),
});

export type RequestBrief = z.infer<typeof RequestBriefSchema>;
