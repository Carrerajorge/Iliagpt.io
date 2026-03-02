import { EventEmitter } from "events";
import crypto from "crypto";
import { voiceEngine, type VoiceProfile, type STTResult, type TTSResult } from "./voiceEngine";
import { voiceGuardrails } from "./voiceGuardrails";

export type CallState = "idle" | "ringing" | "active" | "hold" | "ended";
export type CallProtocol = "PSTN" | "SIP" | "WebRTC" | "internal";

export interface ScriptStep {
  id: string;
  type: "speak" | "listen" | "confirm" | "transfer" | "pause";
  content?: string;
  timeoutMs?: number;
  confirmationRequired?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CallSession {
  id: string;
  state: CallState;
  protocol: CallProtocol;
  voiceSessionId: string;
  callerNumber?: string;
  calleeNumber?: string;
  direction: "inbound" | "outbound";
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  holdStartedAt: number | null;
  totalHoldDurationMs: number;
  consentVerified: boolean;
  consentTimestamp: number | null;
  identifiedAsAI: boolean;
  profile: VoiceProfile | null;
  script: ScriptStep[];
  currentStepIndex: number;
  transcription: Array<{
    timestamp: number;
    speaker: "agent" | "caller";
    text: string;
    sttResult?: STTResult;
    ttsResult?: TTSResult;
  }>;
  governanceMode: string;
  killSwitchActive: boolean;
  metadata: Record<string, unknown>;
}

export interface CallSessionStats {
  totalCalls: number;
  activeCalls: number;
  completedCalls: number;
  avgDurationMs: number;
  consentRate: number;
  protocolBreakdown: Record<string, number>;
  stateBreakdown: Record<string, number>;
}

const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  idle: ["ringing", "ended"],
  ringing: ["active", "ended"],
  active: ["hold", "ended"],
  hold: ["active", "ended"],
  ended: [],
};

export class CallSessionManager extends EventEmitter {
  private sessions: Map<string, CallSession> = new Map();
  private completedCount = 0;
  private totalDurationMs = 0;
  private totalWithConsent = 0;

  create(options: {
    protocol?: CallProtocol;
    callerNumber?: string;
    calleeNumber?: string;
    direction?: "inbound" | "outbound";
    profile?: VoiceProfile;
    script?: ScriptStep[];
    governanceMode?: string;
    metadata?: Record<string, unknown>;
  } = {}): CallSession {
    const voiceSession = voiceEngine.createSession({
      profile: options.profile,
    });

    const session: CallSession = {
      id: crypto.randomUUID(),
      state: "idle",
      protocol: options.protocol || "internal",
      voiceSessionId: voiceSession.id,
      callerNumber: options.callerNumber,
      calleeNumber: options.calleeNumber,
      direction: options.direction || "outbound",
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      holdStartedAt: null,
      totalHoldDurationMs: 0,
      consentVerified: false,
      consentTimestamp: null,
      identifiedAsAI: false,
      profile: options.profile || null,
      script: options.script || [],
      currentStepIndex: 0,
      transcription: [],
      governanceMode: options.governanceMode || "SUPERVISED",
      killSwitchActive: false,
      metadata: options.metadata || {},
    };

    this.sessions.set(session.id, session);
    this.emit("callCreated", session);
    return session;
  }

