/**
 * Security Monitoring & Threat Detection
 * Real-time security event monitoring
 */

import { EventEmitter } from "events";
import { db } from "../db";
import { sql } from "drizzle-orm";

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  severity: "low" | "medium" | "high" | "critical";
  source: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  details: Record<string, any>;
  timestamp: Date;
  handled: boolean;
}

export type SecurityEventType =
  | "brute_force_attempt"
  | "suspicious_login"
  | "privilege_escalation"
  | "data_exfiltration"
  | "sql_injection_attempt"
  | "xss_attempt"
  | "rate_limit_exceeded"
  | "invalid_token"
  | "unusual_activity"
  | "geographic_anomaly"
  | "session_hijack"
  | "api_abuse";

const SEVERITY_SCORES: Record<SecurityEventType, "low" | "medium" | "high" | "critical"> = {
  brute_force_attempt: "high",
  suspicious_login: "medium",
  privilege_escalation: "critical",
  data_exfiltration: "critical",
  sql_injection_attempt: "critical",
  xss_attempt: "high",
  rate_limit_exceeded: "low",
  invalid_token: "low",
  unusual_activity: "medium",
  geographic_anomaly: "medium",
  session_hijack: "critical",
  api_abuse: "high"
};

class SecurityMonitor extends EventEmitter {
  private events: SecurityEvent[] = [];
  private readonly MAX_EVENTS = 1000;
  private suspiciousIPs: Map<string, number> = new Map();
  private userActivityPatterns: Map<string, number[]> = new Map();

  constructor() {
    super();
    this.setMaxListeners(50);
    
    // Cleanup old data every hour
    setInterval(() => this.cleanup(), 3600000);
  }

  /**
   * Log a security event
   */
  async logEvent(
    type: SecurityEventType,
    source: string,
    details: Record<string, any>,
    userId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<SecurityEvent> {
    const event: SecurityEvent = {
      id: `sec_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      type,
      severity: SEVERITY_SCORES[type],
      source,
      userId,
      ipAddress,
      userAgent,
      details,
      timestamp: new Date(),
      handled: false
    };

    this.events.unshift(event);
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(0, this.MAX_EVENTS);
    }

    // Persist to database
    try {
      await db.execute(sql`
        INSERT INTO security_events (id, type, severity, source, user_id, ip_address, user_agent, details, handled)
        VALUES (${event.id}, ${event.type}, ${event.severity}, ${event.source}, 
                ${event.userId || null}, ${event.ipAddress || null}, ${event.userAgent || null}, 
                ${JSON.stringify(event.details)}, false)
      `);
    } catch (e) {
      console.error("[SecurityMonitor] Failed to persist event:", e);
    }

    // Track suspicious IPs
    if (ipAddress && event.severity !== "low") {
      const count = (this.suspiciousIPs.get(ipAddress) || 0) + 1;
      this.suspiciousIPs.set(ipAddress, count);
      
      if (count >= 5) {
        this.emit("block_ip", ipAddress);
      }
    }

    // Emit for real-time handling
    this.emit("event", event);
    
    if (event.severity === "critical") {
      this.emit("critical_alert", event);
    }

    return event;
  }

  /**
   * Detect brute force attempts
   */
  async detectBruteForce(email: string, ip: string): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM login_attempts
      WHERE (email = ${email} OR ip_address = ${ip})
      AND success = false
      AND created_at > NOW() - INTERVAL '15 minutes'
    `);

    const count = parseInt(result.rows?.[0]?.count || "0");
    
    if (count >= 5) {
      await this.logEvent(
        "brute_force_attempt",
        "login",
        { email, failedAttempts: count },
        undefined,
        ip
      );
      return true;
    }
    
    return false;
  }

  /**
   * Detect suspicious login patterns
   */
  async detectSuspiciousLogin(
    userId: string,
    ip: string,
    userAgent: string,
    country?: string
  ): Promise<boolean> {
    // Check for login from new location
    const recentLogins = await db.execute(sql`
      SELECT DISTINCT ip_address, details->>'country' as country
      FROM login_attempts
      WHERE user_id = ${userId} AND success = true
      AND created_at > NOW() - INTERVAL '30 days'
    `);

    const knownIPs = new Set(recentLogins.rows?.map((r: any) => r.ip_address) || []);
    const knownCountries = new Set(recentLogins.rows?.map((r: any) => r.country).filter(Boolean) || []);

    let isSuspicious = false;

    // New IP
    if (knownIPs.size > 0 && !knownIPs.has(ip)) {
      // New country is more suspicious
      if (country && knownCountries.size > 0 && !knownCountries.has(country)) {
        await this.logEvent(
          "geographic_anomaly",
          "login",
          { newCountry: country, knownCountries: Array.from(knownCountries) },
          userId,
          ip,
          userAgent
        );
        isSuspicious = true;
      }
    }

    return isSuspicious;
  }

  /**
   * Detect SQL injection attempts
   */
  detectSQLInjection(input: string): boolean {
    const patterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|UNION)\b)/i,
      /['";].*(\b(OR|AND)\b).*['";\d]/i,
      /--\s*$/,
      /\/\*.*\*\//,
      /\bEXEC\b/i,
      /\bXP_/i
    ];

