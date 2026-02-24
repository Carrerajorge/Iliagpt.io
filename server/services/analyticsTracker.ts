/**
 * Analytics Tracker Service
 * Automatically captures and stores analytics events
 */

import { storage } from "../storage";
import { EventEmitter } from "events";

export interface AnalyticsEvent {
  eventType: string;
  userId?: string;
  sessionId?: string;
  page?: string;
  action?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface SessionMetrics {
  sessionId: string;
  userId?: string;
  startTime: Date;
  lastActivity: Date;
  pageViews: number;
  actions: string[];
  duration: number;
}

class AnalyticsTrackerService extends EventEmitter {
  private events: AnalyticsEvent[] = [];
  private sessions: Map<string, SessionMetrics> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly MAX_EVENTS = 10000;
  private readonly FLUSH_INTERVAL_MS = 60000; // Flush every minute

  constructor() {
    super();
    this.setMaxListeners(50);
    this.startFlushInterval();
  }

  private startFlushInterval() {
    this.flushInterval = setInterval(() => {
      this.flushEvents();
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Track a page view event
   */
  trackPageView(userId: string | undefined, sessionId: string, page: string, metadata?: Record<string, any>) {
    this.track({
      eventType: "page_view",
      userId,
      sessionId,
      page,
      metadata,
      timestamp: new Date()
    });
    this.updateSession(sessionId, userId, page);
  }

  /**
   * Track a user action
   */
  trackAction(userId: string | undefined, sessionId: string, action: string, metadata?: Record<string, any>) {
    this.track({
      eventType: "action",
      userId,
      sessionId,
      action,
      metadata,
      timestamp: new Date()
    });
    this.updateSessionAction(sessionId, action);
  }

  /**
   * Track a chat query
   */
  trackChatQuery(userId: string | undefined, sessionId: string, metadata?: Record<string, any>) {
    this.track({
      eventType: "chat_query",
      userId,
      sessionId,
      action: "chat_query",
      metadata,
      timestamp: new Date()
    });
  }

  /**
   * Track a conversion event
   */
  trackConversion(userId: string, conversionType: string, value?: number, metadata?: Record<string, any>) {
    this.track({
      eventType: "conversion",
      userId,
      action: conversionType,
      metadata: { ...metadata, value },
      timestamp: new Date()
    });
  }

  /**
   * Internal track method
   */
  private track(event: AnalyticsEvent) {
    this.events.push(event);
    this.emit("event", event);

    // Trim old events if over limit
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS / 2);
    }
  }

  /**
   * Update session metrics
   */
  private updateSession(sessionId: string, userId: string | undefined, page: string) {
    const now = new Date();
    const existing = this.sessions.get(sessionId);
    
    if (existing) {
      existing.lastActivity = now;
      existing.pageViews++;
      existing.duration = now.getTime() - existing.startTime.getTime();
    } else {
      this.sessions.set(sessionId, {
        sessionId,
        userId,
        startTime: now,
        lastActivity: now,
        pageViews: 1,
        actions: [],
        duration: 0
      });
    }
  }

  private updateSessionAction(sessionId: string, action: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.actions.push(action);
      session.lastActivity = new Date();
      session.duration = session.lastActivity.getTime() - session.startTime.getTime();
    }
  }

  /**
   * Flush events to database
   */
  async flushEvents() {
    if (this.events.length === 0) return;

    const eventsToFlush = [...this.events];
    this.events = [];

    try {
      // Group events by type for efficient storage
      const eventCounts: Record<string, number> = {};
      eventsToFlush.forEach(e => {
        eventCounts[e.eventType] = (eventCounts[e.eventType] || 0) + 1;
      });

      // Create analytics snapshot with counts
      await storage.createAnalyticsSnapshot({
        activeUsersNow: this.sessions.size,
        queriesPerMinute: eventCounts["chat_query"] || 0,
        tokensConsumedToday: 0,
        revenueToday: "0",
        avgLatencyMs: 0,
        errorRatePercentage: "0"
      });

      console.log(`[AnalyticsTracker] Flushed ${eventsToFlush.length} events`);
    } catch (error) {
      console.error("[AnalyticsTracker] Failed to flush events:", error);
      // Put events back if flush failed
      this.events.unshift(...eventsToFlush);
    }
  }

  /**
   * Get real-time metrics
   */
  getRealTimeMetrics() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const fiveMinutesAgo = now - 300000;

    const recentEvents = this.events.filter(e => e.timestamp.getTime() > oneMinuteAgo);
    const activeSessions = Array.from(this.sessions.values()).filter(
      s => s.lastActivity.getTime() > fiveMinutesAgo
    );

    return {
      eventsPerMinute: recentEvents.length,
      activeSessions: activeSessions.length,
      totalEventsBuffered: this.events.length,
      eventsByType: recentEvents.reduce((acc, e) => {
        acc[e.eventType] = (acc[e.eventType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      topPages: this.getTopPages(),
      avgSessionDuration: this.getAvgSessionDuration()
    };
  }

  private getTopPages(): Array<{ page: string; views: number }> {
    const pageCounts: Record<string, number> = {};
    this.events
      .filter(e => e.eventType === "page_view" && e.page)
      .forEach(e => {
        pageCounts[e.page!] = (pageCounts[e.page!] || 0) + 1;
      });
    
    return Object.entries(pageCounts)
      .map(([page, views]) => ({ page, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);
  }

  private getAvgSessionDuration(): number {
    const sessions = Array.from(this.sessions.values());
    if (sessions.length === 0) return 0;
    const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);
    return Math.round(totalDuration / sessions.length / 1000); // in seconds
  }

  /**
   * Get session details
   */
  getSessionDetails(sessionId: string): SessionMetrics | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(minutes = 5): SessionMetrics[] {
    const cutoff = Date.now() - minutes * 60000;
    return Array.from(this.sessions.values()).filter(
      s => s.lastActivity.getTime() > cutoff
    );
  }

  /**
   * Cleanup old sessions
   */
  cleanupOldSessions(maxAgeMinutes = 30) {
    const cutoff = Date.now() - maxAgeMinutes * 60000;
    let cleaned = 0;
    for (const [sessionId, session] of this.sessions) {
      if (session.lastActivity.getTime() < cutoff) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    return cleaned;
  }

  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
  }
}

export const analyticsTracker = new AnalyticsTrackerService();
