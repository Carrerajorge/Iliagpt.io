import type { ConnectorManifest, ConnectorCapability } from "./types";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface CodegenOptions {
  connectorId: string;
  displayName: string;
  description?: string;
  category?: "productivity" | "communication" | "crm" | "development" | "storage" | "analytics" | "finance" | "marketing" | "design" | "hr" | "security" | "other";
  authType?: "oauth2" | "api_key" | "basic" | "none";
  baseUrl?: string;
  maxOps?: number;
  scopes?: string[];
  requiredEnvVars?: string[];
}

/* ------------------------------------------------------------------ */
/*  $ref resolution                                                    */
/* ------------------------------------------------------------------ */

/**
 * Recursively inline all `$ref` pointers against the OpenAPI
 * `#/components/…` tree.  Handles nested refs and circular refs
 * (breaks cycle after 32 levels).
 */
export function resolveRefs(
  schema: Record<string, any>,
  components: Record<string, any>,
  _depth = 0,
): Record<string, any> {
  if (_depth > 32) return schema;

  if (schema === null || schema === undefined || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => resolveRefs(item, components, _depth + 1));
  }

  if (typeof schema.$ref === "string") {
    const resolved = followRef(schema.$ref, components);
    if (!resolved) return { type: "object" };
    return resolveRefs(resolved, components, _depth + 1);
  }

  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(schema)) {
    out[key] = resolveRefs(val, components, _depth + 1);
  }
  return out;
}

function followRef(
  ref: string,
  components: Record<string, any>,
): Record<string, any> | undefined {
  // Only handle local refs of the form "#/components/…"
  if (!ref.startsWith("#/")) return undefined;
  const segments = ref.replace(/^#\//, "").split("/");
  let cursor: any = { components };
  // The top-level keys under "#/" are usually "components", so we
  // walk from the root object that wraps components.
  cursor = undefined;

  // Re-walk from a pseudo-root that mirrors the full spec structure.
  let node: any = { components } as any;
  for (const seg of segments) {
    if (node === undefined || node === null || typeof node !== "object") return undefined;
    node = node[seg];
  }
  return typeof node === "object" ? JSON.parse(JSON.stringify(node)) : undefined;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const HTTP_METHODS = ["get", "head", "post", "put", "patch", "delete", "options", "trace"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function isHttpMethod(m: string): m is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(m.toLowerCase());
}

function toSnakeCase(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function deriveOperationId(
  connectorId: string,
  method: string,
  path: string,
): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/^\{|\}$/g, "").replace(/[^a-zA-Z0-9]/g, "_"));
  const raw = `${method}_${segments.join("_")}`;
  const prefixed = `${connectorId}_${raw}`;
  return toSnakeCase(prefixed).slice(0, 64);
}

function deriveName(method: string, path: string, summary?: string): string {
  if (summary) return truncate(summary, 120);
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/^\{|\}$/g, ""));
  const resource = segments[segments.length - 1] || "resource";
  const verb =
    method === "get"
      ? "Get"
      : method === "post"
        ? "Create"
        : method === "put"
          ? "Update"
          : method === "patch"
            ? "Patch"
            : method === "delete"
              ? "Delete"
              : method.charAt(0).toUpperCase() + method.slice(1);
  return `${verb} ${resource.charAt(0).toUpperCase() + resource.slice(1)}`;
}

function dataAccessForMethod(method: string): "read" | "write" | "admin" {
  const m = method.toLowerCase();
  if (m === "get" || m === "head") return "read";
  if (m === "delete") return "admin";
  return "write";
}

function isIdempotent(method: string): boolean {
  const m = method.toLowerCase();
  return m === "get" || m === "head" || m === "put" || m === "delete";
}

/* ------------------------------------------------------------------ */
/*  Schema builders                                                    */
/* ------------------------------------------------------------------ */

interface ParamObject {
  name: string;
  in: string;
  required?: boolean;
  schema?: Record<string, any>;
  description?: string;
}

