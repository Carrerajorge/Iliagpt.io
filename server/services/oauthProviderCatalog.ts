import {
  ensureAuthProfileStore,
  listProfilesForProvider,
} from "./superIntelligence/agents/auth-profiles.js";
import {
  loadModelCatalog,
  type ModelCatalogEntry,
} from "./superIntelligence/agents/model-catalog.js";
import { getGoogleGeminiCliOAuthStatus } from "./googleGeminiCliOAuthService.js";
import { getOpenAICodexOAuthStatus } from "./openAICodexOAuthService.js";
import { resolveUserScopedAgentDir } from "./userScopedAgentDir.js";

export type OAuthProviderBootstrapModel = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string;
  isEnabled: "true";
  enabledAt: null;
  displayOrder: number;
  icon: null;
  modelType: "TEXT";
  contextWindow: number;
};

type ProviderSeedModel = {
  id: string;
  name: string;
  contextWindow: number;
};

const PROVIDER_DISPLAY_ORDER: Record<string, number> = {
  "openai-codex": 10,
  "google-gemini-cli": 20,
  "google-antigravity": 30,
};

const OPENAI_CODEX_SEED_MODELS: ProviderSeedModel[] = [
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", contextWindow: 272_000 },
];

const GOOGLE_GEMINI_CLI_SEED_MODELS: ProviderSeedModel[] = [
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    contextWindow: 2_000_000,
  },
];

function normalizeKey(provider: string, modelId: string): string {
  return `${provider.trim().toLowerCase()}::${modelId.trim().toLowerCase()}`;
}

function toSeedCatalogEntry(provider: string, model: ProviderSeedModel): ModelCatalogEntry {
  return {
    id: model.id,
    name: model.name,
    provider,
    contextWindow: model.contextWindow,
  };
}

function sortCatalogEntries(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  return [...entries].sort((left, right) => {
    const leftName = (left.name || left.id || "").toLowerCase();
    const rightName = (right.name || right.id || "").toLowerCase();
    return leftName.localeCompare(rightName);
  });
}

function mergeProviderEntries(params: {
  provider: string;
  catalog: ModelCatalogEntry[];
  seeds?: ProviderSeedModel[];
}): ModelCatalogEntry[] {
  const catalogEntries = params.catalog.filter((entry) => entry.provider === params.provider);
  const catalogMap = new Map(
    catalogEntries.map((entry) => [entry.id.trim().toLowerCase(), entry]),
  );
  const merged: ModelCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const seed of params.seeds ?? []) {
    const existing = catalogMap.get(seed.id.trim().toLowerCase());
    const entry = existing ?? toSeedCatalogEntry(params.provider, seed);
    const key = normalizeKey(params.provider, entry.id);
    if (seen.has(key)) {
      continue;
    }
    merged.push(entry);
    seen.add(key);
  }

  for (const entry of sortCatalogEntries(catalogEntries)) {
    const key = normalizeKey(params.provider, entry.id);
    if (seen.has(key)) {
      continue;
    }
    merged.push(entry);
    seen.add(key);
  }

  return merged;
}

function createDescription(provider: string, name: string): string {
  if (provider === "openai-codex") {
    return `${name} usando tu cuenta de ChatGPT con OAuth`;
  }
  if (provider === "google-gemini-cli") {
    return `${name} usando la cuenta de Google vinculada por OAuth`;
  }
  return `${name} disponible mediante Google Antigravity ya configurado en el gateway`;
}

function toBootstrapModels(
  provider: string,
  entries: ModelCatalogEntry[],
): OAuthProviderBootstrapModel[] {
  const providerOrder = PROVIDER_DISPLAY_ORDER[provider] ?? 99;
  return entries.map((entry, index) => ({
    id: `bootstrap-${provider}-${entry.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: entry.name || entry.id,
    provider,
    modelId: entry.id,
    description: createDescription(provider, entry.name || entry.id),
    isEnabled: "true",
    enabledAt: null,
    displayOrder: providerOrder + index,
    icon: null,
    modelType: "TEXT",
    contextWindow: entry.contextWindow ?? 128_000,
  }));
}

async function hasConfiguredGoogleAntigravityProfile(
  userId?: string | null,
): Promise<boolean> {
  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    return false;
  }
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  return listProfilesForProvider(store, "google-antigravity").length > 0;
}

export async function getOAuthProviderBootstrapModels(
  userId?: string | null,
): Promise<OAuthProviderBootstrapModel[]> {
  const agentDir = resolveUserScopedAgentDir(userId);
  const [catalogResult, openAiStatusResult, geminiStatusResult, antigravityStatusResult] =
    await Promise.allSettled([
      agentDir
        ? loadModelCatalog({ agentDir, useCache: false })
        : Promise.resolve([] as ModelCatalogEntry[]),
      getOpenAICodexOAuthStatus(userId),
      getGoogleGeminiCliOAuthStatus(userId),
      hasConfiguredGoogleAntigravityProfile(userId),
    ]);

  const catalog = catalogResult.status === "fulfilled" ? catalogResult.value : [];
  const models: OAuthProviderBootstrapModel[] = [];

  if (openAiStatusResult.status === "fulfilled" && openAiStatusResult.value.connected) {
    models.push(
      ...toBootstrapModels(
        "openai-codex",
        mergeProviderEntries({
          provider: "openai-codex",
          catalog,
          seeds: OPENAI_CODEX_SEED_MODELS,
        }),
      ),
    );
  }

  if (geminiStatusResult.status === "fulfilled" && geminiStatusResult.value.connected) {
    models.push(
      ...toBootstrapModels(
        "google-gemini-cli",
        mergeProviderEntries({
          provider: "google-gemini-cli",
          catalog,
          seeds: GOOGLE_GEMINI_CLI_SEED_MODELS,
        }),
      ),
    );
  }

  if (antigravityStatusResult.status === "fulfilled" && antigravityStatusResult.value) {
    models.push(
      ...toBootstrapModels(
        "google-antigravity",
        mergeProviderEntries({
          provider: "google-antigravity",
          catalog,
        }),
      ),
    );
  }

  const deduped = new Map<string, OAuthProviderBootstrapModel>();
  for (const model of models) {
    deduped.set(normalizeKey(model.provider, model.modelId), model);
  }

  return Array.from(deduped.values()).sort(
    (left, right) => left.displayOrder - right.displayOrder,
  );
}
