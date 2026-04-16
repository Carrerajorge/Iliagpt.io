/**
 * ConnectorDataTransformer — Cross-connector data normalization and transformation.
 *
 * When data flows between connectors (e.g., Gmail contact → HubSpot contact),
 * this layer:
 *  1. Normalizes provider-specific formats to a canonical form
 *  2. Applies field-level transformations (date formats, name splitting, etc.)
 *  3. Validates transformed data against target schema
 *  4. Handles data loss warnings when target schema is narrower than source
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface FieldMapping {
  /** Source field path (dot notation) */
  source: string;
  /** Target field path (dot notation) */
  target: string;
  /** Optional transformation function name */
  transform?: TransformFunction;
  /** If true, skip if source value is missing */
  optional?: boolean;
  /** Default value if source is missing and not optional */
  defaultValue?: unknown;
}

export type TransformFunction =
  | "toString"
  | "toNumber"
  | "toBoolean"
  | "toDate"
  | "toIsoDate"
  | "toUnixTimestamp"
  | "toLowerCase"
  | "toUpperCase"
  | "trim"
  | "splitFirst"       // "John Doe" → "John"
  | "splitLast"        // "John Doe" → "Doe"
  | "joinArray"        // ["a","b"] → "a, b"
  | "firstElement"     // [item1, item2] → item1
  | "flattenArray"     // [[a],[b]] → [a,b]
  | "extractEmails"    // "contact me at a@b.com" → ["a@b.com"]
  | "extractUrls"      // "visit https://foo.com" → ["https://foo.com"]
  | "stripHtml"        // "<b>hello</b>" → "hello"
  | "truncate100"      // Truncate to 100 chars
  | "truncate255"      // Truncate to 255 chars
  | "md5Hash"          // Hash for dedup
  | "parseJson"        // String → parsed object
  | "toJson"           // Object → JSON string
  | "identity";        // Pass through unchanged

export interface TransformPipeline {
  id: string;
  name: string;
  description?: string;
  sourceConnector: string;
  sourceOperation: string;
  targetConnector: string;
  targetOperation: string;
  mappings: FieldMapping[];
  /** Fields to exclude from output even if present */
  excludeFields?: string[];
  /** If true, include unmapped fields from source in output */
  passthrough?: boolean;
}

export interface TransformResult {
  success: boolean;
  data: Record<string, unknown>;
  warnings: string[];
  /** Fields that couldn't be mapped */
  unmappedFields: string[];
  /** Fields where transformation failed */
  failedTransforms: string[];
}

// ─── Transform functions ─────────────────────────────────────────────

