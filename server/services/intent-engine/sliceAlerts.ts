import { 
  getProductMetrics, 
  getSliceMetrics, 
  type Alert, 
  type SliceType,
  type ProductMetricsSnapshot
} from "./productMetrics";
import type { IntentType, SupportedLocale } from "../../../shared/schemas/intent";
import { logStructured } from "./telemetry";

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface AlertThresholds {
  accuracy_drop_percent: number;
  fallback_rate_max: number;
  unknown_rate_max: number;
  intent_success_drop_percent: number;
  latency_p95_max_ms: number;
  latency_p99_max_ms: number;
  correction_rate_max: number;
  clarification_helpfulness_min: number;
}

export interface SliceAlertConfig {
  global: AlertThresholds;
  by_locale?: Partial<Record<SupportedLocale, Partial<AlertThresholds>>>;
  by_intent?: Partial<Record<IntentType, Partial<AlertThresholds>>>;
  by_channel?: Record<string, Partial<AlertThresholds>>;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  accuracy_drop_percent: 10,
  fallback_rate_max: 0.20,
  unknown_rate_max: 0.15,
  intent_success_drop_percent: 15,
  latency_p95_max_ms: 2000,
  latency_p99_max_ms: 5000,
  correction_rate_max: 0.10,
  clarification_helpfulness_min: 0.50
};

let alertConfig: SliceAlertConfig = {
  global: { ...DEFAULT_THRESHOLDS }
};

let activeAlerts: Map<string, Alert> = new Map();
let alertCounter = 0;

let baselineMetrics: {
  by_locale: Record<string, { success_rate: number }>;
  by_intent: Record<string, { success_rate: number }>;
  overall_success_rate: number;
} | null = null;

function generateAlertId(): string {
  return `alert_${Date.now()}_${++alertCounter}`;
}

function getThresholdsForSlice(sliceType: SliceType, sliceValue: string): AlertThresholds {
  const base = { ...alertConfig.global };
  
  switch (sliceType) {
    case "locale":
      if (alertConfig.by_locale?.[sliceValue as SupportedLocale]) {
        return { ...base, ...alertConfig.by_locale[sliceValue as SupportedLocale] };
      }
      break;
    case "intent":
      if (alertConfig.by_intent?.[sliceValue as IntentType]) {
        return { ...base, ...alertConfig.by_intent[sliceValue as IntentType] };
      }
      break;
    case "channel":
      if (alertConfig.by_channel?.[sliceValue]) {
        return { ...base, ...alertConfig.by_channel[sliceValue] };
      }
      break;
  }
  
  return base;
}

function determineSeverity(
  metricName: string,
  value: number,
  threshold: number,
  isMax: boolean
): AlertSeverity {
  const diff = isMax ? value - threshold : threshold - value;
  const percentOver = (diff / threshold) * 100;

  if (percentOver > 50) {
    return "CRITICAL";
  } else if (percentOver > 25) {
    return "WARNING";
  }
  return "INFO";
}

function createAlert(
  type: string,
  message: string,
  severity: AlertSeverity,
  slice?: string,
  value?: number,
  threshold?: number
): Alert {
  const alertKey = `${type}:${slice || 'global'}`;
  
  const existingAlert = activeAlerts.get(alertKey);
  if (existingAlert && !existingAlert.acknowledged) {
    existingAlert.value = value;
    existingAlert.severity = severity;
    return existingAlert;
  }

  const alert: Alert = {
    id: generateAlertId(),
    severity,
    type,
    message,
    slice,
    value,
    threshold,
    created_at: new Date(),
    acknowledged: false
  };

  activeAlerts.set(alertKey, alert);
  
  logStructured(severity === "CRITICAL" ? "error" : severity === "WARNING" ? "warn" : "info", 
    `Alert triggered: ${type}`, {
      alert_id: alert.id,
      severity,
      slice,
      value,
      threshold
    });

  return alert;
}

