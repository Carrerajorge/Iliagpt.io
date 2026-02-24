/**
 * Voice & Audio Service
 *
 * Provides:
 *   - Text-to-Speech (TTS) via ElevenLabs, OpenAI, or macOS native `say`
 *   - Speech-to-Text (STT) via OpenAI Whisper API or local whisper
 *   - Audio recording/playback helpers
 *   - Voice session management
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────

export type TTSProvider = "system" | "elevenlabs" | "openai";
export type STTProvider = "whisper_api" | "whisper_local" | "deepgram";

export interface TTSOptions {
  provider?: TTSProvider;
  voice?: string;
  speed?: number;       // 0.25-4.0 for OpenAI, speaking rate for system
  model?: string;       // tts-1 or tts-1-hd for OpenAI
  format?: "mp3" | "wav" | "aac" | "opus";
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
}

export interface STTOptions {
  provider?: STTProvider;
  language?: string;     // ISO code
  prompt?: string;       // context hint
  model?: string;        // whisper-1 for API
  temperature?: number;
  format?: "json" | "text" | "srt" | "verbose_json" | "vtt";
}

export interface TTSResult {
  success: boolean;
  audioPath: string;
  format: string;
  durationMs?: number;
  error?: string;
}

export interface STTResult {
  success: boolean;
  text: string;
  language?: string;
  durationMs?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  error?: string;
}

export interface VoiceSession {
  id: string;
  userId: string;
  chatId?: string;
  status: "idle" | "listening" | "processing" | "speaking";
  ttsProvider: TTSProvider;
  sttProvider: STTProvider;
  voice?: string;
  language: string;
  createdAt: Date;
}

// ── TTS ────────────────────────────────────────────────────────────────

export class TextToSpeechService {

  /**
   * Convert text to speech audio file.
   */
  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    const provider = options.provider || "system";

    switch (provider) {
      case "system":
        return this.systemTTS(text, options);
      case "openai":
        return this.openaiTTS(text, options);
      case "elevenlabs":
        return this.elevenLabsTTS(text, options);
      default:
        return { success: false, audioPath: "", format: "", error: `Unknown provider: ${provider}` };
    }
  }

  /**
   * macOS native TTS via `say` command.
   */
  private async systemTTS(text: string, options: TTSOptions): Promise<TTSResult> {
    const outputPath = path.join(os.tmpdir(), `iliagpt-tts-${Date.now()}.aiff`);
    const args = ["-o", outputPath];

    if (options.voice) args.push("-v", options.voice);
    if (options.speed) args.push("-r", String(options.speed));
    args.push(text);

    try {
      await execFileAsync("/usr/bin/say", args, { timeout: 30000 });

      // Convert AIFF to requested format if needed
      const format = options.format || "aiff";
      let finalPath = outputPath;

      if (format !== "aiff" && await this.hasFFmpeg()) {
        finalPath = outputPath.replace(".aiff", `.${format}`);
        await execFileAsync("ffmpeg", ["-i", outputPath, "-y", finalPath], { timeout: 15000 });
        await fs.unlink(outputPath).catch(() => {});
      }

      return { success: true, audioPath: finalPath, format: format === "aiff" ? "aiff" : format };
    } catch (err: any) {
      return { success: false, audioPath: "", format: "", error: err.message };
    }
  }

  /**
   * OpenAI TTS API.
   */
  private async openaiTTS(text: string, options: TTSOptions): Promise<TTSResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { success: false, audioPath: "", format: "", error: "OPENAI_API_KEY not set" };

    const model = options.model || "tts-1";
    const voice = options.voice || "nova";
    const format = options.format || "mp3";
    const speed = options.speed || 1.0;

    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: text,
          voice,
          response_format: format,
          speed,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { success: false, audioPath: "", format, error: `OpenAI TTS error: ${response.status} ${err}` };
      }

      const outputPath = path.join(os.tmpdir(), `iliagpt-tts-${Date.now()}.${format}`);
      const body = response.body;
      if (!body) return { success: false, audioPath: "", format, error: "No response body" };

      await pipeline(Readable.fromWeb(body as any), createWriteStream(outputPath));

      return { success: true, audioPath: outputPath, format };
    } catch (err: any) {
      return { success: false, audioPath: "", format: "", error: err.message };
    }
  }

  /**
   * ElevenLabs TTS API.
   */
  private async elevenLabsTTS(text: string, options: TTSOptions): Promise<TTSResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return { success: false, audioPath: "", format: "", error: "ELEVENLABS_API_KEY not set" };

    const voiceId = options.elevenLabsVoiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    const modelId = options.elevenLabsModelId || "eleven_multilingual_v2";
    const format = options.format || "mp3";

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": `audio/${format === "mp3" ? "mpeg" : format}`,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { success: false, audioPath: "", format, error: `ElevenLabs error: ${response.status} ${err}` };
      }

      const outputPath = path.join(os.tmpdir(), `iliagpt-tts-${Date.now()}.${format}`);
      const body = response.body;
      if (!body) return { success: false, audioPath: "", format, error: "No response body" };

      await pipeline(Readable.fromWeb(body as any), createWriteStream(outputPath));

      return { success: true, audioPath: outputPath, format };
    } catch (err: any) {
      return { success: false, audioPath: "", format: "", error: err.message };
    }
  }

  private async hasFFmpeg(): Promise<boolean> {
    try {
      await execFileAsync("which", ["ffmpeg"]);
      return true;
    } catch {
      return false;
    }
  }
}

