import { geminiAdapter } from "./adapters/gemini";
import { openaiCompatibleAdapter } from "./adapters/openaiCompatible";
import { openaiImagesAdapter } from "./adapters/openaiImages";
import { openrouterAdapter } from "./adapters/openrouter";
import { xaiAdapter } from "./adapters/xai";
import type { ImageModelDescriptor, ImageProviderAdapter } from "./types";

const ALL_ADAPTERS: ImageProviderAdapter[] = [
  geminiAdapter,
  openaiImagesAdapter,
  xaiAdapter,
  openrouterAdapter,
  openaiCompatibleAdapter,
];

const DEFAULT_PROVIDER_ORDER = ["gemini", "openai", "xai", "openrouter", "custom"];

function providerOrder(): string[] {
  const raw = process.env.IMAGE_ENGINE_PRIORITY || "";
  const fromEnv = raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length === 0) return DEFAULT_PROVIDER_ORDER;
  return [...fromEnv, ...DEFAULT_PROVIDER_ORDER.filter((name) => !fromEnv.includes(name))];
}

// ── Circuit breaker (per model id) ────────────────────────────────────────────
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

interface ModelHealth {
  consecutiveFailures: number;
  openedAt: number | null;
}

const health = new Map<string, ModelHealth>();

function getHealth(modelId: string): ModelHealth {
  let entry = health.get(modelId);
  if (!entry) {
    entry = { consecutiveFailures: 0, openedAt: null };
    health.set(modelId, entry);
  }
  return entry;
}

export function isModelCoolingDown(modelId: string): boolean {
  const entry = health.get(modelId);
  if (!entry?.openedAt) return false;
  if (Date.now() - entry.openedAt >= COOLDOWN_MS) {
    // Half-open: allow one probe.
    entry.openedAt = null;
    entry.consecutiveFailures = FAILURE_THRESHOLD - 1;
    return false;
  }
  return true;
}

export function reportModelSuccess(modelId: string): void {
  const entry = getHealth(modelId);
  entry.consecutiveFailures = 0;
  entry.openedAt = null;
}

export function reportModelFailure(modelId: string): void {
  const entry = getHealth(modelId);
  entry.consecutiveFailures += 1;
  if (entry.consecutiveFailures >= FAILURE_THRESHOLD) {
    entry.openedAt = Date.now();
  }
}

/** Test-only hook. */
export function resetModelHealth(): void {
  health.clear();
}

// ── Catalog & resolution ──────────────────────────────────────────────────────

export function getConfiguredAdapters(): ImageProviderAdapter[] {
  const order = providerOrder();
  return ALL_ADAPTERS.filter((adapter) => adapter.isConfigured()).sort(
    (a, b) => order.indexOf(a.name) - order.indexOf(b.name),
  );
}

export function getAdapter(providerName: string): ImageProviderAdapter | undefined {
  return ALL_ADAPTERS.find((adapter) => adapter.name === providerName);
}

export interface CatalogEntry extends ImageModelDescriptor {
  available: boolean;
}

/** Full catalog: every known model, flagged by provider availability. */
export function getModelCatalog(): CatalogEntry[] {
  const order = providerOrder();
  return ALL_ADAPTERS.flatMap((adapter) =>
    adapter.listModels().map((model) => ({ ...model, available: adapter.isConfigured() })),
  ).sort((a, b) => {
    const byProvider = order.indexOf(a.provider) - order.indexOf(b.provider);
    return byProvider !== 0 ? byProvider : a.priority - b.priority;
  });
}

export interface ResolvedAttempt {
  adapter: ImageProviderAdapter;
  model: ImageModelDescriptor;
}

/**
 * Build the ordered attempt chain for a request.
 *
 * - No model / "auto": every available model, provider-priority order.
 * - Known model id: that model first, then the auto chain as fallback.
 * - Unknown "vendor/model" id: routed verbatim through OpenRouter (any
 *   image model works without code changes), then the auto chain.
 */
export function resolveAttempts(requestedModel?: string): ResolvedAttempt[] {
  const adapters = getConfiguredAdapters();
  const autoChain: ResolvedAttempt[] = adapters.flatMap((adapter) =>
    adapter
      .listModels()
      .sort((a, b) => a.priority - b.priority)
      .map((model) => ({ adapter, model })),
  );

  const wanted = requestedModel?.trim();
  if (!wanted || wanted === "auto") return autoChain;

  const exact = autoChain.find((attempt) => attempt.model.id === wanted);
  if (exact) {
    return [exact, ...autoChain.filter((attempt) => attempt.model.id !== wanted)];
  }

  const openrouter = adapters.find((adapter) => adapter.name === "openrouter");
  if (openrouter && wanted.includes("/")) {
    const passthrough: ResolvedAttempt = {
      adapter: openrouter,
      model: {
        id: wanted,
        provider: "openrouter",
        label: `${wanted} (OpenRouter)`,
        priority: 0,
        supportsAspectRatio: false,
        supportsEdit: false,
      },
    };
    return [passthrough, ...autoChain];
  }

  return autoChain;
}
