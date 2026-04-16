import { and, desc, eq, ne } from "drizzle-orm";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import vm from "vm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { createLogger } from "../lib/structuredLogger";
import { addAttributes, recordError, SPAN_ATTRIBUTES, withSpan } from "../lib/tracing";
import { createServiceCircuitBreaker, type ServiceCircuitConfig } from "../lib/circuitBreaker";
import { toolExecutionEngine } from "./toolExecutionEngine";
import { safeExecutePython } from "./pythonSandbox";
import {
  skillCatalog,
  skillCatalogVersions,
  skillExecutionRuns,
  skillExecutionStatusSchema,
  skillSpecSchema,
  type SkillErrorContract,
  type SkillExecutionPolicy,
  type SkillScope,
  type SkillSpec,
  type SkillWorkflowDefinition,
  type SkillWorkflowStep,
} from "@shared/schema/skillPlatform";

interface ConcurrencyWaiter {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
}

class ConversationExecutionLimiter {
  private readonly inFlightByKey = new Map<string, number>();
  private readonly waitersByKey = new Map<string, ConcurrencyWaiter[]>();
  private readonly keyPrefix = "skill-platform";

  constructor(
    private readonly maxConcurrentPerKey: number,
    private readonly queueTimeoutMs: number
  ) {}

  private makeKey(conversationId?: string | null, runId?: string | null): string {
    const conversationToken = conversationId && conversationId.length <= 80
      ? conversationId
      : "anon";
    const runToken = runId && runId.length <= 80 ? runId : "global";
    return `${this.keyPrefix}:${conversationToken}:${runToken}`;
  }

  private nowRunningForKey(key: string): number {
    return this.inFlightByKey.get(key) ?? 0;
  }

  private canRunNow(key: string): boolean {
    return this.nowRunningForKey(key) < this.maxConcurrentPerKey;
  }

  private grantNextWaiter(key: string): void {
    const waiters = this.waitersByKey.get(key);
    if (!waiters || waiters.length === 0) return;
    if (!this.canRunNow(key)) return;

    const next = waiters.shift();
    if (!next) return;
    clearTimeout(next.timer);
    this.inFlightByKey.set(key, this.nowRunningForKey(key) + 1);
    next.resolve();
  }

  async acquire(conversationId?: string | null, runId?: string | null): Promise<() => void> {
    const key = this.makeKey(conversationId, runId);
    if (this.canRunNow(key)) {
      this.inFlightByKey.set(key, this.nowRunningForKey(key) + 1);
      return () => this.release(key);
    }

    const waiters = this.waitersByKey.get(key) ?? [];
    return await new Promise<() => void>((resolve, reject) => {
      const waiter: ConcurrencyWaiter = {
        resolve: () => resolve(() => this.release(key)),
        timer: setTimeout(() => {
          const current = this.waitersByKey.get(key);
          if (current) {
            const index = current.indexOf(waiter);
            if (index >= 0) current.splice(index, 1);
            if (current.length === 0) this.waitersByKey.delete(key);
          }
          reject(new Error(`Skill execution queue timeout for ${key}`));
        }, this.queueTimeoutMs),
      };
      waiters.push(waiter);
      this.waitersByKey.set(key, waiters);
    });
  }

  release(key: string): void {
    const current = this.nowRunningForKey(key);
    if (current <= 1) {
      this.inFlightByKey.delete(key);
    } else {
      this.inFlightByKey.set(key, current - 1);
    }
    this.grantNextWaiter(key);
  }
}

type StageMetrics = {
  planner: number;
  retrieval: number;
  factory: number;
  validation: number;
  execution: number;
  tooling: number;
  model: number;
  policy: number;
  risk_gate: number;
  cleanup: number;
  finish: number;
};

type SkillIntentHint = {
  intent?: string | null;
  confidence?: number;
  output_format?: string | null;
  language_detected?: string | null;
};

export interface SkillExecutionAttachment {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface SkillExecutionRequest {
  requestId: string;
  conversationId?: string | null;
  runId?: string | null;
  userId?: string | null;
  userMessage: string;
  attachments?: SkillExecutionAttachment[];
  allowedScopes?: SkillScope[];
  intentHint?: SkillIntentHint | null;
  autoCreate?: boolean;
  maxRetries?: number;
  emitTrace?: (trace: SkillExecutionTraceEvent) => void;
  now?: Date;
}

export interface SkillExecutionTraceEvent {
  stage:
    | "planner"
    | "retrieval"
    | "factory"
    | "validation"
    | "execution"
    | "tooling"
    | "model"
    | "policy"
    | "risk_gate"
    | "cleanup"
    | "finish";
  status: "ok" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
  runId?: string;
  elapsedMs?: number;
  timestamp: string;
}

export interface SkillPlanMatch {
  slug: string;
  catalogId: string;
  versionId: string;
  name: string;
  mode: "workflow" | "code";
  reason: string;
  score: number;
  confidence: number;
  status: "active" | "inactive" | "draft" | "deprecated";
}

export interface SkillExecutionPlan {
  inputText: string;
  candidates: SkillPlanMatch[];
  selected: SkillPlanMatch | null;
  selectedVia: "planner" | "factory" | "none";
  needsAutoSkill: boolean;
  autoSuggestion?: {
    name: string;
    description: string;
    permissions: SkillScope[];
    expectedLatencyMs: number;
    expectedCostCents: number;
    mode: "workflow" | "code";
    reasons: string[];
  };
}

export interface SkillExecutionDraft {
  name: string;
  description: string;
  permissions: SkillScope[];
  expectedLatencyMs: number;
  expectedCostCents: number;
  mode: "workflow" | "code";
  schemaPreview: {
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
  };
  risks: SkillScope[];
  validation: {
    valid: boolean;
    reasons: string[];
  };
}

export interface SkillExecutionResult {
  status:
    | "completed"
    | "partial"
    | "blocked"
    | "skipped"
    | "failed";
  executionPlan?: SkillExecutionPlan;
  continueWithModel: boolean;
  output?: unknown;
  outputText: string;
  partialOutput?: string;
  fallbackText?: string;
  selectedSkill?: {
    catalogId: string;
    versionId: string;
    slug: string;
    name: string;
    mode: "workflow" | "code";
    confidence: number;
  };
  requiresConfirmation: boolean;
  autoCreated: boolean;
  traces: SkillExecutionTraceEvent[];
  policyBreached?: {
    missingScopes: SkillScope[];
    blockedScopes: SkillScope[];
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metrics?: {
    latencyMs: number;
    retryCount: number;
    cached: boolean;
    timedOut: boolean;
  };
}

interface RuntimeSkill {
  catalogId: string;
  versionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: "active" | "inactive" | "draft" | "deprecated";
  spec: SkillSpec;
  activeVersion: number;
  latestVersion: number;
  isManaged: boolean;
  createdBy?: string | null;
}

interface ExecutionPlanMatch {
  skill: RuntimeSkill;
  score: number;
  reason: string;
}

interface SkillVersionHistoryItem {
  version: number;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
  createdFrom: string | null;
  tags: string[];
  dependencies: string[];
}

interface ExecutionContext {
  runId: string;
  requestId: string;
  runRecordId?: string;
  conversationId?: string | null;
  userId?: string | null;
  startMs: number;
  attempts: number;
  policy: SkillExecutionPolicy;
  workspacePath: string;
  state: Record<string, unknown>;
}

interface RuntimeStepResult {
  output: unknown;
  stepId: string;
}

interface ExecutionPolicyState {
  allowWrite: boolean;
  allowNetwork: boolean;
}

interface SkillExecutionAttempt {
  attempts: number;
  timedOut: boolean;
}

interface PersistedExecutionRunData {
  catalogId: string | null;
  versionId: string | null;
  output?: unknown;
  partialOutput?: unknown;
  continueWithModel?: boolean;
  status?: string;
  autoCreated?: boolean;
  latencyMs?: number;
  policy?: unknown;
  error?: unknown;
  traces?: Record<string, unknown>[];
  fallbackUsed?: boolean;
}

interface SkillExecutionMetrics {
  totalRequests: number;
  completed: number;
  partial: number;
  blocked: number;
  failed: number;
  skipped: number;
  autoCreated: number;
  cacheHit: number;
  avgLatencyMs: number;
  lastErrors: string[];
  startedAt: number;
  stageMetrics: StageMetrics;
  peakConcurrent: number;
  activeRuns: number;
}

const logger = createLogger("skill-platform");
const SKILL_PLATFORM_EXECUTION_BREAKER_CONFIG: ServiceCircuitConfig = {
  name: "skill-platform.execution",
  failureThreshold: 8,
  resetTimeout: 60_000,
  timeout: 45_000,
  retries: 2,
  retryDelay: 750,
};
const SKILL_PLATFORM_FACTORY_BREAKER_CONFIG: ServiceCircuitConfig = {
  name: "skill-platform.factory",
  failureThreshold: 5,
  resetTimeout: 90_000,
  timeout: 25_000,
  retries: 2,
  retryDelay: 700,
};
const SKILL_PLATFORM_CONCURRENCY_LIMIT = 3;
const SKILL_PLATFORM_QUEUE_TIMEOUT_MS = 20_000;
const SKILL_PLATFORM_RUN_CACHE_TTL_MS = 5 * 60_000;
const SKILL_PLATFORM_MAX_RUN_CACHE_ENTRIES = 1500;
const SKILL_PLATFORM_MAX_RUN_CACHE_TEXT_BYTES = 8192;
const SKILL_PLATFORM_MAX_OUTPUT_TEXT_LEN = 8192;
const SKILL_PLATFORM_MAX_OUTPUT_EVENT_LEN = 4096;
const SKILL_PLATFORM_MAX_OUTPUT_EVENTS = 64;
const SKILL_PLATFORM_MAX_PERSISTED_OUTPUT_LEN = 12_000;
const SKILL_PLATFORM_MAX_ALLOWED_SCOPES = 12;
const SKILL_PLATFORM_MAX_ALLOWED_ATTACHMENTS = 12;
const SKILL_PLATFORM_MAX_DEPENDENCIES = 24;
const SKILL_PLATFORM_MAX_RETRY_BUDGET = 6;
const SKILL_PLATFORM_RUN_KEY_HASH_LENGTH = 28;
const SKILL_PLATFORM_IDENTIFIER_RE = /^[a-zA-Z0-9._-]+$/;
const SKILL_PLATFORM_MAX_REQUEST_ID_LENGTH = 140;
const SKILL_PLATFORM_SAFE_ATTACHMENT_NAME_RE = /^[^<>:"/\\|?*\u0000-\u001f]{1,220}$/;
const SKILL_PLATFORM_SAFE_MIME_TYPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.+-\/]*$/;
const SKILL_PLATFORM_MAX_ATTACHMENT_ID_LENGTH = 160;
const SKILL_PLATFORM_MAX_ATTACHMENT_NAME_LENGTH = 220;
const SKILL_PLATFORM_MAX_ATTACHMENT_MIME_LENGTH = 120;
const SKILL_PLATFORM_MAX_ATTACHMENT_SIZE = 200_000_000;
const SKILL_PLATFORM_EXECUTION_BREAKER = createServiceCircuitBreaker(SKILL_PLATFORM_EXECUTION_BREAKER_CONFIG);
const SKILL_PLATFORM_FACTORY_BREAKER = createServiceCircuitBreaker(SKILL_PLATFORM_FACTORY_BREAKER_CONFIG);

const SKILL_PLATFORM_METRICS: SkillExecutionMetrics = {
  totalRequests: 0,
  completed: 0,
  partial: 0,
  blocked: 0,
  failed: 0,
  skipped: 0,
  autoCreated: 0,
  cacheHit: 0,
  avgLatencyMs: 0,
  lastErrors: [],
  startedAt: Date.now(),
  stageMetrics: {
    planner: 0,
    retrieval: 0,
    factory: 0,
    validation: 0,
    execution: 0,
    tooling: 0,
    model: 0,
    policy: 0,
    risk_gate: 0,
    cleanup: 0,
    finish: 0,
  },
  peakConcurrent: 0,
  activeRuns: 0,
};

const RISKY_SCOPES: ReadonlySet<SkillScope> = new Set([
  "external_network",
  "email",
  "database",
  "browser",
  "system",
  "files",
  "code_interpreter",
]);
const SIDE_EFFECT_SCOPES: ReadonlySet<SkillScope> = new Set([
  "external_network",
  "email",
  "database",
  "browser",
  "system",
]);

const BUILTIN_SCOPE: SkillScope[] = ["storage.read", "storage.write", "files", "code_interpreter"];
const BUILTIN_SKILLS: Array<{ slug: string; spec: SkillSpec }> = [
  {
    slug: "identity_text_v1",
    spec: {
      name: "Identity Text",
      description: "Devuelve el texto recibido exactamente sin transformar.",
      category: "general",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Texto de entrada del usuario" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Texto emitido" },
          source: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      permissions: ["storage.read"],
      expectedLatencyMs: 180,
      expectedCostCents: 0,
      dependencies: [],
      errorContract: [
        {
          code: "EMPTY_INPUT",
          message: "Entrada vacía",
          retryable: false,
          fallbackHint: "Pedir entrada textual clara al usuario.",
        },
        {
          code: "SCHEMA_MISMATCH",
          message: "Input/output fuera de contrato JSON Schema",
          retryable: false,
          fallbackHint: "No usar texto malformado.",
        },
      ],
      examples: [
        "Devuelve texto de resumen del mensaje del usuario.",
        "Reescribe exactamente el mensaje sin modificar.",
      ],
      tags: ["text", "identity", "echo"],
      implementationMode: "code",
      code: {
        language: "javascript",
        source:
          [
            "module.exports = async function run(input) {",
            "  const text = typeof input?.text === 'string' ? input.text.trim() : '';",
            "  if (!text) return { text: '', source: 'identity_text_v1' };",
            "  return { text, source: 'identity_text_v1', confidence: 0.99 };",
            "};",
          ].join("\n"),
      },
      executionPolicy: {
        maxRetries: 0,
        timeoutMs: 2000,
        cpuLimitMs: 50,
        memoryLimitMb: 64,
        requiresConfirmation: false,
        allowExternalSideEffects: false,
      },
      status: "active",
    },
  },
  {
    slug: "noop_v1",
    spec: {
      name: "No-op",
      description: "Valida contrato y confirma que la petición se recibió.",
      category: "general",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          text: { type: "string" },
        },
        required: ["status"],
        additionalProperties: false,
      },
      permissions: ["storage.read"],
      expectedLatencyMs: 140,
      expectedCostCents: 0,
      dependencies: [],
      errorContract: [],
      examples: [
        "Confirma recepción de texto sin ejecutar acciones.",
      ],
      tags: ["noop", "noop", "safe", "fallback"],
      implementationMode: "code",
      code: {
        language: "javascript",
        source:
          [
            "module.exports = async function run(input) {",
            "  return { status: 'noop', text: String(input?.text || '').slice(0, 120) };",
            "};",
          ].join("\n"),
      },
      executionPolicy: {
        maxRetries: 0,
        timeoutMs: 1500,
        cpuLimitMs: 50,
        memoryLimitMb: 64,
        requiresConfirmation: false,
        allowExternalSideEffects: false,
      },
      status: "active",
    },
  },
];