const TRANSFORM_REGISTRY: Record<TransformFunction, (value: unknown) => unknown> = {
  identity: (v) => v,
  toString: (v) => (v === null || v === undefined ? "" : String(v)),
  toNumber: (v) => {
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  },
  toBoolean: (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return ["true", "1", "yes", "on"].includes(v.toLowerCase());
    return Boolean(v);
  },
  toDate: (v) => {
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
  },
  toIsoDate: (v) => {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },
  toUnixTimestamp: (v) => {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
  },
  toLowerCase: (v) => String(v ?? "").toLowerCase(),
  toUpperCase: (v) => String(v ?? "").toUpperCase(),
  trim: (v) => String(v ?? "").trim(),
  splitFirst: (v) => {
    const parts = String(v ?? "").trim().split(/\s+/);
    return parts[0] || "";
  },
  splitLast: (v) => {
    const parts = String(v ?? "").trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  },
  joinArray: (v) => {
    if (Array.isArray(v)) return v.join(", ");
    return String(v ?? "");
  },
  firstElement: (v) => {
    if (Array.isArray(v)) return v[0] ?? null;
    return v;
  },
  flattenArray: (v) => {
    if (Array.isArray(v)) return v.flat();
    return v;
  },
  extractEmails: (v) => {
    const str = String(v ?? "");
    const matches = str.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    return matches || [];
  },
  extractUrls: (v) => {
    const str = String(v ?? "");
    const matches = str.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g);
    return matches || [];
  },
  stripHtml: (() => {
    const htmlTagPattern = /<\s*(?:script|style)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/gi;
    const markupPattern = /<[^>]*?>/g;
    const entityPattern = /&(?:nbsp|amp|lt|gt|quot|apos);/gi;

    return (v) =>
      String(v ?? "")
        .normalize("NFKC")
        .replace(htmlTagPattern, "")
        .replace(markupPattern, "")
        .replace(entityPattern, "")
        .replace(/[`*_~#>{}[\]]/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
  })(),
  truncate100: (v) => {
    const s = String(v ?? "");
    return s.length > 100 ? s.slice(0, 97) + "..." : s;
  },
  truncate255: (v) => {
    const s = String(v ?? "");
    return s.length > 255 ? s.slice(0, 252) + "..." : s;
  },
  md5Hash: (v) => {
    const { createHash } = require("crypto");
    return createHash("md5").update(String(v ?? "")).digest("hex");
  },
  parseJson: (v) => {
    try {
      return typeof v === "string" ? JSON.parse(v) : v;
    } catch {
      return null;
    }
  },
  toJson: (v) => {
    try {
      return JSON.stringify(v);
    } catch {
      return "null";
    }
  },
};

// ─── Data Transformer ────────────────────────────────────────────────

export class ConnectorDataTransformer {
  private pipelines = new Map<string, TransformPipeline>();

  /** Register a transform pipeline */
  registerPipeline(pipeline: TransformPipeline): void {
    this.pipelines.set(pipeline.id, pipeline);
  }

  /** Get a pipeline by ID */
  getPipeline(id: string): TransformPipeline | undefined {
    return this.pipelines.get(id);
  }

  /** Find a pipeline for a source→target connector pair */
  findPipeline(
    sourceConnector: string,
    sourceOperation: string,
    targetConnector: string,
    targetOperation: string
  ): TransformPipeline | undefined {
    for (const pipeline of Array.from(this.pipelines.values())) {
      if (
        pipeline.sourceConnector === sourceConnector &&
        pipeline.sourceOperation === sourceOperation &&
        pipeline.targetConnector === targetConnector &&
        pipeline.targetOperation === targetOperation
      ) {
        return pipeline;
      }
    }
    return undefined;
  }

  /** Transform data using a specific pipeline */
  transform(
    pipelineId: string,
    sourceData: Record<string, unknown>
  ): TransformResult {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      return {
        success: false,
        data: {},
        warnings: [`Pipeline "${pipelineId}" not found`],
        unmappedFields: [],
        failedTransforms: [],
      };
    }

    return this.applyMappings(pipeline, sourceData);
  }

  /** Transform data using explicit mappings */
  transformWithMappings(
    mappings: FieldMapping[],
    sourceData: Record<string, unknown>,
    options?: { passthrough?: boolean; excludeFields?: string[] }
  ): TransformResult {
    const pipeline: TransformPipeline = {
      id: "inline",
      name: "Inline transform",
      sourceConnector: "unknown",
      sourceOperation: "unknown",
      targetConnector: "unknown",
      targetOperation: "unknown",
      mappings,
      passthrough: options?.passthrough,
      excludeFields: options?.excludeFields,
    };
    return this.applyMappings(pipeline, sourceData);
  }

  /** Apply a single transform function */
  applyTransform(value: unknown, transform: TransformFunction): unknown {
    const fn = TRANSFORM_REGISTRY[transform];
    if (!fn) {
      console.warn(`[DataTransformer] Unknown transform: ${transform}`);
      return value;
    }
    return fn(value);
  }

  /** List all available transform functions */
  getAvailableTransforms(): TransformFunction[] {
    return Object.keys(TRANSFORM_REGISTRY) as TransformFunction[];
  }

  /** List all registered pipelines */
  listPipelines(): TransformPipeline[] {
    return Array.from(this.pipelines.values());
  }

  // ─── Private ───────────────────────────────────────────────────

  private applyMappings(
    pipeline: TransformPipeline,
    sourceData: Record<string, unknown>
  ): TransformResult {
    const result: Record<string, unknown> = {};
    const warnings: string[] = [];
    const unmappedFields: string[] = [];
    const failedTransforms: string[] = [];
    const mappedSourcePaths = new Set<string>();

    // Apply explicit mappings
    for (const mapping of pipeline.mappings) {
      mappedSourcePaths.add(mapping.source);

      const sourceValue = navigatePath(sourceData, mapping.source);

      // Handle missing source values
      if (sourceValue === undefined || sourceValue === null) {
        if (mapping.optional) continue;
        if (mapping.defaultValue !== undefined) {
          setPath(result, mapping.target, mapping.defaultValue);
          continue;
        }
        warnings.push(`Source field "${mapping.source}" is missing`);
        continue;
      }

      // Apply transformation
      let transformedValue = sourceValue;
      if (mapping.transform && mapping.transform !== "identity") {
        try {
          transformedValue = this.applyTransform(sourceValue, mapping.transform);
        } catch (err) {
          failedTransforms.push(mapping.source);
          warnings.push(
            `Transform "${mapping.transform}" failed on "${mapping.source}": ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          continue;
        }
      }

      setPath(result, mapping.target, transformedValue);
    }

    // Passthrough unmapped fields
    if (pipeline.passthrough) {
      const excludeSet = new Set(pipeline.excludeFields || []);
      for (const [key, value] of Object.entries(sourceData)) {
        if (!mappedSourcePaths.has(key) && !excludeSet.has(key)) {
          if (!(key in result)) {
            result[key] = value;
            unmappedFields.push(key);
          }
        }
      }
    } else {
      // Report unmapped fields as warnings
      for (const key of Object.keys(sourceData)) {
        if (!mappedSourcePaths.has(key)) {
          unmappedFields.push(key);
        }
      }
    }

    return {
      success: failedTransforms.length === 0,
      data: result,
      warnings,
      unmappedFields,
      failedTransforms,
    };
  }
}

