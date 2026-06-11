/**
 * Image generation facade.
 *
 * The heavy lifting lives in ./imageEngine — a provider-agnostic engine
 * (Gemini, OpenAI, xAI, OpenRouter, any OpenAI-compatible endpoint) with
 * priority + circuit-breaker fallback. This module keeps the historical
 * API surface (generateImage / editImage / detect / extract) intact.
 */
import {
  editImageUniversal,
  generateImageUniversal,
  type ImageEngineOptions,
  type ImageProgressListener,
} from "./imageEngine";

export interface ImageGenerationResult {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
}

export async function generateImage(
  prompt: string,
  options: ImageEngineOptions = {},
  onProgress?: ImageProgressListener,
): Promise<ImageGenerationResult> {
  const result = await generateImageUniversal(prompt, options, onProgress);
  return {
    imageBase64: result.imageBase64,
    mimeType: result.mimeType,
    prompt: result.prompt,
    model: result.model,
    provider: result.provider,
    latencyMs: result.latencyMs,
  };
}

export interface ImageEditResult extends ImageGenerationResult {
  parentId?: string;
}

export async function editImage(
  baseImageBase64: string,
  editPrompt: string,
  baseMimeType: string = "image/png",
  options: ImageEngineOptions = {},
  onProgress?: ImageProgressListener,
): Promise<ImageEditResult> {
  const result = await editImageUniversal(
    baseImageBase64,
    editPrompt,
    baseMimeType,
    options,
    onProgress,
  );
  return {
    imageBase64: result.imageBase64,
    mimeType: result.mimeType,
    prompt: result.prompt,
    model: result.model,
    provider: result.provider,
    latencyMs: result.latencyMs,
  };
}

// ── Intent detection ──────────────────────────────────────────────────────────

// Verb stems accept Spanish clitic forms (créame, genérame, hazme, dibújame,
// píntame...) with or without accents, plus infinitives.
const IMAGE_PATTERNS: RegExp[] = [
  // "créame/genera/haz/diseña/dibuja (una) imagen|foto|logo..."
  /\b(?:g[eé]n[eé]ra(?:r|me|nos)?|cr[eé]a(?:r|me|nos)?|h[aá]z(?:me|nos)?|dis[eé][ñn]a(?:r|me)?|dib[uú]ja(?:r|me)?|p[ií]nta(?:r|me)?|mu[eé]stra(?:me)?)\s+(?:una?\s+|el\s+|la\s+)?(?:imagen|foto(?:graf[ií]a)?|ilustraci[oó]n|dibujo|logo(?:tipo)?|banner|p[oó]ster|poster|cartel|avatar|sticker|wallpaper|retrato|icono)\b/i,
  // English: "generate/create/draw me an image|photo|logo..."
  /\b(?:generate|create|make|design|draw|paint|sketch|show)\s+(?:me\s+)?(?:an?\s+|the\s+|some\s+)?(?:image|photo(?:graph)?|picture|illustration|drawing|logo|icon|banner|poster|avatar|sticker|wallpaper|portrait|artwork)\b/i,
  // "imagen de un perro" / "image of a dog" / "foto de..."
  /\b(?:imagen|image|foto|photo|picture)\s+(?:de|of)\b/i,
  // Want/need phrasing: "quiero una imagen de...", "I want a picture of..."
  /\b(?:quiero|necesito|me\s+gustar[ií]a)\s+(?:una?\s+)?(?:imagen|foto|ilustraci[oó]n|dibujo|logo)\b/i,
  /\bi\s+(?:want|need)\s+(?:an?\s+)?(?:image|photo|picture|illustration|drawing|logo)\b/i,
  // Drawing verbs are self-sufficient when followed by an object:
  // "dibújame un perro", "píntame la luna", "draw me a dragon".
  /\b(?:dib[uú]ja(?:me)?|p[ií]nta(?:me)?)\s+(?:una?|unos?|el|la|los|las)\b/i,
  /\b(?:draw|paint|sketch)\s+(?:me\s+)?(?:a|an|the)\b/i,
  /\bcreate\s+art\b/i,
  /\bg[eé]n[eé]ra(?:r)?\s+arte\b/i,
];

const ACTION_KEYWORD_PATTERN =
  /\b(?:g[eé]n[eé]ra(?:r|me|nos)?|cr[eé]a(?:r|me|nos)?|h[aá]z(?:me|nos)?|dis[eé][ñn]a(?:r|me)?|dib[uú]ja(?:r|me)?|p[ií]nta(?:r|me)?|generate|create|draw|make|design|paint)\b/i;

// Word boundaries avoid false positives like "startup" -> "art" or
// "excelente" -> "excel". Doc-type nouns (word/excel/ppt/pdf) are
// intentionally NOT image keywords — see imageGeneration.officeGuards tests.
const IMAGE_KEYWORD_PATTERN =
  /\b(?:imagen|image|foto(?:graf[ií]a)?|photo(?:graph)?|picture|ilustraci[oó]n|illustration|dibujo|drawing|arte|artwork|logo(?:tipo)?|icono|icon|banner|p[oó]ster|poster|cartel|avatar|sticker|wallpaper|retrato|portrait)\b|\bart\b/i;

export function detectImageRequest(message: string): boolean {
  const text = message.toLowerCase();

  for (const pattern of IMAGE_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  return ACTION_KEYWORD_PATTERN.test(text) && IMAGE_KEYWORD_PATTERN.test(text);
}

export function extractImagePrompt(message: string): string {
  let prompt = message
    .replace(
      /^(?:por\s+favor[,\s]+)?(?:puedes\s+|podr[ií]as\s+)?(?:g[eé]n[eé]ra(?:r|me|nos)?|cr[eé]a(?:r|me|nos)?|dib[uú]ja(?:r|me)?|p[ií]nta(?:r|me)?|h[aá]z(?:me|nos)?|dis[eé][ñn]a(?:r|me)?|mu[eé]stra(?:me)?|quiero|necesito|generate|create|draw|paint|make|design|show)\s*/i,
      "",
    )
    .replace(
      /^(?:una?\s+)?(?:imagen|image|foto(?:graf[ií]a)?|photo(?:graph)?|picture|ilustraci[oó]n|illustration|dibujo|drawing)\s*(?:de|of)?\s*/i,
      "",
    )
    .trim();

  if (prompt.length < 5) {
    prompt = message;
  }

  return prompt;
}
