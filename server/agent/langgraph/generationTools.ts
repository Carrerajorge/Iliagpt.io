import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import * as fs from "fs/promises";
import * as path from "path";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const generateTextTool = tool(
  async (input) => {
    const { prompt, style = "neutral", tone = "professional", format = "prose", maxLength = 2000, language = "en" } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert content writer. Generate high-quality text content with the following specifications:
- Style: ${style}
- Tone: ${tone}
- Format: ${format}
- Language: ${language}
- Maximum length: approximately ${maxLength} characters

Guidelines:
1. Maintain consistent style and voice throughout
2. Use appropriate vocabulary for the target audience
3. Structure content logically with clear flow
4. Ensure originality and engaging narrative
5. Avoid filler content or repetition

Return JSON:
{
  "content": "the generated text",
  "wordCount": number,
  "characterCount": number,
  "readingTime": "estimated reading time",
  "structure": {
    "paragraphs": number,
    "sections": number,
    "hasIntro": boolean,
    "hasConclusion": boolean
  },
  "metadata": {
    "style": "detected style",
    "tone": "detected tone",
    "complexity": "simple|intermediate|advanced"
  }
}`,
          },
          {
            role: "user",
            content: `Generate text content for:\n\n${prompt}`,
          },
        ],
        temperature: 0.7,
        max_tokens: Math.min(maxLength * 2, 8000),
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        content,
        wordCount: content.split(/\s+/).length,
        characterCount: content.length,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "generate_text",
    description: "Generates high-quality text content with control over style, tone, format, and length. Supports various content types including articles, stories, reports, and marketing copy.",
    schema: z.object({
      prompt: z.string().describe("Description of the text content to generate"),
      style: z.enum(["neutral", "formal", "casual", "academic", "creative", "technical", "journalistic"]).optional().default("neutral")
        .describe("Writing style"),
      tone: z.enum(["professional", "friendly", "authoritative", "conversational", "persuasive", "informative"]).optional().default("professional")
        .describe("Tone of voice"),
      format: z.enum(["prose", "article", "essay", "story", "script", "outline", "bullet_points", "report"]).optional().default("prose")
        .describe("Content format"),
      maxLength: z.number().optional().default(2000).describe("Approximate maximum character count"),
      language: z.string().optional().default("en").describe("Output language code (en, es, fr, etc)"),
    }),
  }
);

export const generateImageTool = tool(
  async (input) => {
    const { prompt, style = "realistic", size = "1024x1024", quality = "standard", model = "dall-e-3" } = input;
    const startTime = Date.now();

    try {
      const enhancedPrompt = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert at crafting image generation prompts. Enhance the given prompt for better results with DALL-E or Stable Diffusion.

Include:
- Specific visual details
- Lighting and atmosphere
- Style references
- Composition guidance
- Quality keywords (4K, detailed, professional, etc.)

Return only the enhanced prompt, no JSON.`,
          },
          {
            role: "user",
            content: `Original prompt: ${prompt}\nDesired style: ${style}`,
          },
        ],
        temperature: 0.6,
        max_tokens: 500,
      });

      const enhancedPromptText = enhancedPrompt.choices[0].message.content || prompt;

      return JSON.stringify({
        success: true,
        message: "Image generation prepared",
        originalPrompt: prompt,
        enhancedPrompt: enhancedPromptText,
        requestedStyle: style,
        requestedSize: size,
        requestedQuality: quality,
        model,
        note: "Actual image generation requires configured image API (DALL-E, Stable Diffusion, or Midjourney)",
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "generate_image",
    description: "Prepares and enhances prompts for image generation using diffusion models (DALL-E, Stable Diffusion). Returns optimized prompts for best results.",
    schema: z.object({
      prompt: z.string().describe("Description of the image to generate"),
      style: z.enum(["realistic", "artistic", "cartoon", "3d", "sketch", "watercolor", "oil_painting", "digital_art", "photography", "anime"])
        .optional().default("realistic").describe("Visual style"),
      size: z.enum(["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"]).optional().default("1024x1024").describe("Image dimensions"),
      quality: z.enum(["standard", "hd"]).optional().default("standard").describe("Image quality level"),
      model: z.enum(["dall-e-3", "dall-e-2", "stable-diffusion", "midjourney"]).optional().default("dall-e-3").describe("Generation model"),
    }),
  }
);