const SKILL_MATCH_THRESHOLD = 0.28;
const SKILL_EXPLICIT_REFERENCE_BOOST = 0.995;
const OUTPUT_FORMAT_ALIASES: Record<string, string[]> = {
  docx: ["docx", "word", "documento", "document", "informe", "report"],
  pdf: ["pdf", "portable", "document", "documento"],
  pptx: ["ppt", "pptx", "powerpoint", "slides", "presentacion", "presentation", "diapositivas"],
  xlsx: ["xlsx", "excel", "spreadsheet", "sheet", "tabla", "hoja", "calculo"],
  csv: ["csv", "comma", "table", "tabular", "datos"],
};
const INTENT_HINT_ALIASES: Record<string, string[]> = {
  create_document: ["documento", "document", "word", "docx", "reporte", "report", "pdf"],
  create_presentation: ["presentacion", "presentation", "slides", "powerpoint", "ppt", "pptx", "diapositivas"],
  create_spreadsheet: ["excel", "xlsx", "spreadsheet", "tabla", "datos", "csv"],
  summarize: ["resumen", "summary", "resumir", "summarize", "sintesis"],
  translate: ["traducir", "translate", "idioma", "language"],
  search_web: ["buscar", "search", "web", "internet", "research", "investigar"],
  analyze_document: ["analizar", "analyze", "documento", "archivo", "file", "pdf", "docx", "xlsx"],
};
const SKILL_CATEGORY_ALIASES: Record<string, string[]> = {
  general: ["general"],
  documents: ["document", "documents", "documento", "pdf", "word", "ppt", "presentation", "slides"],
  data: ["data", "datos", "excel", "xlsx", "csv", "analytics", "analysis", "tabla"],
  integrations: ["integration", "integrations", "gmail", "calendar", "slack", "notion", "drive", "web"],
  custom: ["custom", "personalized", "personalizado"],
};
const MAX_WORKFLOW_STEPS = 12;
const MAX_AUTO_WORKFLOW_STEPS = 4;
const SKILL_SCOPE_SET = new Set<SkillScope>([
  "storage.read",
  "storage.write",
  "browser",
  "email",
  "database",
  "external_network",
  "code_interpreter",
  "files",
  "system",
]);
const AUTO_SKILL_PREFIX = "auto_skill";
const AUTO_SKILL_PREFIX_DASH = `${AUTO_SKILL_PREFIX}_`;
const EXECUTION_TIMEOUT_FALLBACK_MS = 45_000;
const MAX_RUN_MESSAGE_LEN = 8_000;
const SKILL_PLATFORM_WORKSPACE_BASE = path.resolve(os.tmpdir(), "skill-platform");
const SKILL_PLATFORM_MAX_TRACE_DETAILS_CHARS = 3_000;
const SKILL_PLATFORM_MAX_WORKFLOW_STEP_DETAILS_BYTES = 12_000;
const SKILL_PLATFORM_RUNTIME_INPUT_MAX_DEPTH = 8;
const SKILL_PLATFORM_RUNTIME_INPUT_MAX_KEYS = 160;
const SKILL_PLATFORM_RUNTIME_INPUT_MAX_ARRAY_LENGTH = 256;
const SKILL_PLATFORM_RUNTIME_INPUT_STRING_LIMIT = 2_000;
const SKILL_PLATFORM_RUNTIME_INPUT_KEY_LIMIT = 120;
const SKILL_PLATFORM_MAX_WORKFLOW_EVENTS = 64;

const TOOL_NAME_RE = /^[a-zA-Z0-9._-]{1,80}$/;

function sanitizeTraceDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!details || Object.keys(details).length === 0) return undefined;
  try {
    const serialized = safeStringify(details);
    if (serialized.length <= SKILL_PLATFORM_MAX_TRACE_DETAILS_CHARS) {
      return details;
    }
    return {
      _truncated: true,
      _size: serialized.length,
      _sample: serialized.slice(0, SKILL_PLATFORM_MAX_TRACE_DETAILS_CHARS),
    };
  } catch {
    return {
      _truncated: true,
      _sample: "[unserializable details]",
    };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeExecutionInput(value: unknown, depth = 0, seen = new WeakSet<object>() ): unknown {
  if (depth >= SKILL_PLATFORM_RUNTIME_INPUT_MAX_DEPTH) {
    return "[depth-limit]";
  }

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const normalized = value
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
    return normalized.length > SKILL_PLATFORM_RUNTIME_INPUT_STRING_LIMIT
      ? normalized.slice(0, SKILL_PLATFORM_RUNTIME_INPUT_STRING_LIMIT)
      : normalized;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();

  if (typeof value === "symbol" || typeof value === "function") return String(value);

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const output = value
      .slice(0, SKILL_PLATFORM_RUNTIME_INPUT_MAX_ARRAY_LENGTH)
      .map((item) => sanitizeExecutionInput(item, depth + 1, seen));
    seen.delete(value);
    return output;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const output: Record<string, unknown> = {};
  let keys = 0;
  for (const [key, item] of Object.entries(value)) {
    if (keys >= SKILL_PLATFORM_RUNTIME_INPUT_MAX_KEYS) break;
    if (!TOOL_NAME_RE.test(key) || key.length > SKILL_PLATFORM_RUNTIME_INPUT_KEY_LIMIT) {
      continue;
    }
    output[key] = sanitizeExecutionInput(item, depth + 1, seen);
    keys += 1;
  }
  return output;
}

function resolveWorkspacePath(runId: string): string {
  const safeRunId = makeDeterministicId(runId, 72) || `run_${uuidv4().replace(/-/g, "").slice(0, 20)}`;
  const candidate = path.resolve(SKILL_PLATFORM_WORKSPACE_BASE, safeRunId);
  const normalizedBase = `${SKILL_PLATFORM_WORKSPACE_BASE}${path.sep}`;
  if (!candidate.startsWith(normalizedBase)) {
    throw new Error("Unsafe workspace path");
  }
  return candidate;
}

function getTraceSpanName(stage: SkillExecutionTraceEvent["stage"]): string {
  return `skill_platform.${stage}`;
}

function sanitizeRunId(runId: string | null | undefined): string {
  if (!runId) return "";
  return sanitizeRunIdInput(runId, 72);
}

function makeDeterministicId(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  if (!normalized) return "";
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, maxLength);
  if (!safe) return "";
  return safe;
}

function sanitizeRequestInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}

function sanitizeRunIdInput(value: unknown, maxLength = 72): string {
  const normalized = makeDeterministicId(value, maxLength);
  if (!normalized) return "";
  if (!SKILL_PLATFORM_IDENTIFIER_RE.test(normalized)) {
    const hashed = crypto
      .createHash("sha256")
      .update(normalized)
      .digest("hex");
    return `id_${hashed}`.slice(0, maxLength);
  }
  return normalized;
}

