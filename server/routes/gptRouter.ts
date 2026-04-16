import { Router, Request } from "express";
import { storage } from "../storage";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { createGptActionRuntime, normalizeGptActionRequestPayload } from "../services/gptActionRuntime";
import { gptActionCreateSchema, gptActionUpdateSchema, gptActionUseSchema } from "@shared/schema/gpt";
import { safeErrorMessage } from "../lib/safeError";

const DEFAULT_GPT_MODEL = "grok-4-1-fast-non-reasoning";
const DEFAULT_GPT_KNOWLEDGE_SOURCES: Array<Record<string, any>> = [];
const DEFAULT_GPT_ACTIONS: string[] = [];
const IDENTIFIER_RE = /^[a-zA-Z0-9._-]{1,140}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_GPT_ACTION_USE_PAYLOAD_BYTES = 80_000;
const MAX_GPT_ACTION_REQUEST_KEYS = 240;
const MAX_GPT_ACTION_REQUEST_DEPTH = 16;
const MAX_GPT_ACTION_REQUEST_ARRAY = 400;
const MAX_GPT_ACTION_REQUEST_STRING_BYTES = 10_240;
const MAX_GPT_ACTION_ERROR_MESSAGE_BYTES = 1_024;
const FORBIDDEN_REQUEST_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown, fallback?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item) => typeof item === "string");
}

function normalizeCapabilities(value: unknown) {
  const source = asRecord(value) || {};
  return {
    webBrowsing: asBoolean(source.webBrowsing, false),
    codeInterpreter: asBoolean(source.codeInterpreter, false),
    imageGeneration: asBoolean(source.imageGeneration, false),
    fileUpload: asBoolean(source.fileUpload, false),
    dataAnalysis: asBoolean(source.dataAnalysis, false),
    canvas: asBoolean(source.canvas, false),
  };
}

function normalizeRuntimePolicy(value: unknown) {
  const source = asRecord(value) || {};
  return {
    enforceModel: asBoolean(source.enforceModel, false),
    modelFallbacks: asStringArray(source.modelFallbacks),
    maxTokensOverride: asNumber(source.maxTokensOverride),
    temperatureOverride: asNumber(source.temperatureOverride),
    allowClientOverride: asBoolean(source.allowClientOverride, false),
    piiRedactionEnabled: asBoolean(source.piiRedactionEnabled, true),
    allowedDomains: asStringArray(source.allowedDomains),
    workspaceOnly: asBoolean(source.workspaceOnly, false),
  };
}

function normalizeToolPermissions(value: unknown): { mode: "allowlist" | "denylist"; tools: string[]; actionsEnabled: boolean } {
  const source = asRecord(value) || {};
  return {
    mode: source.mode === "denylist" ? "denylist" : "allowlist",
    tools: asStringArray(source.tools),
    actionsEnabled: asBoolean(source.actionsEnabled, true),
  };
}

function definitionFromRequest(body: any) {
  const definitionBody = asRecord(body?.definition) || {};
  const instructions = asString(definitionBody.instructions) || asString(body.instructions) || asString(body.systemPrompt);
  const capabilities = asRecord(body.capabilities) || asRecord(definitionBody.capabilities);
  const policies = asRecord(body.policies) || asRecord(definitionBody.policies);
  const knowledgeSources = Array.isArray(definitionBody.knowledgeSources) ? definitionBody.knowledgeSources : (Array.isArray(body.knowledgeSources) ? body.knowledgeSources : undefined);
  const actions = Array.isArray(definitionBody.actions) ? definitionBody.actions : (Array.isArray(body.actions) ? body.actions : undefined);

  const result = {
    name: asString(definitionBody.name) || asString(body.name),
    description: asString(definitionBody.description) || asString(body.description),
    avatar: asString(definitionBody.avatar) || asString(body.avatar),
    model: asString(definitionBody.model) || asString(body.model),
    instructions: instructions !== undefined ? instructions : undefined,
    conversationStarters: Array.isArray(definitionBody.conversationStarters)
      ? definitionBody.conversationStarters
      : (Array.isArray(body.conversationStarters) ? body.conversationStarters : undefined),
    capabilities: capabilities ? normalizeCapabilities(capabilities) : undefined,
    knowledgeSources: Array.isArray(knowledgeSources) ? knowledgeSources : undefined,
    actions: Array.isArray(actions) ? actions : undefined,
    policies: policies ? normalizeRuntimePolicy(policies) : undefined,
  };

  return Object.fromEntries(Object.entries(result).filter(([_, v]) => v !== undefined));
}

