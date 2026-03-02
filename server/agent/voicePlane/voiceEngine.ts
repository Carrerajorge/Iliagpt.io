import { EventEmitter } from "events";
import crypto from "crypto";

export type STTProvider = "whisper" | "deepgram" | "google" | "azure";
export type TTSProvider = "openai" | "elevenlabs" | "google" | "azure";

export interface VoiceProfile {
  id: string;
  name: string;
  language: string;
  speed: number;
  pitch: number;
  provider: TTSProvider;
  voiceId: string;
}

export interface STTRequest {
  audioData: Buffer | string;
  language?: string;
  provider?: STTProvider;
  model?: string;
  sessionId?: string;
}

export interface STTResult {
  id: string;
  text: string;
  confidence: number;
  language: string;
  durationMs: number;
  provider: STTProvider;
  timestamp: number;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

export interface TTSRequest {
  text: string;
  profile?: VoiceProfile;
  provider?: TTSProvider;
  voiceId?: string;
  language?: string;
  speed?: number;
  pitch?: number;
  format?: "mp3" | "wav" | "ogg" | "pcm";
  sessionId?: string;
}

export interface TTSResult {
  id: string;
  audioData: Buffer | null;
  audioUrl?: string;
  durationMs: number;
  provider: TTSProvider;
  format: string;
  characterCount: number;
  timestamp: number;
}

export interface VoiceSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  language: string;
  profile: VoiceProfile | null;
  transcriptions: STTResult[];
  syntheses: TTSResult[];
  consentGiven: boolean;
  consentTimestamp: number | null;
  identifiedAsAI: boolean;
  metadata: Record<string, unknown>;
}

export interface VoiceEngineStats {
  totalTranscriptions: number;
  totalSyntheses: number;
  activeSessions: number;
  totalSessions: number;
  avgTranscriptionConfidence: number;
  totalCharactersSynthesized: number;
  providerBreakdown: Record<string, number>;
}

const DEFAULT_PROFILE: VoiceProfile = {
  id: "default",
  name: "Default Voice",
  language: "en-US",
  speed: 1.0,
  pitch: 1.0,
  provider: "openai",
  voiceId: "alloy",
};

export class VoiceEngine extends EventEmitter {
  private sessions: Map<string, VoiceSession> = new Map();
  private profiles: Map<string, VoiceProfile> = new Map([["default", DEFAULT_PROFILE]]);
  private totalTranscriptions = 0;
  private totalSyntheses = 0;
  private totalConfidence = 0;
  private totalCharactersSynthesized = 0;
  private providerUsage: Record<string, number> = {};

  async transcribe(request: STTRequest): Promise<STTResult> {
    const provider = request.provider || "whisper";
    const startTime = Date.now();

    const result: STTResult = {
      id: crypto.randomUUID(),
      text: `[Transcribed audio via ${provider}]`,
      confidence: 0.95,
      language: request.language || "en-US",
      durationMs: Date.now() - startTime,
      provider,
      timestamp: Date.now(),
    };

    this.totalTranscriptions++;
    this.totalConfidence += result.confidence;
    this.providerUsage[provider] = (this.providerUsage[provider] || 0) + 1;

    if (request.sessionId) {
      const session = this.sessions.get(request.sessionId);
      if (session) {
        session.transcriptions.push(result);
        session.updatedAt = Date.now();
      }
    }

    this.emit("transcription", result);
    return result;
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const profile = request.profile || this.profiles.get("default") || DEFAULT_PROFILE;
    const provider = request.provider || profile.provider;
    const startTime = Date.now();

    const result: TTSResult = {
      id: crypto.randomUUID(),
      audioData: null,
      durationMs: Date.now() - startTime,
      provider,
      format: request.format || "mp3",
      characterCount: request.text.length,
      timestamp: Date.now(),
    };

    this.totalSyntheses++;
    this.totalCharactersSynthesized += request.text.length;
    this.providerUsage[provider] = (this.providerUsage[provider] || 0) + 1;

    if (request.sessionId) {
      const session = this.sessions.get(request.sessionId);
      if (session) {
        session.syntheses.push(result);
        session.updatedAt = Date.now();
      }
    }

    this.emit("synthesis", result);
    return result;
  }

  createSession(options: {
    language?: string;
    profile?: VoiceProfile;
    metadata?: Record<string, unknown>;
  } = {}): VoiceSession {
    const session: VoiceSession = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      language: options.language || "en-US",
      profile: options.profile || null,
      transcriptions: [],
      syntheses: [],
      consentGiven: false,
      consentTimestamp: null,
      identifiedAsAI: false,
      metadata: options.metadata || {},
    };

    this.sessions.set(session.id, session);
    this.emit("sessionCreated", session);
    return session;
  }

  recordConsent(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.consentGiven = true;
    session.consentTimestamp = Date.now();
    session.updatedAt = Date.now();

    this.emit("consentRecorded", { sessionId, timestamp: session.consentTimestamp });
    return true;
  }

  markIdentifiedAsAI(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.identifiedAsAI = true;
    session.updatedAt = Date.now();

    this.emit("aiIdentified", { sessionId });
    return true;
  }

  getSession(sessionId: string): VoiceSession | null {
    return this.sessions.get(sessionId) || null;
  }

  getAllSessions(): VoiceSession[] {
    return Array.from(this.sessions.values());
  }

  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.updatedAt = Date.now();
    this.emit("sessionEnded", session);
    return true;
  }

  registerProfile(profile: VoiceProfile): void {
    this.profiles.set(profile.id, profile);
    this.emit("profileRegistered", profile);
  }

  getProfile(profileId: string): VoiceProfile | null {
    return this.profiles.get(profileId) || null;
  }

  getAllProfiles(): VoiceProfile[] {
    return Array.from(this.profiles.values());
  }

  getStats(): VoiceEngineStats {
    return {
      totalTranscriptions: this.totalTranscriptions,
      totalSyntheses: this.totalSyntheses,
      activeSessions: this.sessions.size,
      totalSessions: this.sessions.size,
      avgTranscriptionConfidence: this.totalTranscriptions > 0
        ? this.totalConfidence / this.totalTranscriptions
        : 0,
      totalCharactersSynthesized: this.totalCharactersSynthesized,
      providerBreakdown: { ...this.providerUsage },
    };
  }

  getTranscript(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return "";

    return session.transcriptions
      .map(t => `[${new Date(t.timestamp).toISOString()}] ${t.text}`)
      .join("\n");
  }
}

export const voiceEngine = new VoiceEngine();
