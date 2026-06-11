import OpenAI, { toFile } from "openai";
import type {
  GenerateParams,
  ImageAspectRatio,
  ImageModelDescriptor,
  ImageProviderAdapter,
  RawImageOutput,
} from "../types";

// Guard against a common misconfiguration: an OpenRouter key (sk-or-...)
// stored in OPENAI_API_KEY would 401 on every call to api.openai.com.
const rawKey = process.env.OPENAI_API_KEY || "";
const apiKey = rawKey.startsWith("sk-or-") ? "" : rawKey;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey });
  return client;
}

const MODELS: ImageModelDescriptor[] = [
  {
    id: "gpt-image-1",
    provider: "openai",
    label: "GPT Image 1",
    priority: 20,
    supportsAspectRatio: true,
    supportsEdit: true,
  },
  {
    id: "dall-e-3",
    provider: "openai",
    label: "DALL·E 3",
    priority: 21,
    supportsAspectRatio: true,
    supportsEdit: false,
  },
  {
    id: "dall-e-2",
    provider: "openai",
    label: "DALL·E 2",
    priority: 22,
    supportsAspectRatio: false,
    supportsEdit: true,
  },
];

function sizeFor(modelId: string, aspectRatio?: ImageAspectRatio): string {
  const landscape = aspectRatio === "16:9" || aspectRatio === "4:3" || aspectRatio === "3:2";
  const portrait = aspectRatio === "9:16" || aspectRatio === "3:4" || aspectRatio === "2:3";
  if (modelId === "gpt-image-1") {
    if (landscape) return "1536x1024";
    if (portrait) return "1024x1536";
    return "1024x1024";
  }
  if (modelId === "dall-e-3") {
    if (landscape) return "1792x1024";
    if (portrait) return "1024x1792";
    return "1024x1024";
  }
  return "1024x1024";
}

export const openaiImagesAdapter: ImageProviderAdapter = {
  name: "openai",
  isConfigured: () => Boolean(apiKey),
  listModels: () => MODELS,

  async generate(params: GenerateParams): Promise<RawImageOutput> {
    const openai = getClient();
    const isGptImage = params.modelId.startsWith("gpt-image");
    const prompt = params.negativePrompt
      ? `${params.prompt}\nDo not include: ${params.negativePrompt}`
      : params.prompt;

    const response = await openai.images.generate(
      {
        model: params.modelId,
        prompt,
        n: 1,
        size: sizeFor(params.modelId, params.aspectRatio) as any,
        // gpt-image-1 always returns b64_json and rejects response_format.
        ...(isGptImage
          ? { quality: params.quality === "hd" ? "high" : "medium" }
          : {
              response_format: "b64_json" as const,
              ...(params.modelId === "dall-e-3" && params.quality === "hd"
                ? { quality: "hd" as const }
                : {}),
            }),
      },
      { signal: params.signal },
    );

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI Images returned no b64_json data");
    return { imageBase64: b64, mimeType: "image/png" };
  },

  async edit(baseImageBase64, baseMimeType, params): Promise<RawImageOutput> {
    const openai = getClient();
    const ext = baseMimeType.includes("jpeg") || baseMimeType.includes("jpg") ? "jpg" : "png";
    const file = await toFile(Buffer.from(baseImageBase64, "base64"), `image.${ext}`, {
      type: baseMimeType,
    });
    const response = await openai.images.edit(
      { model: params.modelId, image: file, prompt: params.prompt, n: 1 },
      { signal: params.signal },
    );
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI Images edit returned no b64_json data");
    return { imageBase64: b64, mimeType: "image/png" };
  },
};
