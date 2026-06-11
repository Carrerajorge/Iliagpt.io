import { trackMediaCost } from "../mediaGenerationCostTracker";
import {
  isModelCoolingDown,
  reportModelFailure,
  reportModelSuccess,
  resolveAttempts,
} from "./registry";
import type {
  ImageEngineAttempt,
  ImageEngineOptions,
  ImageEngineResult,
  ImageProgressListener,
} from "./types";

export { getModelCatalog, resolveAttempts, resetModelHealth } from "./registry";
export * from "./types";

const MAX_ATTEMPTS = 8;

// Auth failures (expired/wrong key) affect every model of a provider —
// skip the rest of that provider's chain instead of burning attempts.
const AUTH_ERROR_RE = /api[\s_-]?key|401|403|unauthorized|invalid_api_key|API_KEY_INVALID|expired/i;

/**
 * Generate an image with whichever provider/model is available.
 * Walks the resolved fallback chain, skipping models in cooldown,
 * emitting progress events suited for streaming to the client.
 */
export async function generateImageUniversal(
  prompt: string,
  options: ImageEngineOptions = {},
  onProgress?: ImageProgressListener,
): Promise<ImageEngineResult> {
  const startTime = Date.now();
  const attempts: ImageEngineAttempt[] = [];

  onProgress?.({ stage: "selecting", message: "Seleccionando el mejor modelo disponible" });

  const chain = resolveAttempts(options.model);
  if (chain.length === 0) {
    throw new Error(
      "Image generation failed: no image provider is configured (set GEMINI_API_KEY, OPENAI_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY or IMAGE_ENGINE_CUSTOM_*)",
    );
  }

  let attemptNumber = 0;
  const authFailedProviders = new Set<string>();
  for (const { adapter, model } of chain) {
    if (options.signal?.aborted) throw new Error("Image generation aborted");
    if (authFailedProviders.has(adapter.name)) continue;
    if (isModelCoolingDown(model.id)) continue;
    if (attemptNumber >= MAX_ATTEMPTS) break;
    attemptNumber += 1;

    onProgress?.({
      stage: attemptNumber === 1 ? "generating" : "fallback",
      provider: adapter.name,
      model: model.id,
      modelLabel: model.label,
      attempt: attemptNumber,
    });

    const attemptStart = Date.now();
    try {
      const raw = await adapter.generate({
        prompt,
        modelId: model.id,
        aspectRatio: options.aspectRatio,
        quality: options.quality,
        negativePrompt: options.negativePrompt,
        signal: options.signal,
      });

      const latencyMs = Date.now() - attemptStart;
      attempts.push({ provider: adapter.name, model: model.id, ok: true, latencyMs });
      reportModelSuccess(model.id);
      trackMediaCost("image", `${adapter.name}/${model.id}`, prompt.length);

      onProgress?.({
        stage: "processing",
        provider: adapter.name,
        model: model.id,
        modelLabel: model.label,
      });

      console.log(
        `[ImageEngine] Success with ${adapter.name}/${model.id} in ${latencyMs}ms (attempt ${attemptNumber})`,
      );

      return {
        imageBase64: raw.imageBase64,
        mimeType: raw.mimeType,
        prompt,
        model: model.id,
        provider: adapter.name,
        latencyMs: Date.now() - startTime,
        attempts,
      };
    } catch (error: any) {
      if (options.signal?.aborted) throw new Error("Image generation aborted");
      const latencyMs = Date.now() - attemptStart;
      const message = error?.message || String(error);
      attempts.push({ provider: adapter.name, model: model.id, ok: false, latencyMs, error: message });
      reportModelFailure(model.id);
      if (AUTH_ERROR_RE.test(message)) {
        authFailedProviders.add(adapter.name);
        console.error(`[ImageEngine] ${adapter.name} auth failure — skipping remaining ${adapter.name} models this run`);
      }
      console.error(`[ImageEngine] ${adapter.name}/${model.id} failed: ${message}`);
    }
  }

  const summary = attempts
    .map((attempt) => `${attempt.provider}/${attempt.model}: ${attempt.error || "skipped"}`)
    .join(" | ");
  throw new Error(`Image generation failed after ${attempts.length} attempts. ${summary}`);
}

/**
 * Edit an image with the first available edit-capable model.
 */
export async function editImageUniversal(
  baseImageBase64: string,
  editPrompt: string,
  baseMimeType = "image/png",
  options: ImageEngineOptions = {},
  onProgress?: ImageProgressListener,
): Promise<ImageEngineResult> {
  const startTime = Date.now();
  const attempts: ImageEngineAttempt[] = [];

  const chain = resolveAttempts(options.model).filter(
    ({ adapter, model }) => typeof adapter.edit === "function" && model.supportsEdit,
  );
  if (chain.length === 0) {
    throw new Error("Image editing failed: no edit-capable image provider is configured");
  }

  let attemptNumber = 0;
  for (const { adapter, model } of chain) {
    if (options.signal?.aborted) throw new Error("Image editing aborted");
    if (isModelCoolingDown(model.id)) continue;
    if (attemptNumber >= MAX_ATTEMPTS) break;
    attemptNumber += 1;

    onProgress?.({
      stage: attemptNumber === 1 ? "generating" : "fallback",
      provider: adapter.name,
      model: model.id,
      modelLabel: model.label,
      attempt: attemptNumber,
    });

    const attemptStart = Date.now();
    try {
      const raw = await adapter.edit!(baseImageBase64, baseMimeType, {
        prompt: editPrompt,
        modelId: model.id,
        signal: options.signal,
      });
      const latencyMs = Date.now() - attemptStart;
      attempts.push({ provider: adapter.name, model: model.id, ok: true, latencyMs });
      reportModelSuccess(model.id);
      trackMediaCost("image", `${adapter.name}/${model.id}`, editPrompt.length);

      return {
        imageBase64: raw.imageBase64,
        mimeType: raw.mimeType,
        prompt: editPrompt,
        model: model.id,
        provider: adapter.name,
        latencyMs: Date.now() - startTime,
        attempts,
      };
    } catch (error: any) {
      if (options.signal?.aborted) throw new Error("Image editing aborted");
      const latencyMs = Date.now() - attemptStart;
      const message = error?.message || String(error);
      attempts.push({ provider: adapter.name, model: model.id, ok: false, latencyMs, error: message });
      reportModelFailure(model.id);
      console.error(`[ImageEngine] edit ${adapter.name}/${model.id} failed: ${message}`);
    }
  }

  throw new Error(`Image editing failed after ${attempts.length} attempts`);
}
