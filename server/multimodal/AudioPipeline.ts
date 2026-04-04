/**
 * AudioPipeline — transcription via Whisper API with speaker diarization,
 * sentiment analysis per segment, summary generation, and SRT caption output.
 */

import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const logger = createLogger("AudioPipeline");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioSegment {
  start: number; // seconds
  end: number;
  text: string;
  speaker?: string;
  sentiment?: "positive" | "neutral" | "negative";
  confidence?: number;
  language?: string;
}

export interface TranscriptionResult {
  fullText: string;
  segments: AudioSegment[];
  language: string;
  duration: number;
  model: string;
  summary?: string;
  srtCaptions?: string;
  speakers?: string[];
  overallSentiment?: "positive" | "neutral" | "negative";
  keywords?: string[];
  tokensUsed: number;
}

export interface TranscriptionOptions {
  language?: string;
  generateSummary?: boolean;
  generateSrt?: boolean;
  analyzeSentiment?: boolean;
  detectSpeakers?: boolean;
  maxSpeakers?: number;
  prompt?: string; // context hint for Whisper
}

// ─── SRT Generator ────────────────────────────────────────────────────────────

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function generateSrt(segments: AudioSegment[]): string {
  return segments
    .map((seg, i) => {
      const speaker = seg.speaker ? `[${seg.speaker}] ` : "";
      return `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${speaker}${seg.text}\n`;
    })
    .join("\n");
}

// ─── Sentiment Analysis ───────────────────────────────────────────────────────

function analyzeSentimentSimple(text: string): "positive" | "neutral" | "negative" {
  const pos = (text.match(/\b(good|great|excellent|amazing|love|happy|wonderful|fantastic|positive|success|well|better|best|glad|pleased|appreciate|thank|congratulations|nice)\b/gi) ?? []).length;
  const neg = (text.match(/\b(bad|terrible|awful|hate|angry|frustrated|wrong|fail|failure|problem|issue|error|broken|slow|poor|worst|disappointed|unfortunately|concern|risk|difficult)\b/gi) ?? []).length;

  if (pos > neg * 1.5) return "positive";
  if (neg > pos * 1.5) return "negative";
  return "neutral";
}

// ─── Speaker Diarization (heuristic without API) ──────────────────────────────

function heuristicDiarization(segments: AudioSegment[], maxSpeakers: number): AudioSegment[] {
  // Simple heuristic: alternate speakers based on silence gaps
  const SILENCE_THRESHOLD = 0.8; // seconds
  let currentSpeaker = 0;
  const speakers = Array.from({ length: maxSpeakers }, (_, i) => `Speaker ${i + 1}`);

  return segments.map((seg, i) => {
    if (i > 0) {
      const prevSeg = segments[i - 1]!;
      const gap = seg.start - prevSeg.end;
      if (gap >= SILENCE_THRESHOLD) {
        // Switch speaker on significant gap
        currentSpeaker = (currentSpeaker + 1) % maxSpeakers;
      }
    }
    return { ...seg, speaker: speakers[currentSpeaker] };
  });
}

// ─── Language Detection ───────────────────────────────────────────────────────

function detectLanguageFromText(text: string): string {
  const langPatterns: Array<[string, RegExp]> = [
    ["es", /\b(que|de|el|la|en|y|los|las|por|para|con|una|tiene|puede|sobre)\b/gi],
    ["fr", /\b(que|de|le|la|les|et|en|un|une|des|sur|avec|pour|dans)\b/gi],
    ["pt", /\b(que|de|o|a|os|as|em|do|da|para|com|uma|por|como)\b/gi],
    ["de", /\b(der|die|das|und|in|zu|mit|von|für|ist|nicht|auch|auf|er)\b/gi],
  ];

  let bestLang = "en";
  let bestCount = 0;

  for (const [lang, pattern] of langPatterns) {
    const count = (text.match(pattern) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      bestLang = lang;
    }
  }

  return bestLang;
}

// ─── Summary Generation ───────────────────────────────────────────────────────

async function generateSummary(fullText: string, duration: number): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Summarize this audio transcript (${Math.round(duration / 60)} minutes) in 3-5 bullet points:

${fullText.slice(0, 4_000)}