function normalizeDefinitionFromLegacyGpt(gpt: any) {
  const base = asRecord(gpt.definition) || {};
  return {
    name: asString(gpt.name) || "",
    description: asString(gpt.description),
    avatar: asString(gpt.avatar),
    model: asString(base.model) || asString(gpt.recommendedModel) || DEFAULT_GPT_MODEL,
    instructions: asString(base.instructions) || asString(gpt.systemPrompt) || "",
    conversationStarters: asStringArray(base.conversationStarters || gpt.conversationStarters, []),
    capabilities: normalizeCapabilities(base.capabilities || gpt.capabilities),
    knowledgeSources: Array.isArray(base.knowledgeSources) ? base.knowledgeSources : DEFAULT_GPT_KNOWLEDGE_SOURCES,
    actions: Array.isArray(base.actions) ? base.actions : DEFAULT_GPT_ACTIONS,
    policies: normalizeRuntimePolicy(base.policies || {}),
    piiRedactionEnabled: asBoolean((asRecord(base.policies) || {}).piiRedactionEnabled, true),
  };
}

function mergeDefinitions(base: any, patch: any) {
  const next: any = { ...base, ...patch };
  if (patch && typeof patch.capabilities === "object") {
    next.capabilities = { ...base.capabilities, ...patch.capabilities };
  }
  if (patch && typeof patch.policies === "object") {
    next.policies = { ...base.policies, ...patch.policies };
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, "conversationStarters")) {
    next.conversationStarters = Array.isArray(patch.conversationStarters) ? patch.conversationStarters : [];
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, "knowledgeSources")) {
    next.knowledgeSources = Array.isArray(patch.knowledgeSources) ? patch.knowledgeSources : [];
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, "actions")) {
    next.actions = Array.isArray(patch.actions) ? patch.actions : [];
  }
  return next;
}

function getRuntimePolicyPayload(policies: any) {
  const safePolicies = policies || {};
  return {
    enforceModel: asBoolean(safePolicies.enforceModel, false),
    modelFallbacks: asStringArray(safePolicies.modelFallbacks),
    maxTokensOverride: asNumber(safePolicies.maxTokensOverride),
    temperatureOverride: asNumber(safePolicies.temperatureOverride),
    allowClientOverride: asBoolean(safePolicies.allowClientOverride, false),
  };
}

function sanitizeTextForRoute(value: string, maxBytes: number): string {
  const normalized = value.normalize("NFKC").replace(CONTROL_CHAR_RE, "").trim();
  const bytes = Buffer.byteLength(normalized, "utf8");
  if (bytes <= maxBytes) {
    return normalized;
  }
  return normalized.slice(0, maxBytes);
}

function normalizeIdentifier(rawId: unknown): string | null {
  if (typeof rawId !== "string") {
    return null;
  }
  const normalized = rawId.normalize("NFKC").trim().replace(CONTROL_CHAR_RE, "");
  if (!IDENTIFIER_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function sanitizeRoutePayloadObject(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_GPT_ACTION_REQUEST_DEPTH) {
    throw new Error("Request payload depth is too high");
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Request payload contains invalid numeric value");
    }
    return value;
  }

  if (typeof value === "string") {
    return sanitizeTextForRoute(value, MAX_GPT_ACTION_REQUEST_STRING_BYTES);
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error("Request payload contains unsupported type");
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_GPT_ACTION_REQUEST_ARRAY) {
      throw new Error("Request payload array is too large");
    }
    if (seen.has(value)) {
      throw new Error("Request payload contains circular reference");
    }
    seen.add(value);
    const output = value.slice(0, MAX_GPT_ACTION_REQUEST_ARRAY).map((entry) => sanitizeRoutePayloadObject(entry, depth + 1, seen));
    seen.delete(value);
    return output;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    throw new Error("Request payload contains invalid object");
  }

  if (seen.has(value as object)) {
    throw new Error("Request payload contains circular reference");
  }

  seen.add(value as object);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_GPT_ACTION_REQUEST_KEYS) {
    throw new Error("Request payload contains too many keys");
  }

  const output: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = sanitizeTextForRoute(rawKey, 80);
    if (!key || FORBIDDEN_REQUEST_KEYS.has(key) || !IDENTIFIER_RE.test(key)) {
      continue;
    }
    output[key] = sanitizeRoutePayloadObject(rawValue, depth + 1, seen);
  }
  seen.delete(value as object);
  return output;
}

function sanitizeErrorForRoute(message: string | undefined): string {
  return sanitizeTextForRoute(message || "Action execution failed", MAX_GPT_ACTION_ERROR_MESSAGE_BYTES);
}

function sanitizeValidationIssues(issues: unknown): unknown[] {
  if (!Array.isArray(issues)) {
    return [];
  }

  const allowed = ["code", "path", "message", "expected", "received"];
  return issues.slice(0, 12).map((issue) => {
    if (!issue || typeof issue !== "object") {
      return { message: "Invalid payload issue" };
    }

    const source: Record<string, unknown> = issue as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        const value = source[field];
        if (typeof value === "string") {
          output[field] = sanitizeTextForRoute(value, 256);
        } else if (Array.isArray(value) || typeof value === "number" || typeof value === "boolean") {
          output[field] = value;
        } else if (value !== null && typeof value === "object") {
          output[field] = "[redacted]";
        } else {
          output[field] = value;
        }
      }
    }

    if (Object.keys(output).length === 0) {
      return { message: "Invalid payload issue" };
    }

    return output;
  });
}

