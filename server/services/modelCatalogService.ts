import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { dbRead } from "../db";
import {
  FREE_MODEL_ID,
  GEMINI_MODELS_REGISTRY,
  OPENROUTER_MODELS,
  XAI_MODELS,
  isModelFreeForAll,
} from "../lib/modelRegistry";
import { storage } from "../storage";
import {
  isModelEligibleForPublic,
  normalizeModelProviderToRuntime,
} from "./modelIntegration";
import { getSettingValue } from "./settingsConfigService";

type ModelTier = "free" | "paid";
type AccessState = "available" | "upgrade_required";

type BrandingPreset = {
  matchIds: readonly string[];
  canonicalModelId: string;
  provider: string;
  displayName: string;
  providerDisplayName?: string;
  icon?: string;
  displayOrder: number;
  tier?: ModelTier;
  description?: string;
  contextWindow?: number;
  modelType?: string;
};

export type UnifiedModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  providerDisplayName: string;
  gatewayProvider: string;
  modelId: string;
  description: string | null;
  isEnabled: string;
  enabledAt: Date | string | null;
  enabledByAdminId: string | null;
  displayOrder: number;
  icon: string | null;
  logoUrl: string | null;
  modelType: string;
  contextWindow: number | null;
  tier: ModelTier;
  availableToUser: boolean;
  accessState: AccessState;
  requiresUpgrade: boolean;
  status: "active";
};

type BaseCatalogState = {
  models: UnifiedModelCatalogEntry[];
  defaultModelId: string;
  refreshedAt: string;
};

type UserAccessProfile = {
  plan: string;
  isAdmin: boolean;
  isPaid: boolean;
};

const BASE_CATALOG_TTL_MS = 15_000;

const PROVIDER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  google: "Google",
  gemini: "Google",
  xai: "xAI",
  grok: "xAI",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  openrouter: "OpenRouter",
  local: "Local",
});

const BRANDING_PRESETS: readonly BrandingPreset[] = Object.freeze([
  {
    matchIds: [OPENROUTER_MODELS.GEMMA_4_31B_IT, `${OPENROUTER_MODELS.GEMMA_4_31B_IT}:free`],
    canonicalModelId: OPENROUTER_MODELS.GEMMA_4_31B_IT,
    provider: "openrouter",
    displayName: "Gemma 4 31B",
    providerDisplayName: "OpenRouter",
    icon: "/logos/gemma.png",
    displayOrder: 10,
    tier: "free",
    description: "Gemma 4 31B Instruct via OpenRouter",
    contextWindow: 262144,
    modelType: "TEXT",
  },
  {
    matchIds: [XAI_MODELS.GROK_4_1_FAST, "x-ai/grok-4.1-fast"],
    canonicalModelId: XAI_MODELS.GROK_4_1_FAST,
    provider: "xai",
    displayName: "Grok 4.1 Rápido",
    providerDisplayName: "xAI",
    icon: "/logos/grok.png",
    displayOrder: 20,
    tier: "free",
    description: "Grok 4.1 Fast via xAI",
    contextWindow: 2000000,
    modelType: "TEXT",
  },
  {
    matchIds: ["openai/gpt-5.4", "gpt-5.4", "openai/chatgpt-5.4", "openai/gpt-4.1", "gpt-4.1"],
    canonicalModelId: "gpt-5.4",
    provider: "openai",
    displayName: "GPT-5.4",
    providerDisplayName: "OpenAI",
    icon: "/logos/openai.png",
    displayOrder: 30,
    description: "GPT-5.4 vía OpenAI",
    contextWindow: 400000,
    modelType: "TEXT",
  },
  {
    matchIds: ["claude-opus-4-6", "anthropic/claude-opus-4", "anthropic/claude-opus-4-6", "claude-opus-4-5"],
    canonicalModelId: "claude-opus-4-6",
    provider: "anthropic",
    displayName: "Claude Opus",
    providerDisplayName: "Anthropic",
    icon: "/logos/claude.svg",
    displayOrder: 40,
    description: "Claude Opus vía Anthropic",
    contextWindow: 200000,
    modelType: "TEXT",
  },
  {
    matchIds: [GEMINI_MODELS_REGISTRY.PRO_31, `google/${GEMINI_MODELS_REGISTRY.PRO_31}`, GEMINI_MODELS_REGISTRY.PRO_PREVIEW, `google/${GEMINI_MODELS_REGISTRY.PRO_PREVIEW}`],
    canonicalModelId: GEMINI_MODELS_REGISTRY.PRO_31,
    provider: "google",
    displayName: "Gemini 3.1 Pro",
    providerDisplayName: "Google",
    icon: "/logos/gemini.svg",
    displayOrder: 50,
    description: "Gemini 3.1 Pro",
    contextWindow: 2000000,
    modelType: "MULTIMODAL",
  },
  {
    matchIds: [OPENROUTER_MODELS.GROK_4_2, "grok-4.2"],
    canonicalModelId: OPENROUTER_MODELS.GROK_4_2,
    provider: "openrouter",
    displayName: "Grok 4.2",
    providerDisplayName: "xAI",
    icon: "/logos/grok.png",
    displayOrder: 60,
    description: "Grok 4.2 vía OpenRouter",
    contextWindow: 256000,
    modelType: "TEXT",
  },
  {
    matchIds: [OPENROUTER_MODELS.GLM_5_1, "glm-5.1", OPENROUTER_MODELS.GLM_5],
    canonicalModelId: OPENROUTER_MODELS.GLM_5,
    provider: "openrouter",
    displayName: "GLM 5.1",
    providerDisplayName: "Z.ai",
    icon: "/logos/glm.png",
    displayOrder: 70,
    description: "GLM 5.1 vía OpenRouter",
    contextWindow: 80000,
    modelType: "MULTIMODAL",
  },
  {
    matchIds: [OPENROUTER_MODELS.KIMI_K2_5],
    canonicalModelId: OPENROUTER_MODELS.KIMI_K2_5,
    provider: "openrouter",
    displayName: "Kimi K2.5",
    providerDisplayName: "Moonshot AI",
    icon: "/logos/kimi.png",
    displayOrder: 80,
    description: "Kimi K2.5 vía OpenRouter",
    contextWindow: 262144,
    modelType: "TEXT",
  },
]);

