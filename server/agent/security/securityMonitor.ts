import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { promptInjectionDetector, type InjectionDetectionResult, type ThreatSeverity } from "./promptInjectionDetector";
import { outputSanitizer, type OutputSanitizationResult } from "./outputSanitizer";

export type SecurityEventType =
  | "injection_detected"
  | "injection_blocked"
  | "output_sanitized"
  | "threat_escalation"
  | "emergency_stop_triggered"
  | "anomaly_detected";

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  severity: ThreatSeverity;
  source: string;
  message: string;
  details: Record<string, any>;
  timestamp: number;
  acknowledged: boolean;
}

export interface ThreatScore {
  overall: number;
  injectionRisk: number;
  outputLeakRisk: number;
  anomalyRisk: number;
  trend: "increasing" | "stable" | "decreasing";
  lastUpdated: number;
}

export interface SecurityAlert {
  id: string;
  eventId: string;
  severity: ThreatSeverity;
  title: string;
  message: string;
  actionRequired: boolean;
  autoEscalate: boolean;
  timestamp: number;
  resolved: boolean;
}

export class SecurityMonitor extends EventEmitter {
  private events: SecurityEvent[] = [];
  private alerts: SecurityAlert[] = [];
  private readonly maxEvents = 5000;
  private readonly maxAlerts = 1000;
  private threatScore: ThreatScore = {
    overall: 0,
    injectionRisk: 0,
    outputLeakRisk: 0,
    anomalyRisk: 0,
    trend: "stable",
    lastUpdated: Date.now(),
  };
  private recentScores: number[] = [];
  private emergencyStopCallback: (() => void) | null = null;
  private emergencyStopThreshold = 0.9;

  constructor() {
    super();
    this.setupListeners();
  }

  setEmergencyStopCallback(callback: () => void): void {
    this.emergencyStopCallback = callback;
  }

  setEmergencyStopThreshold(threshold: number): void {
    this.emergencyStopThreshold = Math.max(0, Math.min(1, threshold));
  }

  private setupListeners(): void {
    promptInjectionDetector.on("injection_detected", (result: InjectionDetectionResult) => {
      this.recordInjectionEvent(result);
    });

    promptInjectionDetector.on("injection_blocked", (result: InjectionDetectionResult) => {
      this.recordInjectionBlocked(result);
    });

    outputSanitizer.on("output_sanitized", (result: OutputSanitizationResult) => {
      this.recordOutputSanitization(result);
    });
  }

