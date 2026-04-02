import { trackMediaCost, checkMediaBudget } from "./mediaGenerationCostTracker";

export interface VideoGenerationResult {
  videoUrl?: string;
  videoBase64?: string;
  mimeType: string;
  prompt: string;
  model: string;
  duration?: number;
  storyboard?: any;
  status: "completed" | "processing" | "queued" | "failed";
  message?: string;
}

const OPENROUTER_VIDEO_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
];

function getOpenRouterKey(): string {
  return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
}

export function detectVideoRequest(message: string): boolean {
  const lower = message.toLowerCase();
  const videoPatterns = [
    /genera(r)?\s+(un|una?)?\s*v[ií]deo/i,
    /crea(r)?\s+(un|una?)?\s*v[ií]deo/i,
    /haz(me)?\s+(un|una?)?\s*v[ií]deo/i,
    /generate\s+(a\s+)?video/i,
    /create\s+(a\s+)?video/i,
    /make\s+(a\s+)?video/i,
    /produce\s+(a\s+)?video/i,
    /animaci[oó]n\s+de/i,
    /animate\s+/i,
    /video\s+(of|about|showing|de|sobre|mostrando)/i,
    /cort(o|ometraje)/i,
    /short\s+film/i,
    /clip\s+(de|of|about)/i,
  ];
  return videoPatterns.some(p => p.test(lower));
}

export function extractVideoPrompt(message: string): string {
  let prompt = message
    .replace(/^(genera|crea|haz|hazme|produce|make|create|generate)\s*/i, "")
    .replace(/^(un|una?|a|an)\s*/i, "")
    .replace(/^(v[ií]deo|video|animaci[oó]n|animation|clip|corto|cortometraje|short\s+film)\s*(de|of|about|showing|mostrando|sobre)?\s*/i, "")
    .trim();
  if (prompt.length < 5) prompt = message;
  return prompt;
}

export async function generateVideo(prompt: string, options: {
  duration?: number;
  style?: string;
  aspectRatio?: string;
  userId?: string;
  chatId?: string;
} = {}): Promise<VideoGenerationResult> {
  const startTime = Date.now();
  console.log(`[VideoGeneration] Request: "${prompt.slice(0, 60)}..."`);

  const budgetCheck = checkMediaBudget("video", OPENROUTER_VIDEO_MODELS[0]);
  if (!budgetCheck.allowed) {
    console.warn(`[VideoGeneration] Budget denied: ${budgetCheck.reason}`);
    return {
      mimeType: "text/plain",
      prompt,
      model: "budget-check",
      status: "failed",
      message: `Video generation blocked: ${budgetCheck.reason}`,
    };
  }

  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    return {
      mimeType: "text/plain",
      prompt,
      model: "none",
      status: "failed",
      message: "No API key configured for video generation. Set OPENROUTER_API_KEY.",
    };
  }

  const enhancedPrompt = buildVideoPrompt(prompt, options);

  for (const model of OPENROUTER_VIDEO_MODELS) {
    try {
      console.log(`[VideoGeneration] Trying model: ${model}`);
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://iliagpt.com",
          "X-Title": "IliaGPT",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: `You are a professional video production assistant. When asked to create a video, generate a detailed production-ready storyboard with scenes, visual descriptions, camera movements, audio cues, and timing. Format the output as a structured JSON storyboard that can be used for video production.`,
            },
            { role: "user", content: enhancedPrompt },
          ],
          max_tokens: 4096,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(90000),
      });

      if (!res.ok) {
        console.error(`[VideoGeneration] OpenRouter ${model} HTTP ${res.status}`);
        continue;
      }

      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content;
      const usage = data.usage || {};
      const durationMs = Date.now() - startTime;

      let storyboard: any = null;
      try {
        storyboard = JSON.parse(content);
      } catch {
        storyboard = { rawContent: content };
      }

      trackMediaCost("video", model, usage.prompt_tokens || prompt.length, options.userId, options.chatId);

      console.log(`[VideoGeneration] Storyboard generated with ${model} in ${durationMs}ms`);

      return {
        mimeType: "application/json",
        prompt,
        model,
        duration: options.duration || 15,
        storyboard,
        status: "completed",
        message: `Video storyboard generated successfully. The storyboard contains detailed scene descriptions, camera directions, and production notes ready for rendering.`,
      };
    } catch (error: any) {
      console.error(`[VideoGeneration] ${model} failed:`, error.message);
    }
  }

  return {
    mimeType: "text/plain",
    prompt,
    model: "fallback",
    status: "failed",
    message: "Video generation failed: All models exhausted. Please try again later.",
  };
}

function buildVideoPrompt(prompt: string, options: { duration?: number; style?: string; aspectRatio?: string } = {}): string {
  const parts = [`Create a detailed video production storyboard for: "${prompt}"`];
  if (options.duration) parts.push(`Target duration: ${options.duration} seconds`);
  if (options.style) parts.push(`Visual style: ${options.style}`);
  if (options.aspectRatio) parts.push(`Aspect ratio: ${options.aspectRatio}`);
  parts.push(`Include in the JSON response:
- title: string
- description: string
- totalDuration: number (seconds)
- aspectRatio: string
- style: string
- scenes: array of { sceneNumber, duration, visualDescription, cameraMovement, audioDescription, textOverlay, transitionToNext }
- musicSuggestion: string
- colorPalette: array of hex colors
- productionNotes: string`);
  return parts.join("\n");
}