let baseCatalogCache: BaseCatalogState | null = null;
let baseCatalogCacheExpiresAt = 0;

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function isTruthyText(value: unknown): boolean {
  return normalizeLower(value) === "true";
}

function isTrackedUserId(userId?: string | null): boolean {
  const normalized = normalizeText(userId);
  if (!normalized) return false;
  if (normalized === "anonymous" || normalized === "openclaw-user") return false;
  if (normalized.startsWith("token:") || normalized.startsWith("anon_")) return false;
  return true;
}

function resolveBrandingPreset(modelId: string): BrandingPreset | null {
  const normalizedModelId = normalizeLower(modelId);
  if (!normalizedModelId) return null;

  for (const preset of BRANDING_PRESETS) {
    if (preset.matchIds.some((candidate) => candidate.toLowerCase() === normalizedModelId)) {
      return preset;
    }
  }

  return null;
}

function humanizeProvider(provider: string): string {
  return PROVIDER_LABELS[normalizeLower(provider)] || normalizeText(provider) || "Provider";
}

function resolveGatewayProvider(provider: string): string {
  const normalized = normalizeLower(provider);
  if (!normalized) return "openrouter";
  if (normalized === "google") return "gemini";
  if (normalized === "grok") return "xai";
  if (normalized === "local") return "local";
  return normalizedModelProviderForGateway(normalized);
}

function normalizedModelProviderForGateway(provider: string): string {
  if (provider === "openrouter") return "openrouter";
  return normalizeModelProviderToRuntime(provider) || provider;
}

function fallbackDisplayName(name: string, modelId: string): string {
  const normalizedName = normalizeText(name);
  if (normalizedName) return normalizedName;
  return normalizeText(modelId) || "Modelo";
}

function buildSyntheticPresetEntry(preset: BrandingPreset): UnifiedModelCatalogEntry {
  const provider = normalizeLower(preset.provider);
  const icon = normalizeText(preset.icon) || null;

  return {
    id: preset.canonicalModelId,
    name: preset.displayName,
    provider,
    providerDisplayName: preset.providerDisplayName || humanizeProvider(provider),
    gatewayProvider: resolveGatewayProvider(provider),
    modelId: preset.canonicalModelId,
    description: preset.description || null,
    isEnabled: "true",
    enabledAt: null,
    enabledByAdminId: null,
    displayOrder: preset.displayOrder,
    icon,
    logoUrl: icon,
    modelType: normalizeText(preset.modelType) || "TEXT",
    contextWindow: typeof preset.contextWindow === "number" ? preset.contextWindow : null,
    tier: preset.tier || (isModelFreeForAll(preset.canonicalModelId) ? "free" : "paid"),
    availableToUser: true,
    accessState: "available",
    requiresUpgrade: false,
    status: "active",
  };
}

function mergeCuratedPresetEntries(models: UnifiedModelCatalogEntry[]): UnifiedModelCatalogEntry[] {
  const knownIds = new Set(
    models.flatMap((model) => [normalizeLower(model.id), normalizeLower(model.modelId)]).filter(Boolean),
  );

  const syntheticEntries = BRANDING_PRESETS
    .filter((preset) => !preset.matchIds.some((candidate) => knownIds.has(normalizeLower(candidate))))
    .map((preset) => buildSyntheticPresetEntry(preset));

  return [...models, ...syntheticEntries];
}