// ── STT ────────────────────────────────────────────────────────────────

export class SpeechToTextService {

  /**
   * Transcribe audio file to text.
   */
  async transcribe(audioPath: string, options: STTOptions = {}): Promise<STTResult> {
    const provider = options.provider || "whisper_api";

    switch (provider) {
      case "whisper_api":
        return this.whisperAPI(audioPath, options);
      case "whisper_local":
        return this.whisperLocal(audioPath, options);
      case "deepgram":
        return this.deepgramAPI(audioPath, options);
      default:
        return { success: false, text: "", error: `Unknown provider: ${provider}` };
    }
  }

  /**
   * OpenAI Whisper API.
   */
  private async whisperAPI(audioPath: string, options: STTOptions): Promise<STTResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { success: false, text: "", error: "OPENAI_API_KEY not set" };

    try {
      const audioBuffer = await fs.readFile(audioPath);
      const fileName = path.basename(audioPath);

      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer]), fileName);
      formData.append("model", options.model || "whisper-1");
      if (options.language) formData.append("language", options.language);
      if (options.prompt) formData.append("prompt", options.prompt);
      if (options.temperature) formData.append("temperature", String(options.temperature));
      formData.append("response_format", options.format || "verbose_json");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.text();
        return { success: false, text: "", error: `Whisper API error: ${response.status} ${err}` };
      }

      const data = await response.json() as any;

      return {
        success: true,
        text: data.text || "",
        language: data.language,
        durationMs: data.duration ? Math.round(data.duration * 1000) : undefined,
        segments: data.segments?.map((s: any) => ({ start: s.start, end: s.end, text: s.text })),
      };
    } catch (err: any) {
      return { success: false, text: "", error: err.message };
    }
  }

  /**
   * Local Whisper CLI (whisper.cpp or openai-whisper).
   */
  private async whisperLocal(audioPath: string, options: STTOptions): Promise<STTResult> {
    try {
      const model = options.model || "base";
      const language = options.language || "auto";

      // Try whisper CLI first (Python openai-whisper)
      const { stdout } = await execFileAsync("whisper", [
        audioPath,
        "--model", model,
        "--language", language,
        "--output_format", "json",
        "--output_dir", os.tmpdir(),
      ], { timeout: 120000 });

      // Read the JSON output
      const baseName = path.basename(audioPath, path.extname(audioPath));
      const jsonPath = path.join(os.tmpdir(), `${baseName}.json`);
      const jsonContent = await fs.readFile(jsonPath, "utf-8");
      const data = JSON.parse(jsonContent);

      return {
        success: true,
        text: data.text || "",
        language: data.language,
        segments: data.segments?.map((s: any) => ({ start: s.start, end: s.end, text: s.text })),
      };
    } catch (err: any) {
      return { success: false, text: "", error: `Local whisper error: ${err.message}` };
    }
  }

  /**
   * Deepgram API.
   */
  private async deepgramAPI(audioPath: string, options: STTOptions): Promise<STTResult> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) return { success: false, text: "", error: "DEEPGRAM_API_KEY not set" };

    try {
      const audioBuffer = await fs.readFile(audioPath);
      const ext = path.extname(audioPath).slice(1);
      const mimeMap: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm" };

      const response = await fetch(`https://api.deepgram.com/v1/listen?model=nova-2&language=${options.language || "es"}&smart_format=true`, {
        method: "POST",
        headers: {
          "Authorization": `Token ${apiKey}`,
          "Content-Type": mimeMap[ext] || "audio/mpeg",
        },
        body: audioBuffer,
      });

      if (!response.ok) {
        const err = await response.text();
        return { success: false, text: "", error: `Deepgram error: ${response.status} ${err}` };
      }

      const data = await response.json() as any;
      const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

      return {
        success: true,
        text: transcript,
        language: data.results?.channels?.[0]?.detected_language,
      };
    } catch (err: any) {
      return { success: false, text: "", error: err.message };
    }
  }
}

