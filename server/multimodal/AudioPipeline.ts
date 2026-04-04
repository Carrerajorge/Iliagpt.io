import fs from "fs";
import path from "path";
import OpenAI from "openai";
import axios from "axios";
import { Logger } from "../lib/logger";
import { env } from "../config/env";
import { llmGateway } from "../lib/llmGateway";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface TranscriptionRequest {
  audioSource:
    | { type: "url"; url: string }
    | { type: "buffer"; buffer: Buffer; filename: string }
    | { type: "filepath"; path: string };
  language?: string;
  tasks?: AudioTask[];
  speakerCount?: number;
}

export type AudioTask =
  | "transcribe"
  | "translate_to_english"
  | "timestamps"
  | "diarize"
  | "sentiment"
  | "srt"
  | "vtt"
  | "summary";

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  sentiment?: {
    label: "positive" | "negative" | "neutral";
    score: number;
  };
  confidence: number;
}

export interface SpeakerProfile {
  id: string;
  label: string;
  totalDuration: number;
  segments: number[];
  estimatedGender?: "male" | "female" | "unknown";
}

export interface TranscriptionResult {
  text: string;
  language: string;
  duration: number;
  segments: TranscriptSegment[];
  speakers?: SpeakerProfile[];
  summary?: string;
  srt?: string;
  vtt?: string;
  processingTimeMs: number;
}

// ─── Class ────────────────────────────────────────────────────────────────────

