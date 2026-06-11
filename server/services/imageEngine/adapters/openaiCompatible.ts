import { extractImageFromChatMessage } from "../normalize";
import type {
  GenerateParams,
  ImageModelDescriptor,
  ImageProviderAdapter,
  RawImageOutput,
} from "../types";

/**
 * Generic adapter for ANY OpenAI-compatible images endpoint (Together,
 * Fireworks, Stability bridges, LocalAI, ComfyUI proxies, self-hosted...).
 *
 * Configure with:
 *   IMAGE_ENGINE_CUSTOM_BASE_URL=https://api.example.com/v1
 *   IMAGE_ENGINE_CUSTOM_API_KEY=sk-...
 *   IMAGE_ENGINE_CUSTOM_MODELS=model-a,model-b   (first = preferred)
 *   IMAGE_ENGINE_CUSTOM_MODE=images|chat         (default: images)
 */
function readConfig() {
  return {
    baseUrl: (process.env.IMAGE_ENGINE_CUSTOM_BASE_URL || "").replace(/\/$/, ""),
    apiKey: process.env.IMAGE_ENGINE_CUSTOM_API_KEY || "",
    models: (process.env.IMAGE_ENGINE_CUSTOM_MODELS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    mode: process.env.IMAGE_ENGINE_CUSTOM_MODE === "chat" ? "chat" : "images",
  };
}

export const openaiCompatibleAdapter: ImageProviderAdapter = {
  name: "custom",
  isConfigured: () => {
    const { baseUrl, models } = readConfig();
    return Boolean(baseUrl && models.length > 0);
  },
  listModels: (): ImageModelDescriptor[] =>
    readConfig().models.map((id, index) => ({
      id,
      provider: "custom",
      label: `${id} (custom)`,
      priority: 50 + index,
      supportsAspectRatio: false,
      supportsEdit: false,
    })),

  async generate(params: GenerateParams): Promise<RawImageOutput> {
    const { baseUrl, apiKey, mode } = readConfig();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    if (mode === "chat") {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: params.modelId,
          messages: [{ role: "user", content: `Generate an image: ${params.prompt}` }],
          modalities: ["image", "text"],
          max_tokens: 4096,
        }),
        signal: params.signal ?? AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`Custom endpoint HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const image = await extractImageFromChatMessage(data.choices?.[0]?.message);
      if (!image) throw new Error("Custom chat endpoint returned no image payload");
      return image;
    }

    const res = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: params.modelId,
        prompt: params.prompt,
        n: 1,
        response_format: "b64_json",
      }),
      signal: params.signal ?? AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Custom endpoint HTTP ${res.status}`);
    const data = (await res.json()) as any;
    const entry = data.data?.[0];
    if (entry?.b64_json) return { imageBase64: entry.b64_json, mimeType: "image/png" };
    if (entry?.url) {
      const { fetchImageAsBase64 } = await import("../normalize");
      const fetched = await fetchImageAsBase64(entry.url);
      if (fetched) return fetched;
    }
    throw new Error("Custom images endpoint returned no image data");
  },
};
