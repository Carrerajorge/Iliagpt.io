/**
 * ErrorReporter — Central error collection with rich context and frequency tracking.
 *
 * Features:
 *   - Captures errors with caller context (userId, chatId, runId, route, version)
 *   - Tracks frequency per error fingerprint with first/last seen timestamps
 *   - Exposes top N most frequent errors for dashboards
 *   - Integrates with ErrorHandler for category and dedup
 *   - Flushes periodic summaries to Logger for structured log aggregators
 *   - Optional external webhook for critical error alerting
 */

import { EventEmitter } from 'events';
import { Logger }       from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ErrorContext {
  userId?   : string;
  chatId?   : string;
  runId?    : string;
  route?    : string;
  method?   : string;
  toolName? : string;
  model?    : string;
  extra?    : Record<string, unknown>;
}

export interface ErrorReport {
  fingerprint : string;
  message     : string;
  stack?      : string;
  category?   : string;
  context     : ErrorContext;
  count       : number;
  firstSeen   : number;
  lastSeen    : number;
  severity    : 'low' | 'medium' | 'high' | 'critical';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_REPORTS    = 1_000;
const FLUSH_INTERVAL = 5 * 60_000;  // 5 min summary log
const CRITICAL_THRESHOLD = 10;      // errors per minute to trigger alert

// ─── Main class ───────────────────────────────────────────────────────────────

export class ErrorReporter extends EventEmitter {
  private readonly reports = new Map<string, ErrorReport>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private alertWebhook: string | null = null;

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  stop(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
  }

  setWebhook(url: string): void { this.alertWebhook = url; }

  // ── Report an error ──────────────────────────────────────────────────────────

  report(err: unknown, ctx: ErrorContext = {}, severity: ErrorReport['severity'] = 'medium'): ErrorReport {
    const raw       = err instanceof Error ? err : new Error(String(err));
    const fingerprint = this._fingerprint(raw.message, ctx);
    const now       = Date.now();

    const existing = this.reports.get(fingerprint);
    if (existing) {
      existing.count++;
      existing.lastSeen = now;
      if (severity === 'critical' || severity === 'high') existing.severity = severity;
      this._maybeAlert(existing);
      return existing;
    }

    // Evict oldest if full
    if (this.reports.size >= MAX_REPORTS) {
      const oldest = [...this.reports.entries()]
        .sort(([, a], [, b]) => a.lastSeen - b.lastSeen)
        .slice(0, 50);
      for (const [k] of oldest) this.reports.delete(k);
    }

    const report: ErrorReport = {
      fingerprint,
      message  : raw.message,
      stack    : raw.stack,
      context  : ctx,
      count    : 1,
      firstSeen: now,
      lastSeen : now,
      severity,
    };

    this.reports.set(fingerprint, report);
    this.emit('error_reported', report);
    this._maybeAlert(report);

    return report;
  }

  // ── Query ────────────────────────────────────────────────────────────────────

  /** Top N errors by occurrence count */
  top(n = 10): ErrorReport[] {
    return [...this.reports.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /** All critical/high severity errors */
  critical(): ErrorReport[] {
    return [...this.reports.values()]
      .filter(r => r.severity === 'critical' || r.severity === 'high')
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** Errors occurring recently (within windowMs) */
  recent(windowMs = 60_000): ErrorReport[] {
    const cutoff = Date.now() - windowMs;
    return [...this.reports.values()]
      .filter(r => r.lastSeen >= cutoff)
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  stats(): Record<string, unknown> {
    return {
      totalFingerprints: this.reports.size,
      totalErrors      : [...this.reports.values()].reduce((s, r) => s + r.count, 0),
      criticalCount    : this.critical().length,
      recentCount      : this.recent(60_000).length,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private _fingerprint(message: string, ctx: ErrorContext): string {
    const normalized = message
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<uuid>')
      .replace(/\b\d+\b/g, '<n>')
      .slice(0, 100);
    const routePart = ctx.route ?? '';
    const toolPart  = ctx.toolName ?? '';
    return `${routePart}:${toolPart}:${normalized}`;
  }

  private _maybeAlert(report: ErrorReport): void {
    // Alert if critical or if a single error fires > CRITICAL_THRESHOLD times in the last minute
    if (report.severity !== 'critical' && report.count < CRITICAL_THRESHOLD) return;

    const ageMs  = report.lastSeen - report.firstSeen || 1;
    const rate   = (report.count / ageMs) * 60_000;
    if (report.severity !== 'critical' && rate < CRITICAL_THRESHOLD) return;

    Logger.error('[ErrorReporter] critical error threshold reached', {
      fingerprint: report.fingerprint,
      count      : report.count,
      severity   : report.severity,
      message    : report.message,
    });

    this.emit('alert', report);

    if (this.alertWebhook) {
      void this._sendWebhookAlert(report);
    }
  }

  private async _sendWebhookAlert(report: ErrorReport): Promise<void> {
    try {
      await fetch(this.alertWebhook!, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          text   : `🚨 Error alert: ${report.message}`,
          count  : report.count,
          severity: report.severity,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch { /* fire and forget — don't throw on webhook failure */ }
  }

  private _flush(): void {
    const stats = this.stats();
    if ((stats.totalErrors as number) === 0) return;
    Logger.info('[ErrorReporter] periodic summary', {
      ...stats,
      top5: this.top(5).map(r => ({ msg: r.message, count: r.count, severity: r.severity })),
    });
  }
}

export const errorReporter = new ErrorReporter();