Format as bullet points starting with •`,
      },
    ],
  });

  return response.content[0]?.type === "text" ? response.content[0].text : "";
}

// ─── Keyword Extraction ───────────────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can", "it",
    "its", "this", "that", "these", "those", "i", "we", "you", "he", "she",
    "they", "what", "which", "who", "when", "where", "how", "all", "each",
  ]);

  const wordFreq = new Map<string, number>();
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !stopwords.has(w));

  for (const word of words) {
    wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
  }

  return [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
}

// ─── AudioPipeline ────────────────────────────────────────────────────────────

export class AudioPipeline {
  private openai: OpenAI | null;

  constructor() {
    this.openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  }

  async transcribe(
    audioBuffer: Buffer,
    filename: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    if (!this.openai) {
      throw new AppError("OpenAI API key required for audio transcription", 400, "MISSING_API_KEY");
    }

    logger.info(`Transcribing audio: ${filename} (${(audioBuffer.length / 1024).toFixed(0)}KB)`);

    // Whisper API call
    const transcription = await this.openai.audio.transcriptions.create({
      file: new File([audioBuffer], filename, { type: this.getAudioMimeType(filename) }),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
      language: options.language,
      prompt: options.prompt,
    });

    const whisperData = transcription as unknown as {
      text: string;
      language: string;
      duration: number;
      segments: Array<{
        id: number;
        start: number;
        end: number;
        text: string;
        avg_logprob: number;
      }>;
    };

    const rawSegments: AudioSegment[] = (whisperData.segments ?? []).map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
      confidence: Math.exp(seg.avg_logprob ?? -1),
      language: whisperData.language,
    }));

    const fullText = whisperData.text;
    const detectedLanguage = whisperData.language ?? detectLanguageFromText(fullText);
    const duration = whisperData.duration ?? 0;

    // Speaker diarization
    let segments = rawSegments;
    if (options.detectSpeakers && rawSegments.length > 2) {
      segments = heuristicDiarization(rawSegments, options.maxSpeakers ?? 2);
    }

    // Sentiment analysis
    if (options.analyzeSentiment) {
      segments = segments.map((seg) => ({
        ...seg,
        sentiment: analyzeSentimentSimple(seg.text),
      }));
    }

    const overallSentiment = options.analyzeSentiment
      ? analyzeSentimentSimple(fullText)
      : undefined;

    // Summary
    const summary = options.generateSummary
      ? await generateSummary(fullText, duration)
      : undefined;

    // SRT
    const srtCaptions = options.generateSrt ? generateSrt(segments) : undefined;

    // Keywords
    const keywords = extractKeywords(fullText);

    // Unique speakers
    const speakers = options.detectSpeakers
      ? [...new Set(segments.map((s) => s.speaker).filter(Boolean))] as string[]
      : undefined;

    logger.info(`Transcription complete: ${fullText.split(/\s+/).length} words, ${segments.length} segments`);

    return {
      fullText,
      segments,
      language: detectedLanguage,
      duration,
      model: "whisper-1",
      summary,
      srtCaptions,
      speakers,
      overallSentiment,
      keywords,
      tokensUsed: 0, // Whisper doesn't use tokens
    };
  }

  async transcribeFromUrl(url: string, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    logger.info(`Fetching audio from URL: ${url}`);

    const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new AppError(`Failed to fetch audio: ${resp.status}`, 502, "AUDIO_FETCH_ERROR");

    const buffer = Buffer.from(await resp.arrayBuffer());
    const filename = url.split("/").pop() ?? "audio.mp3";

    return this.transcribe(buffer, filename, options);
  }

  getSegmentsBySpeaker(result: TranscriptionResult): Map<string, AudioSegment[]> {
    const bySpeaker = new Map<string, AudioSegment[]>();
    for (const seg of result.segments) {
      const speaker = seg.speaker ?? "Unknown";
      const existing = bySpeaker.get(speaker) ?? [];
      existing.push(seg);
      bySpeaker.set(speaker, existing);
    }
    return bySpeaker;
  }

  getSpeakerStats(result: TranscriptionResult): Array<{
    speaker: string;
    wordCount: number;
    speakingTime: number;
    percentage: number;
  }> {
    const bySpeaker = this.getSegmentsBySpeaker(result);
    const totalTime = result.duration;

    return [...bySpeaker.entries()].map(([speaker, segs]) => {
      const wordCount = segs.reduce((s, seg) => s + seg.text.split(/\s+/).length, 0);
      const speakingTime = segs.reduce((s, seg) => s + (seg.end - seg.start), 0);
      return {
        speaker,
        wordCount,
        speakingTime,
        percentage: totalTime > 0 ? (speakingTime / totalTime) * 100 : 0,
      };
    });
  }

  private getAudioMimeType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/m4a",
      mp4: "audio/mp4",
      ogg: "audio/ogg",
      flac: "audio/flac",
      webm: "audio/webm",
    };
    return mimeTypes[ext ?? ""] ?? "audio/mpeg";
  }
}

export const audioPipeline = new AudioPipeline();