function clearAlertIfResolved(type: string, slice?: string): void {
  const alertKey = `${type}:${slice || 'global'}`;
  const existingAlert = activeAlerts.get(alertKey);
  
  if (existingAlert && !existingAlert.acknowledged) {
    activeAlerts.delete(alertKey);
    logStructured("info", `Alert auto-resolved: ${type}`, {
      alert_id: existingAlert.id,
      slice
    });
  }
}

export function checkSliceAlerts(): Alert[] {
  const triggeredAlerts: Alert[] = [];
  const metrics = getProductMetrics();
  const thresholds = alertConfig.global;

  if (metrics.overall.fallback_rate > thresholds.fallback_rate_max) {
    const severity = determineSeverity("fallback_rate", metrics.overall.fallback_rate, thresholds.fallback_rate_max, true);
    triggeredAlerts.push(createAlert(
      "HIGH_FALLBACK_RATE",
      `Global fallback rate ${(metrics.overall.fallback_rate * 100).toFixed(1)}% exceeds threshold ${(thresholds.fallback_rate_max * 100).toFixed(1)}%`,
      severity,
      undefined,
      metrics.overall.fallback_rate,
      thresholds.fallback_rate_max
    ));
  } else {
    clearAlertIfResolved("HIGH_FALLBACK_RATE");
  }

  if (metrics.overall.unknown_rate > thresholds.unknown_rate_max) {
    const severity = determineSeverity("unknown_rate", metrics.overall.unknown_rate, thresholds.unknown_rate_max, true);
    triggeredAlerts.push(createAlert(
      "HIGH_UNKNOWN_RATE",
      `Global unknown rate ${(metrics.overall.unknown_rate * 100).toFixed(1)}% exceeds threshold ${(thresholds.unknown_rate_max * 100).toFixed(1)}%`,
      severity,
      undefined,
      metrics.overall.unknown_rate,
      thresholds.unknown_rate_max
    ));
  } else {
    clearAlertIfResolved("HIGH_UNKNOWN_RATE");
  }

  if (metrics.overall.correction_rate > thresholds.correction_rate_max) {
    const severity = determineSeverity("correction_rate", metrics.overall.correction_rate, thresholds.correction_rate_max, true);
    triggeredAlerts.push(createAlert(
      "HIGH_CORRECTION_RATE",
      `Global correction rate ${(metrics.overall.correction_rate * 100).toFixed(1)}% exceeds threshold ${(thresholds.correction_rate_max * 100).toFixed(1)}%`,
      severity,
      undefined,
      metrics.overall.correction_rate,
      thresholds.correction_rate_max
    ));
  } else {
    clearAlertIfResolved("HIGH_CORRECTION_RATE");
  }

  if (metrics.overall.clarification_helpfulness < thresholds.clarification_helpfulness_min) {
    const severity = determineSeverity("clarification_helpfulness", metrics.overall.clarification_helpfulness, thresholds.clarification_helpfulness_min, false);
    triggeredAlerts.push(createAlert(
      "LOW_CLARIFICATION_HELPFULNESS",
      `Clarification helpfulness ${(metrics.overall.clarification_helpfulness * 100).toFixed(1)}% below threshold ${(thresholds.clarification_helpfulness_min * 100).toFixed(1)}%`,
      severity,
      undefined,
      metrics.overall.clarification_helpfulness,
      thresholds.clarification_helpfulness_min
    ));
  } else {
    clearAlertIfResolved("LOW_CLARIFICATION_HELPFULNESS");
  }

  if (metrics.overall.p95_latency_ms > thresholds.latency_p95_max_ms) {
    const severity = determineSeverity("latency_p95", metrics.overall.p95_latency_ms, thresholds.latency_p95_max_ms, true);
    triggeredAlerts.push(createAlert(
      "HIGH_LATENCY_P95",
      `P95 latency ${metrics.overall.p95_latency_ms.toFixed(0)}ms exceeds threshold ${thresholds.latency_p95_max_ms}ms`,
      severity,
      undefined,
      metrics.overall.p95_latency_ms,
      thresholds.latency_p95_max_ms
    ));
  } else {
    clearAlertIfResolved("HIGH_LATENCY_P95");
  }

  for (const [locale, localeMetrics] of Object.entries(metrics.by_locale)) {
    const localeThresholds = getThresholdsForSlice("locale", locale);
    
    if (baselineMetrics?.by_locale[locale]) {
      const baseline = baselineMetrics.by_locale[locale].success_rate;
      const current = localeMetrics.success_rate;
      const dropPercent = ((baseline - current) / baseline) * 100;
      
      if (dropPercent > localeThresholds.accuracy_drop_percent) {
        const severity = dropPercent > 25 ? "CRITICAL" : dropPercent > 15 ? "WARNING" : "INFO";
        triggeredAlerts.push(createAlert(
          "LOCALE_ACCURACY_DROP",
          `Locale ${locale} accuracy dropped ${dropPercent.toFixed(1)}% (from ${(baseline * 100).toFixed(1)}% to ${(current * 100).toFixed(1)}%)`,
          severity,
          `locale:${locale}`,
          dropPercent,
          localeThresholds.accuracy_drop_percent
        ));
      } else {
        clearAlertIfResolved("LOCALE_ACCURACY_DROP", `locale:${locale}`);
      }
    }

    if (localeMetrics.fallback_rate > localeThresholds.fallback_rate_max) {
      const severity = determineSeverity("fallback_rate", localeMetrics.fallback_rate, localeThresholds.fallback_rate_max, true);
      triggeredAlerts.push(createAlert(
        "LOCALE_HIGH_FALLBACK",
        `Locale ${locale} fallback rate ${(localeMetrics.fallback_rate * 100).toFixed(1)}% exceeds threshold`,
        severity,
        `locale:${locale}`,
        localeMetrics.fallback_rate,
        localeThresholds.fallback_rate_max
      ));
    } else {
      clearAlertIfResolved("LOCALE_HIGH_FALLBACK", `locale:${locale}`);
    }

    if (localeMetrics.unknown_rate > localeThresholds.unknown_rate_max) {
      const severity = determineSeverity("unknown_rate", localeMetrics.unknown_rate, localeThresholds.unknown_rate_max, true);
      triggeredAlerts.push(createAlert(
        "LOCALE_HIGH_UNKNOWN",
        `Locale ${locale} unknown rate ${(localeMetrics.unknown_rate * 100).toFixed(1)}% exceeds threshold`,
        severity,
        `locale:${locale}`,
        localeMetrics.unknown_rate,
        localeThresholds.unknown_rate_max
      ));
    } else {
      clearAlertIfResolved("LOCALE_HIGH_UNKNOWN", `locale:${locale}`);
    }
  }

  for (const [intent, intentMetrics] of Object.entries(metrics.by_intent)) {
    if (intentMetrics.total === 0) continue;
    
    const intentThresholds = getThresholdsForSlice("intent", intent);
    const successRate = intentMetrics.successful / intentMetrics.total;
    
    if (baselineMetrics?.by_intent[intent]) {
      const baseline = baselineMetrics.by_intent[intent].success_rate;
      const dropPercent = ((baseline - successRate) / baseline) * 100;
      
      if (dropPercent > intentThresholds.intent_success_drop_percent) {
        const severity = dropPercent > 30 ? "CRITICAL" : dropPercent > 20 ? "WARNING" : "INFO";
        triggeredAlerts.push(createAlert(
          "INTENT_SUCCESS_DROP",
          `Intent ${intent} success rate dropped ${dropPercent.toFixed(1)}% (from ${(baseline * 100).toFixed(1)}% to ${(successRate * 100).toFixed(1)}%)`,
          severity,
          `intent:${intent}`,
          dropPercent,
          intentThresholds.intent_success_drop_percent
        ));
      } else {
        clearAlertIfResolved("INTENT_SUCCESS_DROP", `intent:${intent}`);
      }
    }
  }

  return triggeredAlerts;
}