function sanitizeRequestId(value: unknown): string {
  const normalized = sanitizeRunIdInput(value, SKILL_PLATFORM_MAX_REQUEST_ID_LENGTH);
  return normalized || `req_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}

function sanitizeAttachmentText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function normalizeAttachment(raw: unknown, fallbackName: string): SkillExecutionAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;

  const id = sanitizeAttachmentText(candidate.id, SKILL_PLATFORM_MAX_ATTACHMENT_ID_LENGTH) || sanitizeAttachmentText(candidate.fileId, SKILL_PLATFORM_MAX_ATTACHMENT_ID_LENGTH);
  const name = sanitizeAttachmentText(candidate.name, SKILL_PLATFORM_MAX_ATTACHMENT_NAME_LENGTH);

  if (!name && !id) return null;
  if (name && !SKILL_PLATFORM_SAFE_ATTACHMENT_NAME_RE.test(name)) return null;

  const mimeRaw = sanitizeAttachmentText(candidate.mimeType, SKILL_PLATFORM_MAX_ATTACHMENT_MIME_LENGTH) || sanitizeAttachmentText(candidate.type, SKILL_PLATFORM_MAX_ATTACHMENT_MIME_LENGTH);
  const mimeType = mimeRaw && SKILL_PLATFORM_SAFE_MIME_TYPE_RE.test(mimeRaw) ? mimeRaw : undefined;

  const parsedSize = Number(candidate.size);
  const size = Number.isFinite(parsedSize) && parsedSize >= 0 && parsedSize <= SKILL_PLATFORM_MAX_ATTACHMENT_SIZE
    ? Math.floor(parsedSize)
    : undefined;

  return {
    id: id || undefined,
    name: (name || fallbackName).slice(0, SKILL_PLATFORM_MAX_ATTACHMENT_NAME_LENGTH),
    mimeType,
    size,
  };
}

function normalizeAttachments(attachments: unknown): SkillExecutionAttachment[] {
  if (!Array.isArray(attachments)) return [];
  const normalized: SkillExecutionAttachment[] = [];
  for (const attachment of attachments) {
    if (normalized.length >= SKILL_PLATFORM_MAX_ALLOWED_ATTACHMENTS) break;
    const item = normalizeAttachment(attachment, `attachment-${normalized.length + 1}`);
    if (item) normalized.push(item);
  }
  return normalized;
}

function normalizeSkillDependencies(dependencies: unknown): NormalizedSkillDependency[] {
  if (!Array.isArray(dependencies)) return [];
  const parsed: NormalizedSkillDependency[] = [];
  const seen = new Set<string>();

  for (const dependency of dependencies) {
    if (!dependency || typeof dependency !== "object") continue;

    const candidate = dependency as Record<string, unknown>;
    const skillId = sanitizeRunIdInput(candidate.skillId, 80);
    if (!skillId || seen.has(skillId)) continue;

    const rawVersion = Number(candidate.minVersion);
    const minVersion = Number.isInteger(rawVersion) && rawVersion > 0 ? rawVersion : 1;
    const reason = sanitizeAttachmentText(candidate.reason, 300);

    parsed.push({
      skillId,
      minVersion,
      ...(reason ? { reason } : {}),
    });
    seen.add(skillId);
  }

  return parsed;
}

function clampPolicyInt(value: unknown, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizePolicy(rawPolicy: SkillExecutionPolicy | undefined): SkillExecutionPolicy {
  const fallback: SkillExecutionPolicy = {
    maxRetries: 1,
    timeoutMs: 30_000,
    cpuLimitMs: 150,
    memoryLimitMb: 256,
    requiresConfirmation: false,
    allowExternalSideEffects: false,
  };
  if (!rawPolicy) return fallback;

  return {
    maxRetries: clampPolicyInt(rawPolicy.maxRetries, fallback.maxRetries, 0, SKILL_PLATFORM_MAX_RETRY_BUDGET),
    timeoutMs: clampPolicyInt(rawPolicy.timeoutMs, fallback.timeoutMs, 100, 180_000),
    cpuLimitMs: clampPolicyInt(rawPolicy.cpuLimitMs ?? fallback.cpuLimitMs, fallback.cpuLimitMs!, 10, 600_000),
    memoryLimitMb: clampPolicyInt(rawPolicy.memoryLimitMb ?? fallback.memoryLimitMb, fallback.memoryLimitMb!, 32, 2048),
    requiresConfirmation: !!rawPolicy.requiresConfirmation,
    allowExternalSideEffects: !!rawPolicy.allowExternalSideEffects,
  };
}

interface SkillExecutionCacheEntry {
  result: SkillExecutionResult;
  expiresAt: number;
}

interface SkillValidationResult {
  valid: boolean;
  reasons: string[];
}

interface SkillExecutionPlanState {
  candidates: SkillPlanMatch[];
  selected: SkillPlanMatch | null;
  selectedVia: "planner" | "factory" | "none";
  needsAutoSkill: boolean;
}

interface NormalizedSkillDependency {
  skillId: string;
  minVersion: number;
  reason?: string;
}

function clampText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen);
}

function clampOutputText(value: unknown, maxLen: number): string {
  if (typeof value === "string") {
    return value.length <= maxLen ? value : value.slice(0, maxLen);
  }
  if (typeof value === "object" && value !== null) {
    return clampText(safeStringify(value), maxLen);
  }
  return clampText(String(value ?? ""), maxLen);
}

function sanitizeErrorText(value: unknown, maxLen = 240): string {
  return clampText(typeof value === "string" ? value : String(value ?? ""), maxLen);
}

function clampPersistedPayload(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  try {
    const serialized = safeStringify(value);
    if (serialized.length <= SKILL_PLATFORM_MAX_PERSISTED_OUTPUT_LEN) {
      return value as Record<string, unknown>;
    }
    return {
      _truncated: true,
      _length: serialized.length,
      _value: serialized.slice(0, SKILL_PLATFORM_MAX_PERSISTED_OUTPUT_LEN),
      _truncatedAt: nowIso(),
    };
  } catch (error) {
    return {
      _truncated: true,
      _error: error instanceof Error ? error.message : "unserializable payload",
      _truncatedAt: nowIso(),
    };
  }
}

function safeNow(): number {
  return Date.now();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(" ").filter((token) => token.length >= 3);
}

function computeJaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function computeTokenCoverage(targetTokens: string[], corpusTokens: string[]): number {
  if (targetTokens.length === 0 || corpusTokens.length === 0) return 0;
  const corpus = new Set(corpusTokens);
  const target = Array.from(new Set(targetTokens));
  let matches = 0;
  for (const token of target) {
    if (corpus.has(token)) matches += 1;
  }
  return matches / target.length;
}

function parseExplicitSkillReference(input: string): { raw: string; name: string; normalizedName: string; stripped: string } | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("@")) return null;

  const braceMatch = trimmed.match(/^@\{([^}]{1,64})\}/);
  if (braceMatch) {
    const raw = braceMatch[0];
    const name = braceMatch[1].trim();
    return {
      raw,
      name,
      normalizedName: normalizeText(name),
      stripped: trimmed.slice(raw.length).trim(),
    };
  }

  const tokenMatch = trimmed.match(/^@([^\s]{1,64})/);
  if (tokenMatch) {
    const raw = tokenMatch[0];
    const name = tokenMatch[1].trim();
    return {
      raw,
      name,
      normalizedName: normalizeText(name),
      stripped: trimmed.slice(raw.length).trim(),
    };
  }

  return null;
}

function getOutputFormatTokens(outputFormat?: string | null): string[] {
  if (!outputFormat) return [];
  const normalized = normalizeText(outputFormat).replace(/\s+/g, "");
  return OUTPUT_FORMAT_ALIASES[normalized] || tokenize(outputFormat);
}

function getIntentHintTokens(intent?: string | null): string[] {
  if (!intent) return [];
  const normalized = normalizeText(intent).replace(/\s+/g, "_");
  return INTENT_HINT_ALIASES[normalized] || tokenize(intent);
}

function getCategoryTokens(category?: string | null): string[] {
  if (!category) return [];
  const normalized = normalizeText(category).replace(/\s+/g, "_");
  return SKILL_CATEGORY_ALIASES[normalized] || tokenize(category);
}

function inferRequestedCategories(
  request: SkillExecutionRequest,
  outputTokens: string[],
  attachmentTokens: string[]
): string[] {
  const categories = new Set<string>();
  const intent = normalizeText(request.intentHint?.intent || "").replace(/\s+/g, "_");
  const outputFormat = normalizeText(request.intentHint?.output_format || "").replace(/\s+/g, "");
  const aggregate = new Set<string>([...outputTokens, ...attachmentTokens]);

  if (intent === "create_spreadsheet" || outputFormat === "xlsx" || outputFormat === "csv") {
    categories.add("data");
  }
  if (
    intent === "create_document" ||
    intent === "create_presentation" ||
    intent === "analyze_document" ||
    outputFormat === "docx" ||
    outputFormat === "pdf" ||
    outputFormat === "pptx"
  ) {
    categories.add("documents");
  }
  if (intent === "search_web") {
    categories.add("integrations");
  }
  if (aggregate.has("xlsx") || aggregate.has("excel") || aggregate.has("csv")) {
    categories.add("data");
  }
  if (
    aggregate.has("pdf") ||
    aggregate.has("docx") ||
    aggregate.has("word") ||
    aggregate.has("pptx") ||
    aggregate.has("powerpoint")
  ) {
    categories.add("documents");
  }

  return Array.from(categories);
}

function getAttachmentSignalTokens(attachments: SkillExecutionAttachment[] | undefined): string[] {
  const tokens = new Set<string>();
  for (const attachment of attachments || []) {
    for (const token of tokenize(attachment.name || "")) {
      tokens.add(token);
    }
    for (const token of tokenize((attachment.mimeType || "").replace(/[/.+-]/g, " "))) {
      tokens.add(token);
    }

    const ext = (attachment.name || "").toLowerCase().match(/\.([a-z0-9]{2,8})$/)?.[1];
    if (ext) {
      tokens.add(ext);
      for (const alias of OUTPUT_FORMAT_ALIASES[ext] || []) {
        tokens.add(alias);
      }
    }
  }

  return Array.from(tokens);
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, replacement) =>
    typeof replacement === "bigint" ? `${replacement}n` : replacement
  );
}

function toPathSegments(pathValue: string): string[] {
  return pathValue.split(".").filter(Boolean);
}

function getByPath(value: unknown, pathValue: string): unknown {
  const keys = toPathSegments(pathValue);
  let current: unknown = value;
  for (const key of keys) {
    if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function interpolateTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_match, token) => {
      const pathValue = String(token).replace(/^steps\./, "steps.").replace(/^input\./, "input.");
      const resolved = getByPath(context, pathValue);
      return typeof resolved === "string" ? resolved : resolved == null ? "" : safeStringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolateTemplate(item, context));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      output[k] = interpolateTemplate(v, context);
    }
    return output;
  }
  return value;
}

function sortWorkflowSteps(steps: SkillWorkflowStep[]): { sorted: SkillWorkflowStep[]; hasCycle: boolean } {
  const byId = new Map<string, SkillWorkflowStep>();
  for (const step of steps) {
    byId.set(step.id, step);
  }
  const indegree = new Map<string, number>();
  const edges = new Map<string, string[]>();
  for (const step of steps) {
    indegree.set(step.id, 0);
    edges.set(step.id, []);
  }
  for (const step of steps) {
    const deps = step.dependsOn || [];
    for (const dep of deps) {
      if (!byId.has(dep)) {
        throw new Error(`Workflow dependency missing: ${step.id} -> ${dep}`);
      }
      indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
      edges.get(dep)!.push(step.id);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of indegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const ordered: SkillWorkflowStep[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const step = byId.get(id)!;
    ordered.push(step);
    for (const nxt of edges.get(id) || []) {
      const next = byId.get(nxt)!;
      indegree.set(nxt, (indegree.get(nxt) ?? 0) - 1);
      if ((indegree.get(nxt) ?? 0) <= 0) {
        queue.push(next.id);
      }
    }
  }

  return { sorted: ordered, hasCycle: ordered.length !== steps.length };
}

function validateSchema(value: unknown, schema: any, pathParts: string[] = []): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== "object") return errors;

  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`Expected object at ${pathParts.join(".") || "root"}`);
      return errors;
    }
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in obj)) errors.push(`Missing required property: ${[...pathParts, key].join(".")}`);
    }
    const properties = schema.properties || {};
    if (typeof properties === "object") {
      for (const [prop, propSchema] of Object.entries(properties)) {
        if (obj[prop] !== undefined) {
          errors.push(...validateSchema(obj[prop], propSchema, [...pathParts, prop]));
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!properties || !(key in properties)) {
          errors.push(`Unexpected property: ${[...pathParts, key].join(".")}`);
        }
      }
    }
    return errors;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`Expected array at ${pathParts.join(".") || "root"}`);
      return errors;
    }
    if (schema.minItems && value.length < schema.minItems) {
      errors.push(`Array too short at ${pathParts.join(".") || "root"}: ${value.length}`);
    }
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateSchema(value[i], schema.items, [...pathParts, `${i}`]));
    }
    return errors;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`Expected string at ${pathParts.join(".") || "root"}`);
      return errors;
    }
    if (schema.maxLength && value.length > schema.maxLength) {
      errors.push(`String too long at ${pathParts.join(".") || "root"}: ${value.length}`);
    }
    return errors;
  }

  if (schema.type === "integer" || schema.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`Expected number at ${pathParts.join(".") || "root"}`);
    }
    return errors;
  }

  if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push(`Expected boolean at ${pathParts.join(".") || "root"}`);
    return errors;
  }

  if (Array.isArray(schema.type)) {
    if (!schema.type.includes(typeof value)) {
      errors.push(`Unexpected type at ${pathParts.join(".") || "root"}`);
    }
    return errors;
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`Invalid enum value at ${pathParts.join(".") || "root"}: ${safeStringify(value)}`);
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.some((sub: any) => validateSchema(value, sub).length === 0);
    if (!matched) errors.push(`No oneOf branch matched at ${pathParts.join(".") || "root"}`);
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((sub: any) => validateSchema(value, sub).length === 0);
    if (!matched) errors.push(`No anyOf branch matched at ${pathParts.join(".") || "root"}`);
  }

  return errors;
}

function extractJsonFromText(text: string): unknown | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sanitizeScope(value: string | undefined): value is SkillScope {
  if (!value) return false;
  return SKILL_SCOPE_SET.has(value as SkillScope);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function pickScopes(rawScopes: unknown): SkillScope[] {
  if (!Array.isArray(rawScopes)) return [];
  const selected: SkillScope[] = [];
  const seen = new Set<SkillScope>();
  for (const value of rawScopes) {
    if (typeof value !== "string") continue;
    const candidate = value.trim();
    if (sanitizeScope(candidate) && !seen.has(candidate)) {
      selected.push(candidate);
      seen.add(candidate);
      if (selected.length >= SKILL_PLATFORM_MAX_ALLOWED_SCOPES) {
        break;
      }
    }
  }
  return selected;
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashToHex(input: string, maxLen: number): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, maxLen);
}

function buildRequestSignature(request: SkillExecutionRequest): string {
  const signature = {
    text: sanitizeRequestInput(request.userMessage).slice(0, MAX_RUN_MESSAGE_LEN),
    attachments: normalizeAttachments(request.attachments).map((attachment) => ({
      id: attachment.id || "",
      name: attachment.name || "",
      mimeType: attachment.mimeType || "",
      size: attachment.size ?? 0,
    })),
    scopes: pickScopes(request.allowedScopes).sort(),
    intent: request.intentHint
      ? {
          intent: sanitizeRequestInput(request.intentHint.intent || "").slice(0, 120),
          language: sanitizeRequestInput(request.intentHint.language_detected || "").slice(0, 40),
          confidence: request.intentHint.confidence ?? 0,
          output_format: sanitizeRequestInput(request.intentHint.output_format || "").slice(0, 120),
        }
      : null,
    autoCreate: request.autoCreate ?? true,
    maxRetries: request.maxRetries ?? null,
  };

  return hashToHex(safeStringify(signature), 64);
}

function resolvePlanMatch(item: ExecutionPlanMatch): SkillPlanMatch {
  return {
    slug: item.skill.slug,
    catalogId: item.skill.catalogId,
    versionId: item.skill.versionId,
    name: item.skill.name,
    mode: item.skill.spec.implementationMode || "code",
    reason: item.reason,
    score: item.score,
    confidence: item.score,
    status: item.skill.status,
  };
}

export class SkillPlatformService {
  private skillsBySlug = new Map<string, RuntimeSkill>();
  private skillsById = new Map<string, RuntimeSkill>();
  private runCache = new Map<string, SkillExecutionCacheEntry>();
  private activeExecutionsById = new Map<string, Promise<SkillExecutionResult>>();
  private limiter = new ConversationExecutionLimiter(
    SKILL_PLATFORM_CONCURRENCY_LIMIT,
    SKILL_PLATFORM_QUEUE_TIMEOUT_MS
  );
  private initialized = false;
  private lastDbRefreshMs = 0;
  private initializationPromise: Promise<void> | null = null;
  private activeRunTokens = new Set<string>();
  private activeExecutionCount = 0;

  private pruneRunCache(now = safeNow()): void {
    if (this.runCache.size === 0) return;
    if (this.runCache.size > SKILL_PLATFORM_MAX_RUN_CACHE_ENTRIES) {
      const oldest = Array.from(this.runCache.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
        .slice(0, Math.max(1, Math.floor(this.runCache.size * 0.1)));
      for (const [key] of oldest) {
        this.runCache.delete(key);
      }
    }
    for (const [cacheKey, value] of this.runCache.entries()) {
      if (!value?.expiresAt || value.expiresAt <= now) {
        this.runCache.delete(cacheKey);
      }
    }
  }

  private getCachedResult(cacheKey: string, now = safeNow()): SkillExecutionResult | null {
    const entry = this.runCache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.runCache.delete(cacheKey);
      return null;
    }
    this.incrementMetric("cacheHit");
    return clone(entry.result);
  }

  private setCachedResult(cacheKey: string, result: SkillExecutionResult, now = safeNow()): void {
    this.pruneRunCache(now);
    this.runCache.set(cacheKey, {
      result: clone(result),
      expiresAt: now + SKILL_PLATFORM_RUN_CACHE_TTL_MS,
    });
  }

  private buildInFlightKey(request: SkillExecutionRequest): string {
    const scopedRun = sanitizeRunId(request.runId) || sanitizeRunId(request.requestId) || "run";
    const conversationToken = sanitizeRunId(request.conversationId) || "anon";
    const userToken = sanitizeRunId(request.userId) || "anon-user";
    const signature = buildRequestSignature(request);
    return hashToHex(`${scopedRun}|${conversationToken}|${userToken}|${signature}`, SKILL_PLATFORM_RUN_KEY_HASH_LENGTH);
  }

  private buildRunKey(request: SkillExecutionRequest, message: string): string {
    const normalizedRequest = {
      ...request,
      userMessage: sanitizeRequestInput(message).slice(0, MAX_RUN_MESSAGE_LEN),
      requestId: request.requestId,
    };
    const safeConversation = sanitizeRunId(request.conversationId) || "anon-conv";
    const scopedRun = sanitizeRunId(request.runId) || "anon-run";
    const normalizedMessage = normalizeText(normalizedRequest.userMessage).slice(0, 120);
    const base = [
      safeConversation,
      scopedRun,
      request.userId || "anon",
      buildRequestSignature(normalizedRequest),
      normalizedMessage,
      `a:${Array.isArray(request.attachments) ? request.attachments.length : 0}`,
    ].join("|");
    return hashToHex(base, SKILL_PLATFORM_RUN_KEY_HASH_LENGTH);
  }

  private incrementMetric(field: keyof Omit<SkillExecutionMetrics, "lastErrors" | "startedAt">): void {
    SKILL_PLATFORM_METRICS[field] += 1;
  }

  private incrementStageMetric(stage: SkillExecutionTraceEvent["stage"]): void {
    if (stage in SKILL_PLATFORM_METRICS.stageMetrics) {
      SKILL_PLATFORM_METRICS.stageMetrics[stage]++;
    }
  }

  private refreshActiveMetrics(): void {
    const activeRuns = Math.max(this.activeExecutionCount, this.activeRunTokens.size);
    SKILL_PLATFORM_METRICS.activeRuns = activeRuns;
    if (activeRuns > SKILL_PLATFORM_METRICS.peakConcurrent) {
      SKILL_PLATFORM_METRICS.peakConcurrent = activeRuns;
    }
  }

  private registerFailure(error: string): void {
    this.incrementMetric("failed");
    if (SKILL_PLATFORM_METRICS.lastErrors.length >= 12) {
      SKILL_PLATFORM_METRICS.lastErrors.shift();
    }
    SKILL_PLATFORM_METRICS.lastErrors.push(error);
  }

  private updateLatencyMetric(latencyMs: number): void {
    const completed = Math.max(1, SKILL_PLATFORM_METRICS.completed + SKILL_PLATFORM_METRICS.partial + SKILL_PLATFORM_METRICS.blocked + SKILL_PLATFORM_METRICS.failed + SKILL_PLATFORM_METRICS.skipped);
    const previousTotal = SKILL_PLATFORM_METRICS.avgLatencyMs * Math.max(0, completed - 1);
    SKILL_PLATFORM_METRICS.avgLatencyMs = Math.round(((previousTotal + latencyMs) / completed) * 100) / 100;
  }

  private emitRiskGate(payload: { stage: "policy" | "risk_gate"; status: "ok" | "warn" | "error"; message: string; details?: Record<string, unknown> }, request: SkillExecutionRequest): void {
    const details = payload.details ? sanitizeTraceDetails(payload.details) : undefined;
    this.emitTrace(request, {
      ...payload,
      stage: payload.stage,
      timestamp: new Date().toISOString(),
      details,
    });
    if (payload.status === "warn") {
      logger.warn("Skill platform risk gate", {
        requestId: request.requestId,
        runId: request.runId || request.requestId,
        details,
        message: payload.message,
      });
    }
    if (payload.status === "error") {
      logger.error("Skill platform risk gate", {
        requestId: request.requestId,
        runId: request.runId || request.requestId,
        details,
        message: payload.message,
      });
    }
  }

  private normalizeAllowedScopes(scopes: unknown): SkillScope[] {
    const normalized = pickScopes(scopes);
    return normalized.length > SKILL_PLATFORM_MAX_ALLOWED_SCOPES
      ? normalized.slice(0, SKILL_PLATFORM_MAX_ALLOWED_SCOPES)
      : normalized;
  }

  private async bootstrap(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    this.initializationPromise = (async () => {
      await this.seedBuiltins();
      await this.refreshFromDb();
      this.initialized = true;
      logger.info("Skill platform initialized", {
        skills: this.skillsBySlug.size,
      });
    })();
    await this.initializationPromise;
  }

  private async seedBuiltins(): Promise<void> {
    const now = safeNow();
    for (const builtin of BUILTIN_SKILLS) {
      const record: RuntimeSkill = {
        catalogId: `builtin-${builtin.slug}`,
        versionId: `builtin-${builtin.slug}-v1`,
        slug: builtin.slug,
        name: builtin.spec.name,
        description: builtin.spec.description,
        category: builtin.spec.category,
        status: "active",
        spec: builtin.spec,
        activeVersion: 1,
        latestVersion: 1,
        isManaged: true,
        createdBy: null,
      };
      this.skillsBySlug.set(builtin.slug, record);
      this.skillsById.set(record.catalogId, record);
      this.skillsBySlug.set(`${builtin.slug}-${record.versionId}`, record);
      logger.debug("Seeded builtin skill", {
        slug: record.slug,
        name: record.name,
      });
      void now;
    }
  }

  private async refreshFromDb(): Promise<void> {
    const now = safeNow();
    if (now - this.lastDbRefreshMs < 10_000) return;
    try {
      const catalogs = await db.select().from(skillCatalog).where(eq(skillCatalog.isActive, true));
      for (const catalogItem of catalogs) {
        const versions = await db.select()
          .from(skillCatalogVersions)
          .where(
            and(
              eq(skillCatalogVersions.catalogId, catalogItem.id),
              eq(skillCatalogVersions.status, "active")
            )
          )
          .orderBy(desc(skillCatalogVersions.version))
          .limit(1);

        const active = versions[0];
        if (!active) continue;

        const spec = this.normalizeSpec(active);
        if (!spec) continue;

        const runtime: RuntimeSkill = {
          catalogId: catalogItem.id,
          versionId: active.id,
          slug: catalogItem.slug,
          name: catalogItem.name,
          description: catalogItem.description || spec.description,
          category: catalogItem.category || spec.category,
          status: "active",
          spec,
          activeVersion: catalogItem.activeVersion,
          latestVersion: catalogItem.latestVersion,
          isManaged: catalogItem.isManaged,
          createdBy: active.createdBy || null,
        };

        if (runtime.slug) {
          this.skillsBySlug.set(runtime.slug, runtime);
        }
        this.skillsById.set(runtime.catalogId, runtime);
      }
      this.lastDbRefreshMs = now;
    } catch (error) {
      logger.warn("Skill platform DB sync skipped, using in-memory catalog", {
        error: (error as Error).message,
      });
    }
  }

  private normalizeSpec(versionRow: any): SkillSpec | null {
    try {
      const input = versionRow.inputSchema as unknown;
      const output = versionRow.outputSchema as unknown;
      const spec = (versionRow.spec as unknown) as SkillSpec;
      const merged = clone({
        ...spec,
        inputSchema: input || spec.inputSchema,
        outputSchema: output || spec.outputSchema,
        permissions: Array.isArray(versionRow.permissions) ? pickScopes(versionRow.permissions) : pickScopes(spec.permissions),
        executionPolicy: versionRow.executionPolicy || spec.executionPolicy || {
          maxRetries: 2,
          timeoutMs: 30000,
          cpuLimitMs: 150,
          memoryLimitMb: 256,
          requiresConfirmation: false,
          allowExternalSideEffects: false,
        },
        errorContract: Array.isArray(versionRow.errorContract) ? versionRow.errorContract : spec.errorContract || [],
        dependencies: Array.isArray(versionRow.dependencies) ? versionRow.dependencies : spec.dependencies || [],
        tags: Array.isArray(versionRow.tags) ? versionRow.tags : spec.tags || [],
        implementationMode: spec.implementationMode || "code",
      });
      const parsed = skillSpecSchema.safeParse(merged);
      if (!parsed.success) {
        logger.warn("Failed to validate skill version", {
          versionId: versionRow?.id,
          reasons: parsed.error.issues.map((issue) => issue.message),
        });
        return null;
      }
      return parsed.data;
    } catch (error) {
      logger.warn("Failed to normalize skill version", {
        versionId: versionRow?.id,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private emitTrace(req: SkillExecutionRequest, event: Omit<SkillExecutionTraceEvent, "timestamp" | "runId">): void {
    const safeDetails = event.details ? sanitizeTraceDetails(event.details) : undefined;
    const payload: SkillExecutionTraceEvent = {
      ...event,
      details: safeDetails,
      runId: req.runId || req.requestId,
      timestamp: new Date().toISOString(),
    };
    if (req.emitTrace) req.emitTrace(payload);
    this.incrementStageMetric(payload.stage);
    if (payload.status === "error") {
      logger.error("Skill platform trace", payload);
    } else if (payload.status === "warn") {
      logger.warn("Skill platform trace", payload);
    } else {
      logger.debug("Skill platform trace", payload);
    }
  }

  private buildMatchReason(parts: Array<[string, number]>): string {
    const meaningful = parts
      .filter(([, score]) => score > 0.01)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, score]) => `${label} ${(score * 100).toFixed(0)}%`);

    return meaningful.length > 0 ? meaningful.join(" · ") : "heuristic_match";
  }

  private async withServiceSpan<T>(
    stage: SkillExecutionTraceEvent["stage"],
    request: SkillExecutionRequest,
    fn: () => Promise<T>
  ): Promise<T> {
    return withSpan(
      getTraceSpanName(stage),
      async (_span) => {
        const stageStarted = safeNow();
        addAttributes({
          "skill.platform.stage": stage,
          "skill.platform.request_has_conversation": !!request.conversationId,
          "skill.platform.attachments": Array.isArray(request.attachments) ? request.attachments.length : 0,
          "skill.platform.scope_count": Array.isArray(request.allowedScopes) ? request.allowedScopes.length : 0,
        });
        try {
          const result = await fn();
          addAttributes({
            "skill.platform.stage_ms": safeNow() - stageStarted,
            "skill.platform.stage_status": "ok",
          });
          return result;
        } catch (error) {
          const err = error as Error;
          recordError(err);
          addAttributes({
            [SPAN_ATTRIBUTES.ERROR_TYPE]: err.name || "Error",
            [SPAN_ATTRIBUTES.ERROR_MESSAGE]: clampText(err.message || String(err), 256),
            "skill.platform.stage_ms": safeNow() - stageStarted,
            "skill.platform.stage_status": "error",
          });
          throw error;
        }
      },
      {
        requestId: request.requestId,
        userId: request.userId || undefined,
        sessionId: request.conversationId || undefined,
      }
    );
  }

  private async withExecutionConcurrency<T>(
    request: SkillExecutionRequest,
    fn: () => Promise<T>
  ): Promise<T> {
    const release = await this.limiter.acquire(request.conversationId, request.runId);
    this.activeExecutionCount += 1;
    this.refreshActiveMetrics();
    try {
      return await fn();
    } finally {
      release();
      this.activeExecutionCount -= 1;
      this.refreshActiveMetrics();
    }
  }

  private async executeWithCircuitBreaker<T>(
    request: SkillExecutionRequest,
    stage: "execution" | "factory",
    op: () => Promise<T>
  ): Promise<T> {
    const breaker = stage === "factory" ? SKILL_PLATFORM_FACTORY_BREAKER : SKILL_PLATFORM_EXECUTION_BREAKER;
    const result = await breaker.call(op, `${stage}:${request.requestId}`);
    if (!result.success) {
      throw new Error(result.error || `${stage} stage failed`);
    }
    return result.data as T;
  }

  private async withInFlightDedup<T>(
    request: SkillExecutionRequest,
    fn: () => Promise<T>
  ): Promise<T> {
    const token = this.buildInFlightKey(request);
    if (this.activeRunTokens.has(token)) {
      const existing = this.activeExecutionsById.get(token);
      if (existing) {
        return clone(await existing) as T;
      }
    }

    const activePromise = (async () => {
      this.activeRunTokens.add(token);
      this.refreshActiveMetrics();
      try {
        return await fn();
      } finally {
        this.activeRunTokens.delete(token);
        this.activeExecutionsById.delete(token);
        this.refreshActiveMetrics();
      }
    })();
    this.activeExecutionsById.set(token, activePromise as Promise<SkillExecutionResult>);
    return clone(await activePromise);
  }

  private buildRuntimeInput(request: SkillExecutionRequest): Record<string, unknown> {
    return {
      text: clampText(request.userMessage, 12000),
      attachments: request.attachments || [],
      userId: request.userId || null,
      conversationId: request.conversationId || null,
      runId: request.runId || request.requestId,
      requestId: request.requestId,
      requestedAt: (request.now || new Date()).toISOString(),
    };
  }

  private calculateErrorContract(spec: SkillSpec, error: Error): { code: string; message: string; retryable: boolean; fallbackHint?: string } {
    const fallback = spec.errorContract || [];
    const message = String(error?.message || "Unknown error");
    for (const entry of fallback) {
      if (message.toLowerCase().includes(entry.code.toLowerCase()) || message.toLowerCase().includes(entry.message.toLowerCase())) {
        return {
          code: entry.code,
          message: entry.message,
          retryable: entry.retryable || false,
          fallbackHint: entry.fallbackHint,
        };
      }
    }
    return {
      code: "UNKNOWN_ERROR",
      message,
      retryable: false,
      fallbackHint: "No se pudo completar esta ejecución. Continuaré con respuesta general.",
    };
  }

  private resolvePlanMatch(item: ExecutionPlanMatch): SkillPlanMatch {
    return {
      slug: item.skill.slug,
      catalogId: item.skill.catalogId,
      versionId: item.skill.versionId,
      name: item.skill.name,
      mode: item.skill.spec.implementationMode || "code",
      reason: item.reason,
      score: item.score,
      confidence: item.score,
      status: item.skill.status,
    };
  }

  private validateSkillSpec(spec: SkillSpec): SkillValidationResult {
    const parsed = skillSpecSchema.safeParse(spec);
    if (!parsed.success) {
      return {
        valid: false,
        reasons: parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
        ),
      };
    }

    const normalized = parsed.data;
    const policy = normalizePolicy(normalized.executionPolicy);
    const normalizedDependencies = normalizeSkillDependencies(normalized.dependencies);
    const hasSideEffectScopes = normalized.permissions.some((scope) => SIDE_EFFECT_SCOPES.has(scope));
    const reasons: string[] = [];
    const sanitizedPermissions = this.normalizeAllowedScopes(normalized.permissions);
    if (sanitizedPermissions.length > SKILL_PLATFORM_MAX_ALLOWED_SCOPES) {
      reasons.push("Too many permissions");
    }
    if (normalized.name.trim().length < 3) {
      reasons.push("Invalid name");
    }
    if (normalized.description.trim().length < 3) {
      reasons.push("Invalid description");
    }
    if (policy.timeoutMs < 100 || policy.timeoutMs > 180_000) {
      reasons.push("Invalid timeoutMs");
    }
    if (policy.maxRetries < 0 || policy.maxRetries > SKILL_PLATFORM_MAX_RETRY_BUDGET) {
      reasons.push("Invalid maxRetries");
    }
    if (policy.cpuLimitMs == null || policy.cpuLimitMs < 10 || policy.cpuLimitMs > 600_000) {
      reasons.push("Invalid cpuLimitMs");
    }
    if (policy.memoryLimitMb == null || policy.memoryLimitMb < 32 || policy.memoryLimitMb > 2048) {
      reasons.push("Invalid memoryLimitMb");
    }
    if (hasSideEffectScopes && !policy.allowExternalSideEffects && !policy.requiresConfirmation) {
      reasons.push("Side-effect scopes require explicit confirmation or allowExternalSideEffects=true");
    }
    if (normalizedDependencies.length > SKILL_PLATFORM_MAX_DEPENDENCIES) {
      reasons.push("Too many dependencies");
    }
    if (normalizedDependencies.length !== normalized.dependencies.length) {
      reasons.push("Invalid dependencies");
    }

    if (normalized.implementationMode === "workflow") {
      const workflow = normalized.workflow as SkillWorkflowDefinition | undefined;
      if (!workflow || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
        reasons.push("Workflow mode requires at least one step");
      } else if (normalized.name?.startsWith("Workflow Auto") && workflow.steps.length > MAX_AUTO_WORKFLOW_STEPS) {
        reasons.push(`Auto workflow exceeds max step limit (${MAX_AUTO_WORKFLOW_STEPS})`);
      } else if (workflow.steps.length > MAX_WORKFLOW_STEPS) {
        reasons.push(`Workflow exceeds max step limit (${MAX_WORKFLOW_STEPS})`);
      }
    }

    if (normalized.implementationMode === "code") {
      const language = normalized.code?.language;
      if (language !== "javascript" && language !== "python") {
        reasons.push("Code mode requires javascript or python");
      }
      const source = normalized.code?.source;
      if (typeof source !== "string" || source.trim().length < 20) {
        reasons.push("Code source is required");
      }
    }

    return { valid: reasons.length === 0, reasons };
  }

  private async compileSkillSpec(spec: SkillSpec): Promise<SkillValidationResult> {
    const base = this.validateSkillSpec(spec);
    if (!base.valid) return base;

    const normalized = skillSpecSchema.parse(spec);
    const normalizedPermissions = this.normalizeAllowedScopes(normalized.permissions);
    const normalizedDependencies = normalizeSkillDependencies(normalized.dependencies);
    const normalizedPolicy = normalizePolicy(normalized.executionPolicy);

    if (normalized.permissions.length !== normalizedPermissions.length) {
      return {
        valid: false,
        reasons: ["Invalid or unsupported permissions"],
      };
    }

    if (normalized.dependencies.length !== normalizedDependencies.length) {
      return {
        valid: false,
        reasons: ["Invalid or unsupported dependencies"],
      };
    }

    if (normalizedDependencies.length > SKILL_PLATFORM_MAX_DEPENDENCIES) {
      return {
        valid: false,
        reasons: [`Too many dependencies (${SKILL_PLATFORM_MAX_DEPENDENCIES})`],
      };
    }

    const hasSideEffectScopes = normalizedPermissions.some((scope) => SIDE_EFFECT_SCOPES.has(scope));
    if (hasSideEffectScopes && !normalizedPolicy.allowExternalSideEffects && !normalizedPolicy.requiresConfirmation) {
      return {
        valid: false,
        reasons: ["Side-effect permissions require explicit confirmation or allowExternalSideEffects=true"],
      };
    }

    if (normalized.implementationMode === "code" && normalized.code) {
      const codeIssues = this.validateCodeSource(normalized.code.language, normalized.code.source);
      if (codeIssues.length > 0) {
        return { valid: false, reasons: codeIssues };
      }
    }

    if (normalized.implementationMode === "workflow" && normalized.workflow) {
      const workflow = normalized.workflow;
      const steps = workflow.steps || [];
      if (!Array.isArray(steps) || steps.length === 0) {
        return { valid: false, reasons: ["Workflow must include at least one step"] };
      }
      if (steps.length > MAX_WORKFLOW_STEPS) {
        return { valid: false, reasons: [`Workflow exceeds max step limit (${MAX_WORKFLOW_STEPS})`] };
      }

      const stepIds = new Set<string>();
      const outputKeys = new Set<string>();
      const requiredStepDeps: string[] = [];
      const sideEffectPermitted = normalizedPolicy.allowExternalSideEffects || normalizedPolicy.requiresConfirmation;

      for (const step of steps) {
        if (!step || typeof step.id !== "string" || !step.id.trim()) {
          return { valid: false, reasons: ["Workflow steps must declare ids"] };
        }
        const stepId = step.id.trim();
        if (!TOOL_NAME_RE.test(stepId) || stepId.length > SKILL_PLATFORM_RUNTIME_INPUT_KEY_LIMIT) {
          return { valid: false, reasons: ["Workflow step ids must be safe identifiers"] };
        }
        if (stepIds.has(stepId)) {
          return { valid: false, reasons: ["Workflow step ids must be unique"] };
        }
        stepIds.add(stepId);

        if (!step.name || typeof step.name !== "string" || !step.name.trim()) {
          return { valid: false, reasons: ["Workflow internal steps require a valid name"] };
        }
        if (!TOOL_NAME_RE.test(step.name.trim())) {
          return { valid: false, reasons: [`Workflow step ${stepId} has invalid name`] };
        }

        if (step.kind === "tool" && (typeof step.toolName !== "string" || !step.toolName.trim())) {
          return { valid: false, reasons: [`Workflow tool step ${stepId} requires toolName`] };
        }
        if (step.kind === "tool" && !TOOL_NAME_RE.test(step.toolName!.trim())) {
          return { valid: false, reasons: [`Workflow step ${stepId} has invalid toolName`] };
        }

        if (typeof step.outputKey !== "string" || !step.outputKey.trim()) {
          return { valid: false, reasons: [`Workflow step ${stepId} requires outputKey`] };
        }
        if (!TOOL_NAME_RE.test(step.outputKey.trim()) || step.outputKey.length > SKILL_PLATFORM_RUNTIME_INPUT_KEY_LIMIT) {
          return { valid: false, reasons: [`Workflow step ${stepId} has invalid outputKey`] };
        }
        if (outputKeys.has(step.outputKey)) {
          return { valid: false, reasons: [`Duplicate workflow outputKey: ${step.outputKey}`] };
        }
        outputKeys.add(step.outputKey);

        const requiredScopes = this.normalizeAllowedScopes(step.requiredScopes);
        if (requiredScopes.length !== (step.requiredScopes || []).length) {
          return { valid: false, reasons: [`Invalid scope in workflow step ${stepId}`] };
        }
        if (requiredScopes.some((scope) => SIDE_EFFECT_SCOPES.has(scope)) && !sideEffectPermitted) {
          return {
            valid: false,
            reasons: [`Workflow step ${stepId} requests side-effect scope without confirmation policy`],
          };
        }

        if (step.inputSchema && typeof step.inputSchema !== "object") {
          return { valid: false, reasons: [`Workflow step ${stepId} inputSchema must be an object`] };
        }

        const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn : [];
        if (dependsOn.length > 0) {
          if (new Set(dependsOn).size !== dependsOn.length) {
            return { valid: false, reasons: [`Workflow step ${stepId} has duplicated dependencies`] };
          }
          for (const dep of dependsOn) {
            if (typeof dep !== "string" || !dep.trim()) {
              return { valid: false, reasons: [`Workflow step ${stepId} has invalid dependsOn entry`] };
            }
            requiredStepDeps.push(dep);
          }
        }
      }

      if (requiredStepDeps.some((dep) => !stepIds.has(dep))) {
        return { valid: false, reasons: ["Workflow dependency refers to unknown step"] };
      }

      if (workflow.resultStep && !stepIds.has(workflow.resultStep)) {
        return { valid: false, reasons: ["Workflow resultStep refers to unknown step"] };
      }
      if (!workflow.resultStep) {
        const terminal = steps[steps.length - 1];
        if (!terminal?.outputKey) {
          return { valid: false, reasons: ["workflow requires a resultStep or valid terminal outputKey"] };
        }
      }
    }

    return { valid: true, reasons: [] };
  }

  private buildDryRunInput(inputSchema: any): Record<string, unknown> {
    if (!inputSchema || typeof inputSchema !== "object" || inputSchema.type !== "object") {
      return {};
    }

    const properties = inputSchema.properties;
    if (!properties || typeof properties !== "object") {
      return {};
    }

    const output: Record<string, unknown> = {};
    const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];

    for (const key of required) {
      if (!(key in properties)) continue;
      const spec = properties[key];
      if (!spec || typeof spec !== "object") {
        output[key] = null;
        continue;
      }

      if (spec.type === "array") {
        output[key] = [];
      } else if (spec.type === "object") {
        output[key] = {};
      } else if (spec.type === "number" || spec.type === "integer") {
        output[key] = 1;
      } else if (spec.type === "boolean") {
        output[key] = false;
      } else {
        output[key] = `sample-${String(key)}`;
      }
    }

    return output;
  }

  private async runAutoSkillDryRun(spec: SkillSpec, request: SkillExecutionRequest): Promise<SkillValidationResult> {
    const dryRunSkill: RuntimeSkill = {
      catalogId: `dry_run_${Date.now()}`,
      versionId: "dry-run-v1",
      slug: `dry_run_storage`,
      name: spec.name,
      description: spec.description,
      category: spec.category || "general",
      status: "active",
      spec,
      activeVersion: 1,
      latestVersion: 1,
      isManaged: true,
      createdBy: request.userId || null,
    };

    const dryRequest: SkillExecutionRequest = {
      requestId: `${request.requestId}:dryrun`,
      runId: `${request.runId || request.requestId}:dryrun`,
      conversationId: request.conversationId,
      userId: request.userId,
      userMessage: "",
      allowedScopes: ["storage.read"],
      now: new Date(),
    };

    const context = this.createExecutionContext(dryRequest, dryRunSkill);
    const dryInput = this.buildDryRunInput(spec.inputSchema);
    try {
      await fs.mkdir(context.workspacePath, { recursive: true });
      const output = await this.executeSkill(dryRequest, dryRunSkill, context, dryInput);
      const outputValidation = validateSchema(output.output, spec.outputSchema || {});
      if (outputValidation.length > 0) {
        return {
          valid: false,
          reasons: [`Dry-run output contract failure: ${outputValidation.slice(0, 2).join(", ")}`],
        };
      }

      return { valid: true, reasons: [] };
    } catch (error) {
      return {
        valid: false,
        reasons: [
          `Auto skill dry-run failed: ${(error as Error)?.message || "unknown"}`,
        ],
      };
    } finally {
      await fs.rm(context.workspacePath, { recursive: true, force: true }).catch(() => { });
    }
  }

  private isScopeAllowed(required: SkillScope[], allowed: SkillScope[]): { ok: boolean; missing: SkillScope[] } {
    const allowedSet = new Set(allowed);
    const missing = required.filter((scope) => !allowedSet.has(scope));
    return {
      ok: missing.length === 0,
      missing,
    };
  }

  private requiresConfirmation(scopes: SkillScope[], policy: SkillExecutionPolicy): boolean {
    if (policy.requiresConfirmation) return true;
    return scopes.some((scope) => RISKY_SCOPES.has(scope));
  }

  private async runWorkflow(
    request: SkillExecutionRequest,
    skill: RuntimeSkill,
    context: ExecutionContext,
    input: Record<string, unknown>
  ): Promise<{ output: unknown; partial: unknown; complete: boolean; outputText: string; executionError?: string; failedStepId?: string }> {
    const workflow = skill.spec.workflow as SkillWorkflowDefinition | undefined;
    if (!workflow) {
      throw new Error("Workflow definition is missing");
    }

    const steps = workflow.steps || [];
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error("Workflow has no steps");
    }
    if (steps.length > MAX_WORKFLOW_STEPS) {
      throw new Error("Workflow exceeds step limit");
    }
    const { sorted, hasCycle } = sortWorkflowSteps(steps);
    if (hasCycle) {
      throw new Error("Workflow has dependency cycle");
    }

    const stepCache: Record<string, unknown> = {};
    const resolvedContext = {
      input,
      state: context.state,
      steps: stepCache,
    };
    const partialOutputs: unknown[] = [];
    let lastOutput: unknown = undefined;
    let executionError: Error | null = null;
    let failedStepId: string | null = null;

    for (const step of sorted) {
      const started = safeNow();
      let output: unknown;
      try {
        const resolvedInput = interpolateTemplate(step.input || {}, resolvedContext) as Record<string, unknown>;
        const sanitizedResolvedInput = sanitizeExecutionInput(resolvedInput) as Record<string, unknown>;
        output = await this.executeStep(
          request,
          step,
          skill,
          context,
          sanitizedResolvedInput,
          [...request.attachments || []]
        );
        const toCache = step.outputKey ? {
          output: output,
          input: sanitizedResolvedInput,
          step: step.id,
        } : output;
        if (step.outputKey) {
          (stepCache as Record<string, unknown>)[step.outputKey] = toCache;
        } else {
          (stepCache as Record<string, unknown>)[step.id] = toCache;
        }
        lastOutput = output;
        this.emitTrace(request, {
          stage: "execution",
          status: "ok",
          message: `workflow_step_completed:${step.id}`,
          details: {
            step: step.id,
            kind: step.kind,
            elapsedMs: safeNow() - started,
          },
        });
      } catch (error) {
        const err = error as Error;
        partialOutputs.push({
          step: step.id,
          error: err.message || String(err),
        });
        this.emitTrace(request, {
          stage: "execution",
          status: "warn",
          message: `workflow_step_failed:${step.id}`,
          details: {
            step: step.id,
            error: err.message,
            continueOnError: step.continueOnError,
          },
        });
        if (!step.continueOnError) {
          executionError = err;
          failedStepId = step.id;
          break;
        }
      }
    }

    const selectedResultKey = workflow.resultStep || workflow.steps[workflow.steps.length - 1]?.outputKey || workflow.steps[workflow.steps.length - 1]?.id;
    const chosen = selectedResultKey && (stepCache as Record<string, unknown>)[selectedResultKey];

    const outputText =
      typeof chosen === "string"
        ? chosen
        : typeof chosen === "object" && chosen
          ? safeStringify(chosen)
          : safeStringify(lastOutput);

    return {
      output: chosen ?? lastOutput ?? {},
      partial: partialOutputs.length > 0 ? partialOutputs : undefined,
      complete: executionError === null && partialOutputs.length === 0,
      outputText,
      executionError: executionError?.message,
      failedStepId: failedStepId || undefined,
    };
  }

  private parseRetryDelay(attempt: number): number {
    const base = 150 * Math.pow(1.9, attempt);
    const jitter = Math.random() * 75;
    return Math.min(Math.round(base + jitter), 1_500);
  }

  private resolveRetryBudget(request: SkillExecutionRequest, policy: SkillExecutionPolicy): number {
    const requested = Number.isInteger(request.maxRetries) ? request.maxRetries : policy.maxRetries;
    return clampPolicyInt(requested, policy.maxRetries, 0, policy.maxRetries);
  }

  private resolveExecutionPolicy(rawPolicy: SkillExecutionPolicy | undefined): SkillExecutionPolicy {
    return normalizePolicy(rawPolicy);
  }

  private async enforceStepScopePolicy(step: SkillWorkflowStep, request: SkillExecutionRequest): Promise<void> {
    const requiredScopes = Array.isArray(step.requiredScopes) ? step.requiredScopes : [];
    if (!requiredScopes.length) return;
    const { missing } = this.isScopeAllowed(requiredScopes, this.normalizeAllowedScopes(request.allowedScopes));
    if (missing.length) {
      this.emitRiskGate(
        {
          stage: "risk_gate",
          status: "warn",
          message: `workflow_step_scope_blocked:${step.id}`,
          details: { stepId: step.id, missing },
        },
        request
      );
      throw new Error(`Step ${step.id} blocked by scope policy (${missing.join(", ")})`);
    }
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number, request: SkillExecutionRequest): Promise<T> {
    const effectiveTimeout = Math.max(100, Math.min(timeoutMs, EXECUTION_TIMEOUT_FALLBACK_MS));
    const started = safeNow();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`execution timeout after ${effectiveTimeout}ms`));
          }, effectiveTimeout);
        }),
      ]);
    } finally {
      this.emitTrace(request, {
        stage: "execution",
        status: timedOut ? "error" : "ok",
        message: timedOut ? "execution_timeout" : "execution_segment_complete",
        details: {
          timeoutMs: effectiveTimeout,
          elapsedMs: safeNow() - started,
          timedOut,
        },
      });
      if (timer) clearTimeout(timer);
    }
  }

  private async executeSkillWithRetries(
    request: SkillExecutionRequest,
    selected: RuntimeSkill,
    context: ExecutionContext,
    input: Record<string, unknown>,
    maxRetries: number,
    timeoutMs: number
  ): Promise<{ output: unknown; outputText: string; partialOutput?: unknown; complete: boolean; executionError?: string; failedStepId?: string; attempts: number; timedOut: boolean; }> {
    let lastError: unknown = null;
    let timedOut = false;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeWithTimeout(
          () => this.executeSkill(request, selected, context, input),
          timeoutMs,
          request
        );
        return { ...result, attempts: attempt + 1, timedOut: false };
      } catch (error) {
        lastError = error as Error;
        timedOut = timedOut || String((error as Error)?.message || "").includes("execution timeout");
        if (attempt >= maxRetries) {
          break;
        }
        this.emitTrace(request, {
          stage: "execution",
          status: "warn",
          message: `execution_retry:${attempt}`,
          details: { attempt, maxRetries, error: (error as Error).message },
        });
        await new Promise((resolve) => setTimeout(resolve, this.parseRetryDelay(attempt)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Skill execution failed");
  }

  private async executeStep(
    request: SkillExecutionRequest,
    step: SkillWorkflowStep,
    rootSkill: RuntimeSkill,
    context: ExecutionContext,
    input: Record<string, unknown>,
    _attachments: SkillExecutionAttachment[]
  ): Promise<unknown> {
    const safeInput = sanitizeExecutionInput(input) as Record<string, unknown>;
    const policy = rootSkill.spec.executionPolicy || {
      maxRetries: 0,
      timeoutMs: 30000,
      requiresConfirmation: false,
      allowExternalSideEffects: false,
    };
    const normalizedPolicy = this.resolveExecutionPolicy(policy);
    const stepTimeoutMs = Math.max(100, step.timeoutMs || normalizedPolicy.timeoutMs);
    const maxRetries = this.resolveRetryBudget(request, normalizedPolicy);
    await this.enforceStepScopePolicy(step, request);
    if (step.inputSchema) {
      const inputValidation = validateSchema(safeInput, step.inputSchema);
      if (inputValidation.length > 0) {
        throw new Error(`Workflow step input validation failed: ${inputValidation.slice(0, 2).join(", ")}`);
      }
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeWithTimeout(async () => {
          if (step.kind === "internal") {
            const internal = this.skillsBySlug.get(step.name);
            if (!internal) {
              throw new Error(`Internal skill not found: ${step.name}`);
            }
            const result = await this.executeSkill(request, internal, context, safeInput);
            return result.output;
          }
          if (step.kind === "tool") {
            const toolName = step.toolName;
            if (!toolName) throw new Error(`tool step missing toolName: ${step.id}`);
            const result = await toolExecutionEngine.execute(toolName, safeInput, {
              timeout: stepTimeoutMs,
              maxRetries: 0,
              userId: request.userId,
            });
            if (!result.success) {
              throw new Error(result.error || "tool execution failed");
            }
            return result.data;
          }
          if (step.kind === "code") {
            const rootSpec = rootSkill.spec;
            if (!rootSpec.code?.source) {
              throw new Error(`code step has no source: ${step.id}`);
            }
            const codeResult = await this.executeCodeOrPython(
              rootSpec,
              request,
              context,
              safeInput,
              `${rootSkill.catalogId}:${step.id}`
            );
            return codeResult.output;
          }
          throw new Error(`Unsupported step kind: ${step.kind}`);
        }, stepTimeoutMs, request);
      } catch (error) {
        lastError = error as Error;
        this.emitTrace(request, {
          stage: "tooling",
          status: "warn",
          message: `step_retry:${step.id}:${attempt}`,
          details: { step: step.id, attempt, error: lastError.message },
        });
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(150 * (attempt + 1), 1200)));
          continue;
        }
      }
    }
    throw lastError || new Error("Unknown workflow step failure");
  }

  private async executeCodeOrPython(
    spec: SkillSpec,
    request: SkillExecutionRequest,
    context: ExecutionContext,
    input: Record<string, unknown>,
    runIdTag: string
  ): Promise<{ output: unknown; outputText: string }> {
    const codeMode = spec.code;
    if (!codeMode) throw new Error("Missing skill code definition");
    const policy = this.resolveExecutionPolicy(spec.executionPolicy);
    if (codeMode.language === "javascript") {
      return await this.executeJavaScriptCode(
        codeMode.source,
        request,
        context,
        input,
        runIdTag,
        policy.timeoutMs
      );
    }
    if (codeMode.language === "python") {
      return await this.executePythonCode(codeMode.source, request, context, input, runIdTag, policy.timeoutMs);
    }
    throw new Error(`Unsupported language ${codeMode.language}`);
  }

  private validateCodeSource(language: "javascript" | "python", source: string): string[] {
    const normalized = String(source || "");
    if (!normalized.trim()) return ["code is empty"];
    const banned = [
      "require(",
      "import os",
      "subprocess",
      "child_process",
      "fs.",
      "spawn(",
      "exec(",
      "readFileSync",
      "writeFileSync",
      "socket",
      "http.",
      "requests.",
      "urllib",
      "process.env",
      "globalThis.process",
      "Function(",
      "eval(",
      "new Function",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "__proto__",
      "constructor",
      "globalThis",
      "process.mainModule",
    ];
    const found = banned.filter((token) => normalized.includes(token));
    if (found.length > 0) {
      return found.map((token) => `forbidden token: ${token}`);
    }
    if (language === "javascript") {
      try {
        new vm.Script(normalized);
      } catch (error) {
        return [`javascript syntax error: ${(error as Error).message}`];
      }
    }
    return [];
  }

  private async executeJavaScriptCode(
    source: string,
    request: SkillExecutionRequest,
    context: ExecutionContext,
    input: Record<string, unknown>,
    runIdTag: string,
    timeoutMs: number
  ): Promise<{ output: unknown; outputText: string }> {
    const issues = this.validateCodeSource("javascript", source);
    if (issues.length > 0) {
      throw new Error(issues.join("; "));
    }
    const safeInput = sanitizeExecutionInput(input) as Record<string, unknown>;
    const safeState = sanitizeExecutionInput(context.state) as Record<string, unknown>;
    const events: unknown[] = [];
    const emitEvent = (type: string, payload: unknown) => {
      if (events.length >= SKILL_PLATFORM_MAX_WORKFLOW_EVENTS) return;
      events.push({ type, data: payload, ts: safeNow() });
    };
    const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
    const safeContext = {
      module: moduleObj,
      exports: moduleObj.exports,
      __input: safeInput,
      __state: safeState,
      __events: events,
      __emit: (name: string, payload: unknown) => emitEvent(name, payload),
      console: {
        log: (...args: unknown[]) => emitEvent("log", args),
        warn: (...args: unknown[]) => emitEvent("warn", args),
        error: (...args: unknown[]) => emitEvent("error", args),
      },
      JSON,
      Object,
      Array,
      Math,
      Date,
      Number,
      String,
      Boolean,
    } as const;
    const script = new vm.Script(
      [
        "(async () => {",
        source,
        "const fn = (module.exports?.default) || (module.exports.run) || module.exports;",
        "if (typeof fn !== 'function') { throw new Error('Skill code must export a function'); }",
        "return await Promise.resolve(fn(__input, __state, __emit));",
        "})();",
      ].join("\n")
    );

    const vmContext = vm.createContext(safeContext);
    const rawResult = await Promise.race([
      Promise.resolve(script.runInContext(vmContext, { filename: `skill-${runIdTag}.mjs`, timeout: timeoutMs })),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("js execution timeout")), timeoutMs + 200)
      ),
    ]);
    const output = await Promise.resolve(rawResult);
    const outputText =
      typeof output === "string"
        ? clampOutputText(output, SKILL_PLATFORM_MAX_OUTPUT_TEXT_LEN)
        : typeof output === "object" && output
          ? clampOutputText(safeStringify((output as { text?: string }).text ?? output), SKILL_PLATFORM_MAX_OUTPUT_TEXT_LEN)
          : clampOutputText(safeStringify(output), SKILL_PLATFORM_MAX_OUTPUT_TEXT_LEN);
    this.emitTrace(request, {
      stage: "execution",
      status: "ok",
      message: "javascript_execution_done",
      details: {
        runIdTag,
        workspace: context.workspacePath,
        outputType: typeof output,
        events: events.length,
      },
    });
    return { output, outputText };
  }

  private async executePythonCode(
    source: string,
    request: SkillExecutionRequest,
    context: ExecutionContext,
    input: Record<string, unknown>,
    runIdTag: string,
    timeoutMs: number
  ): Promise<{ output: unknown; outputText: string }> {
    const issues = this.validateCodeSource("python", source);
    if (issues.length > 0) {
      throw new Error(issues.join("; "));
    }
    const safeInput = sanitizeExecutionInput(input);
    const safeState = sanitizeExecutionInput(context.state);
    const safeInputText = safeStringify(safeInput);
    const safeStateText = safeStringify(safeState);
    if (safeInputText.length > SKILL_PLATFORM_MAX_WORKFLOW_STEP_DETAILS_BYTES || safeStateText.length > SKILL_PLATFORM_MAX_WORKFLOW_STEP_DETAILS_BYTES) {
      throw new Error("Python execution input exceeds safety limits");
    }

    const wrappedSource = [
      "import json",
      "from typing import Any, Dict",
      "input_payload: Dict[str, Any] = json.loads(",
      safeStringify(safeInput),
      ")",
      "state = json.loads(",
      safeStringify(safeState),
      ")",
      "events = []",
      "def emit(event, payload):",
      "    events.append({\"event\": event, \"payload\": payload})",
      source,
      "",
      "func = globals().get('run')",
      "if func is None:",
      "    raise RuntimeError('Python skill must expose run(input, state, emit)')",
      "result = func(input_payload, state, emit)",
      "print(json.dumps({'result': result, 'events': events}, ensure_ascii=False))",
    ].join("\n");

    const effectivePolicy = normalizePolicy(context.policy);
    const allowNetwork = Boolean(effectivePolicy.allowExternalSideEffects && request.allowedScopes?.includes("external_network"));
    const maxMemoryMB = clampPolicyInt(effectivePolicy.memoryLimitMb, 256, 32, 2048);
    const result = await safeExecutePython(wrappedSource, {
      maxExecutionTime: Math.max(100, timeoutMs || effectivePolicy.timeoutMs || 30000),
      maxOutputSize: 256 * 1024,
      allowNetwork,
      maxMemoryMB,
      allowFileWrite: false,
    });
    if (!result.success) {
      throw new Error(result.error || result.stderr || "python execution failed");
    }
    const parsed = extractJsonFromText(result.stdout);
    const output = parsed && typeof parsed === "object" && "result" in parsed ? (parsed as any).result : parsed;
    const outputText = clampOutputText(typeof output === "string" ? output : safeStringify(output), SKILL_PLATFORM_MAX_OUTPUT_TEXT_LEN);
    this.emitTrace(request, {
      stage: "execution",
      status: "ok",
      message: "python_execution_done",
      details: {
        runIdTag,
        executionTime: result.executionTime,
        workspace: context.workspacePath,
      },
    });
    return { output, outputText };
  }

  private async createRunRecord(
    request: SkillExecutionRequest,
    data: PersistedExecutionRunData
  ): Promise<string | null> {
    if (!data.catalogId || !data.versionId) {
      return null;
    }
    try {
      const normalizedStatus = typeof data.status === "string"
        ? skillExecutionStatusSchema.safeParse(data.status)
        : skillExecutionStatusSchema.parse("running");
      const values = {
        conversationId: request.conversationId || null,
        runId: request.runId || request.requestId,
        userId: request.userId || null,
        catalogId: data.catalogId,
        versionId: data.versionId,
        status: normalizedStatus.success ? normalizedStatus.data : "running",
        requestText: clampText(request.userMessage, 20000),
        input: this.buildRuntimeInput(request),
        output: clampPersistedPayload(data.output),
        partialOutput: clampPersistedPayload(data.partialOutput),
        policy: clampPersistedPayload(data.policy) || {},
        error: clampPersistedPayload(data.error),
        fallbackUsed: !!data.continueWithModel,
        latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
        traces: Array.isArray(data.traces) ? data.traces : [],
      };
      const inserted = await db
        .insert(skillExecutionRuns)
        .values(values as any)
        .returning({ id: skillExecutionRuns.id });
      return inserted?.[0]?.id || null;
    } catch (error) {
      logger.warn("Failed to create skill execution run", {
        requestId: request.requestId,
        runId: request.runId,
        error: sanitizeErrorText((error as Error).message),
      });
      return null;
    }
  }

  private async persistRun(
    request: SkillExecutionRequest,
    status: unknown,
    data: Record<string, unknown>,
    runRecordId?: string | null
  ): Promise<void> {
    try {
      const normalizedStatus = typeof status === "string"
        ? skillExecutionStatusSchema.safeParse(status)
        : skillExecutionStatusSchema.safeParse(data.status);
      const resolvedStatus = normalizedStatus.success ? normalizedStatus.data : "failed";

      if (runRecordId) {
        const statusValue = String(resolvedStatus) as "pending" | "running" | "completed" | "partial" | "failed" | "skipped";
        const updateValues: Record<string, unknown> = {
          status: statusValue,
          fallbackUsed: !!(data.continueWithModel || data.fallbackUsed),
          output: clampPersistedPayload(data.output),
          partialOutput: clampPersistedPayload(data.partialOutput),
          policy: clampPersistedPayload(data.policy),
          error: clampPersistedPayload(data.error),
          traces: Array.isArray(data.traces) ? data.traces : [],
          latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
        };
        if (resolvedStatus && ["completed", "partial", "failed", "skipped"].includes(resolvedStatus)) {
          (updateValues as Record<string, unknown>).finishedAt = new Date();
        }
        await db.update(skillExecutionRuns).set(updateValues).where(eq(skillExecutionRuns.id, runRecordId));
        return;
      }

      if (!data.catalogId || !data.versionId) {
        return;
      }

      const runId = (() => {
        const safeBase = sanitizeRunId(request.requestId);
        const safeTail = sanitizeRunId(request.requestId) || "run";
        return `${safeBase || `run_${uuidv4().replace(/-/g, "").slice(0, 12)}`}-${safeTail.slice(0, 6)}`;
      })();
      const persistedOutput = clampPersistedPayload(data.output);
      const persistedPartial = clampPersistedPayload(data.partialOutput);
      await db.insert(skillExecutionRuns).values({
        id: runId,
        conversationId: request.conversationId || null,
        runId: request.runId || request.requestId,
        userId: request.userId || null,
        catalogId: (data.catalogId as string) || null,
        versionId: (data.versionId as string) || null,
        status: resolvedStatus,
        requestText: clampText(request.userMessage, 20000),
        input: this.buildRuntimeInput(request),
        output: persistedOutput,
        partialOutput: persistedPartial,
        policy: clampPersistedPayload(data.policy) || {},
        error: clampPersistedPayload(data.error),
        fallbackUsed: !!data.continueWithModel,
        latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
        traces: Array.isArray(data.traces) ? data.traces : [],
      });
    } catch (error) {
      logger.warn("Failed to persist skill execution run", {
        requestId: request.requestId,
        runId: request.runId,
        error: sanitizeErrorText((error as Error).message),
      });
    }
  }

  private async persistRunStatus(runRecordId: string, status: "pending" | "running" | "completed" | "partial" | "failed"): Promise<void> {
    try {
      const parsed = skillExecutionStatusSchema.parse(status);
      await db
        .update(skillExecutionRuns)
        .set({ status: parsed, updatedAt: new Date() })
        .where(eq(skillExecutionRuns.id, runRecordId));
    } catch (error) {
      // best effort
    }
  }

  private async executeSkill(
    request: SkillExecutionRequest,
    skill: RuntimeSkill,
    context: ExecutionContext,
    input: Record<string, unknown>
  ): Promise<{ output: unknown; outputText: string; partialOutput?: unknown; complete: boolean }> {
    const mode = skill.spec.implementationMode || "code";
    if (mode === "workflow") {
      const result = await this.runWorkflow(request, skill, context, input);
      return {
        output: result.output,
        outputText: result.outputText,
        partialOutput: result.partial,
        complete: result.complete,
      };
    }
    if (mode === "code") {
      const result = await this.executeCodeOrPython(skill.spec, request, context, input, `${skill.catalogId}-${skill.versionId}`);
      return {
        output: result.output,
        outputText: result.outputText,
        complete: true,
      };
    }
    throw new Error(`Unsupported implementation mode: ${mode}`);
  }

  private createExecutionContext(request: SkillExecutionRequest, catalogEntry: RuntimeSkill, runRecordId?: string): ExecutionContext {
    const safeRunId = sanitizeRunId(request.runId) || sanitizeRunId(request.requestId) || `run_${uuidv4()}`;
    const runId = safeRunId;
    const workspace = resolveWorkspacePath(runId);
    return {
      runId,
      runRecordId,
      requestId: request.requestId,
      conversationId: request.conversationId,
      userId: request.userId || null,
      startMs: safeNow(),
      attempts: 0,
      policy: catalogEntry.spec.executionPolicy || {
        maxRetries: 1,
        timeoutMs: 30000,
        cpuLimitMs: 300,
        memoryLimitMb: 256,
        requiresConfirmation: false,
        allowExternalSideEffects: false,
      },
      workspacePath: workspace,
      state: {
        requestId: request.requestId,
        runId,
        conversationId: request.conversationId || null,
        userId: request.userId || null,
      },
    };
  }

  private inferAutoSkill(userMessage: string): SkillSpec {
    const normalized = normalizeText(userMessage);
    const hasCode = /python|javascript|codigo|script|program/gi.test(normalized);
    const hasNetwork = /busca|buscar|web|internet|buscar|news|noticias|search/.test(normalized);
    const hasExternal = /enviar|email|correo|whatsapp|telegram|db|base de datos|sql|database|conex/.test(normalized);
    const permissions: SkillScope[] = [...BUILTIN_SCOPE];
    if (hasNetwork) permissions.push("external_network");
    if (hasExternal) permissions.push("email", "database");

    const codeLanguage = /python/i.test(normalized) ? "python" : "javascript";
    const sourceJs = [
      "module.exports = async function run(input) {",
      "  const text = String(input?.text || '').trim();",
      "  if (!text) return { status: 'no_input', text: '' };",
      "  return { text, status: 'ok', notes: ['auto_skill_generated'] };",
      "};",
    ].join("\n");
    const sourcePy = [
      "def run(payload, state, emit):",
      "    text = str(payload.get('text', '')).strip()",
      "    if not text:",
      "        return {'status':'no_input', 'text': ''}",
      "    return {'text': text, 'status': 'ok', 'notes': ['auto_skill_generated']}",
    ].join("\n");

    const useWorkflow = /paso|secuencia|proceso|pipeline|workflow|encadena/.test(normalized);
    if (useWorkflow) {
      return {
        name: `Workflow Auto ${Math.floor(Math.random() * 10000)}`,
        description: "Plantilla auto-generada basada en pasos existentes",
        category: "general",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            status: { type: "string" },
          },
          required: ["text"],
          additionalProperties: false,
        },
        permissions,
        expectedLatencyMs: 900,
        expectedCostCents: 0,
        dependencies: [],
        errorContract: [
          {
            code: "WORKFLOW_ERROR",
            message: "Fallo en la composición de pasos",
            retryable: true,
            fallbackHint: "Reintenta con una redacción más clara o usa LLM fallback.",
          },
        ],
        examples: [userMessage],
        tags: ["auto", "workflow", "generated", "safe"],
        implementationMode: "workflow",
        workflow: {
          steps: [
            {
              id: "echo_step",
              kind: "internal",
              name: "identity_text_v1",
              outputKey: "text_payload",
              continueOnError: false,
              dependsOn: [],
              timeoutMs: 1000,
              inputSchema: {
                type: "object",
                properties: {
                  text: { type: "string" },
                },
                required: ["text"],
                additionalProperties: false,
              },
              input: { text: "{{input.text}}" },
            },
            {
              id: "noop_step",
              kind: "internal",
              name: "noop_v1",
              outputKey: "result",
              continueOnError: true,
              dependsOn: ["echo_step"],
              timeoutMs: 1000,
              inputSchema: {
                type: "object",
                properties: {
                  text: { type: "string" },
                },
                required: ["text"],
                additionalProperties: false,
              },
              input: { text: "{{steps.text_payload.text}}" },
            },
          ],
          resultStep: "result",
        },
        executionPolicy: {
          maxRetries: 1,
          timeoutMs: 4000,
          cpuLimitMs: 120,
          memoryLimitMb: 128,
          requiresConfirmation: hasNetwork || hasExternal,
          allowExternalSideEffects: false,
        },
        status: "active",
      } as SkillSpec;
    }

    return {
      name: "Auto Skill Generated",
      description: "Skill generado automáticamente para resolver la solicitud del usuario.",
      category: "general",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          status: { type: "string" },
          notes: { type: "array", items: { type: "string" } },
        },
        required: ["text"],
        additionalProperties: false,
      },
      permissions,
      expectedLatencyMs: 1200,
      expectedCostCents: 0,
      dependencies: [],
      errorContract: [
        { code: "AUTO_EXECUTION_ERROR", message: "No se pudo ejecutar la habilidad auto-generada", retryable: true },
      ],
      examples: ["Respuesta breve con el texto solicitado."],
      tags: ["auto", "code", "generated", "safe"],
      implementationMode: "code",
      code: {
        language: codeLanguage === "python" ? "python" : "javascript",
        source: codeLanguage === "python" ? sourcePy : sourceJs,
      },
      executionPolicy: {
        maxRetries: 1,
        timeoutMs: 2500,
        cpuLimitMs: 120,
        memoryLimitMb: 128,
        requiresConfirmation: hasNetwork || hasExternal,
        allowExternalSideEffects: false,
      },
      status: "active",
    };
  }

  private async registerGeneratedVersion(request: SkillExecutionRequest, spec: SkillSpec): Promise<RuntimeSkill> {
    const catalogId = uuidv4();
    const versionId = uuidv4();
    const now = new Date();
    const nameToken = normalizeText(spec.name).replace(/\s+/g, "_").slice(0, 24) || "auto_skill";
    const slug = `${AUTO_SKILL_PREFIX}_${nameToken}_${now.getTime()}`.slice(0, 120);

    const catalogRow = {
      id: catalogId,
      slug,
      ownerId: request.userId || null,
      name: spec.name,
      description: spec.description,
      category: spec.category || "general",
      isManaged: true,
      isActive: !this.requiresConfirmation(spec.permissions, spec.executionPolicy),
      latestVersion: 1,
      activeVersion: spec.executionPolicy?.requiresConfirmation ? 0 : 1,
    };

    const versionRow = {
      id: versionId,
      catalogId,
      version: 1,
      status: this.requiresConfirmation(spec.permissions, spec.executionPolicy) ? "draft" : "active",
      spec: { ...spec },
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      permissions: spec.permissions,
      expectedLatencyMs: spec.expectedLatencyMs,
      expectedCostCents: spec.expectedCostCents,
      dependencies: spec.dependencies || [],
      errorContract: spec.errorContract || [],
      executionPolicy: spec.executionPolicy || {
        maxRetries: 1,
        timeoutMs: 3000,
        requiresConfirmation: false,
        allowExternalSideEffects: false,
      },
      implementationMode: spec.implementationMode,
      workflow: spec.workflow || null,
      code: spec.code || null,
      createdBy: request.userId || null,
      createdAt: now,
      createdFrom: request.requestId,
      approvedBy: null,
      approvedAt: null,
    };

    try {
      await db.insert(skillCatalog).values(catalogRow as any);
      await db.insert(skillCatalogVersions).values(versionRow as any);
      this.emitTrace(request, {
        stage: "factory",
        status: "ok",
        message: "Auto skill persisted",
        details: { slug, catalogId, versionId },
      });
    } catch (error) {
      const message = (error as Error)?.message || "unknown";
      this.emitTrace(request, {
        stage: "factory",
        status: "warn",
        message: "Auto skill persistence failed",
        details: { reason: message },
      });
      throw new Error(`Auto skill persistence failed: ${message}`);
    }

    const runtime: RuntimeSkill = {
      catalogId,
      versionId,
      slug,
      name: spec.name,
      description: spec.description,
      category: spec.category || "general",
      status: this.requiresConfirmation(spec.permissions, spec.executionPolicy) ? "draft" : "active",
      spec,
      activeVersion: this.requiresConfirmation(spec.permissions, spec.executionPolicy) ? 0 : 1,
      latestVersion: 1,
      isManaged: true,
      createdBy: request.userId,
    };
    this.skillsBySlug.set(slug, runtime);
    this.skillsById.set(catalogId, runtime);
    return runtime;
  }

  private pickBestMatch(matches: ExecutionPlanMatch[]): ExecutionPlanMatch | null {
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.score - a.score);
    return matches[0] || null;
  }

  private matchSkills(request: SkillExecutionRequest, input: string): ExecutionPlanMatch[] {
    const explicitReference = parseExplicitSkillReference(input);
    const strippedInput = explicitReference?.stripped || input;
    const textTokens = tokenize(strippedInput);
    const intentTokens = getIntentHintTokens(request.intentHint?.intent);
    const outputTokens = getOutputFormatTokens(request.intentHint?.output_format);
    const attachmentTokens = getAttachmentSignalTokens(request.attachments);
    const requestedCategories = inferRequestedCategories(request, outputTokens, attachmentTokens);
    const matches: ExecutionPlanMatch[] = [];
    const target = new Set([
      ...textTokens,
      ...intentTokens,
      ...outputTokens,
      ...attachmentTokens,
    ]);

    if (explicitReference?.normalizedName) {
      for (const skill of this.skillsBySlug.values()) {
        if (skill.status !== "active" || !skill.spec) continue;
        const normalizedName = normalizeText(skill.name);
        const normalizedSlug = normalizeText(skill.slug.replace(/[_-]+/g, " "));
        if (
          normalizedName === explicitReference.normalizedName ||
          normalizedSlug === explicitReference.normalizedName
        ) {
          return [{
            skill,
            score: SKILL_EXPLICIT_REFERENCE_BOOST,
            reason: `explicit_skill_reference ${explicitReference.name}`,
          }];
        }
      }
    }

    for (const skill of this.skillsBySlug.values()) {
      if (skill.status !== "active") continue;
      if (!skill.spec) continue;
      const corpusParts = [
        skill.slug,
        skill.name,
        skill.description,
        skill.category,
        ...(skill.spec.tags || []),
        ...(skill.spec.examples || []),
      ];
      const corpus = corpusParts.filter(Boolean).join(" ");
      const corpusTokens = tokenize(corpus);
      const tagTokens = tokenize((skill.spec.tags || []).join(" "));
      const exampleTokens = tokenize((skill.spec.examples || []).join(" "));
      const categoryTokens = getCategoryTokens(skill.category);
      const normalizedName = normalizeText(skill.name);
      const normalizedSlug = normalizeText(skill.slug.replace(/[_-]+/g, " "));
      const normalizedInput = normalizeText(strippedInput);

      const lexicalScore = computeJaccardSimilarity(Array.from(target), corpusTokens);
      const tagScore = computeJaccardSimilarity(textTokens, tagTokens);
      const exampleScore = computeJaccardSimilarity(textTokens, exampleTokens);
      const intentScore = computeTokenCoverage(intentTokens, corpusTokens);
      const formatScore = computeTokenCoverage(outputTokens, corpusTokens);
      const attachmentScore = computeTokenCoverage(attachmentTokens, corpusTokens);
      const categoryScore =
        requestedCategories.includes(normalizeText(skill.category).replace(/\s+/g, "_"))
          ? 1
          : computeTokenCoverage(requestedCategories, categoryTokens);

      let exactScore = 0;
      if (normalizedInput && (normalizedInput === normalizedName || normalizedInput === normalizedSlug)) {
        exactScore = 1;
      } else if (
        normalizedInput &&
        (
          normalizedInput.includes(normalizedName) ||
          normalizedInput.includes(normalizedSlug) ||
          normalizedName.includes(normalizedInput) ||
          normalizedSlug.includes(normalizedInput)
        )
      ) {
        exactScore = 0.65;
      }

      const attachmentPermissionBoost =
        attachmentTokens.length > 0 && (skill.spec.permissions || []).includes("storage.read") ? 0.04 : 0;
      const confidence = Math.min(
        0.99,
        Number((
          (lexicalScore * 0.40) +
          (tagScore * 0.14) +
          (exampleScore * 0.08) +
          (intentScore * 0.18) +
          (formatScore * 0.18) +
          (attachmentScore * 0.16) +
          (categoryScore * 0.10) +
          (exactScore * 0.25) +
          attachmentPermissionBoost
        ).toFixed(4))
      );
      if (confidence >= SKILL_MATCH_THRESHOLD) {
        matches.push({
          skill,
          score: confidence,
          reason: this.buildMatchReason([
            ["lexical", lexicalScore],
            ["tags", tagScore],
            ["examples", exampleScore],
            ["intent", intentScore],
            ["format", formatScore],
            ["attachment", attachmentScore],
            ["category", categoryScore],
            ["exact", exactScore],
          ]),
        });
      }
    }

    return matches;
  }

  private async findByMatch(request: SkillExecutionRequest, input: string): Promise<ExecutionPlanMatch | null> {
    await this.bootstrap();
    await this.refreshFromDb();
    const matches = this.matchSkills(request, input);
    return this.pickBestMatch(matches);
  }

  public async executeFromMessage(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
    const normalizedRequestId = sanitizeRunIdInput(request.requestId, 140) || request.requestId;
    const normalizedUserId = sanitizeRunIdInput(request.userId, 80) || null;
    const normalizedConversationId = sanitizeRunIdInput(request.conversationId, 80);
    const normalizedRunId = sanitizeRunIdInput(request.runId, 72);
    const normalizedScopes = this.normalizeAllowedScopes(request.allowedScopes);
    const normalizedAttachments = normalizeAttachments(request.attachments);
    const normalizedRetries = Number.isInteger(request.maxRetries)
      ? Math.min(Math.max(request.maxRetries, 0), 6)
      : undefined;

    const normalizedRequest: SkillExecutionRequest = {
      ...request,
      requestId: normalizedRequestId,
      userMessage: sanitizeRequestInput(request.userMessage).slice(0, MAX_RUN_MESSAGE_LEN),
      userId: normalizedUserId,
      runId: normalizedRunId || request.runId,
      conversationId: normalizedConversationId || request.conversationId,
      allowedScopes: normalizedScopes,
      attachments: normalizedAttachments,
      maxRetries: normalizedRetries,
    };

    return this.withServiceSpan(
      "execution",
      normalizedRequest,
      () => this.withInFlightDedup(
        normalizedRequest,
        () => this.withExecutionConcurrency(normalizedRequest, () => this.executeFromMessageCore(normalizedRequest))
      )
    );
  }

  private async executeFromMessageCore(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
    await this.bootstrap();
    const cacheKey = this.buildRunKey(request, request.userMessage);
    const started = safeNow();
    this.incrementMetric("totalRequests");
    const emitTrace = (trace: Omit<SkillExecutionTraceEvent, "timestamp" | "runId">) => this.emitTrace(request, trace);
    const requestInput = this.buildRuntimeInput(request);
    emitTrace({ stage: "planner", status: "ok", message: "skill_request_received", details: { runKey: cacheKey } });

    const cached = this.getCachedResult(cacheKey, started);
    if (cached) {
      const cachedResult = clone(cached);
      if (cachedResult.metrics) {
        cachedResult.metrics.cached = true;
      } else {
        cachedResult.metrics = {
          latencyMs: safeNow() - started,
          retryCount: 0,
          cached: true,
          timedOut: false,
        };
      }
      emitTrace({
        stage: "planner",
        status: "ok",
        message: "idempotent_hit",
        details: { cacheKey },
      });
      return cachedResult;
    }

    const traces: SkillExecutionTraceEvent[] = [];
    const pushTrace = (item: Omit<SkillExecutionTraceEvent, "timestamp" | "runId">) => {
      const trace: SkillExecutionTraceEvent = {
        ...item,
        runId: request.runId || request.requestId,
        timestamp: new Date().toISOString(),
      };
      traces.push(trace);
      emitTrace(item);
    };
    let executionAttempts = 0;
    let executionTimedOut = false;
    let executionPlan: SkillExecutionPlan | undefined;
    let executionRunRecordId: string | null = null;

    const finalizeResult = (result: SkillExecutionResult, retryCount = 0, timedOut = false): SkillExecutionResult => {
      const latencyMs = safeNow() - started;
      this.updateLatencyMetric(latencyMs);
      if (result.status === "completed") this.incrementMetric("completed");
      if (result.status === "partial") this.incrementMetric("partial");
      if (result.status === "failed") this.incrementMetric("failed");
      if (result.status === "blocked") this.incrementMetric("blocked");
      if (result.status === "skipped") this.incrementMetric("skipped");
      if (result.autoCreated) this.incrementMetric("autoCreated");
      result.metrics = {
        latencyMs,
        retryCount,
        cached: false,
        timedOut,
      };
      result.executionPlan = executionPlan;
      return result;
    };

    try {
      const inputText = clampText(request.userMessage, 2000);
      pushTrace({ stage: "retrieval", status: "ok", message: "skill_lookup_started", details: { inputTextLen: inputText.length } });

      const matched = await this.withServiceSpan("retrieval", request, () => this.findByMatch(request, inputText));
      const planCandidates: SkillPlanMatch[] = [];
      let selected: RuntimeSkill;
      let autoCreated = false;
      let selectedVia: SkillExecutionPlan["selectedVia"] = "none";

      if (!matched) {
        pushTrace({ stage: "planner", status: "warn", message: "no_skill_match", details: { inputText } });
        if (request.autoCreate ?? true) {
          const inferred = this.inferAutoSkill(inputText);
          const compileValidation = await this.compileSkillSpec(inferred);
          if (!compileValidation.valid) {
            const result: SkillExecutionResult = {
              status: "failed",
              continueWithModel: true,
              outputText: "",
              autoCreated: false,
              requiresConfirmation: false,
              traces,
              selectedSkill: undefined,
              error: {
                code: "AUTO_SKILL_INVALID",
                message: compileValidation.reasons.join(", "),
                retryable: true,
              },
              fallbackText: "No se pudo validar la Skill automática con restricciones seguras. Continúo con el modelo.",
            };
            this.setCachedResult(cacheKey, result, started);
            await this.persistRun(request, "failed", {
              status: "failed",
              continueWithModel: true,
              autoCreated: false,
              traces,
              catalogId: null,
              versionId: null,
            });
            return finalizeResult(result, 0, false);
          }

          const dryRunValidation = await this.withServiceSpan("factory", request, () => this.runAutoSkillDryRun(inferred, request));
          if (!dryRunValidation.valid) {
            const result: SkillExecutionResult = {
              status: "failed",
              continueWithModel: true,
              outputText: "",
              autoCreated: false,
              requiresConfirmation: false,
              traces,
              selectedSkill: undefined,
              error: {
                code: "AUTO_SKILL_DRYRUN_FAILED",
                message: dryRunValidation.reasons.join(", "),
                retryable: true,
              },
              fallbackText: "La validación segura de la Skill auto-generada falló. Continuo con el modelo conversacional.",
            };
            this.setCachedResult(cacheKey, result, started);
            await this.persistRun(request, "failed", {
              status: "failed",
              continueWithModel: true,
              autoCreated: false,
              traces,
              catalogId: null,
              versionId: null,
            });
            return finalizeResult(result, 0, false);
          }

          selected = await this.withServiceSpan(
            "factory",
            request,
            () => this.executeWithCircuitBreaker(request, "factory", () => this.registerGeneratedVersion(request, inferred))
          );
          autoCreated = true;
          selectedVia = "factory";
          planCandidates.push({
            slug: selected.slug,
            catalogId: selected.catalogId,
            versionId: selected.versionId,
            name: selected.name,
            mode: selected.spec.implementationMode || "code",
            reason: "auto_skill_factory",
            score: 0.62,
            confidence: 0.62,
            status: selected.status,
          });

          if (selected.status !== "active") {
            this.emitRiskGate(
              {
                stage: "policy",
                status: "warn",
                message: "auto_skill_not_active",
                details: { skill: selected.slug, requestedAutoCreate: request.autoCreate ?? true },
              },
              request
            );
            const result: SkillExecutionResult = {
              status: "blocked",
              continueWithModel: true,
              outputText: "",
              requiresConfirmation: true,
              autoCreated,
              traces,
              selectedSkill: {
                catalogId: selected.catalogId,
                versionId: selected.versionId,
                slug: selected.slug,
                name: selected.name,
                mode: selected.spec.implementationMode || "code",
                confidence: 0.45,
              },
              fallbackText: "La Skill auto-generada está en borrador y requiere aprobación antes de ejecutar.",
              policyBreached: {
                missingScopes: [],
                blockedScopes: selected.spec.permissions.filter((scope) => RISKY_SCOPES.has(scope)),
              },
            };
            this.setCachedResult(cacheKey, result, started);
            return finalizeResult(result, 0, false);
          }

          pushTrace({ stage: "factory", status: "ok", message: "auto_skill_created", details: { slug: selected.slug } });
        } else {
          const result: SkillExecutionResult = {
            status: "skipped",
            continueWithModel: true,
            outputText: "",
            requiresConfirmation: false,
            autoCreated: false,
            traces,
            selectedSkill: undefined,
          };
          this.setCachedResult(cacheKey, result, started);
          await this.persistRun(request, "skipped", {
            status: "skipped",
            continueWithModel: true,
            outputText: "",
            autoCreated,
            traces,
            catalogId: null,
            versionId: null,
          });
          return finalizeResult(result, 0, false);
        }
      } else {
        selected = matched.skill;
        selectedVia = "planner";
        pushTrace({ stage: "planner", status: "ok", message: "skill_matched", details: { slug: selected.slug, score: matched.score } });
        planCandidates.push(resolvePlanMatch(matched));
      }

      const skillPlan: SkillExecutionPlan = {
        inputText,
        candidates: planCandidates,
        selected: planCandidates[0] || null,
        selectedVia,
        needsAutoSkill: selectedVia === "factory",
        autoSuggestion: {
          name: selected.spec.name,
          description: selected.spec.description,
          permissions: selected.spec.permissions || [],
          expectedLatencyMs: selected.spec.expectedLatencyMs,
          expectedCostCents: selected.spec.expectedCostCents,
          mode: selected.spec.implementationMode || "code",
          reasons: ["plan-match"],
        },
      };
      executionPlan = skillPlan;

      if (selected.status !== "active") {
        this.emitRiskGate(
          {
            stage: "policy",
            status: "warn",
            message: "selected_skill_not_active",
            details: { skill: selected.slug, status: selected.status },
          },
          request
        );
        const result: SkillExecutionResult = {
          status: "blocked",
          continueWithModel: true,
          outputText: "",
          requiresConfirmation: true,
          autoCreated,
          traces,
          selectedSkill: {
            catalogId: selected.catalogId,
            versionId: selected.versionId,
            slug: selected.slug,
            name: selected.name,
            mode: selected.spec.implementationMode || "code",
            confidence: planCandidates[0]?.score || 0.4,
          },
          fallbackText: "La skill seleccionada no está activa y requiere aprobación.",
          policyBreached: {
            missingScopes: [],
            blockedScopes: selected.spec.permissions || [],
          },
        };
        this.setCachedResult(cacheKey, result, started);
        return finalizeResult(result, 0, false);
      }

      const scopePolicy = {
        allowed: pickScopes(request.allowedScopes),
        required: selected.spec.permissions || [],
      };
      const scopeCheck = this.isScopeAllowed(scopePolicy.required, scopePolicy.allowed);
      if (!scopeCheck.ok) {
        this.emitRiskGate(
          {
            stage: "risk_gate",
            status: "warn",
            message: "skill_scope_blocked",
            details: { skill: selected.slug, missing: scopeCheck.missing, requestId: request.requestId },
          },
          request
        );
        const result: SkillExecutionResult = {
          status: "blocked",
          continueWithModel: true,
          outputText: "",
          requiresConfirmation: true,
          autoCreated,
          policyBreached: {
            missingScopes: scopeCheck.missing,
            blockedScopes: scopeCheck.missing.filter((scope) => RISKY_SCOPES.has(scope)),
          },
          traces,
          selectedSkill: {
            catalogId: selected.catalogId,
            versionId: selected.versionId,
            slug: selected.slug,
            name: selected.name,
            mode: selected.spec.implementationMode || "code",
            confidence: planCandidates[0]?.score || 0.4,
          },
        };
        this.setCachedResult(cacheKey, result, started);
        return finalizeResult(result, 0, false);
      }

      const requiresConfirmation = this.requiresConfirmation(selected.spec.permissions || [], selected.spec.executionPolicy || {
        requiresConfirmation: false,
      } as SkillExecutionPolicy);
      if (requiresConfirmation) {
        this.emitRiskGate(
          {
            stage: "risk_gate",
            status: "warn",
            message: "skill_requires_confirmation",
            details: { skill: selected.slug, scopes: selected.spec.permissions },
          },
          request
        );
        const result: SkillExecutionResult = {
          status: "blocked",
          continueWithModel: true,
          outputText: "",
          requiresConfirmation: true,
          autoCreated,
          traces,
          selectedSkill: {
            catalogId: selected.catalogId,
            versionId: selected.versionId,
            slug: selected.slug,
            name: selected.name,
            mode: selected.spec.implementationMode || "code",
            confidence: planCandidates[0]?.score || 0.4,
          },
          fallbackText: "Se requiere confirmación explícita para ejecutar esta habilidad por scopes sensibles.",
        };
        this.setCachedResult(cacheKey, result, started);
        return finalizeResult(result, 0, false);
      }

      const inputValidation = await this.withServiceSpan("validation", request, () =>
        Promise.resolve(validateSchema(requestInput, selected.spec.inputSchema || {}))
      );
      if (inputValidation.length > 0) {
        const err = new Error(`Input schema validation failed: ${inputValidation.slice(0, 2).join(", ")}`);
        const contract = this.calculateErrorContract(selected.spec, err);
        const result: SkillExecutionResult = {
          status: "failed",
          continueWithModel: true,
          outputText: "",
          autoCreated,
          requiresConfirmation: false,
          traces,
          selectedSkill: {
            catalogId: selected.catalogId,
            versionId: selected.versionId,
            slug: selected.slug,
            name: selected.name,
            mode: selected.spec.implementationMode || "code",
            confidence: planCandidates[0]?.score || 0.4,
          },
          error: {
            code: contract.code,
            message: contract.message,
            retryable: contract.retryable,
          },
          fallbackText: contract.fallbackHint,
        };
        this.setCachedResult(cacheKey, result, started);
        return finalizeResult(result, 0, false);
      }

      const executionRunPolicy = selected.spec.executionPolicy || {
        maxRetries: 1,
        timeoutMs: 30000,
        requiresConfirmation: false,
        allowExternalSideEffects: false,
      };
      executionRunRecordId = await this.createRunRecord(request, {
        catalogId: selected.catalogId,
        versionId: selected.versionId,
        status: "running",
        continueWithModel: false,
        policy: executionRunPolicy,
        traces: [],
      });
      const execCtx = this.createExecutionContext(request, selected, executionRunRecordId || undefined);
      pushTrace({ stage: "execution", status: "ok", message: "execution_started", details: { mode: selected.spec.implementationMode } });
      if (executionRunRecordId) {
        pushTrace({ stage: "execution", status: "ok", message: "execution_run_record_created", details: { runRecordId: executionRunRecordId } });
      }

      await fs.mkdir(execCtx.workspacePath, { recursive: true });
      let executionResult: { output: unknown; outputText: string; partialOutput?: unknown; complete: boolean; executionError?: string; failedStepId?: string; attempts: number; timedOut: boolean };
      try {
        executionResult = await this.withServiceSpan(
          "execution",
          request,
          () =>
            this.executeWithCircuitBreaker(request, "execution", () =>
              this.executeSkillWithRetries(
                {
                  ...request,
                  maxRetries: request.maxRetries != null ? Math.max(0, Math.floor(request.maxRetries)) : undefined,
                },
                selected,
                execCtx,
                requestInput,
                executionRunPolicy.maxRetries,
                executionRunPolicy.timeoutMs
              )
            )
        );
        executionAttempts = executionResult.attempts;
        executionTimedOut = executionResult.timedOut;
      } finally {
        await fs.rm(execCtx.workspacePath, { recursive: true, force: true }).catch(() => { });
      }

      const outputValidation = await this.withServiceSpan("validation", request, () =>
        Promise.resolve(validateSchema(executionResult.output, selected.spec.outputSchema || {}))
      );
      if (outputValidation.length > 0) {
        const err = new Error(`Output schema validation failed: ${outputValidation.slice(0, 2).join(", ")}`);
        const contract = this.calculateErrorContract(selected.spec, err);
        const finalResult: SkillExecutionResult = {
          status: "failed",
          continueWithModel: true,
          outputText: "",
          autoCreated,
          requiresConfirmation: false,
          traces,
          selectedSkill: {
            catalogId: selected.catalogId,
            versionId: selected.versionId,
            slug: selected.slug,
            name: selected.name,
            mode: selected.spec.implementationMode || "code",
            confidence: planCandidates[0]?.score || 0.4,
          },
          error: {
            code: contract.code,
            message: contract.message,
            retryable: contract.retryable,
          },
          fallbackText: contract.fallbackHint,
        };
        await this.persistRun(request, finalResult.status, {
          catalogId: selected.catalogId,
          versionId: selected.versionId,
          status: finalResult.status,
          error: {
            code: contract.code,
            message: contract.message,
            retryable: contract.retryable,
          },
          autoCreated,
          traces,
          continueWithModel: true,
          latencyMs: safeNow() - started,
          policy: executionRunPolicy,
        }, executionRunRecordId);
        this.setCachedResult(cacheKey, finalResult, started);
        return finalizeResult(finalResult, executionAttempts, executionTimedOut);
      }

      const finalOutputText =
        typeof executionResult.outputText === "string"
          ? executionResult.outputText
          : typeof executionResult.output === "string"
            ? executionResult.output
            : typeof executionResult.output === "object" && executionResult.output !== null && "text" in (executionResult.output as Record<string, unknown>)
              ? safeStringify((executionResult.output as Record<string, unknown>).text)
              : safeStringify(executionResult.output);

      const finalOutcome: SkillExecutionResult = {
        status: executionResult.complete ? "completed" : "partial",
        continueWithModel: !executionResult.complete,
        output: executionResult.output,
        outputText: finalOutputText,
        partialOutput: executionResult.partialOutput === undefined ? undefined : safeStringify(executionResult.partialOutput),
        selectedSkill: {
          catalogId: selected.catalogId,
          versionId: selected.versionId,
          slug: selected.slug,
          name: selected.name,
          mode: selected.spec.implementationMode || "code",
          confidence: planCandidates[0]?.score || 0.4,
        },
        requiresConfirmation: false,
        autoCreated,
        traces,
      };

      if (!executionResult.complete && executionResult.executionError) {
        const err = new Error(executionResult.executionError);
        const contract = this.calculateErrorContract(selected.spec, err);
        finalOutcome.error = {
          code: contract.code,
          message: contract.message,
          retryable: contract.retryable,
        };
        finalOutcome.fallbackText = contract.fallbackHint
          || `No fue posible completar el flujo completo: ${executionResult.executionError}`;
      }
      if (!executionResult.complete && !finalOutcome.fallbackText) {
        finalOutcome.fallbackText = "La ejecución no terminó completamente. Continúo con el modelo.";
      }

      const latencyMs = safeNow() - started;
      await this.persistRun(request, finalOutcome.status, {
        catalogId: selected.catalogId,
        versionId: selected.versionId,
        status: finalOutcome.status,
        output: executionResult.output,
        partialOutput: executionResult.partialOutput,
        continueWithModel: finalOutcome.continueWithModel,
        autoCreated,
        traces,
        latencyMs,
        policy: executionRunPolicy,
      }, executionRunRecordId);

      finalizeResult(finalOutcome, executionAttempts, executionTimedOut);
      this.setCachedResult(cacheKey, finalOutcome, started);
      pushTrace({ stage: "finish", status: "ok", message: "execution_finished", details: { status: finalOutcome.status, latencyMs } });
      return finalOutcome;
    } catch (error) {
      const err = error as Error;
      const status = "failed";
      const result: SkillExecutionResult = {
        status,
        continueWithModel: true,
        outputText: "",
        autoCreated,
        requiresConfirmation: false,
        traces,
        selectedSkill: undefined,
        error: {
          code: "UNHANDLED_ERROR",
          message: err.message || "Error desconocido",
          retryable: true,
        },
        fallbackText: executionTimedOut
          ? "La ejecución excedió el tiempo máximo y se continúa con el modelo conversacional."
          : "La ejecución determinística no pudo completarse; se continúa con el modelo conversacional.",
      };
      pushTrace({ stage: "finish", status: "error", message: "execution_failed", details: { error: err.message } });
      await this.persistRun(request, status, {
        status,
        error: {
          message: err.message || "Error desconocido",
          code: "UNHANDLED_ERROR",
        },
        traces,
        continueWithModel: true,
        fallbackUsed: true,
      }, executionRunRecordId);
      const finalized = finalizeResult(result, executionAttempts, executionTimedOut);
      this.setCachedResult(cacheKey, finalized, started);
      return finalized;
    }
  }

  public async rollbackSkill(catalogSlugOrId: string, targetVersion: number): Promise<boolean> {
    await this.bootstrap();
    const skill = this.skillsBySlug.get(catalogSlugOrId) || this.skillsById.get(catalogSlugOrId);
    if (!skill) return false;
    try {
      const target = await db
        .select({ id: skillCatalogVersions.id })
        .from(skillCatalogVersions)
        .where(
          and(
            eq(skillCatalogVersions.catalogId, skill.catalogId),
            eq(skillCatalogVersions.version, targetVersion)
          )
        )
        .limit(1);

      if (!target[0]) {
        return false;
      }

      await db.transaction(async (tx) => {
        await tx
          .update(skillCatalogVersions)
          .set({ status: "deprecated" })
          .where(and(eq(skillCatalogVersions.catalogId, skill.catalogId), ne(skillCatalogVersions.version, targetVersion)));

        await tx
          .update(skillCatalogVersions)
          .set({ status: "active" })
          .where(and(eq(skillCatalogVersions.catalogId, skill.catalogId), eq(skillCatalogVersions.version, targetVersion)));

        await tx
          .update(skillCatalog)
          .set({
            activeVersion: targetVersion,
            latestVersion: Math.max(skill.latestVersion, targetVersion),
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(skillCatalog.id, skill.catalogId));
      });

      await this.refreshFromDb();
      return true;
    } catch {
      return false;
    }
  }

  public getExecutionMetrics(): {
    totalRequests: number;
    completed: number;
    partial: number;
    blocked: number;
    failed: number;
    skipped: number;
    autoCreated: number;
    cacheHit: number;
    avgLatencyMs: number;
    lastErrors: string[];
    startedAt: number;
    stageMetrics: StageMetrics;
    peakConcurrent: number;
    activeRuns: number;
    circuit: {
      execution: ReturnType<typeof SKILL_PLATFORM_EXECUTION_BREAKER.getStats>;
      factory: ReturnType<typeof SKILL_PLATFORM_FACTORY_BREAKER.getStats>;
    };
  } {
    return {
      ...SKILL_PLATFORM_METRICS,
      lastErrors: [...SKILL_PLATFORM_METRICS.lastErrors],
      stageMetrics: { ...SKILL_PLATFORM_METRICS.stageMetrics },
      circuit: {
        execution: SKILL_PLATFORM_EXECUTION_BREAKER.getStats(),
        factory: SKILL_PLATFORM_FACTORY_BREAKER.getStats(),
      },
    };
  }

  public async getSkillHistory(catalogSlugOrId: string): Promise<SkillVersionHistoryItem[]> {
    await this.bootstrap();
    const skill = this.skillsBySlug.get(catalogSlugOrId) || this.skillsById.get(catalogSlugOrId);
    if (!skill) return [];

    const rows = await db
      .select()
      .from(skillCatalogVersions)
      .where(eq(skillCatalogVersions.catalogId, skill.catalogId))
      .orderBy(desc(skillCatalogVersions.version));

    return rows.map((row) => ({
      version: row.version,
      status: row.status,
      createdBy: row.createdBy || null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      createdFrom: row.createdFrom || null,
      tags: [],
      dependencies: Array.isArray(row.dependencies)
        ? row.dependencies
            .map((dep: any) => (typeof dep?.skillId === "string" ? dep.skillId : null))
            .filter((value: unknown): value is string => typeof value === "string")
        : [],
    }));
  }

  public async listSkills(): Promise<Array<{
    slug: string;
    catalogId: string;
    name: string;
    category: string;
    activeVersion: number;
    status: string;
    permissions: SkillScope[];
    mode: "workflow" | "code";
    latestVersion: number;
  }>> {
    await this.bootstrap();
    const seen = new Set<string>();
    return Array.from(this.skillsBySlug.values())
      .filter((skill) => {
        if (seen.has(skill.catalogId)) return false;
        seen.add(skill.catalogId);
        return true;
      })
      .map((skill) => ({
        slug: skill.slug,
        catalogId: skill.catalogId,
        name: skill.name,
        category: skill.category,
        activeVersion: skill.activeVersion,
        latestVersion: skill.latestVersion,
        status: skill.status,
        permissions: skill.spec.permissions || [],
        mode: skill.spec.implementationMode || "code",
      }));
  }
}

const skillPlatformService = new SkillPlatformService();
export const getSkillPlatformService = (): SkillPlatformService => skillPlatformService;
export default skillPlatformService;