  private recordInjectionEvent(result: InjectionDetectionResult): void {
    const event: SecurityEvent = {
      id: randomUUID(),
      type: "injection_detected",
      severity: result.severity || "medium",
      source: result.source,
      message: `Prompt injection detected (${result.injectionType}) from ${result.source} — score: ${result.score}`,
      details: {
        injectionType: result.injectionType,
        score: result.score,
        matchedPatterns: result.matchedPatterns,
        inputPreview: result.input.substring(0, 200),
      },
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.addEvent(event);
    this.updateThreatScore();

    if (result.severity === "critical" || result.severity === "high") {
      this.createAlert(event, `Injection attempt: ${result.injectionType}`, result.severity === "critical");
    }
  }

  private recordInjectionBlocked(result: InjectionDetectionResult): void {
    const event: SecurityEvent = {
      id: randomUUID(),
      type: "injection_blocked",
      severity: result.severity || "high",
      source: result.source,
      message: `Prompt injection BLOCKED (${result.injectionType}) from ${result.source} — score: ${result.score}`,
      details: {
        injectionType: result.injectionType,
        score: result.score,
        matchedPatterns: result.matchedPatterns,
      },
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.addEvent(event);
    this.updateThreatScore();
  }

  private recordOutputSanitization(result: OutputSanitizationResult): void {
    const hasCritical = result.events.some(e => e.category === "secret_detected" || e.category === "system_prompt_leak");
    const severity: ThreatSeverity = hasCritical ? "high" : "medium";

    const event: SecurityEvent = {
      id: randomUUID(),
      type: "output_sanitized",
      severity,
      source: "output",
      message: `Output sanitized: ${result.totalRedactions} redaction(s) applied`,
      details: {
        totalRedactions: result.totalRedactions,
        categories: result.events.map(e => e.category),
        confidenceScore: result.confidenceScore,
      },
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.addEvent(event);
    this.updateThreatScore();

    if (hasCritical) {
      this.createAlert(event, "Critical content detected in output", true);
    }
  }

  recordAnomaly(source: string, message: string, details: Record<string, any> = {}): void {
    const event: SecurityEvent = {
      id: randomUUID(),
      type: "anomaly_detected",
      severity: "medium",
      source,
      message,
      details,
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.addEvent(event);
    this.updateThreatScore();
  }

  private createAlert(event: SecurityEvent, title: string, autoEscalate: boolean): void {
    const alert: SecurityAlert = {
      id: randomUUID(),
      eventId: event.id,
      severity: event.severity,
      title,
      message: event.message,
      actionRequired: event.severity === "critical",
      autoEscalate,
      timestamp: Date.now(),
      resolved: false,
    };

    this.alerts.push(alert);
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(-this.maxAlerts);
    }

    this.emit("security_alert", alert);

    if (autoEscalate && this.threatScore.overall >= this.emergencyStopThreshold) {
      this.triggerEmergencyStop(alert);
    }
  }

  private triggerEmergencyStop(triggerAlert: SecurityAlert): void {
    const event: SecurityEvent = {
      id: randomUUID(),
      type: "emergency_stop_triggered",
      severity: "critical",
      source: "security_monitor",
      message: `Emergency stop triggered — threat score: ${this.threatScore.overall}`,
      details: {
        triggerAlertId: triggerAlert.id,
        threatScore: { ...this.threatScore },
      },
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.addEvent(event);
    this.emit("emergency_stop", { event, alert: triggerAlert, threatScore: this.threatScore });

    if (this.emergencyStopCallback) {
      this.emergencyStopCallback();
    }
  }

  private updateThreatScore(): void {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000;
    const recentEvents = this.events.filter(e => now - e.timestamp < windowMs);

    const severityWeight: Record<ThreatSeverity, number> = { low: 0.1, medium: 0.3, high: 0.6, critical: 1.0 };

    let injectionScore = 0;
    let outputScore = 0;
    let anomalyScore = 0;

    for (const event of recentEvents) {
      const weight = severityWeight[event.severity];
      if (event.type === "injection_detected" || event.type === "injection_blocked") {
        injectionScore += weight;
      } else if (event.type === "output_sanitized") {
        outputScore += weight;
      } else if (event.type === "anomaly_detected") {
        anomalyScore += weight;
      }
    }

    injectionScore = Math.min(injectionScore / 5, 1);
    outputScore = Math.min(outputScore / 5, 1);
    anomalyScore = Math.min(anomalyScore / 5, 1);

    const overall = Math.min(injectionScore * 0.5 + outputScore * 0.3 + anomalyScore * 0.2, 1);
    const previousOverall = this.threatScore.overall;

    this.recentScores.push(overall);
    if (this.recentScores.length > 10) {
      this.recentScores = this.recentScores.slice(-10);
    }

    let trend: "increasing" | "stable" | "decreasing" = "stable";
    if (this.recentScores.length >= 3) {
      const recent = this.recentScores.slice(-3);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      if (avg > previousOverall + 0.05) trend = "increasing";
      else if (avg < previousOverall - 0.05) trend = "decreasing";
    }

    this.threatScore = {
      overall: Math.round(overall * 100) / 100,
      injectionRisk: Math.round(injectionScore * 100) / 100,
      outputLeakRisk: Math.round(outputScore * 100) / 100,
      anomalyRisk: Math.round(anomalyScore * 100) / 100,
      trend,
      lastUpdated: now,
    };

    this.emit("threat_score_updated", this.threatScore);
  }

  getEvents(limit = 100, severity?: ThreatSeverity): SecurityEvent[] {
    let filtered = this.events;
    if (severity) {
      filtered = filtered.filter(e => e.severity === severity);
    }
    return filtered.slice(-limit);
  }

  getAlerts(unresolvedOnly = false): SecurityAlert[] {
    if (unresolvedOnly) {
      return this.alerts.filter(a => !a.resolved);
    }
    return [...this.alerts];
  }

  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      this.emit("alert_resolved", alert);
      return true;
    }
    return false;
  }

  acknowledgeEvent(eventId: string): boolean {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.acknowledged = true;
      return true;
    }
    return false;
  }

  getThreatScore(): ThreatScore {
    return { ...this.threatScore };
  }

  getSecuritySummary(): {
    threatScore: ThreatScore;
    recentEvents: number;
    unresolvedAlerts: number;
    injectionStats: ReturnType<typeof promptInjectionDetector.getStats>;
    sanitizationStats: ReturnType<typeof outputSanitizer.getStats>;
  } {
    return {
      threatScore: this.getThreatScore(),
      recentEvents: this.events.filter(e => Date.now() - e.timestamp < 3600000).length,
      unresolvedAlerts: this.alerts.filter(a => !a.resolved).length,
      injectionStats: promptInjectionDetector.getStats(),
      sanitizationStats: outputSanitizer.getStats(),
    };
  }

  clearEvents(): void {
    this.events = [];
    this.alerts = [];
    this.recentScores = [];
    this.threatScore = {
      overall: 0,
      injectionRisk: 0,
      outputLeakRisk: 0,
      anomalyRisk: 0,
      trend: "stable",
      lastUpdated: Date.now(),
    };
  }

  private addEvent(event: SecurityEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    this.emit("security_event", event);
  }
}

export const securityMonitor = new SecurityMonitor();
