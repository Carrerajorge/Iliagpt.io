import { GoogleGenAI } from "@google/genai";
import type {
  GenerateParams,
  ImageModelDescriptor,
  ImageProviderAdapter,
  RawImageOutput,
} from "../types";

const apiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  "";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

const MODELS: ImageModelDescriptor[] = [
  {
    id: "gemini-3.1-flash-image-preview",
    provider: "gemini",
    label: "Gemini 3.1 Flash Image",
    priority: 10,
    supportsAspectRatio: true,
    supportsEdit: true,
  },
  {
    id: "gemini-2.5-flash-image",
    provider: "gemini",
    label: "Gemini 2.5 Flash Image (Nano Banana)",
    priority: 11,
    supportsAspectRatio: true,
    supportsEdit: true,
  },
  {
    id: "imagen-3.0-generate-002",
    provider: "gemini",
    label: "Imagen 3",
    priority: 12,
    supportsAspectRatio: true,
    supportsEdit: false,
  },
  {
    id: "gemini-2.0-flash-exp-image-generation",
    provider: "gemini",
    label: "Gemini 2.0 Flash Image (exp)",
    priority: 13,
    supportsAspectRatio: false,
    supportsEdit: true,
  },
];

function extractInlineImage(response: any): RawImageOutput | null {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return {
        imageBase64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      };
    }
  }
  return null;
}

async function generateWithGenerateContent(params: GenerateParams): Promise<RawImageOutput> {
  const ai = getClient();
  const promptText = params.negativePrompt
    ? `Generate an image: ${params.prompt}\nAvoid: ${params.negativePrompt}`
    : `Generate an image: ${params.prompt}`;

  const baseConfig: Record<string, unknown> = { responseModalities: ["IMAGE"] };
  const configs: Array<Record<string, unknown>> = [];
  if (params.aspectRatio) {
    configs.push({ ...baseConfig, imageConfig: { aspectRatio: params.aspectRatio } });
  }
  configs.push(baseConfig);

  let lastError: Error | null = null;
  for (const config of configs) {
    try {
      const response = await ai.models.generateContent({
        model: params.modelId,
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        config,
      });
      const image = extractInlineImage(response);
      if (image) return image;
      lastError = new Error("Gemini returned no inline image data");
    } catch (error: any) {
      lastError = error;
    }
  }
  throw lastError || new Error("Gemini image generation failed");
}

async function generateWithImagen(params: GenerateParams): Promise<RawImageOutput> {
  const ai = getClient();
  const response: any = await (ai.models as any).generateImages({
    model: params.modelId,
    prompt: params.prompt,
    config: {
      numberOfImages: 1,
      ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
      ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
    },
  });
  const generated = response?.generatedImages?.[0]?.image;
  if (generated?.imageBytes) {
    return { imageBase64: generated.imageBytes, mimeType: generated.mimeType || "image/png" };
  }
  throw new Error("Imagen returned no image bytes");
}

export const geminiAdapter: ImageProviderAdapter = {
  name: "gemini",
  isConfigured: () => Boolean(apiKey),
  listModels: () => MODELS,

  async generate(params: GenerateParams): Promise<RawImageOutput> {
    if (params.modelId.startsWith("imagen-")) {
      return generateWithImagen(params);
    }
    return generateWithGenerateContent(params);
  },

  async edit(baseImageBase64, baseMimeType, params): Promise<RawImageOutput> {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: params.modelId,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: baseMimeType, data: baseImageBase64 } },
            {
              text: `Edit this image according to these instructions: ${params.prompt}. Return only the edited image.`,
            },
          ],
        },
      ],
      config: { responseModalities: ["IMAGE"] },
    });
    const image = extractInlineImage(response);
    if (!image) throw new Error("Gemini edit returned no inline image data");
    return image;
  },
};
