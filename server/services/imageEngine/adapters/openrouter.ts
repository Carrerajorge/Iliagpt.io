import { extractImageFromChatMessage } from "../normalize";
import type {
  GenerateParams,
  ImageModelDescriptor,
  ImageProviderAdapter,
  RawImageOutput,
} from "../types";

// Accept an OpenRouter key that was misplaced in OPENAI_API_KEY (sk-or-...).
const misplacedKey = (process.env.OPENAI_API_KEY || "").startsWith("sk-or-")
  ? process.env.OPENAI_API_KEY!
  : "";
const apiKey = process.env.OPENROUTER_API_KEY || misplacedKey;

/**
 * OpenRouter routes to ANY image-output model by id — this adapter is what
 * makes the engine model-agnostic: an unknown "vendor/model" id is sent
 * here verbatim, so new models work without code changes.
 */
const DEFAULT_MODELS: ImageModelDescriptor[] = [
  {
    id: "google/gemini-2.5-flash-image",
    provider: "openrouter",
    label: "Gemini 2.5 Flash Image (OpenRouter)",
    priority: 40,
    supportsAspectRatio: false,
    supportsEdit: true,
  },
  {
    id: "google/gemini-3.1-flash-image-preview",
    provider: "openrouter",
    label: "Gemini 3.1 Flash Image (OpenRouter)",
    priority: 41,
    supportsAspectRatio: false,
    supportsEdit: true,
  },
  {
    id: "openai/gpt-5-image-mini",
    provider: "openrouter",
    label: "GPT-5 Image Mini (OpenRouter)",
    priority: 42,
    supportsAspectRatio: false,
    supportsEdit: false,
  },
  {
    id: "openai/gpt-5-image",
    provider: "openrouter",
    label: "GPT-5 Image (OpenRouter)",
    priority: 43,
    supportsAspectRatio: false,
    supportsEdit: false,
  },
];

function extraModelsFromEnv(): ImageModelDescriptor[] {
  const raw = process.env.IMAGE_ENGINE_OPENROUTER_MODELS || "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .filter((id) => !DEFAULT_MODELS.some((m) => m.id === id))
    .map((id, index) => ({
      id,
      provider: "openrouter",
      label: `${id} (OpenRouter)`,
      priority: 39 - index, // env-pinned models go before the defaults
      supportsAspectRatio: false,
      supportsEdit: false,
    }));
}

async function callChatCompletions(
  modelId: string,
  content: unknown,
  signal?: AbortSignal,
): Promise<RawImageOutput> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : "https://iliagpt.com",
      "X-Title": "IliaGPT",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      max_tokens: 4096,
    }),
    signal: signal ?? AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const image = await extractImageFromChatMessage(data.choices?.[0]?.message);
  if (!image) throw new Error("OpenRouter response contained no image payload");
  return image;
}

export const openrouterAdapter: ImageProviderAdapter = {
  name: "openrouter",
  isConfigured: () => Boolean(apiKey),
  listModels: () => [...extraModelsFromEnv(), ...DEFAULT_MODELS],

  async generate(params: GenerateParams): Promise<RawImageOutput> {
    const prompt = params.negativePrompt
      ? `Generate an image: ${params.prompt}\nDo not include: ${params.negativePrompt}`
      : `Generate an image: ${params.prompt}`;
    const withRatio = params.aspectRatio
      ? `${prompt}\nAspect ratio: ${params.aspectRatio}`
      : prompt;
    return callChatCompletions(params.modelId, withRatio, params.signal);
  },

  async edit(baseImageBase64, baseMimeType, params): Promise<RawImageOutput> {
    return callChatCompletions(
      params.modelId,
      [
        {
          type: "image_url",
          image_url: { url: `data:${baseMimeType};base64,${baseImageBase64}` },
        },
        {
          type: "text",
          text: `Edit this image according to these instructions: ${params.prompt}. Return only the edited image.`,
        },
      ],
      params.signal,
    );
  },
};
