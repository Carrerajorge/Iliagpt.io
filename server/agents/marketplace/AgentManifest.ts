import { z } from "zod";
import pino from "pino";

const logger = pino({ name: "AgentManifest" });

// ─── Semver regex ────────────────────────────────────────────────────────────
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?(?:\+([\w.-]+))?$/;
const SEMVER_RANGE_RE = /^[\^~>=<]?[\d.*]+(?:\s*-\s*[\d.*]+)?$/;

const SemVer = z.string().regex(SEMVER_RE, "Must be valid semver (x.y.z)");
const SemVerRange = z
  .string()
  .regex(SEMVER_RANGE_RE, "Must be valid semver range");

// ─── Enums ───────────────────────────────────────────────────────────────────
export const AgentCategory = z.enum([
  "productivity",
  "research",
  "coding",
  "data-analysis",
  "creative",
  "customer-support",
  "security",
  "devops",
  "finance",
  "legal",
  "healthcare",
  "education",
  "other",
]);
export type AgentCategory = z.infer<typeof AgentCategory>;

export const PermissionLevel = z.enum(["minimal", "standard", "trusted", "admin"]);
export type PermissionLevel = z.infer<typeof PermissionLevel>;

export const ModelTier = z.enum(["nano", "small", "medium", "large", "frontier"]);
export type ModelTier = z.infer<typeof ModelTier>;

// ─── Sub-schemas ─────────────────────────────────────────────────────────────
export const AgentCapabilitySchema = z.object({
  /** Unique identifier for this capability, e.g. "web-search" */
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-_]*$/),
  name: z.string().min(1).max(128),
  description: z.string().max(512),
  /** Semantic version of this capability implementation */
  version: SemVer,
  /** Whether this capability is optional for the agent to function */
  optional: z.boolean().default(false),
  /** Input/output schema as a JSON Schema object */
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const RequiredToolSchema = z.object({
  toolId: z.string().min(1),
  versionRange: SemVerRange.optional(),
  /** If false, agent degrades gracefully when tool is unavailable */
  required: z.boolean().default(true),
  /** Why this tool is needed */
  reason: z.string().max(256).optional(),
});
export type RequiredTool = z.infer<typeof RequiredToolSchema>;

export const RequiredModelSchema = z.object({
  /** Model family, e.g. "claude", "gpt", "gemini" */
  family: z.string().min(1),
  /** Minimum tier needed */
  minTier: ModelTier,
  /** Specific model IDs acceptable, if empty any model in family at minTier works */
  acceptedModelIds: z.array(z.string()).default([]),
  /** Context window needed in tokens */
  minContextWindow: z.number().int().positive().optional(),
  /** Whether vision capability is needed */
  requiresVision: z.boolean().default(false),
  /** Whether function/tool calling is needed */
  requiresToolUse: z.boolean().default(true),
});
export type RequiredModel = z.infer<typeof RequiredModelSchema>;

export const AgentPermissionsSchema = z.object({
  /** Base permission level preset */
  level: PermissionLevel.default("standard"),
  /** Explicit filesystem access */
  filesystem: z.enum(["none", "readonly", "readwrite"]).default("none"),
  /** Network access whitelist; empty array means no network */
  networkAllowlist: z.array(z.string().url()).default([]),
  /** Whether to allow executing shell/terminal commands */
  shellExecution: z.boolean().default(false),
  /** Whether to allow browser/DOM access */
  browserAccess: z.boolean().default(false),
  /** Max heap memory in MB */
  maxMemoryMB: z.number().int().positive().default(256),
  /** Max CPU time per invocation in milliseconds */
  maxCpuTimeMs: z.number().int().positive().default(30_000),
  /** Max concurrent executions */
  maxConcurrency: z.number().int().positive().default(1),
  /** Whether this agent can spawn sub-agents */
  canSpawnAgents: z.boolean().default(false),
  /** Whether this agent can access shared memory across users */
  crossUserMemoryAccess: z.boolean().default(false),
  /** Custom permission keys for extension */
  custom: z.record(z.boolean()).default({}),
});
export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;

