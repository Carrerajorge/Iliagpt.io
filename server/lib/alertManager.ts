import { nanoid } from "nanoid";
import { logger } from "../utils/logger";
import { getSettingValue } from "../services/settingsConfigService";

export type AlertType = "api_failure" | "rate_limit" | "high_latency" | "error_spike";
export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface Alert {
  id: string;
  type: AlertType;
  service: string;
  message: string;
  severity: AlertSeverity;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

const MAX_ALERTS = 200;
const alerts: Alert[] = [];

async function getAlertWebhookUrl(): Promise<string | null> {
  try {
    const configured = await getSettingValue<string>("slack_webhook_url", "");
    if (typeof configured === "string" && configured.trim().length > 0) {
      return configured.trim();
    }
  } catch {
    // ignore
  }
  return process.env.ALERT_WEBHOOK_URL || null;
}

async function sendWebhookNotification(alert: Alert) {
  const webhookUrl = await getAlertWebhookUrl();
  if (!webhookUrl) return;
  if (alert.severity === 'low') return; // Don't spam low severity

  try {
    const payload = {
      text: `🚨 *${alert.severity.toUpperCase()} ALERT* - ${alert.service}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${alert.type}*: ${alert.message}\n_Time: ${alert.timestamp.toISOString()}_`
          }
        }
      ]
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      logger.error(`Failed to send alert webhook: ${response.statusText}`, { alertId: alert.id });
    }
  } catch (error: any) {
    logger.error(`Error sending alert webhook: ${error.message}`, { alertId: alert.id });
  }
}

export function createAlert(
  alertData: Omit<Alert, "id" | "timestamp" | "resolvedAt">
): Alert {
  const alert: Alert = {
    ...alertData,
    id: nanoid(12),
    timestamp: new Date(),
  };

  alerts.push(alert);

  // Rotación: eliminar alertas antiguas si excedemos el límite
  if (alerts.length > MAX_ALERTS) {
    alerts.splice(0, alerts.length - MAX_ALERTS);
  }

  logger.warn(`Alert created: ${alert.type} - ${alert.service}`, {
    alertId: alert.id,
    severity: alert.severity,
    message: alert.message,
  });

  // Fire and forget notification
  sendWebhookNotification(alert).catch(err => {
    console.error("Alert notification error:", err);
  });

  return { ...alert };
}

export function resolveAlert(id: string): Alert | undefined {
  const alert = alerts.find(a => a.id === id);

  if (alert && !alert.resolved) {
    alert.resolved = true;
    alert.resolvedAt = new Date();

    logger.info(`Alert resolved: ${alert.type} - ${alert.service}`, {
      alertId: alert.id,
      resolvedAfterMs: alert.resolvedAt.getTime() - alert.timestamp.getTime(),
    });

    return { ...alert };
  }

  return alert ? { ...alert } : undefined;
}

export function resolveAlertsByService(service: string): number {
  let resolvedCount = 0;
  const now = new Date();

  for (const alert of alerts) {
    if (alert.service === service && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = now;
      resolvedCount++;
    }
  }

  if (resolvedCount > 0) {
    logger.info(`Resolved ${resolvedCount} alerts for service ${service}`);
  }

  return resolvedCount;
}

export function getActiveAlerts(): Alert[] {
  return alerts
    .filter(a => !a.resolved)
    .map(a => ({ ...a }))
    .sort((a, b) => {
      // Ordenar por severidad y luego por timestamp
      const severityOrder: Record<AlertSeverity, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
}

export function getAlertHistory(since?: Date): Alert[] {
  let result = [...alerts];

  if (since) {
    const sinceDate = new Date(since);
    result = result.filter(a => a.timestamp >= sinceDate);
  }

  return result
    .map(a => ({ ...a }))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

export function getAlertStats(): {
  total: number;
  active: number;
  resolved: number;
  byType: Record<AlertType, number>;
  bySeverity: Record<AlertSeverity, number>;
  byService: Record<string, number>;
} {
  const byType: Record<AlertType, number> = {
    api_failure: 0,
    rate_limit: 0,
    high_latency: 0,
    error_spike: 0,
  };

  const bySeverity: Record<AlertSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  const byService: Record<string, number> = {};
  let active = 0;
  let resolved = 0;

  for (const alert of alerts) {
    byType[alert.type]++;
    bySeverity[alert.severity]++;
    byService[alert.service] = (byService[alert.service] || 0) + 1;

    if (alert.resolved) {
      resolved++;
    } else {
      active++;
    }
  }

  return {
    total: alerts.length,
    active,
    resolved,
    byType,
    bySeverity,
    byService,
  };
}

export function getAlertById(id: string): Alert | undefined {
  const alert = alerts.find(a => a.id === id);
  return alert ? { ...alert } : undefined;
}

export function clearResolvedAlerts(): number {
  const initialLength = alerts.length;
  const activeAlerts = alerts.filter(a => !a.resolved);
  alerts.length = 0;
  alerts.push(...activeAlerts);

  const cleared = initialLength - alerts.length;
  if (cleared > 0) {
    logger.info(`Cleared ${cleared} resolved alerts`);
  }

  return cleared;
}
