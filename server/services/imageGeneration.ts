import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

// Keep env var resolution consistent with the rest of the codebase (chat uses GEMINI_API_KEY or GOOGLE_API_KEY).
const geminiApiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  "";
const xaiApiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY || "";

// Lazy initialization to avoid errors during import
let _ai: GoogleGenAI | null = null;
let _xaiClient: OpenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (!geminiApiKey) return null;
  if (!_ai) {
    _ai = new GoogleGenAI({ apiKey: geminiApiKey });
  }
  return _ai;
}

function getXaiClient(): OpenAI | null {
  if (!xaiApiKey) return null;
  if (!_xaiClient) {
    _xaiClient = new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey: xaiApiKey,
    });
  }
  return _xaiClient;
}

export interface ImageGenerationResult {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  model?: string;
}

export async function generateImage(prompt: string): Promise<ImageGenerationResult> {
  const startTime = Date.now();
  console.log(`[ImageGeneration] Generating: "${prompt.slice(0, 50)}..."`);

  // Prefer Gemini for image generation in iliagpt.com (user request).
  const ai = getGeminiClient();
  if (ai) {
    const GEMINI_IMAGE_MODELS = [
      "imagen-3.0-generate-002",
      "gemini-2.0-flash-exp-image-generation",
    ];

    for (const model of GEMINI_IMAGE_MODELS) {
      try {
        console.log(`[ImageGeneration] Trying Gemini model: ${model}`);

        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [{ text: `Generate an image: ${prompt}` }]
            }
          ],
          config: {
            responseModalities: ["IMAGE"],
          }
        });

        const parts = response.candidates?.[0]?.content?.parts;

        if (parts) {
          for (const part of parts) {
            if (part.inlineData && part.inlineData.data) {
              const durationMs = Date.now() - startTime;
              console.log(`[ImageGeneration] Success with Gemini ${model} in ${durationMs}ms`);
              return {
                imageBase64: part.inlineData.data,
                mimeType: part.inlineData.mimeType || "image/png",
                prompt,
                model
              };
            }
          }
        }
      } catch (error: any) {
        console.error(`[ImageGeneration] Gemini ${model} failed:`, error.message);
      }
    }
  }

  // Fallback to xAI Grok Image if available
  const xaiClient = getXaiClient();
  if (xaiClient) {
    try {
      console.log(`[ImageGeneration] Trying xAI Grok Image...`);

      const response = await xaiClient.images.generate({
        model: "grok-2-image-1212",
        prompt: prompt,
        n: 1,
        response_format: "b64_json",
      });

      if (response.data && response.data[0]?.b64_json) {
        const durationMs = Date.now() - startTime;
        console.log(`[ImageGeneration] Success with xAI Grok Image in ${durationMs}ms`);
        return {
          imageBase64: response.data[0].b64_json,
          mimeType: "image/png",
          prompt,
          model: "grok-2-image-1212"
        };
      }
    } catch (error: any) {
      console.error(`[ImageGeneration] xAI Grok Image failed:`, error.message);
    }
  }

  throw new Error("Image generation failed: No working image generation service available");
}

export interface ImageEditResult extends ImageGenerationResult {
  parentId?: string;
}

export async function editImage(
  baseImageBase64: string,
  editPrompt: string,
  baseMimeType: string = "image/png"
): Promise<ImageEditResult> {
  const startTime = Date.now();
  console.log(`[ImageGeneration] Starting edit for prompt: "${editPrompt.slice(0, 100)}..."`);

  // For image editing, we'll use Gemini's multimodal capability
  const ai = getGeminiClient();
  if (ai) {
    const EDIT_MODELS = [
      "gemini-2.0-flash",
      "gemini-2.5-flash",
    ];

    for (const model of EDIT_MODELS) {
      try {
        console.log(`[ImageGeneration] Trying edit with model: ${model}`);

        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: baseMimeType,
                    data: baseImageBase64,
                  }
                },
                { text: `Edit this image according to these instructions: ${editPrompt}. Return only the edited image.` }
              ]
            }
          ],
          config: {
            responseModalities: ["IMAGE"],
          }
        });

        const parts = response.candidates?.[0]?.content?.parts;

        if (parts) {
          for (const part of parts) {
            if (part.inlineData && part.inlineData.data) {
              const durationMs = Date.now() - startTime;
              console.log(`[ImageGeneration] Edit success with model ${model} in ${durationMs}ms`);
              return {
                imageBase64: part.inlineData.data,
                mimeType: part.inlineData.mimeType || "image/png",
                prompt: editPrompt,
                model
              };
            }
          }
        }
      } catch (error: any) {
        console.error(`[ImageGeneration] Edit with ${model} failed:`, error.message);
      }
    }
  }

  throw new Error("Image editing failed: No working image editing service available");
}

// Detection functions
export function detectImageRequest(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  const imageKeywords = [
    "genera", "crea", "dibuja", "haz", "hazme", "diseña",
    "generate", "create", "draw", "make", "design",
    "imagen", "image", "foto", "photo", "picture", "ilustración", "illustration",
    "dibujo", "drawing", "arte", "art", "gráfico", "graphic",
    "logo", "icono", "icon", "banner", "poster", "cartel"
  ];
  
  const imagePatterns = [
    /genera(r)?\s+(una?\s+)?imagen/i,
    /crea(r)?\s+(una?\s+)?imagen/i,
    /dibuja(r)?\s+(una?|un)/i,
    /haz(me)?\s+(una?\s+)?imagen/i,
    /diseña(r)?\s+(una?|un)/i,
    /generate\s+(an?\s+)?image/i,
    /create\s+(an?\s+)?image/i,
    /draw\s+(an?\s+|a\s+)?/i,
    /make\s+(an?\s+)?image/i,
    /imagen\s+de\s+/i,
    /image\s+of\s+/i,
  ];
  
  // Check patterns first (more specific)
  for (const pattern of imagePatterns) {
    if (pattern.test(lowerMessage)) {
      return true;
    }
  }
  
  // Check keywords (less specific, requires image-related context)
  const hasActionKeyword = imageKeywords.slice(0, 12).some(kw => lowerMessage.includes(kw));
  const hasImageKeyword = imageKeywords.slice(12).some(kw => lowerMessage.includes(kw));
  
  return hasActionKeyword && hasImageKeyword;
}

export function extractImagePrompt(message: string): string {
  // Remove common prefixes
  let prompt = message
    .replace(/^(genera|crea|dibuja|haz|hazme|diseña|generate|create|draw|make|design)\s*/i, "")
    .replace(/^(una?\s+)?(imagen|image|foto|photo|picture|ilustración|illustration|dibujo|drawing)\s*(de|of)?\s*/i, "")
    .trim();
  
  // If we removed too much, use original
  if (prompt.length < 5) {
    prompt = message;
  }
  
  return prompt;
}
