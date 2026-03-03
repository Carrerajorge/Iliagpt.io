import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { trackMediaCost } from "./mediaGenerationCostTracker";

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
      "gemini-3.1-flash-image-preview",
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
              trackMediaCost("image", `gemini/${model}`, prompt.length);
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
        trackMediaCost("image", "xai/grok-2-image-1212", prompt.length);
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

  const orResult = await generateImageViaOpenRouter(prompt);
  if (orResult) {
    const durationMs = Date.now() - startTime;
    console.log(`[ImageGeneration] Success with OpenRouter ${orResult.model} in ${durationMs}ms`);
    trackMediaCost("image", orResult.model || "unknown", prompt.length);
    return orResult;
  }

  throw new Error("Image generation failed: No working image generation service available");
}

async function generateImageViaOpenRouter(prompt: string): Promise<ImageGenerationResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;

  const IMAGE_MODELS = [
    "google/gemini-3.1-flash-image-preview",
    "google/gemini-2.5-flash-image",
    "openai/gpt-5-image-mini",
    "openai/gpt-5-image",
    "google/gemini-3-pro-image-preview",
  ];

  for (const model of IMAGE_MODELS) {
    try {
      console.log(`[ImageGeneration] Trying OpenRouter model: ${model}`);
      const isGoogleModel = model.startsWith("google/");
      const requestBody: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: `Generate an image: ${prompt}` }],
        max_tokens: 4096,
      };
      if (isGoogleModel) {
        requestBody.modalities = ["text", "image"];
      }
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://iliagpt.com",
          "X-Title": "IliaGPT",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        console.error(`[ImageGeneration] OpenRouter ${model} HTTP ${res.status}`);
        continue;
      }

      const data = await res.json() as any;
      const message = data.choices?.[0]?.message;
      const content = message?.content;

      console.log(`[ImageGeneration] OpenRouter ${model} response keys:`, JSON.stringify({
        hasImage: !!message?.image,
        contentType: typeof content,
        isArray: Array.isArray(content),
        messageKeys: message ? Object.keys(message) : [],
        contentPreview: typeof content === "string" ? content.slice(0, 100) : Array.isArray(content) ? JSON.stringify(content.map((p: any) => ({ type: p.type, hasData: !!p.inline_data?.data, hasUrl: !!p.image_url?.url }))).slice(0, 300) : "null",
        imagesCount: Array.isArray(message?.images) ? message.images.length : 0,
        imagesPreview: Array.isArray(message?.images) && message.images.length > 0 ? JSON.stringify(typeof message.images[0] === "string" ? { type: "string", len: message.images[0].length, prefix: message.images[0].slice(0, 80) } : { type: typeof message.images[0], keys: message.images[0] ? Object.keys(message.images[0]) : [] }).slice(0, 300) : "none"
      }));

      if (message?.image) {
        return {
          imageBase64: message.image,
          mimeType: "image/png",
          prompt,
          model,
        };
      }

      if (Array.isArray(message?.images) && message.images.length > 0) {
        const img = message.images[0];
        if (typeof img === "string") {
          const b64Match = img.match(/^data:image\/[^;]+;base64,(.+)/);
          if (b64Match) {
            return { imageBase64: b64Match[1], mimeType: "image/png", prompt, model };
          }
          if (img.startsWith("http")) {
            try {
              const imgRes = await fetch(img, { signal: AbortSignal.timeout(15000) });
              if (imgRes.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                return { imageBase64: buf.toString("base64"), mimeType: imgRes.headers.get("content-type") || "image/png", prompt, model };
              }
            } catch {}
          }
          if (img.length > 100 && /^[A-Za-z0-9+/=]+$/.test(img.slice(0, 100))) {
            return { imageBase64: img, mimeType: "image/png", prompt, model };
          }
        } else if (img?.b64_json) {
          return { imageBase64: img.b64_json, mimeType: img.content_type || "image/png", prompt, model };
        } else if (img?.image_url) {
          const imgUrl = typeof img.image_url === "string" ? img.image_url : img.image_url?.url;
          if (imgUrl) {
            const dataMatch = imgUrl.match(/^data:image\/([^;]+);base64,(.+)/);
            if (dataMatch) {
              return { imageBase64: dataMatch[2], mimeType: `image/${dataMatch[1]}`, prompt, model };
            }
            if (imgUrl.startsWith("http")) {
              try {
                const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(15000) });
                if (imgRes.ok) {
                  const buf = Buffer.from(await imgRes.arrayBuffer());
                  return { imageBase64: buf.toString("base64"), mimeType: imgRes.headers.get("content-type") || "image/png", prompt, model };
                }
              } catch {}
            }
          }
        } else if (img?.url) {
          try {
            const imgRes = await fetch(img.url, { signal: AbortSignal.timeout(15000) });
            if (imgRes.ok) {
              const buf = Buffer.from(await imgRes.arrayBuffer());
              return { imageBase64: buf.toString("base64"), mimeType: imgRes.headers.get("content-type") || "image/png", prompt, model };
            }
          } catch {}
        }
      }

      if (content && typeof content === "string") {
        const base64Match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
        if (base64Match) {
          return {
            imageBase64: base64Match[1],
            mimeType: "image/png",
            prompt,
            model,
          };
        }

        if (content.includes("![") || content.includes("http")) {
          const urlMatch = content.match(/https?:\/\/[^\s)"\]]+\.(png|jpg|jpeg|webp|gif)[^\s)"\]]*/i);
          if (urlMatch) {
            try {
              const imgRes = await fetch(urlMatch[0], { signal: AbortSignal.timeout(15000) });
              if (imgRes.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                return {
                  imageBase64: buf.toString("base64"),
                  mimeType: imgRes.headers.get("content-type") || "image/png",
                  prompt,
                  model,
                };
              }
            } catch {}
          }
        }
      }

      if (Array.isArray(data.choices?.[0]?.message?.content)) {
        for (const part of data.choices[0].message.content) {
          if (part.type === "image_url" && part.image_url?.url) {
            const dataUrl = part.image_url.url;
            const b64Match = dataUrl.match(/data:image\/[^;]+;base64,(.+)/);
            if (b64Match) {
              return { imageBase64: b64Match[1], mimeType: "image/png", prompt, model };
            }
            if (part.image_url.url.startsWith("http")) {
              try {
                const imgRes = await fetch(part.image_url.url, { signal: AbortSignal.timeout(15000) });
                if (imgRes.ok) {
                  const buf = Buffer.from(await imgRes.arrayBuffer());
                  return { imageBase64: buf.toString("base64"), mimeType: imgRes.headers.get("content-type") || "image/png", prompt, model };
                }
              } catch {}
            }
          }
          if (part.inline_data?.data) {
            return { imageBase64: part.inline_data.data, mimeType: part.inline_data.mime_type || "image/png", prompt, model };
          }
        }
      }

      const responsePreview = typeof content === "string" ? content.slice(0, 200) : JSON.stringify(content)?.slice(0, 200);
      console.warn(`[ImageGeneration] OpenRouter ${model}: no image in response. Preview: ${responsePreview}`);
    } catch (error: any) {
      console.error(`[ImageGeneration] OpenRouter ${model} failed:`, error.message);
    }
  }
  return null;
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
      "gemini-3.1-flash-image-preview",
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