function buildBaseEntry(model: any): UnifiedModelCatalogEntry {
  const preset = resolveBrandingPreset(model.modelId);
  const provider = normalizeLower(preset?.provider || model.provider);
  const displayOrder =
    preset?.displayOrder ||
    (typeof model.displayOrder === "number" && Number.isFinite(model.displayOrder) && model.displayOrder > 0
      ? model.displayOrder
      : 999);
  const tier: ModelTier = preset?.tier || (isModelFreeForAll(model.modelId) ? "free" : "paid");
  const icon = preset?.icon || normalizeText(model.icon) || null;

  return {
    id: String(model.id),
    name: preset?.displayName || fallbackDisplayName(model.name, model.modelId),
    provider,
    providerDisplayName: preset?.providerDisplayName || humanizeProvider(provider),
    gatewayProvider: resolveGatewayProvider(provider),
    modelId: normalizeText(model.modelId),
    description: preset?.description || (typeof model.description === "string" ? model.description : null),
    isEnabled: isTruthyText(model.isEnabled) ? "true" : "false",
    enabledAt: model.enabledAt ?? null,
    enabledByAdminId: typeof model.enabledByAdminId === "string" ? model.enabledByAdminId : null,
    displayOrder,
    icon,
    logoUrl: icon,
    modelType: normalizeText(preset?.modelType) || normalizeText(model.modelType) || "TEXT",
    contextWindow:
      typeof preset?.contextWindow === "number"
        ? preset.contextWindow
        : typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow)
        ? model.contextWindow
        : null,
    tier,
    availableToUser: true,
    accessState: "available",
    requiresUpgrade: false,
    status: "active",
  };
}

async function resolveUserAccessProfile(userId?: string | null): Promise<UserAccessProfile> {
  if (!isTrackedUserId(userId)) {
    return { plan: "free", isAdmin: false, isPaid: false };
  }

  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

  const [user] = await dbRead
    .select({
      role: users.role,
      plan: users.plan,
      email: users.email,
      subscriptionPlan: users.subscriptionPlan,
      subscriptionStatus: users.subscriptionStatus,
    })
    .from(users)
    .where(eq(users.id, String(userId)))
    .limit(1);

  if (!user) {
    return { plan: "free", isAdmin: false, isPaid: false };
  }

  const role = normalizeLower(user.role);
  const email = normalizeLower(user.email);
  const isAdmin = role === "admin" || role === "superadmin" || (ADMIN_EMAIL !== "" && email === ADMIN_EMAIL);
  const subscriptionStatus = normalizeLower(user.subscriptionStatus);
  const subscriptionPlan = normalizeLower(user.subscriptionPlan);
  const plan = normalizeLower(user.plan) || "free";
  const effectivePlan = subscriptionStatus === "active" && subscriptionPlan ? subscriptionPlan : plan;
  const isPaid = isAdmin || !["", "free"].includes(effectivePlan);

  return {
    plan: isAdmin ? "admin" : effectivePlan || "free",
    isAdmin,
    isPaid,
  };
}

function isPresetModel(modelId: string): boolean {
  const lower = normalizeLower(modelId);
  return BRANDING_PRESETS.some((preset) =>
    preset.matchIds.some((candidate) => candidate.toLowerCase() === lower) ||
    preset.canonicalModelId.toLowerCase() === lower,
  );
}

async function loadBaseCatalog(): Promise<BaseCatalogState> {
  const now = Date.now();
  if (baseCatalogCache && baseCatalogCacheExpiresAt > now) {
    return baseCatalogCache;
  }

  const allModels = await storage.getAiModels();
  const models = mergeCuratedPresetEntries(
    allModels
    .filter((model: any) => isModelEligibleForPublic(model) && isPresetModel(model.modelId))
    .map((model: any) => buildBaseEntry(model))
  )
    .filter((model) => isPresetModel(model.modelId))
    .sort((left, right) => {
      const orderDelta = (left.displayOrder || 0) - (right.displayOrder || 0);
      if (orderDelta !== 0) return orderDelta;
      return left.name.localeCompare(right.name, "es", { sensitivity: "base" });
    });

  const configuredDefaultModel = await getSettingValue<string>("default_model", FREE_MODEL_ID);
  const defaultModel =
    models.find((model) => model.modelId === configuredDefaultModel || model.id === configuredDefaultModel) ||
    models.find((model) => model.modelId === FREE_MODEL_ID || model.id === FREE_MODEL_ID) ||
    models[0] ||
    null;

  const state: BaseCatalogState = {
    models,
    defaultModelId: defaultModel?.modelId || configuredDefaultModel || FREE_MODEL_ID,
    refreshedAt: new Date().toISOString(),
  };

  baseCatalogCache = state;
  baseCatalogCacheExpiresAt = now + BASE_CATALOG_TTL_MS;
  return state;
}