// ─── Built-in pipelines ──────────────────────────────────────────────

/** Common cross-connector pipelines */
export const BUILT_IN_PIPELINES: TransformPipeline[] = [
  {
    id: "gmail_to_hubspot_contact",
    name: "Gmail Email → HubSpot Contact",
    sourceConnector: "gmail",
    sourceOperation: "gmail_read_email",
    targetConnector: "hubspot",
    targetOperation: "hubspot_create_contact",
    mappings: [
      { source: "from.email", target: "email", transform: "toLowerCase" },
      { source: "from.name", target: "firstname", transform: "splitFirst" },
      { source: "from.name", target: "lastname", transform: "splitLast" },
      { source: "subject", target: "notes", transform: "truncate255", optional: true },
    ],
  },
  {
    id: "gmail_to_notion_page",
    name: "Gmail Email → Notion Page",
    sourceConnector: "gmail",
    sourceOperation: "gmail_read_email",
    targetConnector: "notion",
    targetOperation: "notion_create_page",
    mappings: [
      { source: "subject", target: "title" },
      { source: "body", target: "content", transform: "stripHtml" },
      { source: "from.email", target: "properties.email" },
      { source: "date", target: "properties.date", transform: "toIsoDate" },
    ],
  },
  {
    id: "github_issue_to_notion",
    name: "GitHub Issue → Notion Page",
    sourceConnector: "github",
    sourceOperation: "github_list_issues",
    targetConnector: "notion",
    targetOperation: "notion_create_page",
    mappings: [
      { source: "title", target: "title" },
      { source: "body", target: "content" },
      { source: "html_url", target: "properties.url" },
      { source: "state", target: "properties.status" },
      { source: "labels", target: "properties.tags", transform: "joinArray" },
      { source: "assignee.login", target: "properties.assignee", optional: true },
    ],
  },
  {
    id: "hubspot_to_slack",
    name: "HubSpot Contact → Slack Message",
    sourceConnector: "hubspot",
    sourceOperation: "hubspot_get_contact",
    targetConnector: "slack",
    targetOperation: "slack_post_message",
    mappings: [
      {
        source: "properties.firstname",
        target: "text",
        transform: "identity",
        defaultValue: "Unknown Contact",
      },
    ],
  },
];

// ─── Path helpers ────────────────────────────────────────────────────

function navigatePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const segments = path.split(/\.|\[|\]/).filter(Boolean);
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;

    const idx = parseInt(segment, 10);
    if (!Number.isNaN(idx) && Array.isArray(current)) {
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return current;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!(seg in current) || typeof current[seg] !== "object" || current[seg] === null) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }

  current[segments[segments.length - 1]] = value;
}

// ─── Singleton ───────────────────────────────────────────────────────

export const connectorDataTransformer = new ConnectorDataTransformer();

// Register built-in pipelines
for (const pipeline of BUILT_IN_PIPELINES) {
  connectorDataTransformer.registerPipeline(pipeline);
}