class AudioPipeline {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    Logger.info("[AudioPipeline] Initialized");
  }

  // ── Public: main entry ───────────────────────────────────────────────────

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const startMs = Date.now();
    const tasks: AudioTask[] = request.tasks ?? ["transcribe", "timestamps"];
    Logger.info("[AudioPipeline] transcribe", { tasks });

    const { buffer, filename } = await this.prepareAudioBuffer(request.audioSource);

    let text = "";
    let language = request.language ?? "en";
    let duration = 0;
    let rawSegments: any[] = [];

    // Core transcription
    if (tasks.includes("translate_to_english")) {
      text = await this.translateToEnglish(buffer, filename);
      language = "en";
    } else if (tasks.includes("transcribe") || tasks.includes("timestamps")) {
      const whisperResult = await this.transcribeWithWhisper(buffer, filename, request.language);
      text = whisperResult.text;
      language = whisperResult.language;
      duration = whisperResult.duration;
      rawSegments = whisperResult.segments;
    }

    let segments: TranscriptSegment[] = this.mapWhisperSegments(rawSegments);

    if (tasks.includes("diarize")) {
      segments = await this.diarizeSpeakers(segments, request.speakerCount);
    }

    if (tasks.includes("sentiment")) {
      segments = await this.analyzeSentiment(segments);
    }

    const result: TranscriptionResult = {
      text,
      language,
      duration,
      segments,
      processingTimeMs: 0,
    };

    if (tasks.includes("diarize")) {
      result.speakers = this.buildSpeakerProfiles(segments);
    }

    if (tasks.includes("summary")) {
      result.summary = await this.summarizeTranscript(text, duration);
    }

    if (tasks.includes("srt")) {
      result.srt = await this.generateSRT(segments);
    }

    if (tasks.includes("vtt")) {
      result.vtt = await this.generateVTT(segments);
    }

    result.processingTimeMs = Date.now() - startMs;
    Logger.info("[AudioPipeline] transcription complete", {
      processingTimeMs: result.processingTimeMs,
      language,
      duration,
      segmentCount: segments.length,
    });

    return result;
  }

  // ── Whisper transcription ────────────────────────────────────────────────

  async transcribeWithWhisper(
    audioBuffer: Buffer,
    filename: string,
    language?: string
  ): Promise<{ text: string; segments: any[]; language: string; duration: number }> {
    Logger.debug("[AudioPipeline] calling Whisper API", { filename, language });

    const file = new File([audioBuffer], filename);

    const response = await this.openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
      ...(language ? { language } : {}),
    } as any);

    const verbose = response as any;
    return {
      text: verbose.text ?? "",
      segments: verbose.segments ?? [],
      language: verbose.language ?? language ?? "en",
      duration: verbose.duration ?? 0,
    };
  }

  // ── Translation ──────────────────────────────────────────────────────────

  async translateToEnglish(audioBuffer: Buffer, filename: string): Promise<string> {
    Logger.debug("[AudioPipeline] translating to English via Whisper");
    const file = new File([audioBuffer], filename);

    const response = await this.openai.audio.translations.create({
      file,
      model: "whisper-1",
      response_format: "text",
    });

    return typeof response === "string" ? response : (response as any).text ?? "";
  }

  // ── Diarization ──────────────────────────────────────────────────────────

  async diarizeSpeakers(
    segments: TranscriptSegment[],
    speakerCount?: number
  ): Promise<TranscriptSegment[]> {
    if (segments.length === 0) return segments;
    Logger.debug("[AudioPipeline] diarizing speakers", { segmentCount: segments.length, speakerCount });

    // Step 1: heuristic speaker change detection based on pauses > 1.5s
    const PAUSE_THRESHOLD = 1.5;
    let currentSpeaker = 1;
    let lastEnd = 0;
    const heuristic: TranscriptSegment[] = segments.map((seg) => {
      if (seg.start - lastEnd > PAUSE_THRESHOLD) {
        currentSpeaker++;
      }
      lastEnd = seg.end;
      return { ...seg, speaker: `Speaker ${currentSpeaker}` };
    });

    // Step 2: If speakerCount provided, normalize to that count
    if (speakerCount && speakerCount > 0) {
      const totalSpeakers = currentSpeaker;
      const normalized = heuristic.map((seg) => {
        const n = parseInt(seg.speaker?.replace("Speaker ", "") ?? "1", 10);
        const mapped = Math.ceil((n / totalSpeakers) * speakerCount);
        return { ...seg, speaker: `Speaker ${mapped}` };
      });
      return normalized;
    }

    // Step 3: LLM refinement for conversation-style diarization
    if (segments.length <= 50) {
      try {
        const transcript = heuristic.map((s) => `[${s.speaker}] ${s.text}`).join("\n");
        const prompt = `You are a speaker diarization assistant. Below is a transcript with initial speaker labels based on pause detection.
Reassign speaker labels to make the conversation more coherent. Use "Speaker 1", "Speaker 2", etc.
Return ONLY a JSON array of objects: [{"id": <segment_id>, "speaker": "Speaker N"}, ...]

Transcript:
${transcript}

Return ONLY valid JSON array.`;

        const llmResult = await llmGateway.chat([{ role: "user", content: prompt }]);
        const match = llmResult.content.match(/\[[\s\S]*\]/);
        if (match) {
          const assignments: Array<{ id: number; speaker: string }> = JSON.parse(match[0]);
          const map = new Map(assignments.map((a) => [a.id, a.speaker]));
          return heuristic.map((seg) => ({
            ...seg,
            speaker: map.get(seg.id) ?? seg.speaker,
          }));
        }
      } catch (err) {
        Logger.warn("[AudioPipeline] LLM diarization failed, using heuristic", err);
      }
    }

    return heuristic;
  }

  // ── Sentiment analysis ───────────────────────────────────────────────────

  async analyzeSentiment(segments: TranscriptSegment[]): Promise<TranscriptSegment[]> {
    if (segments.length === 0) return segments;
    Logger.debug("[AudioPipeline] analyzing sentiment", { segmentCount: segments.length });

    // Simple keyword-based fast path
    const POSITIVE_WORDS = /\b(great|good|excellent|amazing|happy|love|wonderful|fantastic|positive|success|congratulations|thank|thanks|perfect)\b/i;
    const NEGATIVE_WORDS = /\b(bad|terrible|awful|hate|sad|poor|wrong|fail|failure|error|problem|issue|sorry|unfortunately|difficult)\b/i;

    const keywordLabeled = segments.map((seg) => {
      const positive = POSITIVE_WORDS.test(seg.text);
      const negative = NEGATIVE_WORDS.test(seg.text);
      let label: "positive" | "negative" | "neutral" = "neutral";
      let score = 0.5;

      if (positive && !negative) { label = "positive"; score = 0.75; }
      else if (negative && !positive) { label = "negative"; score = 0.75; }
      else if (positive && negative) { label = "neutral"; score = 0.5; }

      return { ...seg, sentiment: { label, score } };
    });

    // LLM batch for longer transcripts where keywords may be insufficient
    if (segments.length <= 30) {
      try {
        const texts = segments.map((s, i) => `${i}: ${s.text}`).join("\n");
        const prompt = `Analyze the sentiment of each numbered line below.
Return a JSON array: [{"index": 0, "label": "positive"|"negative"|"neutral", "score": 0.0-1.0}]

Lines:
${texts}

Return ONLY valid JSON array.`;

        const llmResult = await llmGateway.chat([{ role: "user", content: prompt }]);
        const match = llmResult.content.match(/\[[\s\S]*\]/);
        if (match) {
          const sentiments: Array<{ index: number; label: "positive" | "negative" | "neutral"; score: number }> =
            JSON.parse(match[0]);
          return keywordLabeled.map((seg, i) => {
            const s = sentiments.find((x) => x.index === i);
            return s ? { ...seg, sentiment: { label: s.label, score: s.score } } : seg;
          });
        }
      } catch (err) {
        Logger.warn("[AudioPipeline] LLM sentiment failed, using keyword fallback", err);
      }
    }

    return keywordLabeled;
  }

  // ── SRT generation ───────────────────────────────────────────────────────

  async generateSRT(segments: TranscriptSegment[]): Promise<string> {
    Logger.debug("[AudioPipeline] generating SRT");
    return segments
      .map(
        (seg) =>
          `${seg.id + 1}\n${this.formatTimestamp(seg.start, "srt")} --> ${this.formatTimestamp(seg.end, "srt")}\n${seg.speaker ? `[${seg.speaker}] ` : ""}${seg.text.trim()}\n`
      )
      .join("\n");
  }

  // ── VTT generation ───────────────────────────────────────────────────────

  async generateVTT(segments: TranscriptSegment[]): Promise<string> {
    Logger.debug("[AudioPipeline] generating VTT");
    const body = segments
      .map(
        (seg) =>
          `${this.formatTimestamp(seg.start, "vtt")} --> ${this.formatTimestamp(seg.end, "vtt")}\n${seg.speaker ? `<v ${seg.speaker}>` : ""}${seg.text.trim()}\n`
      )
      .join("\n");
    return `WEBVTT\n\n${body}`;
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  async summarizeTranscript(text: string, duration: number): Promise<string> {
    Logger.debug("[AudioPipeline] summarizing transcript");
    const minutes = Math.round(duration / 60);
    const prompt = `Summarize the following transcript (approximately ${minutes} minutes long) in 3-5 concise sentences.
Focus on the main topics discussed, key decisions, and action items if any.

Transcript:
${text.slice(0, 8000)}`;

    const result = await llmGateway.chat([{ role: "user", content: prompt }]);
    return result.content;
  }

  // ── Private: timestamp formatter ─────────────────────────────────────────

  private formatTimestamp(seconds: number, format: "srt" | "vtt"): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds - Math.floor(seconds)) * 1000);

    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    const mmm = String(ms).padStart(3, "0");

    return format === "srt" ? `${hh}:${mm}:${ss},${mmm}` : `${hh}:${mm}:${ss}.${mmm}`;
  }

  // ── Private: prepare audio buffer ────────────────────────────────────────

  private async prepareAudioBuffer(
    source: TranscriptionRequest["audioSource"]
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (source.type === "buffer") {
      return { buffer: source.buffer, filename: source.filename };
    }

    if (source.type === "filepath") {
      Logger.debug("[AudioPipeline] reading audio from file", { path: source.path });
      const buffer = await fs.promises.readFile(source.path);
      const filename = path.basename(source.path);
      return { buffer, filename };
    }

    // URL
    Logger.debug("[AudioPipeline] downloading audio from URL", { url: source.url });
    const response = await axios.get<ArrayBuffer>(source.url, {
      responseType: "arraybuffer",
      timeout: 60_000,
    });

    const buffer = Buffer.from(response.data);
    const urlPath = new URL(source.url).pathname;
    const filename = path.basename(urlPath) || "audio.mp3";
    return { buffer, filename };
  }

  // ── Private: map Whisper segments ────────────────────────────────────────

  private mapWhisperSegments(raw: any[]): TranscriptSegment[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((seg, idx) => ({
      id: seg.id ?? idx,
      start: seg.start ?? 0,
      end: seg.end ?? 0,
      text: (seg.text ?? "").trim(),
      confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : 0.9,
    }));
  }

  // ── Private: build speaker profiles ─────────────────────────────────────

  private buildSpeakerProfiles(segments: TranscriptSegment[]): SpeakerProfile[] {
    const speakerMap = new Map<string, SpeakerProfile>();

    for (const seg of segments) {
      const label = seg.speaker ?? "Unknown";
      if (!speakerMap.has(label)) {
        speakerMap.set(label, {
          id: label.toLowerCase().replace(/\s+/g, "_"),
          label,
          totalDuration: 0,
          segments: [],
          estimatedGender: "unknown",
        });
      }
      const profile = speakerMap.get(label)!;
      profile.totalDuration += seg.end - seg.start;
      profile.segments.push(seg.id);
    }

    return Array.from(speakerMap.values());
  }
}

export const audioPipeline = new AudioPipeline();