export const PricingSchema = z.discriminatedUnion("model", [
  z.object({
    model: z.literal("free"),
  }),
  z.object({
    model: z.literal("per-call"),
    /** Price in USD cents per call */
    centsPerCall: z.number().positive(),
    freeTierCalls: z.number().int().nonnegative().default(0),
  }),
  z.object({
    model: z.literal("subscription"),
    /** Monthly price in USD cents */
    monthlyCents: z.number().positive(),
    /** Calls included per month, -1 = unlimited */
    callsPerMonth: z.number().int().default(-1),
  }),
  z.object({
    model: z.literal("usage-based"),
    /** Price per 1000 tokens in USD cents */
    centsPerKToken: z.number().positive(),
    minimumMonthlyCents: z.number().nonnegative().default(0),
  }),
]);
export type Pricing = z.infer<typeof PricingSchema>;

export const AgentAuthorSchema = z.object({
  name: z.string().min(1).max(128),
  email: z.string().email().optional(),
  url: z.string().url().optional(),
  organizationId: z.string().optional(),
});
export type AgentAuthor = z.infer<typeof AgentAuthorSchema>;

// ─── Main manifest schema ─────────────────────────────────────────────────────
export const AgentManifestSchema = z
  .object({
    /** Schema version for forward compatibility */
    manifestVersion: z.literal("1.0"),
    /** Unique reverse-domain identifier, e.g. "com.acme.research-agent" */
    id: z
      .string()
      .min(3)
      .max(128)
      .regex(
        /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/,
        "Must be reverse-domain format (e.g. com.acme.agent-name)"
      ),
    name: z.string().min(1).max(128),
    version: SemVer,
    description: z.string().min(10).max(1024),
    /** Short one-liner shown in search results */
    tagline: z.string().max(160),
    category: AgentCategory,
    tags: z.array(z.string().max(32)).max(10).default([]),
    author: AgentAuthorSchema,
    /** SPDX license identifier */
    license: z.string().default("MIT"),
    homepage: z.string().url().optional(),
    repository: z.string().url().optional(),
    icon: z.string().url().optional(),
    screenshots: z.array(z.string().url()).max(8).default([]),

    /** SemVer range of platform versions this agent supports */
    platformVersionRange: SemVerRange,

    /** Capabilities this agent exposes */
    capabilities: z.array(AgentCapabilitySchema).min(1).max(32),
    /** Tools from the platform's tool registry that this agent requires */
    requiredTools: z.array(RequiredToolSchema).default([]),
    /** Model requirements */
    requiredModels: z.array(RequiredModelSchema).min(1).max(4),
    /** Permission declarations */
    permissions: AgentPermissionsSchema.default({}),
    /** Pricing model */
    pricing: PricingSchema.default({ model: "free" }),

    /** Entry point relative to the agent package root */
    main: z.string().default("index.js"),
    /** Optional secondary entry for types */
    types: z.string().optional(),

    /** SHA-256 hash of the agent bundle for integrity checks */
    checksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "Must be hex-encoded SHA-256")
      .optional(),

    /** Locale codes supported, e.g. ["en", "es", "zh"] */
    supportedLocales: z.array(z.string().length(2)).default(["en"]),

    /** Dependencies on other marketplace agents */
    agentDependencies: z
      .record(SemVerRange)
      .default({}),

    /** Changelog for this version */
    changelog: z.string().max(4096).optional(),

    /** ISO-8601 date of publishing */
    publishedAt: z.string().datetime().optional(),

    /** Whether this is a beta/preview release */
    prerelease: z.boolean().default(false),
  })
  .superRefine((manifest, ctx) => {
    // Validate that admin-level permissions are not granted by default for free agents
    if (
      manifest.permissions.level === "admin" &&
      manifest.pricing.model === "free"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions", "level"],
        message:
          "Admin-level permissions require a paid pricing model for audit trail",
      });
    }

    // Shell execution requires at least trusted permission level
    if (
      manifest.permissions.shellExecution &&
      manifest.permissions.level === "minimal"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions", "shellExecution"],
        message:
          "Shell execution requires permission level of 'standard' or higher",
      });
    }

    // Cross-user memory access requires admin level
    if (
      manifest.permissions.crossUserMemoryAccess &&
      !["trusted", "admin"].includes(manifest.permissions.level)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions", "crossUserMemoryAccess"],
        message: "Cross-user memory access requires 'trusted' or 'admin' level",
      });
    }

    // Validate capability IDs are unique
    const capIds = manifest.capabilities.map((c) => c.id);
    const uniqueIds = new Set(capIds);
    if (uniqueIds.size !== capIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities"],
        message: "Capability IDs must be unique within a manifest",
      });
    }
  });

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse and validate a raw manifest object.
 * Returns a typed manifest or throws with detailed validation errors.
 */
