/**
 * Security Alerts Service
 * Real-time security monitoring and alerting
 */

import { storage } from "../storage";
import { EventEmitter } from "events";

export interface SecurityAlert {
  id: string;
  type: "login_failed" | "rate_limit" | "ip_blocked" | "suspicious_activity" | "unauthorized_access";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  details: Record<string, any>;
  timestamp: Date;
  resolved: boolean;
}

class SecurityAlertsService extends EventEmitter {
  private alerts: SecurityAlert[] = [];
  private alertThresholds = {
    loginFailuresPerHour: 5,
    rateLimitHitsPerMinute: 100,
    suspiciousActionsPerHour: 10
  };

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Create a new security alert
   */
  async createAlert(
    type: SecurityAlert["type"],
    severity: SecurityAlert["severity"],
    message: string,
    details: Record<string, any> = {}
  ): Promise<SecurityAlert> {
    const alert: SecurityAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      type,
      severity,
      message,
      details,
      timestamp: new Date(),
      resolved: false
    };

    this.alerts.unshift(alert);
    
    // Keep only last 1000 alerts in memory
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(0, 1000);
    }

    // Emit event for real-time updates
    this.emit("alert", alert);

    // Log to audit
    try {
      await storage.createAuditLog({
        action: `security_alert.${type}`,
        resource: "security",
        details: {
          alertId: alert.id,
          severity,
          message,
          ...details
        }
      });
    } catch (error) {
      console.error("[SecurityAlerts] Failed to log alert:", error);
    }

    return alert;
  }

  /**
   * Get recent alerts
   */
  getAlerts(limit = 50, unresolvedOnly = false): SecurityAlert[] {
    let filtered = this.alerts;
    if (unresolvedOnly) {
      filtered = filtered.filter(a => !a.resolved);
    }
    return filtered.slice(0, limit);
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: SecurityAlert["severity"]): SecurityAlert[] {
    return this.alerts.filter(a => a.severity === severity);
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      this.emit("alertResolved", alert);
      return true;
    }
    return false;
  }

  /**
   * Track failed login attempt
   */
  async trackLoginFailure(email: string, ip: string): Promise<void> {
    const recentFailures = this.alerts.filter(a => 
      a.type === "login_failed" &&
      a.details.email === email &&
      Date.now() - a.timestamp.getTime() < 3600000 // Last hour
    );

    if (recentFailures.length >= this.alertThresholds.loginFailuresPerHour) {
      await this.createAlert(
        "suspicious_activity",
        "high",
        `Multiple failed login attempts for ${email}`,
        { email, ip, failureCount: recentFailures.length + 1 }
      );
    } else {
      await this.createAlert(
        "login_failed",
        "low",
        `Failed login attempt for ${email}`,
        { email, ip }
      );
    }
  }

  /**
   * Track rate limit hit
   */
  async trackRateLimit(ip: string, endpoint: string): Promise<void> {
    await this.createAlert(
      "rate_limit",
      "medium",
      `Rate limit exceeded for IP ${ip}`,
      { ip, endpoint }
    );
  }

  /**
   * Track unauthorized access attempt
   */
  async trackUnauthorizedAccess(userId: string | null, resource: string, action: string): Promise<void> {
    await this.createAlert(
      "unauthorized_access",
      "high",
      `Unauthorized access attempt to ${resource}`,
      { userId, resource, action }
    );
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    total: number;
    unresolved: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    last24h: number;
  } {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    return {
      total: this.alerts.length,
      unresolved: this.alerts.filter(a => !a.resolved).length,
      bySeverity: {
        low: this.alerts.filter(a => a.severity === "low").length,
        medium: this.alerts.filter(a => a.severity === "medium").length,
        high: this.alerts.filter(a => a.severity === "high").length,
        critical: this.alerts.filter(a => a.severity === "critical").length
      },
      byType: this.alerts.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      last24h: this.alerts.filter(a => a.timestamp.getTime() >= twentyFourHoursAgo).length
    };
  }
}

export const securityAlerts = new SecurityAlertsService();