function buildInputSchema(
  params: ParamObject[],
  requestBody: Record<string, any> | undefined,
  components: Record<string, any>,
): Record<string, any> {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  // Path + query + header params
  for (const p of params) {
    if (p.in === "path" || p.in === "query" || p.in === "header") {
      const resolved = p.schema ? resolveRefs(p.schema, components) : { type: "string" };
      properties[p.name] = { ...resolved };
      if (p.description) properties[p.name].description = p.description;
      if (p.required) required.push(p.name);
    }
  }

  // Request body — merge top-level properties into the flat schema
  if (requestBody) {
    const bodyRef = resolveRefs(requestBody, components);
    const content = bodyRef.content || {};
    const mediaType =
      content["application/json"] ||
      content["application/x-www-form-urlencoded"] ||
      content["multipart/form-data"] ||
      Object.values(content)[0];

    if (mediaType?.schema) {
      const bodySchema = resolveRefs(mediaType.schema, components);
      if (bodySchema.type === "object" && bodySchema.properties) {
        for (const [key, val] of Object.entries(bodySchema.properties)) {
          // Avoid name collisions with path/query params
          const propName = properties[key] ? `body_${key}` : key;
          properties[propName] = val;
        }
        if (Array.isArray(bodySchema.required)) {
          for (const r of bodySchema.required) {
            const propName = properties[r] ? r : properties[`body_${r}`] ? `body_${r}` : r;
            required.push(propName);
          }
        }
      } else {
        // Non-object body: wrap in a "body" property
        properties["body"] = bodySchema;
        if (bodyRef.required) required.push("body");
      }
    }
  }

  const schema: Record<string, any> = {
    type: "object",
    properties,
  };
  if (required.length > 0) {
    schema.required = [...new Set(required)];
  }
  return schema;
}

function buildOutputSchema(
  responses: Record<string, any> | undefined,
  components: Record<string, any>,
): Record<string, any> {
  if (!responses) return { type: "object" };

  // Look for 200, 201, 2XX, default in that order
  const successKey =
    Object.keys(responses).find((k) => k === "200") ||
    Object.keys(responses).find((k) => k === "201") ||
    Object.keys(responses).find((k) => /^2\d\d$/.test(k) || k === "2XX") ||
    Object.keys(responses).find((k) => k === "default");

  if (!successKey) return { type: "object" };

  let resp = responses[successKey];
  resp = resolveRefs(resp, components);

  const content = resp.content || {};
  const mediaType =
    content["application/json"] || Object.values(content)[0] as any;

  if (mediaType?.schema) {
    return resolveRefs(mediaType.schema, components);
  }

  return { type: "object" };
}

/* ------------------------------------------------------------------ */
/*  Main codegen function                                              */
/* ------------------------------------------------------------------ */

