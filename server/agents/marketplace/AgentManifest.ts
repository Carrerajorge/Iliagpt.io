import { z } from 'zod';

// ─── Constants ────────────────────────────────────────────────────────────────

export const CURRENT_SDK_VERSION = '1.0.0';
export const MAX_TOOLS_PER_AGENT = 50;

// ─── Enums / Literals ─────────────────────────────────────────────────────────

export const AgentCapabilityEnum = z.enum([
  'web_search',
  'code_execution',
  'file_system',
  'database',
  'email',
  'calendar',
  'browser',
  'image_generation',
  'data_analysis',
  'communication',
]);

export type AgentCapability = z.infer<typeof AgentCapabilityEnum>;

export const PermissionResourceEnum = z.enum([
  'filesystem',
  'network',
  'process',
  'clipboard',
  'screen',
  'microphone',
  'camera',
  'database',
]);

export const PermissionAccessEnum = z.enum(['read', 'write', 'execute']);

export const PricingTypeEnum = z.enum(['free', 'paid', 'freemium']);

// ─── Semver Validation ────────────────────────────────────────────────────────

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const semverString = z.string().refine((v) => SEMVER_RE.test(v), {
  message: 'Must be a valid semver string (e.g. 1.2.3)',
});

// ─── Slug Validation ──────────────────────────────────────────────────────────

const slugString = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Must be a valid slug (lowercase alphanumeric with hyphens)',
  });

// ─── JSON Schema Support ──────────────────────────────────────────────────────

const JsonSchemaValueSchema: z.ZodType<JsonSchemaValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonSchemaValueSchema),
    z.record(z.string(), JsonSchemaValueSchema),
  ])
);

export type JsonSchemaValue =
  | string
  | number
  | boolean
  | null
  | JsonSchemaValue[]
  | { [key: string]: JsonSchemaValue };

export const JsonSchemaObjectSchema = z.record(z.string(), JsonSchemaValueSchema);
export type JsonSchemaObject = z.infer<typeof JsonSchemaObjectSchema>;

// ─── Permission Schema ────────────────────────────────────────────────────────

export const PermissionSchema = z.object({
  resource: PermissionResourceEnum,
  access: PermissionAccessEnum,
  scope: z.string().optional(),
});

export type Permission = z.infer<typeof PermissionSchema>;

// ─── Tool Declaration Schema ──────────────────────────────────────────────────

export const ToolDeclarationSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, {
      message: 'Tool name must be a valid identifier',
    }),
  description: z.string().min(1).max(1024),
  inputSchema: JsonSchemaObjectSchema,
  outputSchema: JsonSchemaObjectSchema,
});

export type ToolDeclaration = z.infer<typeof ToolDeclarationSchema>;

// ─── Author Schema ────────────────────────────────────────────────────────────

export const AuthorSchema = z.object({
  name: z.string().min(1).max(128),
  email: z.string().email(),
  url: z.string().url().optional(),
});

export type Author = z.infer<typeof AuthorSchema>;

// ─── Models Schema ────────────────────────────────────────────────────────────

export const ModelsSchema = z.object({
  preferred: z.array(z.string().min(1)).min(1),
  fallback: z.array(z.string().min(1)).default([]),
});

export type Models = z.infer<typeof ModelsSchema>;

// ─── Pricing Schema ───────────────────────────────────────────────────────────

export const PricingSchema = z
  .object({
    type: PricingTypeEnum,
    pricePerCall: z.number().positive().optional(),
    currency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/, { message: 'Must be a 3-letter ISO 4217 currency code' }),
  })
  .refine(
    (val) => {
      if (val.type === 'paid' && val.pricePerCall === undefined) {
        return false;
      }
      return true;
    },
    { message: 'pricePerCall is required when pricing type is "paid"' }
  );

export type Pricing = z.infer<typeof PricingSchema>;

// ─── Metadata Schema ──────────────────────────────────────────────────────────

export const MetadataSchema = z.object({
  tags: z.array(z.string().min(1).max(32)).max(20).default([]),
  category: z.string().min(1).max(64),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  license: z.string().min(1).max(64),
});

export type Metadata = z.infer<typeof MetadataSchema>;

// ─── Agent Manifest Schema ────────────────────────────────────────────────────

export const AgentManifestSchema = z
  .object({
    name: slugString,
    version: semverString,
    displayName: z.string().min(1).max(128),
    description: z.string().min(10).max(2048),
    author: AuthorSchema,
    capabilities: z
      .array(AgentCapabilityEnum)
      .min(1)
      .refine((caps) => new Set(caps).size === caps.length, {
        message: 'Capabilities must be unique',
      }),
    tools: z
      .array(ToolDeclarationSchema)
      .max(MAX_TOOLS_PER_AGENT)
      .refine(
        (tools) => {
          const names = tools.map((t) => t.name);
          return new Set(names).size === names.length;
        },
        { message: 'Tool names must be unique within an agent' }
      ),
    models: ModelsSchema,
    permissions: z.array(PermissionSchema).default([]),
    pricing: PricingSchema,
    metadata: MetadataSchema,
    minSdkVersion: semverString,
    entryPoint: z
      .string()
      .min(1)
      .max(256)
      .regex(/\.(js|ts|mjs|cjs)$/, {
        message: 'Entry point must be a JavaScript or TypeScript file',
      }),
  })
  .strict();

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

// ─── Validation Function ──────────────────────────────────────────────────────

export function validateManifest(raw: unknown): AgentManifest {
  const result = AgentManifestSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `[${issue.path.join('.')}]` : '[root]';
        return `  ${path}: ${issue.message}`;
      })
      .join('\n');

    throw new Error(`Agent manifest validation failed:\n${issues}`);
  }

  return result.data;
}

// ─── Semver Utilities ─────────────────────────────────────────────────────────

function parseSemver(version: string): [number, number, number] {
  const match = SEMVER_RE.exec(version);
  if (!match) {
    throw new Error(`Invalid semver string: "${version}"`);
  }
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

export function semverCompare(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

export function isCompatible(manifest: AgentManifest, sdkVersion: string): boolean {
  return semverCompare(sdkVersion, manifest.minSdkVersion) >= 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatPermission(permission: Permission): string {
  const scope = permission.scope ? ` (scope: ${permission.scope})` : '';
  return `${permission.resource}:${permission.access}${scope}`;
}

export function permissionKey(permission: Permission): string {
  return `${permission.resource}:${permission.access}:${permission.scope ?? '*'}`;
}

export function indexTools(manifest: AgentManifest): Map<string, ToolDeclaration> {
  const map = new Map<string, ToolDeclaration>();
  for (const tool of manifest.tools) {
    map.set(tool.name, tool);
  }
  return map;
}