export const generateAudioTool = tool(
  async (input) => {
    const { text, voice = "alloy", speed = 1.0, format = "mp3", language = "en" } = input;
    const startTime = Date.now();

    try {
      const analysisResponse = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a text-to-speech preparation expert. Analyze text for optimal audio synthesis.

Return JSON:
{
  "originalText": "the input text",
  "cleanedText": "text optimized for TTS (expand abbreviations, add pauses)",
  "estimatedDuration": "HH:MM:SS",
  "wordCount": number,
  "ssmlMarkers": [
    {
      "position": number,
      "type": "pause|emphasis|break",
      "value": "marker value"
    }
  ],
  "recommendedSettings": {
    "voice": "best voice for this content",
    "speed": number,
    "pitch": "normal|high|low"
  },
  "contentType": "narrative|conversational|technical|dramatic",
  "emotions": ["detected emotions in text"]
}`,
          },
          {
            role: "user",
            content: `Prepare this text for audio synthesis:\n\n${text}\n\nVoice preference: ${voice}\nSpeed: ${speed}x\nLanguage: ${language}`,
          },
        ],
        temperature: 0.3,
      });

      const content = analysisResponse.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          requestedFormat: format,
          requestedVoice: voice,
          note: "Actual audio generation requires configured TTS API (OpenAI TTS, ElevenLabs, etc.)",
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        originalText: text,
        wordCount: text.split(/\s+/).length,
        estimatedDuration: `${Math.ceil(text.split(/\s+/).length / 150)} min`,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "generate_audio",
    description: "Prepares text for speech synthesis with voice selection, speed control, and SSML markup. Supports multiple languages and voice options.",
    schema: z.object({
      text: z.string().describe("Text content to convert to speech"),
      voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).optional().default("alloy").describe("Voice selection"),
      speed: z.number().min(0.25).max(4.0).optional().default(1.0).describe("Speech speed (0.25 to 4.0)"),
      format: z.enum(["mp3", "opus", "aac", "flac", "wav"]).optional().default("mp3").describe("Output audio format"),
      language: z.string().optional().default("en").describe("Language code"),
    }),
  }
);

export const generateVideoTool = tool(
  async (input) => {
    const { prompt, duration = 5, aspectRatio = "16:9", style = "cinematic", fps = 24 } = input;
    const startTime = Date.now();

    try {
      const storyboardResponse = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a video production expert. Create a detailed storyboard for video generation.

Return JSON:
{
  "title": "video title",
  "description": "overall video description",
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": "in seconds",
      "description": "detailed scene description",
      "visualElements": ["key visual elements"],
      "camera": "camera movement/angle",
      "transition": "transition to next scene",
      "mood": "scene mood/atmosphere"
    }
  ],
  "totalDuration": number,
  "recommendedMusic": "music style suggestion",
  "colorPalette": ["primary colors"],
  "pacing": "slow|medium|fast",
  "targetAudience": "who this is for"
}`,
          },
          {
            role: "user",
            content: `Create a video storyboard for:
Prompt: ${prompt}
Duration: ${duration} seconds
Aspect Ratio: ${aspectRatio}
Style: ${style}
FPS: ${fps}`,
          },
        ],
        temperature: 0.6,
      });

      const content = storyboardResponse.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          requestedDuration: duration,
          requestedAspectRatio: aspectRatio,
          requestedStyle: style,
          requestedFps: fps,
          note: "Actual video generation requires configured video AI API (Runway, Pika, etc.)",
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        prompt,
        duration,
        aspectRatio,
        style,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "generate_video",
    description: "Creates video storyboards and prepares prompts for video generation AI. Includes scene breakdown, timing, and visual specifications.",
    schema: z.object({
      prompt: z.string().describe("Description of the video to generate"),
      duration: z.number().min(1).max(60).optional().default(5).describe("Video duration in seconds"),
      aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "21:9"]).optional().default("16:9").describe("Video aspect ratio"),
      style: z.enum(["cinematic", "documentary", "animated", "timelapse", "slow_motion", "vlog", "commercial"]).optional().default("cinematic")
        .describe("Visual style"),
      fps: z.number().optional().default(24).describe("Frames per second"),
    }),
  }
);

export const generateMusicTool = tool(
  async (input) => {
    const { prompt, genre = "ambient", mood = "neutral", duration = 30, tempo = "medium", instruments = [] } = input;
    const startTime = Date.now();

    try {
      const compositionResponse = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a music composition expert. Create a detailed music composition plan.

Return JSON:
{
  "title": "suggested track title",
  "description": "composition description",
  "structure": [
    {
      "section": "intro|verse|chorus|bridge|outro",
      "duration": "in seconds",
      "description": "what happens musically",
      "intensity": 1-10,
      "instruments": ["active instruments"]
    }
  ],
  "musicalElements": {
    "key": "musical key (e.g., C major)",
    "timeSignature": "4/4, 3/4, etc.",
    "bpm": number,
    "dynamics": "pp to ff range",
    "melody": "melodic characteristics",
    "harmony": "harmonic approach"
  },
  "productionNotes": {
    "mixingAdvice": "how to mix",
    "masteringAdvice": "mastering suggestions",
    "referenceTrack": "similar existing song"
  },
  "totalDuration": number,
  "suggestedUseCase": ["video background", "podcast", etc.]
}`,
          },
          {
            role: "user",
            content: `Create a music composition plan for:
Description: ${prompt}
Genre: ${genre}
Mood: ${mood}
Duration: ${duration} seconds
Tempo: ${tempo}
Instruments: ${instruments.length > 0 ? instruments.join(", ") : "any appropriate"}`,
          },
        ],
        temperature: 0.7,
      });

      const content = compositionResponse.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          requestedGenre: genre,
          requestedMood: mood,
          requestedDuration: duration,
          note: "Actual music generation requires configured music AI API (Suno, MusicGen, etc.)",
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        prompt,
        genre,
        mood,
        duration,
        tempo,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "generate_music",
    description: "Creates music composition plans and prepares prompts for music generation AI. Includes structure, instruments, tempo, and production notes.",
    schema: z.object({
      prompt: z.string().describe("Description of the music to generate"),
      genre: z.enum(["ambient", "classical", "electronic", "jazz", "rock", "pop", "orchestral", "lo-fi", "cinematic", "acoustic"])
        .optional().default("ambient").describe("Music genre"),
      mood: z.enum(["neutral", "happy", "sad", "energetic", "calm", "dramatic", "mysterious", "romantic", "epic"]).optional().default("neutral")
        .describe("Emotional mood"),
      duration: z.number().min(5).max(300).optional().default(30).describe("Duration in seconds"),
      tempo: z.enum(["slow", "medium", "fast", "variable"]).optional().default("medium").describe("Tempo/speed"),
      instruments: z.array(z.string()).optional().default([]).describe("Specific instruments to include"),
    }),
  }
);

export const GENERATION_TOOLS = [
  generateTextTool,
  generateImageTool,
  generateAudioTool,
  generateVideoTool,
  generateMusicTool,
];