export function generateManifestFromOpenApi(
  spec: Record<string, any> | string,
  options: CodegenOptions,
): ConnectorManifest {
  const parsed: Record<string, any> =
    typeof spec === "string" ? JSON.parse(spec) : spec;

  const components = parsed.components || {};
  const paths: Record<string, any> = parsed.paths || {};
  const serverUrl =
    options.baseUrl ||
    parsed.servers?.[0]?.url ||
    "";

  const maxOps = options.maxOps ?? 20;

  // ---- Build capabilities from paths ----
  const capabilities: ConnectorCapability[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (capabilities.length >= maxOps) break;
    if (!pathItem || typeof pathItem !== "object") continue;

    // Resolve path-level $ref if present
    const resolvedPathItem = pathItem.$ref
      ? resolveRefs(pathItem, components)
      : pathItem;

    // Shared parameters at path level
    const sharedParams: ParamObject[] = Array.isArray(resolvedPathItem.parameters)
      ? resolvedPathItem.parameters.map((p: any) => resolveRefs(p, components))
      : [];

    for (const method of HTTP_METHODS) {
      if (capabilities.length >= maxOps) break;
      const operation = resolvedPathItem[method];
      if (!operation || typeof operation !== "object") continue;

      // Merge path-level + operation-level parameters (operation wins on name+in collision)
      const opParams: ParamObject[] = Array.isArray(operation.parameters)
        ? operation.parameters.map((p: any) => resolveRefs(p, components))
        : [];

      const mergedParamsMap = new Map<string, ParamObject>();
      for (const p of sharedParams) mergedParamsMap.set(`${p.in}:${p.name}`, p);
      for (const p of opParams) mergedParamsMap.set(`${p.in}:${p.name}`, p);
      const mergedParams = Array.from(mergedParamsMap.values());

      const operationId =
        operation.operationId
          ? toSnakeCase(operation.operationId).slice(0, 64)
          : deriveOperationId(options.connectorId, method, path);

      const name = deriveName(method, path, operation.summary);
      const description = truncate(
        operation.description || operation.summary || name,
        200,
      );

      const inputSchema = buildInputSchema(
        mergedParams,
        operation.requestBody,
        components,
      );

      const outputSchema = buildOutputSchema(operation.responses, components);

      const dal = dataAccessForMethod(method);
      const tags: string[] = Array.isArray(operation.tags)
        ? operation.tags.map(String)
        : [];

      const cap: ConnectorCapability = {
        operationId,
        name,
        description,
        requiredScopes: options.scopes || [],
        inputSchema,
        outputSchema,
        dataAccessLevel: dal,
        confirmationRequired: dal === "write" || dal === "admin",
        idempotent: isIdempotent(method),
        tags,
      };

      capabilities.push(cap);
    }
  }

  // ---- Detect auth type from spec securityDefinitions / securitySchemes ----
  let detectedAuthType: "oauth2" | "api_key" | "basic" | "none" =
    (options.authType as any) || "none";

  if (!options.authType) {
    const schemes = components.securitySchemes || {};
    for (const scheme of Object.values(schemes) as any[]) {
      if (scheme.type === "oauth2") {
        detectedAuthType = "oauth2";
        break;
      }
      if (scheme.type === "apiKey" || scheme.type === "http" && scheme.scheme === "bearer") {
        detectedAuthType = "api_key";
      }
      if (scheme.type === "http" && scheme.scheme === "basic" && detectedAuthType === "none") {
        detectedAuthType = "basic";
      }
    }
  }

  // ---- Assemble manifest ----
  const manifest: ConnectorManifest = {
    connectorId: options.connectorId,
    version: "1.0.0",
    displayName: options.displayName,
    description:
      options.description ||
      parsed.info?.description ||
      `${options.displayName} connector`,
    iconUrl: "",
    category: (options.category as any) || "other",
    authType: detectedAuthType,
    authConfig: buildAuthConfig(detectedAuthType, components),
    baseUrl: serverUrl,
    capabilities,
    rateLimit: {
      requestsPerMinute: 60,
      requestsPerDay: 10000,
      concurrentRequests: 5,
    },
    requiredEnvVars: options.requiredEnvVars || [],
  };

  return manifest;
}

/* ------------------------------------------------------------------ */
/*  Auth config builder                                                */
/* ------------------------------------------------------------------ */

function buildAuthConfig(
  authType: string,
  components: Record<string, any>,
): Record<string, any> {
  const schemes = components.securitySchemes || {};

  if (authType === "oauth2") {
    for (const scheme of Object.values(schemes) as any[]) {
      if (scheme.type !== "oauth2") continue;
      const flows = scheme.flows || {};
      const flow =
        flows.authorizationCode ||
        flows.clientCredentials ||
        flows.implicit ||
        flows.password ||
        {};
      return {
        authorizationUrl: flow.authorizationUrl || "",
        tokenUrl: flow.tokenUrl || "",
        refreshUrl: flow.refreshUrl || "",
        scopes: flow.scopes ? Object.keys(flow.scopes) : [],
      };
    }
    return { authorizationUrl: "", tokenUrl: "", scopes: [] };
  }

  if (authType === "api_key") {
    for (const scheme of Object.values(schemes) as any[]) {
      if (scheme.type === "apiKey") {
        return {
          headerName: scheme.name || "Authorization",
          in: scheme.in || "header",
          prefix: "",
        };
      }
      if (scheme.type === "http" && scheme.scheme === "bearer") {
        return {
          headerName: "Authorization",
          in: "header",
          prefix: "Bearer ",
        };
      }
    }
    return { headerName: "Authorization", in: "header", prefix: "Bearer " };
  }

  if (authType === "basic") {
    return { headerName: "Authorization", in: "header" };
  }

  return {};
}