    return patterns.some(pattern => pattern.test(input));
  }

  /**
   * Detect XSS attempts
   */
  detectXSS(input: string): boolean {
    const patterns = [
      /<script\b[^>]*>/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /expression\s*\(/i
    ];

    return patterns.some(pattern => pattern.test(input));
  }

  /**
   * Log input validation failure
   */
  async logInputThreat(
    type: "sql_injection_attempt" | "xss_attempt",
    input: string,
    endpoint: string,
    userId?: string,
    ip?: string
  ): Promise<void> {
    await this.logEvent(
      type,
      endpoint,
      { input: input.substring(0, 200) },
      userId,
      ip
    );
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit = 50, severity?: string): SecurityEvent[] {
    let filtered = this.events;
    if (severity) {
      filtered = filtered.filter(e => e.severity === severity);
    }
    return filtered.slice(0, limit);
  }

  /**
   * Get threat statistics
   */
  async getStats(): Promise<{
    total24h: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    topIPs: Array<{ ip: string; count: number }>;
    blockedIPs: number;
  }> {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    const recent = this.events.filter(e => e.timestamp.getTime() > twentyFourHoursAgo);

    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const ipCounts: Record<string, number> = {};

    recent.forEach(e => {
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.ipAddress) {
        ipCounts[e.ipAddress] = (ipCounts[e.ipAddress] || 0) + 1;
      }
    });

    const topIPs = Object.entries(ipCounts)
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total24h: recent.length,
      bySeverity,
      byType,
      topIPs,
      blockedIPs: this.suspiciousIPs.size
    };
  }

  /**
   * Mark event as handled
   */
  markHandled(eventId: string): boolean {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.handled = true;
      return true;
    }
    return false;
  }

  /**
   * Check if IP should be blocked
   */
  shouldBlockIP(ip: string): boolean {
    return (this.suspiciousIPs.get(ip) || 0) >= 5;
  }

  /**
   * Cleanup old data
   */
  private cleanup(): void {
    const oneHourAgo = Date.now() - 3600000;
    this.events = this.events.filter(e => e.timestamp.getTime() > oneHourAgo);
    
    // Reset IP scores gradually
    for (const [ip, count] of this.suspiciousIPs) {
      if (count <= 1) {
        this.suspiciousIPs.delete(ip);
      } else {
        this.suspiciousIPs.set(ip, count - 1);
      }
    }
  }
}

// Ensure table exists
(async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS security_events (
        id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        source VARCHAR(255),
        user_id VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        details JSONB,
        handled BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip_address)`);
  } catch (e) {
    // Table might exist
  }
})();

export const securityMonitor = new SecurityMonitor();