function parseHeaderRequestId(value: unknown): string | null {
  if (Array.isArray(value)) {
    const head = value[0];
    return head ? parseHeaderRequestId(head) : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  return normalizeIdentifier(value);
}

function pickIdempotencyKey(bodyKey: string | undefined, headerKey: unknown): string | null {
  const headerCandidate = parseHeaderRequestId(headerKey);
  if (headerCandidate) {
    return headerCandidate;
  }
  if (typeof bodyKey === "undefined") {
    return null;
  }
  return normalizeIdentifier(bodyKey);
}

function getActionExecutionHttpStatus(result: {
  success: boolean;
  status?: string;
  error?: {
    code?: string;
    retryable?: boolean;
    retryAfter?: number;
  };
}): number {
  if (result.success) {
    return 200;
  }

  const code = result.error?.code || "";
  if (code === "idempotency_conflict" || code === "idempotency_in_progress") {
    return 409;
  }
  if (code === "rate_limited") {
    return 429;
  }
  if (code === "validation_error") {
    return 400;
  }
  if (code === "auth_error") {
    return 401;
  }
  if (code === "action_inactive" || code === "security_blocked") {
    return 403;
  }
  if (code === "timeout") {
    return 408;
  }
  if (result.status === "validation_error") {
    return 400;
  }
  if (result.error?.retryable) {
    return 503;
  }
  return 500;
}

async function canEditGpt(req: Request, gptId: string): Promise<{ allowed: boolean; gpt: any | null; error?: string }> {
  const gpt = await storage.getGpt(gptId);
  if (!gpt) {
    return { allowed: false, gpt: null, error: "GPT not found" };
  }
  const currentUserId = getOrCreateSecureUserId(req);
  if (gpt.creatorId && gpt.creatorId !== currentUserId) {
    return { allowed: false, gpt, error: "Solo el creador puede modificar este GPT" };
  }
  return { allowed: true, gpt };
}

export function createGptRouter() {
  const router = Router();

  router.get("/gpt-categories", async (req, res) => {
    try {
      const categories = await storage.getGptCategories();
      res.json(categories);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.post("/gpt-categories", async (req, res) => {
    try {
      const { name, slug, description, icon, sortOrder } = req.body;
      if (!name || !slug) {
        return res.status(400).json({ error: "name and slug are required" });
      }
      const category = await storage.createGptCategory({
        name,
        slug,
        description: description || null,
        icon: icon || null,
        sortOrder: sortOrder || 0
      });
      res.json(category);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.get("/gpts/my", async (req, res) => {
    try {
      const currentUserId = getOrCreateSecureUserId(req);
      const myGpts = await storage.getGpts({ creatorId: currentUserId });
      res.json(Array.isArray(myGpts) ? myGpts : []);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.get("/gpts/accessible", async (req, res) => {
    try {
      const currentUserId = getOrCreateSecureUserId(req);
      const allGpts = await storage.getGpts();

      const accessibleGpts = allGpts.filter(gpt => {
        if (gpt.visibility === 'public') return true;
        if (gpt.creatorId === currentUserId) return true;
        if (gpt.visibility === 'team') {
          return gpt.creatorId === currentUserId;
        }
        return false;
      });

      res.json(accessibleGpts);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.get("/gpts", async (req, res) => {
    try {
      const { visibility, categoryId, creatorId } = req.query;
      const currentUserId = getOrCreateSecureUserId(req);
      const filters: any = {};
      if (visibility) filters.visibility = visibility as string;
      if (categoryId) filters.categoryId = categoryId as string;
      if (creatorId) filters.creatorId = creatorId as string;

      let gptList = await storage.getGpts(Object.keys(filters).length > 0 ? filters : undefined);

      gptList = gptList.filter(gpt => {
        if (gpt.visibility === 'public') return true;
        if (gpt.creatorId === currentUserId) return true;
        if (gpt.visibility === 'team' && gpt.creatorId === currentUserId) return true;
        return false;
      });

      res.json(gptList);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.get("/gpts/popular", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const gptList = await storage.getPopularGpts(limit);
      res.json(gptList);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.post("/gpts", async (req, res) => {
    try {
      const {
        name, slug, description, avatar, categoryId,
        visibility, systemPrompt, temperature, topP, maxTokens,
        welcomeMessage, capabilities, conversationStarters, isPublished
      } = req.body;
      const payload = definitionFromRequest(req.body);
      const gptDefinition = normalizeDefinitionFromLegacyGpt({
        name,
        description,
        avatar,
        recommendedModel: DEFAULT_GPT_MODEL,
        systemPrompt,
        conversationStarters,
        capabilities,
        definition: {
          conversationStarters,
          capabilities,
          actions: [],
        },
      });
      const finalDefinition = {
        ...gptDefinition,
        ...payload,
      };
      const canonicalName = finalDefinition.name || name;

      // Get authenticated user ID
      const session = req.session as any;
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id || session?.authUserId;
      const creatorId = userId || null;

      if (!canonicalName || !slug) {
        return res.status(400).json({ error: "El nombre y el slug son requeridos." });
      }

      const existing = await storage.getGptBySlug(slug);
      if (existing) {
        return res.status(409).json({ error: "A GPT with this slug already exists" });
      }

      const gpt = await storage.createGpt({
        name: canonicalName,
        slug,
        description: finalDefinition.description || description || null,
        avatar: finalDefinition.avatar || avatar || null,
        categoryId: categoryId || null,
        creatorId: creatorId,
        visibility: visibility || "private",
        systemPrompt: finalDefinition.instructions || "",
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: asNumber(maxTokens, 4096),
        welcomeMessage: welcomeMessage || null,
        capabilities: finalDefinition.capabilities,
        conversationStarters: finalDefinition.conversationStarters || [],
        recommendedModel: finalDefinition.model || DEFAULT_GPT_MODEL,
        runtimePolicy: getRuntimePolicyPayload(finalDefinition.policies),
        toolPermissions: normalizeToolPermissions(req.body.toolPermissions),
        isPublished: isPublished || "false",
        version: 1
      });

      await storage.createGptVersion({
        gptId: gpt.id,
        versionNumber: 1,
        systemPrompt: finalDefinition.instructions || "",
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: asNumber(maxTokens, 4096),
        definitionSnapshot: finalDefinition,
        changeNotes: "Initial version",
        createdBy: creatorId || null
      });

      const response = {
        ...gpt,
        definition: finalDefinition
      };
      res.json(response);
    } catch (error: any) {
      console.error("[POST /api/gpts] Creation failed:", error);
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.get("/gpts/:id", async (req, res) => {
    try {
      const gpt = await storage.getGpt(req.params.id);
      if (!gpt) {
        const gptBySlug = await storage.getGptBySlug(req.params.id);
        if (!gptBySlug) {
          return res.status(404).json({ error: "GPT not found" });
        }
        return res.json(gptBySlug);
      }
      res.json(gpt);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.patch("/gpts/:id", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      const currentGpt = await storage.getGpt(req.params.id);
      if (!currentGpt) {
        return res.status(404).json({ error: "GPT not found" });
      }

      const requestPayload = definitionFromRequest(req.body);
      const mergedDefinition = mergeDefinitions(normalizeDefinitionFromLegacyGpt(currentGpt), requestPayload);
      const nextRuntimePolicy = getRuntimePolicyPayload(mergedDefinition.policies);
      const latestVersion = (await storage.getLatestGptVersion(req.params.id))?.versionNumber ?? 0;
      const requestedSlug = asString(req.body.slug);
      const nextSlug = requestedSlug && requestedSlug !== currentGpt.slug ? requestedSlug : currentGpt.slug;

      const nextVersionNumber = latestVersion ? latestVersion + 1 : 1;
      const requestedTemperature = asNumber(req.body.temperature, parseFloat(currentGpt.temperature || "0.7"));
      const requestedTopP = asNumber(req.body.topP, parseFloat(currentGpt.topP || "1"));
      const requestedMaxTokens = asNumber(req.body.maxTokens, currentGpt.maxTokens ?? 4096);
      const existingToolPermissions = normalizeToolPermissions(req.body.toolPermissions ?? currentGpt.toolPermissions);

      const updatePayload = {
        slug: nextSlug,
        name: mergedDefinition.name,
        description: mergedDefinition.description ?? null,
        avatar: mergedDefinition.avatar ?? null,
        systemPrompt: mergedDefinition.instructions,
        temperature: `${requestedTemperature ?? 0.7}`,
        topP: `${requestedTopP ?? 1}`,
        maxTokens: requestedMaxTokens,
        capabilities: mergedDefinition.capabilities,
        conversationStarters: mergedDefinition.conversationStarters || [],
        version: nextVersionNumber,
        runtimePolicy: nextRuntimePolicy,
        toolPermissions: existingToolPermissions,
        recommendedModel: mergedDefinition.model || currentGpt.recommendedModel || DEFAULT_GPT_MODEL,
        definition: mergedDefinition,
      };

      // Check for slug collision if slug is being updated
      if (req.body.slug && req.body.slug !== currentGpt.slug) {
        const existing = await storage.getGptBySlug(req.body.slug);
        if (existing && existing.id !== req.params.id) {
          return res.status(409).json({ error: "Ya existe un GPT con este nombre/slug. Por favor elige otro nombre." });
        }
      }

      const updatedGpt = await storage.updateGpt(req.params.id, updatePayload as any);

      await storage.createGptVersion({
        gptId: req.params.id,
        versionNumber: nextVersionNumber,
        systemPrompt: mergedDefinition.instructions,
        temperature: `${requestedTemperature ?? 0.7}`,
        topP: `${requestedTopP ?? 1}`,
        maxTokens: requestedMaxTokens,
        definitionSnapshot: mergedDefinition,
        changeNotes: req.body.changeNotes || "Updated GPT configuration",
        createdBy: (req as any).user?.claims?.sub || (req as any).user?.id || (req.session as any)?.authUserId || null,
      });

      res.json(updatedGpt);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.delete("/gpts/:id", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      await storage.deleteGpt(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.post("/gpts/:id/use", async (req, res) => {
    try {
      await storage.incrementGptUsage(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.get("/gpts/:id/versions", async (req, res) => {
    try {
      const versions = await storage.getGptVersions(req.params.id);
      res.json(versions);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.post("/gpts/:id/versions", async (req, res) => {
    try {
      const {
        systemPrompt,
        temperature,
        topP,
        maxTokens,
        changeNotes,
        createdBy,
        ...rest
      } = req.body;
      const currentGpt = await storage.getGpt(req.params.id);
      if (!currentGpt) {
        return res.status(404).json({ error: "GPT not found" });
      }

      const requestPayload = definitionFromRequest({ ...rest, systemPrompt });
      const mergedDefinition = mergeDefinitions(normalizeDefinitionFromLegacyGpt(currentGpt), requestPayload);
      const nextRuntimePolicy = getRuntimePolicyPayload(mergedDefinition.policies);

      const latestVersion = await storage.getLatestGptVersion(req.params.id);
      const nextVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;
      const requestedTemperature = asNumber(temperature, parseFloat(currentGpt.temperature || "0.7"));
      const requestedTopP = asNumber(topP, parseFloat(currentGpt.topP || "1"));
      const requestedMaxTokens = asNumber(maxTokens, currentGpt.maxTokens ?? 4096);

      const version = await storage.createGptVersion({
        gptId: req.params.id,
        versionNumber: nextVersionNumber,
        systemPrompt: mergedDefinition.instructions,
        temperature: `${requestedTemperature ?? 0.7}`,
        topP: `${requestedTopP ?? 1}`,
        maxTokens: requestedMaxTokens,
        definitionSnapshot: mergedDefinition,
        changeNotes: changeNotes || "Added version snapshot",
        createdBy: createdBy || null
      });

      await storage.updateGpt(req.params.id, {
        version: nextVersionNumber,
        systemPrompt: mergedDefinition.instructions,
        temperature: `${requestedTemperature ?? 0.7}`,
        topP: `${requestedTopP ?? 1}`,
        maxTokens: requestedMaxTokens,
        definition: mergedDefinition,
        capabilities: mergedDefinition.capabilities,
        conversationStarters: mergedDefinition.conversationStarters || [],
        runtimePolicy: nextRuntimePolicy,
        recommendedModel: mergedDefinition.model || currentGpt.recommendedModel || DEFAULT_GPT_MODEL,
        toolPermissions: normalizeToolPermissions(req.body.toolPermissions || currentGpt.toolPermissions),
      });

      res.json(version);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.post("/gpts/:id/versions/:versionNumber/activate", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      const versionNumber = parseInt(req.params.versionNumber, 10);
      if (!Number.isFinite(versionNumber) || versionNumber <= 0) {
        return res.status(400).json({ error: "Invalid versionNumber" });
      }

      const currentGpt = await storage.getGpt(req.params.id);
      if (!currentGpt) {
        return res.status(404).json({ error: "GPT not found" });
      }

      const targetVersion = await storage.getGptVersionByNumber(req.params.id, versionNumber);
      if (!targetVersion) {
        return res.status(404).json({ error: "Version not found" });
      }

      const currentDefinition = normalizeDefinitionFromLegacyGpt(currentGpt);
      const targetSnapshot = targetVersion.definitionSnapshot
        ? {
          ...(asRecord(currentDefinition) || {}),
          ...(asRecord(targetVersion.definitionSnapshot) || {}),
        }
        : {
          ...currentDefinition,
          instructions: targetVersion.systemPrompt || currentDefinition.instructions,
        };
      const mergedDefinition = normalizeDefinitionFromLegacyGpt({
        ...currentGpt,
        definition: targetSnapshot,
      });

      const requestedTemperature = asNumber(targetVersion.temperature, parseFloat(currentGpt.temperature || "0.7"));
      const requestedTopP = asNumber(targetVersion.topP, parseFloat(currentGpt.topP || "1"));
      const requestedMaxTokens = asNumber(targetVersion.maxTokens, currentGpt.maxTokens ?? 4096);
      const nextRuntimePolicy = getRuntimePolicyPayload(mergedDefinition.policies);
      const latestVersion = await storage.getLatestGptVersion(req.params.id);
      const nextVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;
      const actorId = (req as any).user?.claims?.sub || (req as any).user?.id || (req.session as any)?.authUserId || null;

      const activatedVersion = await storage.createGptVersion({
        gptId: req.params.id,
        versionNumber: nextVersionNumber,
        systemPrompt: mergedDefinition.instructions,
        temperature: `${requestedTemperature ?? 0.7}`,
        topP: `${requestedTopP ?? 1}`,
        maxTokens: requestedMaxTokens,
        definitionSnapshot: mergedDefinition,
        changeNotes: `Rollback to version ${versionNumber}`,
        createdBy: actorId
      });

      const updatedGpt = await storage.updateGpt(req.params.id, {
        version: nextVersionNumber,
        systemPrompt: mergedDefinition.instructions,
        temperature: `${requestedTemperature ?? 0.7}`,
        topP: `${requestedTopP ?? 1}`,
        maxTokens: requestedMaxTokens,
        definition: mergedDefinition,
        capabilities: mergedDefinition.capabilities,
        conversationStarters: mergedDefinition.conversationStarters || [],
        runtimePolicy: nextRuntimePolicy,
        recommendedModel: mergedDefinition.model || currentGpt.recommendedModel || DEFAULT_GPT_MODEL,
        toolPermissions: normalizeToolPermissions(currentGpt.toolPermissions),
      });

      res.json({
        version: activatedVersion,
        gpt: updatedGpt
      });
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  // GPT Knowledge Base routes
  router.get("/gpts/:id/knowledge", async (req, res) => {
    try {
      const knowledge = await storage.getGptKnowledge(req.params.id);
      res.json(knowledge);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.post("/gpts/:id/knowledge", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      const { fileName, fileType, fileSize, storageUrl, contentHash, extractedText, embeddingStatus, metadata } = req.body;

      if (!fileName || !fileType || !fileSize || !storageUrl) {
        return res.status(400).json({ error: "fileName, fileType, fileSize, and storageUrl are required" });
      }

      const knowledge = await storage.createGptKnowledge({
        gptId: req.params.id,
        fileName,
        fileType,
        fileSize,
        storageUrl,
        contentHash: contentHash || null,
        extractedText: extractedText || null,
        embeddingStatus: embeddingStatus || "pending",
        metadata: metadata || null,
        isActive: "true"
      });

      // Fire-and-forget: process knowledge into vector chunks for semantic retrieval
      void import("../services/gptKnowledgeProcessor").then(({ processGptKnowledge }) => {
        processGptKnowledge(knowledge.id, req.params.id).catch((err) => {
          console.error(`[GPT Knowledge] Background processing failed for ${knowledge.id}:`, err?.message);
        });
      });

      res.json(knowledge);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  // GPT Knowledge processing status
  router.get("/gpts/:id/knowledge/:knowledgeId/status", async (req, res) => {
    try {
      const knowledge = await storage.getGptKnowledgeById(req.params.knowledgeId);
      if (!knowledge || knowledge.gptId !== req.params.id) {
        return res.status(404).json({ error: "Knowledge item not found" });
      }
      res.json({
        id: knowledge.id,
        embeddingStatus: knowledge.embeddingStatus,
        chunkCount: knowledge.chunkCount,
      });
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.patch("/gpts/:id/knowledge/:knowledgeId", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      const updates = req.body;
      const knowledge = await storage.updateGptKnowledge(req.params.knowledgeId, updates);
      if (!knowledge) {
        return res.status(404).json({ error: "Knowledge item not found" });
      }
      res.json(knowledge);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.delete("/gpts/:id/knowledge/:knowledgeId", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      await storage.deleteGptKnowledge(req.params.knowledgeId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  // GPT Actions routes
  router.get("/gpts/:id/actions", async (req, res) => {
    try {
      const actions = await storage.getGptActions(req.params.id);
      res.json(actions);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.post("/gpts/:id/actions", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      const validation = gptActionCreateSchema.safeParse({
        ...req.body,
        gptId: req.params.id,
      });

      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid action payload",
          details: validation.error.issues,
        });
      }

      const action = await storage.createGptAction(validation.data);
      res.json(action);
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.patch("/gpts/:id/actions/:actionId", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      const action = await storage.getGptActionByIdAndGpt(req.params.actionId, req.params.id);
      if (!action) {
        return res.status(404).json({ error: "Action not found" });
      }

      const validation = gptActionUpdateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid action update payload",
          details: validation.error.issues,
        });
      }

      const updatedAction = await storage.updateGptAction(req.params.actionId, validation.data);
      if (!updatedAction) {
        return res.status(404).json({ error: "Action not found" });
      }
      res.json(updatedAction);
      return;
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.delete("/gpts/:id/actions/:actionId", async (req, res) => {
    try {
      const { allowed, error } = await canEditGpt(req, req.params.id);
      if (!allowed) {
        return res.status(error === "GPT not found" ? 404 : 403).json({ error });
      }

      const action = await storage.getGptActionByIdAndGpt(req.params.actionId, req.params.id);
      if (!action) {
        return res.status(404).json({ error: "Action not found" });
      }

      await storage.deleteGptAction(req.params.actionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.post("/gpts/:id/actions/:actionId/use", async (req, res) => {
    try {
      const normalizedGptId = normalizeIdentifier(req.params.id);
      const normalizedActionId = normalizeIdentifier(req.params.actionId);
      if (!normalizedGptId || !normalizedActionId) {
        return res.status(400).json({
          error: "Invalid resource identifier",
        });
      }

      const validation = gptActionUseSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid action use payload",
          details: sanitizeValidationIssues(validation.error.issues),
        });
      }

      const action = await storage.getGptActionByIdAndGpt(normalizedActionId, normalizedGptId);
      if (!action) {
        return res.status(404).json({ error: "Action not found" });
      }

      const normalizedConversationId = normalizeIdentifier(validation.data.conversationId);
      if (!normalizedConversationId) {
        return res.status(400).json({
          error: "Invalid conversation id",
        });
      }

      let requestPayload: Record<string, unknown>;
      try {
        requestPayload = sanitizeRoutePayloadObject(validation.data.request, 0) as Record<string, unknown>;
      } catch (error: any) {
        return res.status(400).json({
          error: sanitizeErrorForRoute(error.message),
        });
      }

      let inputPayload: Record<string, unknown> | undefined;
      if (typeof validation.data.input === "object" && validation.data.input !== null) {
        try {
          inputPayload = sanitizeRoutePayloadObject(validation.data.input, 0) as Record<string, unknown>;
        } catch (error: any) {
          return res.status(400).json({
            error: sanitizeErrorForRoute(error.message),
          });
        }
      }

      const normalizedActorId = validation.data.userId ? normalizeIdentifier(validation.data.userId) : null;
      if (validation.data.userId && !normalizedActorId) {
        return res.status(400).json({
          error: "Invalid user id",
        });
      }

      const resolvedRequestId = validation.data.requestId
        ? sanitizeTextForRoute(validation.data.requestId, 140)
        : parseHeaderRequestId(req.headers["x-request-id"]);
      const normalizedIdempotencyKey = pickIdempotencyKey(
        validation.data.idempotencyKey,
        req.headers["x-idempotency-key"] || req.headers["idempotency-key"]
      );

      const normalizedRequestPayload = normalizeGptActionRequestPayload({
        request: requestPayload,
        input: inputPayload,
      } as Record<string, unknown>);
      if (Buffer.byteLength(JSON.stringify(normalizedRequestPayload), "utf8") > MAX_GPT_ACTION_USE_PAYLOAD_BYTES) {
        return res.status(413).json({
          error: "Action request payload exceeds maximum allowed size",
        });
      }

      const runtime = createGptActionRuntime();
      const execution = await runtime.execute({
        action,
        gptId: normalizedGptId,
        conversationId: normalizedConversationId,
        request: normalizeGptActionRequestPayload({
          request: normalizedRequestPayload,
        } as Record<string, unknown>) as Record<string, unknown>,
        userId: normalizedActorId || getOrCreateSecureUserId(req),
        requestId: resolvedRequestId || undefined,
        headers: validation.data.headers,
        timeoutMs: validation.data.timeoutMs,
        maxRetries: validation.data.maxRetries,
        idempotencyKey: normalizedIdempotencyKey || undefined,
      });

      if (!execution.success && execution.error?.message) {
        execution.error.message = sanitizeErrorForRoute(execution.error.message);
      }

      const httpStatus = getActionExecutionHttpStatus(execution);
      const retryAfter = (execution.error as { retryAfter?: number } | undefined)?.retryAfter;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        res.setHeader("Retry-After", Math.max(1, Math.ceil(retryAfter)).toString());
      }

      res.setHeader("X-Request-Id", execution.requestId || "unknown");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      return res.status(httpStatus).json(execution);
    } catch (error: any) {
      res.status(500).json({ error: sanitizeErrorForRoute(error?.message) });
    }
  });

  // GPT Actions routes

  router.get("/gpts/:id/about", async (req, res) => {
    try {
      const gpt = await storage.getGpt(req.params.id);
      if (!gpt) {
        return res.status(404).json({ error: "GPT not found" });
      }

      let creator = null;
      let creatorSettings: Awaited<ReturnType<typeof storage.getUserSettings>> = null;
      if (gpt.creatorId) {
        creator = await storage.getUser(gpt.creatorId);
        if (creator) {
          creatorSettings = await storage.getUserSettings(creator.id);
        }
      }

      const conversationCount = await storage.getGptConversationCount(req.params.id);

      let relatedGpts: any[] = [];
      if (gpt.creatorId) {
        const allCreatorGpts = await storage.getGpts({ creatorId: gpt.creatorId });
        relatedGpts = allCreatorGpts.filter(g => g.id !== gpt.id).slice(0, 10);
      }

      const creatorProfile = creatorSettings?.userProfile ?? null;

      res.json({
        gpt,
        creator: creator ? {
          id: creator.id,
          name: creatorProfile?.showName === false
            ? (creatorProfile?.nickname || 'Creador')
            : (creator.fullName || creator.username || creator.email?.split('@')[0] || 'Usuario'),
          avatar: creator.profileImageUrl,
          links: {
            website: creatorProfile?.websiteDomain || null,
            linkedIn: creatorProfile?.linkedInUrl || null,
            github: creatorProfile?.githubUrl || null,
          },
          receiveEmailComments: creatorProfile?.receiveEmailComments ?? false,
        } : null,
        conversationCount,
        relatedGpts
      });
    } catch (error: any) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  // Sidebar Pinned GPTs - get pinned GPTs for a user
  router.get("/users/:userId/sidebar-gpts", async (req, res) => {
    try {
      const { userId } = req.params;
      const normalizedUserId = normalizeIdentifier(userId);
      const callerId = normalizeIdentifier(getOrCreateSecureUserId(req));

      if (!normalizedUserId) {
        return res.json([]);
      }
      if (!callerId || callerId !== normalizedUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const pinnedGpts = await storage.getSidebarPinnedGpts(normalizedUserId);
      res.json(pinnedGpts);
    } catch (error: any) {
      console.error("[api] sidebar-gpts load failed", error);
      // Keep sidebar resilient if the DB has a transient failure.
      res.json([]);
    }
  });

  // Pin a GPT to sidebar
  router.post("/users/:userId/sidebar-gpts", async (req, res) => {
    try {
      const { userId } = req.params;
      const { gptId, displayOrder } = req.body;
      const normalizedUserId = normalizeIdentifier(userId);
      const normalizedGptId = normalizeIdentifier(gptId);
      const callerId = normalizeIdentifier(getOrCreateSecureUserId(req));
      if (!normalizedUserId) {
        return res.status(400).json({ error: "userId is required" });
      }
      if (!normalizedGptId) {
        return res.status(400).json({ error: "gptId is required" });
      }
      if (!callerId || callerId !== normalizedUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const safeDisplayOrder = Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : 0;
      const pinned = await storage.pinGptToSidebar(normalizedUserId, normalizedGptId, safeDisplayOrder);
      res.json(pinned);
    } catch (error: any) {
      console.error("[api] sidebar-gpts pin failed", error);
      res.status(500).json({ error: sanitizeErrorForRoute(error?.message) });
    }
  });

  // Unpin a GPT from sidebar
  router.delete("/users/:userId/sidebar-gpts/:gptId", async (req, res) => {
    try {
      const { userId, gptId } = req.params;
      const normalizedUserId = normalizeIdentifier(userId);
      const normalizedGptId = normalizeIdentifier(gptId);
      const callerId = normalizeIdentifier(getOrCreateSecureUserId(req));
      if (!normalizedUserId || !normalizedGptId) {
        return res.status(400).json({ error: "userId and gptId are required" });
      }
      if (!callerId || callerId !== normalizedUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await storage.unpinGptFromSidebar(normalizedUserId, normalizedGptId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[api] sidebar-gpts unpin failed", error);
      res.status(500).json({ error: sanitizeErrorForRoute(error?.message) });
    }
  });

  // Check if a GPT is pinned
  router.get("/users/:userId/sidebar-gpts/:gptId", async (req, res) => {
    try {
      const { userId, gptId } = req.params;
      const normalizedUserId = normalizeIdentifier(userId);
      const normalizedGptId = normalizeIdentifier(gptId);
      const callerId = normalizeIdentifier(getOrCreateSecureUserId(req));
      if (!normalizedUserId || !normalizedGptId) {
        return res.json({ isPinned: false });
      }
      if (!callerId || callerId !== normalizedUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const isPinned = await storage.isGptPinnedToSidebar(normalizedUserId, normalizedGptId);
      res.json({ isPinned });
    } catch (error: any) {
      console.error("[api] sidebar-gpts status check failed", error);
      res.status(500).json({ error: sanitizeErrorForRoute(error?.message) });
    }
  });

  return router;
}