// ── Audio Recording ────────────────────────────────────────────────────

export class AudioRecorder {
  private recordingProcess?: ReturnType<typeof spawn>;

  /**
   * Start recording from system microphone (macOS only).
   */
  async startRecording(outputPath?: string): Promise<string> {
    const filePath = outputPath || path.join(os.tmpdir(), `iliagpt-recording-${Date.now()}.wav`);

    // Use sox (rec) or ffmpeg for recording
    try {
      // Try sox first
      this.recordingProcess = spawn("rec", [filePath, "rate", "16k", "channels", "1"], {
        stdio: "ignore",
      });
    } catch {
      // Fallback to ffmpeg
      this.recordingProcess = spawn("ffmpeg", [
        "-f", "avfoundation",
        "-i", ":0",  // default audio input
        "-ar", "16000",
        "-ac", "1",
        "-y", filePath,
      ], {
        stdio: "ignore",
      });
    }

    return filePath;
  }

  /**
   * Stop recording and return the file path.
   */
  async stopRecording(): Promise<void> {
    if (this.recordingProcess) {
      this.recordingProcess.kill("SIGTERM");
      this.recordingProcess = undefined;
    }
  }
}

// ── Singletons ─────────────────────────────────────────────────────────

export const ttsService = new TextToSpeechService();
export const sttService = new SpeechToTextService();
export const audioRecorder = new AudioRecorder();

// ── Voice Tool (for agent) ─────────────────────────────────────────────

export async function listAvailableVoices(provider: TTSProvider): Promise<string[]> {
  switch (provider) {
    case "system": {
      try {
        const { stdout } = await execFileAsync("say", ["-v", "?"], { timeout: 5000 });
        return stdout.split("\n").filter(Boolean).map(line => {
          const match = line.match(/^(\S+)/);
          return match?.[1] || line.trim();
        });
      } catch {
        return ["Alex", "Samantha", "Victoria", "Daniel", "Karen", "Moira", "Rishi", "Tessa"];
      }
    }
    case "openai":
      return ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    case "elevenlabs": {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return [];
      try {
        const res = await fetch("https://api.elevenlabs.io/v1/voices", {
          headers: { "xi-api-key": apiKey },
        });
        const data = await res.json() as any;
        return data.voices?.map((v: any) => `${v.name} (${v.voice_id})`) || [];
      } catch {
        return [];
      }
    }
    default:
      return [];
  }
}