export function parseManifest(raw: unknown): AgentManifest {
  const result = AgentManifestSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  • ${e.path.join(".")} — ${e.message}`)
      .join("\n");
    logger.warn({ errors: result.error.errors }, "[AgentManifest] Validation failed");
    throw new Error(`Invalid agent manifest:\n${formatted}`);
  }
  logger.debug(
    { agentId: result.data.id, version: result.data.version },
    "[AgentManifest] Manifest validated"
  );
  return result.data;
}

/**
 * Check whether a manifest is compatible with the given platform version.
 * Uses a simple semver range check.
 */
export function isCompatibleWithPlatform(
  manifest: AgentManifest,
  platformVersion: string
): boolean {
  const range = manifest.platformVersionRange;
  const [major, minor] = platformVersion.split(".").map(Number);

  // Parse range patterns: ^1.0.0, ~1.2.0, >=1.0.0 <2.0.0, 1.x
  const exactMatch = range.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (exactMatch) {
    return platformVersion === range;
  }

  const caretMatch = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caretMatch) {
    const [, rMaj] = caretMatch.map(Number);
    return major === rMaj;
  }

  const tildeMatch = range.match(/^~(\d+)\.(\d+)\.(\d+)$/);
  if (tildeMatch) {
    const [, rMaj, rMin] = tildeMatch.map(Number);
    return major === rMaj && minor >= rMin;
  }

  const gteMatch = range.match(/^>=(\d+)\.(\d+)/);
  if (gteMatch) {
    const [, rMaj, rMin] = gteMatch.map(Number);
    return major > rMaj || (major === rMaj && minor >= rMin);
  }

  logger.warn({ range }, "[AgentManifest] Unrecognized semver range pattern, allowing");
  return true;
}

/**
 * Summarize the human-readable permission requirements of a manifest.
 */
export function summarizePermissions(manifest: AgentManifest): string[] {
  const perms = manifest.permissions;
  const lines: string[] = [`Permission level: ${perms.level}`];

  if (perms.filesystem !== "none") lines.push(`Filesystem: ${perms.filesystem}`);
  if (perms.networkAllowlist.length)
    lines.push(`Network: ${perms.networkAllowlist.join(", ")}`);
  if (perms.shellExecution) lines.push("Can execute shell commands");
  if (perms.browserAccess) lines.push("Can control browser");
  if (perms.canSpawnAgents) lines.push("Can spawn sub-agents");
  if (perms.crossUserMemoryAccess) lines.push("Can access other users' memory");

  lines.push(`Max memory: ${perms.maxMemoryMB} MB`);
  lines.push(`Max CPU time: ${perms.maxCpuTimeMs / 1000}s per call`);

  return lines;
}

export type ManifestValidationResult =
  | { valid: true; manifest: AgentManifest }
  | { valid: false; errors: string[] };

/**
 * Non-throwing variant that returns a discriminated result.
 */
export function validateManifest(raw: unknown): ManifestValidationResult {
  const result = AgentManifestSchema.safeParse(raw);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(
        (e) => `${e.path.join(".") || "(root)"}: ${e.message}`
      ),
    };
  }
  return { valid: true, manifest: result.data };
}