export function getActiveAlerts(): Alert[] {
  return Array.from(activeAlerts.values())
    .filter(alert => !alert.acknowledged)
    .sort((a, b) => {
      const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return b.created_at.getTime() - a.created_at.getTime();
    });
}

export function getAllAlerts(): Alert[] {
  return Array.from(activeAlerts.values())
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export function acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean {
  for (const alert of activeAlerts.values()) {
    if (alert.id === alertId) {
      alert.acknowledged = true;
      alert.acknowledged_at = new Date();
      alert.acknowledged_by = acknowledgedBy;
      
      logStructured("info", "Alert acknowledged", {
        alert_id: alertId,
        type: alert.type,
        acknowledged_by: acknowledgedBy
      });
      
      return true;
    }
  }
  return false;
}

export function configureAlertThresholds(config: Partial<SliceAlertConfig>): void {
  if (config.global) {
    alertConfig.global = { ...alertConfig.global, ...config.global };
  }
  if (config.by_locale) {
    alertConfig.by_locale = { ...alertConfig.by_locale, ...config.by_locale };
  }
  if (config.by_intent) {
    alertConfig.by_intent = { ...alertConfig.by_intent, ...config.by_intent };
  }
  if (config.by_channel) {
    alertConfig.by_channel = { ...alertConfig.by_channel, ...config.by_channel };
  }
  
  logStructured("info", "Alert thresholds configured", {
    global: alertConfig.global
  });
}

export function getAlertThresholds(): SliceAlertConfig {
  return { ...alertConfig };
}

export function setBaseline(metrics?: ProductMetricsSnapshot): void {
  const snapshot = metrics || getProductMetrics();
  
  baselineMetrics = {
    by_locale: {},
    by_intent: {},
    overall_success_rate: snapshot.overall.success_rate
  };
  
  for (const [locale, localeMetrics] of Object.entries(snapshot.by_locale)) {
    baselineMetrics.by_locale[locale] = {
      success_rate: localeMetrics.success_rate
    };
  }
  
  for (const [intent, intentMetrics] of Object.entries(snapshot.by_intent)) {
    const total = intentMetrics.total || 1;
    baselineMetrics.by_intent[intent] = {
      success_rate: intentMetrics.successful / total
    };
  }
  
  logStructured("info", "Alert baseline set", {
    overall_success_rate: baselineMetrics.overall_success_rate,
    locale_count: Object.keys(baselineMetrics.by_locale).length,
    intent_count: Object.keys(baselineMetrics.by_intent).length
  });
}

export function getBaseline(): typeof baselineMetrics {
  return baselineMetrics;
}

export function clearAlerts(): void {
  activeAlerts.clear();
  logStructured("info", "All alerts cleared", {});
}

export function resetAlertSystem(): void {
  activeAlerts.clear();
  baselineMetrics = null;
  alertConfig = { global: { ...DEFAULT_THRESHOLDS } };
  alertCounter = 0;
  logStructured("info", "Alert system reset", {});
}

export interface AlertSummary {
  total_active: number;
  by_severity: Record<AlertSeverity, number>;
  by_type: Record<string, number>;
  oldest_unacknowledged: Date | null;
}

export function getAlertSummary(): AlertSummary {
  const active = getActiveAlerts();
  
  const by_severity: Record<AlertSeverity, number> = {
    INFO: 0,
    WARNING: 0,
    CRITICAL: 0
  };
  
  const by_type: Record<string, number> = {};
  let oldest: Date | null = null;
  
  for (const alert of active) {
    by_severity[alert.severity]++;
    by_type[alert.type] = (by_type[alert.type] || 0) + 1;
    
    if (!oldest || alert.created_at < oldest) {
      oldest = alert.created_at;
    }
  }
  
  return {
    total_active: active.length,
    by_severity,
    by_type,
    oldest_unacknowledged: oldest
  };
}