  private transition(sessionId: string, newState: CallState): CallSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Call session ${sessionId} not found`);

    if (!VALID_TRANSITIONS[session.state].includes(newState)) {
      throw new Error(`Invalid call state transition: ${session.state} → ${newState}`);
    }

    const oldState = session.state;
    session.state = newState;

    this.emit("stateChanged", { sessionId, from: oldState, to: newState, timestamp: Date.now() });
    return session;
  }

  start(sessionId: string): CallSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Call session ${sessionId} not found`);

    if (session.state === "idle") {
      this.transition(sessionId, "ringing");
    }

    this.transition(sessionId, "active");
    session.startedAt = Date.now();

    this.emit("callStarted", session);
    return session;
  }

  hold(sessionId: string): CallSession {
    const session = this.transition(sessionId, "hold");
    session.holdStartedAt = Date.now();

    this.emit("callHeld", session);
    return session;
  }

  resume(sessionId: string): CallSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Call session ${sessionId} not found`);

    if (session.holdStartedAt) {
      session.totalHoldDurationMs += Date.now() - session.holdStartedAt;
      session.holdStartedAt = null;
    }

    this.transition(sessionId, "active");
    this.emit("callResumed", session);
    return session;
  }

  end(sessionId: string): CallSession {
    const session = this.transition(sessionId, "ended");
    session.endedAt = Date.now();

    if (session.holdStartedAt) {
      session.totalHoldDurationMs += Date.now() - session.holdStartedAt;
      session.holdStartedAt = null;
    }

    if (session.startedAt) {
      this.totalDurationMs += session.endedAt - session.startedAt;
    }

    this.completedCount++;
    if (session.consentVerified) {
      this.totalWithConsent++;
    }

    this.emit("callEnded", session);
    return session;
  }

  verifyConsent(sessionId: string): CallSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Call session ${sessionId} not found`);

    session.consentVerified = true;
    session.consentTimestamp = Date.now();

    voiceEngine.recordConsent(session.voiceSessionId);

    this.emit("consentVerified", { sessionId, timestamp: session.consentTimestamp });
    return session;
  }

  identifyAsAI(sessionId: string): CallSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Call session ${sessionId} not found`);

    session.identifiedAsAI = true;

    voiceEngine.markIdentifiedAsAI(session.voiceSessionId);

    session.transcription.push({
      timestamp: Date.now(),
      speaker: "agent",
      text: "I want to let you know that I am an AI assistant.",
    });

    this.emit("aiIdentified", { sessionId });
    return session;
  }

  async executeScriptStep(sessionId: string): Promise<ScriptStep | null> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Call session ${sessionId} not found`);

    if (session.killSwitchActive) {
      throw new Error("Call terminated by kill switch");
    }

    if (session.state !== "active") {
      throw new Error(`Cannot execute script step in ${session.state} state`);
    }

    if (session.currentStepIndex >= session.script.length) {
      return null;
    }

    const step = session.script[session.currentStepIndex];

    if (step.content) {
      const validation = voiceGuardrails.validateScriptContent(step.content);
      if (!validation.safe) {
        this.emit("scriptBlocked", { sessionId, step, reasons: validation.issues });
        throw new Error(`Script step blocked: ${validation.issues.join(", ")}`);
      }
    }

    if (step.type === "speak" && step.content) {
      const ttsResult = await voiceEngine.synthesize({
        text: step.content,
        profile: session.profile || undefined,
        sessionId: session.voiceSessionId,
      });

      session.transcription.push({
        timestamp: Date.now(),
        speaker: "agent",
        text: step.content,
        ttsResult,
      });
    }

    session.currentStepIndex++;
    this.emit("scriptStepExecuted", { sessionId, step, stepIndex: session.currentStepIndex - 1 });
    return step;
  }

  addTranscriptionEntry(sessionId: string, speaker: "agent" | "caller", text: string, sttResult?: STTResult): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Call session ${sessionId} not found`);

    const redacted = voiceGuardrails.redactPII(text);

    session.transcription.push({
      timestamp: Date.now(),
      speaker,
      text: redacted,
      sttResult,
    });

    this.emit("transcriptionAdded", { sessionId, speaker, text: redacted });
  }

  activateKillSwitch(sessionId: string): CallSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Call session ${sessionId} not found`);

    session.killSwitchActive = true;

    if (session.state !== "ended") {
      return this.end(sessionId);
    }

    this.emit("killSwitchActivated", { sessionId });
    return session;
  }

  getSession(sessionId: string): CallSession | null {
    return this.sessions.get(sessionId) || null;
  }

  getAllSessions(): CallSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): CallSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.state === "active" || s.state === "ringing" || s.state === "hold"
    );
  }

  getTranscript(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return "";

    return session.transcription
      .map(t => `[${new Date(t.timestamp).toISOString()}] [${t.speaker}] ${t.text}`)
      .join("\n");
  }

  getStats(): CallSessionStats {
    const all = Array.from(this.sessions.values());
    const stateBreakdown: Record<string, number> = {};
    const protocolBreakdown: Record<string, number> = {};

    for (const s of all) {
      stateBreakdown[s.state] = (stateBreakdown[s.state] || 0) + 1;
      protocolBreakdown[s.protocol] = (protocolBreakdown[s.protocol] || 0) + 1;
    }

    return {
      totalCalls: all.length,
      activeCalls: all.filter(s => s.state === "active" || s.state === "ringing" || s.state === "hold").length,
      completedCalls: this.completedCount,
      avgDurationMs: this.completedCount > 0 ? this.totalDurationMs / this.completedCount : 0,
      consentRate: this.completedCount > 0 ? this.totalWithConsent / this.completedCount : 0,
      protocolBreakdown,
      stateBreakdown,
    };
  }
}

export const callSessionManager = new CallSessionManager();
