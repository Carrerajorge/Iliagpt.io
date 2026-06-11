import OpenAI from "openai";
import type {
  GenerateParams,
  ImageModelDescriptor,
  ImageProviderAdapter,
  RawImageOutput,
} from "../types";

const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY || "";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ baseURL: "https://api.x.ai/v1", apiKey });
  return client;
}

const MODELS: ImageModelDescriptor[] = [
  {
    id: "grok-imagine-image",
    provider: "xai",
    label: "Grok Imagine",
    priority: 30,
    supportsAspectRatio: false,
    supportsEdit: false,
  },
  {
    id: "grok-imagine-image-quality",
    provider: "xai",
    label: "Grok Imagine HQ",
    priority: 31,
    supportsAspectRatio: false,
    supportsEdit: false,
  },
];

export const xaiAdapter: ImageProviderAdapter = {
  name: "xai",
  isConfigured: () => Boolean(apiKey),
  listModels: () => MODELS,

  async generate(params: GenerateParams): Promise<RawImageOutput> {
    const xai = getClient();
    // xAI's images API rejects size/quality params — send only the basics.
    const response = await xai.images.generate(
      {
        model: params.modelId,
        prompt: params.prompt,
        n: 1,
        response_format: "b64_json",
      },
      { signal: params.signal },
    );
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("xAI returned no b64_json data");
    return { imageBase64: b64, mimeType: "image/png" };
  },
};