export function invalidateModelCatalogCache(): void {
  baseCatalogCache = null;
  baseCatalogCacheExpiresAt = 0;
}

export async function getUnifiedModelCatalog(options?: {
  userId?: string | null;
}): Promise<{
  models: UnifiedModelCatalogEntry[];
  defaultModel: UnifiedModelCatalogEntry | null;
  defaultModelId: string;
  userAccess: UserAccessProfile;
  refreshedAt: string;
}> {
  const [baseCatalog, userAccess] = await Promise.all([
    loadBaseCatalog(),
    resolveUserAccessProfile(options?.userId),
  ]);

  const models = baseCatalog.models.map((model) => {
    const availableToUser = userAccess.isAdmin || userAccess.isPaid || model.tier === "free";

    return {
      ...model,
      availableToUser,
      accessState: availableToUser ? "available" : "upgrade_required",
      requiresUpgrade: !availableToUser,
    };
  });

  const defaultModel =
    models.find(
      (model) =>
        (model.modelId === baseCatalog.defaultModelId || model.id === baseCatalog.defaultModelId) &&
        model.availableToUser,
    ) ||
    models.find((model) => model.availableToUser) ||
    models.find((model) => model.modelId === baseCatalog.defaultModelId || model.id === baseCatalog.defaultModelId) ||
    models[0] ||
    null;

  return {
    models,
    defaultModel,
    defaultModelId: defaultModel?.modelId || baseCatalog.defaultModelId,
    userAccess,
    refreshedAt: baseCatalog.refreshedAt,
  };
}

export async function getCatalogModelBySelection(
  selection?: string | null,
  options?: { userId?: string | null },
): Promise<UnifiedModelCatalogEntry | null> {
  const normalizedSelection = normalizeText(selection);
  const { models, defaultModel } = await getUnifiedModelCatalog(options);

  if (!normalizedSelection) {
    return defaultModel;
  }

  const normalizedSelectionLower = normalizeLower(normalizedSelection);

  return (
    models.find((model) => {
      const candidates = [
        normalizeLower(model.id),
        normalizeLower(model.modelId),
        normalizeLower(`${model.provider}/${model.id}`),
        normalizeLower(`${model.provider}/${model.modelId}`),
        normalizeLower(`${model.gatewayProvider}/${model.id}`),
        normalizeLower(`${model.gatewayProvider}/${model.modelId}`),
      ].filter(Boolean);

      return candidates.includes(normalizedSelectionLower);
    }) ||
    defaultModel
  );
}

export async function getOpenClawGatewayModelCatalog(options?: {
  userId?: string | null;
}): Promise<{
  models: Array<{
    id: string;
    provider: string;
    name: string;
    available: boolean;
    providerDisplayName: string;
    logoUrl: string | null;
    description: string | null;
    contextWindow: number | null;
    tier: ModelTier;
    requiresUpgrade: boolean;
    accessState: AccessState;
    status: "active";
    permissions: {
      chat: boolean;
      tools: boolean;
      streaming: boolean;
    };
    order: number;
  }>;
  default: { provider: string; model: string };
  meta: {
    unified: true;
    refreshedAt: string;
    plan: string;
    isAdmin: boolean;
    isPaid: boolean;
  };
}> {
  const { models, defaultModel, userAccess, refreshedAt } = await getUnifiedModelCatalog(options);

  return {
    models: models.map((model) => ({
      id: model.modelId,
      provider: model.gatewayProvider,
      name: model.name,
      available: model.availableToUser,
      providerDisplayName: model.providerDisplayName,
      logoUrl: model.logoUrl,
      description: model.description,
      contextWindow: model.contextWindow,
      tier: model.tier,
      requiresUpgrade: model.requiresUpgrade,
      accessState: model.accessState,
      status: model.status,
      permissions: {
        chat: model.availableToUser,
        tools: model.availableToUser,
        streaming: model.availableToUser,
      },
      order: model.displayOrder,
    })),
    default: {
      provider: defaultModel?.gatewayProvider || "openrouter",
      model: defaultModel?.modelId || FREE_MODEL_ID,
    },
    meta: {
      unified: true,
      refreshedAt,
      plan: userAccess.plan,
      isAdmin: userAccess.isAdmin,
      isPaid: userAccess.isPaid,
    },
  };
}
