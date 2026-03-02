import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Phone, PhoneOff, PhoneIncoming, Mic, Volume2, Shield, Activity, AlertTriangle, ShieldAlert, Eye } from "lucide-react";

interface CallSession {
  id: string;
  state: string;
  protocol: string;
  callerNumber?: string;
  calleeNumber?: string;
  direction: string;
  createdAt: number;
  consentGiven: boolean;
  aiDisclosed: boolean;
}

interface GuardrailEvent {
  id: string;
  type: string;
  sessionId: string;
  timestamp: number;
  details: Record<string, unknown>;
}

interface VoiceStats {
  engine: {
    totalTranscriptions: number;
    totalSyntheses: number;
    activeSessions: number;
    avgConfidence: number;
    totalCharactersSynthesized: number;
  };
  calls: {
    totalCalls: number;
    activeCalls: number;
    completedCalls: number;
    avgDurationMs: number;
    consentRate: number;
  };
  guardrails?: {
    totalChecks: number;
    blockedAttempts: number;
    piiDetections: number;
    consentViolations: number;
    impersonationAttempts: number;
    contentViolations: number;
  };
  guardrailEvents?: GuardrailEvent[];
}

const stateColors: Record<string, string> = {
  idle: "bg-gray-500/20 text-gray-400",
  ringing: "bg-yellow-500/20 text-yellow-400",
  active: "bg-green-500/20 text-green-400",
  hold: "bg-blue-500/20 text-blue-400",
  ended: "bg-muted text-muted-foreground",
};

const stateIcons: Record<string, typeof Phone> = {
  idle: Phone,
  ringing: PhoneIncoming,
  active: Phone,
  hold: Phone,
  ended: PhoneOff,
};

const guardrailEventColors: Record<string, string> = {
  impersonation_blocked: "bg-red-500/20 text-red-400",
  consent_missing: "bg-yellow-500/20 text-yellow-400",
  content_unsafe: "bg-red-500/20 text-red-400",
  pii_detected: "bg-orange-500/20 text-orange-400",
  pii_redacted: "bg-blue-500/20 text-blue-400",
};

export default function VoicePlane() {
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["/api/voice/sessions"],
    refetchInterval: 10000,
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/voice/stats"],
    refetchInterval: 10000,
  });

  const sessions: CallSession[] = (sessionsData as any)?.sessions || [];
  const stats: VoiceStats = (statsData as any) || {
    engine: { totalTranscriptions: 0, totalSyntheses: 0, activeSessions: 0, avgConfidence: 0, totalCharactersSynthesized: 0 },
    calls: { totalCalls: 0, activeCalls: 0, completedCalls: 0, avgDurationMs: 0, consentRate: 0 },
    guardrails: { totalChecks: 0, blockedAttempts: 0, piiDetections: 0, consentViolations: 0, impersonationAttempts: 0, contentViolations: 0 },
    guardrailEvents: [],
  };

  const guardrails = stats.guardrails || { totalChecks: 0, blockedAttempts: 0, piiDetections: 0, consentViolations: 0, impersonationAttempts: 0, contentViolations: 0 };
  const guardrailEvents = stats.guardrailEvents || [];

  if (sessionsLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center p-12" data-testid="voice-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="voice-plane-dashboard">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Phone className="h-6 w-6" />
          Voice Plane
        </h2>
        <p className="text-muted-foreground text-sm mt-1">STT/TTS engine, call sessions, and voice guardrails</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Transcriptions</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-transcriptions">{stats.engine.totalTranscriptions}</div>
            <div className="text-xs text-muted-foreground">Confidence: {(stats.engine.avgConfidence * 100).toFixed(0)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Volume2 className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Syntheses</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-syntheses">{stats.engine.totalSyntheses}</div>
            <div className="text-xs text-muted-foreground">{stats.engine.totalCharactersSynthesized.toLocaleString()} chars</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Total Calls</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-calls">{stats.calls.totalCalls}</div>
            <div className="text-xs text-muted-foreground">{stats.calls.activeCalls} active</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 text-yellow-400" />
              <span className="text-xs text-muted-foreground">Consent Rate</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-consent">{(stats.calls.consentRate * 100).toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">AI disclosed in all calls</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Voice Guardrails
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="p-3 rounded-lg border">
              <div className="flex items-center gap-2 mb-1">
                <Eye className="h-3 w-3 text-blue-400" />
                <span className="text-[10px] text-muted-foreground uppercase">Total Checks</span>
              </div>
              <div className="text-lg font-bold" data-testid="stat-guardrail-checks">{guardrails.totalChecks}</div>
            </div>
            <div className="p-3 rounded-lg border">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-3 w-3 text-red-400" />
                <span className="text-[10px] text-muted-foreground uppercase">Blocked</span>
              </div>
              <div className="text-lg font-bold text-red-400" data-testid="stat-guardrail-blocked">{guardrails.blockedAttempts}</div>
              <div className="text-[10px] text-muted-foreground">
                {guardrails.impersonationAttempts} impersonation · {guardrails.contentViolations} content
              </div>
            </div>
            <div className="p-3 rounded-lg border">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-3 w-3 text-orange-400" />
                <span className="text-[10px] text-muted-foreground uppercase">PII / Consent</span>
              </div>
              <div className="text-lg font-bold text-orange-400" data-testid="stat-guardrail-pii">{guardrails.piiDetections}</div>
              <div className="text-[10px] text-muted-foreground">
                {guardrails.consentViolations} consent violations
              </div>
            </div>
          </div>

          {guardrailEvents.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground mb-2">Recent Guardrail Events</div>
              {guardrailEvents.slice(0, 10).map((event) => (
                <div key={event.id} className="flex items-center justify-between p-2 rounded border" data-testid={`guardrail-event-${event.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge className={guardrailEventColors[event.type] || "bg-muted text-muted-foreground"}>
                      {event.type.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">{event.sessionId.slice(0, 8)}...</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{new Date(event.timestamp).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {guardrailEvents.length === 0 && (
            <div className="text-center py-4 text-muted-foreground text-xs">
              No guardrail events recorded yet
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Call Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Phone className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No voice sessions yet</p>
              <p className="text-xs mt-1">Voice sessions will appear here when calls are initiated</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => {
                const StateIcon = stateIcons[session.state] || Phone;
                return (
                  <div key={session.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`voice-session-${session.id}`}>
                    <div className="flex items-center gap-3">
                      <StateIcon className="h-4 w-4" />
                      <div>
                        <div className="text-sm font-medium">{session.id}</div>
                        <div className="text-xs text-muted-foreground">
                          {session.direction} · {session.protocol}
                          {session.calleeNumber && ` · ${session.calleeNumber}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {session.consentGiven && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 bg-green-500/10 text-green-400">Consent</Badge>
                      )}
                      {session.aiDisclosed && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 bg-blue-500/10 text-blue-400">AI Disclosed</Badge>
                      )}
                      <Badge className={stateColors[session.state] || stateColors.idle}>{session.state}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
