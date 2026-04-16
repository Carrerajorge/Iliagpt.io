/**
 * Voice & Audio Agent Tools
 *
 * Allows the agent to:
 *   - Speak text aloud (TTS)
 *   - Transcribe audio files (STT)
 *   - List available voices
 *   - Control audio playback
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ttsService, sttService, listAvailableVoices } from "../../services/voiceAudioService";

export const voiceTTSTool = tool(
  async (input) => {
    const start = Date.now();
    try {
      const result = await ttsService.synthesize(input.text, {
        provider: input.provider as any || "system",
        voice: input.voice,
        speed: input.speed,
        format: input.format as any || "mp3",
      });

      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error, latencyMs: Date.now() - start });
      }

      return JSON.stringify({
        success: true,
        audioPath: result.audioPath,
        format: result.format,
        message: `Generated speech audio at: ${result.audioPath}`,
        latencyMs: Date.now() - start,
      });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message, latencyMs: Date.now() - start });
    }
  },
  {
    name: "voice_tts",
    description: "Convert text to speech audio. Supports system (macOS native), OpenAI TTS, and ElevenLabs voices. Returns the path to the generated audio file.",
    schema: z.object({
      text: z.string().describe("Text to speak"),
      provider: z.enum(["system", "openai", "elevenlabs"]).optional().describe("TTS provider (default: system)"),
      voice: z.string().optional().describe("Voice name/id"),
      speed: z.number().optional().describe("Speaking speed"),
      format: z.enum(["mp3", "wav", "aac"]).optional().describe("Output format"),
    }),
  }
);

export const voiceSTTTool = tool(
  async (input) => {
    const start = Date.now();
    try {
      const result = await sttService.transcribe(input.audioPath, {
        provider: input.provider as any || "whisper_api",
        language: input.language,
        prompt: input.contextHint,
      });

      return JSON.stringify({
        success: result.success,
        text: result.text,
        language: result.language,
        durationMs: result.durationMs,
        segments: result.segments?.length,
        error: result.error,
        latencyMs: Date.now() - start,
      });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message, latencyMs: Date.now() - start });
    }
  },
  {
    name: "voice_stt",
    description: "Transcribe an audio file to text using Whisper API, local Whisper, or Deepgram. Returns the transcribed text.",
    schema: z.object({
      audioPath: z.string().describe("Path to audio file to transcribe"),
      provider: z.enum(["whisper_api", "whisper_local", "deepgram"]).optional().describe("STT provider (default: whisper_api)"),
      language: z.string().optional().describe("Expected language (ISO code)"),
      contextHint: z.string().optional().describe("Context hint to improve accuracy"),
    }),
  }
);

export const voiceListTool = tool(
  async (input) => {
    const voices = await listAvailableVoices(input.provider as any || "system");
    return JSON.stringify({
      success: true,
      provider: input.provider || "system",
      voices: voices.slice(0, 50),
      count: voices.length,
    });
  },
  {
    name: "voice_list_voices",
    description: "List available TTS voices for a given provider.",
    schema: z.object({
      provider: z.enum(["system", "openai", "elevenlabs"]).optional().describe("TTS provider (default: system)"),
    }),
  }
);

export const VOICE_TOOLS = [voiceTTSTool, voiceSTTTool, voiceListTool];
