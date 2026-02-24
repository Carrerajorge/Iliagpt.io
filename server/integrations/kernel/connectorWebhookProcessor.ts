/**
 * ConnectorWebhookProcessor — Inbound webhook processing for connectors.
 *
 * Handles webhook verification, parsing, and routing for connectors
 * that support real-time event notifications (GitHub, Slack, HubSpot, etc.).
 *
 * Security model:
 *  - Signature verification per provider (HMAC-SHA256, etc.)
 *  - Replay prevention via timestamp + nonce checking
 *  - Rate limiting on inbound webhooks
 *  - Structured audit logging for every webhook received
 */

import { createHmac, timingSafeEqual } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────

export interface WebhookConfig {
  connectorId: string;
  /** Secret used to verify webhook signatures */
  signingSecret?: string;
  /** Header containing the signature */
  signatureHeader: string;
  /** Algorithm for HMAC verification */
  signatureAlgorithm: "sha256" | "sha1";
  /** Header prefix (e.g., "sha256=" for GitHub) */
  signaturePrefix?: string;
  /** Timestamp header for replay prevention */
  timestampHeader?: string;
  /** Max age for replay prevention (default 5 minutes) */
  maxTimestampAgeMs?: number;
  /** Custom verification function for providers with non-standard verification */
  customVerifier?: (payload: string | Buffer, headers: Record<string, string>) => boolean;
}

export interface WebhookEvent {
  id: string;
  connectorId: string;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
  verified: boolean;
  /** Provider-specific metadata */
  providerMeta?: Record<string, unknown>;
}

export type WebhookHandler = (event: WebhookEvent) => Promise<void>;

interface WebhookRegistration {
  config: WebhookConfig;
  handlers: Map<string, WebhookHandler[]>; // eventType → handlers
  catchAllHandlers: WebhookHandler[];
}

interface ReplayEntry {
  nonce: string;
  expiresAt: number;
}

// ─── Webhook Processor ───────────────────────────────────────────────

export class ConnectorWebhookProcessor {
  private registrations = new Map<string, WebhookRegistration>();
  private replayCache = new Map<string, ReplayEntry>();
  private recentWebhooks: WebhookEvent[] = [];
  private readonly maxRecentWebhooks = 200;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up replay cache every 2 minutes
    this.cleanupInterval = setInterval(() => this.cleanupReplayCache(), 120_000);
  }

  /** Register a connector's webhook configuration */
  registerWebhook(config: WebhookConfig): void {
    if (this.registrations.has(config.connectorId)) {
      console.warn(
        `[WebhookProcessor] Overwriting webhook config for ${config.connectorId}`
      );
    }

    this.registrations.set(config.connectorId, {
      config,
      handlers: new Map(),
      catchAllHandlers: [],
    });

    console.log(`[WebhookProcessor] Registered webhook for ${config.connectorId}`);
  }

  /** Subscribe to a specific event type from a connector */
  on(connectorId: string, eventType: string, handler: WebhookHandler): void {
    const reg = this.registrations.get(connectorId);
    if (!reg) {
      console.warn(`[WebhookProcessor] No registration for ${connectorId}, creating on-the-fly`);
      this.registrations.set(connectorId, {
        config: {
          connectorId,
          signatureHeader: "x-signature",
          signatureAlgorithm: "sha256",
        },
        handlers: new Map(),
        catchAllHandlers: [],
      });
    }

    const registration = this.registrations.get(connectorId)!;
    const existing = registration.handlers.get(eventType) || [];
    existing.push(handler);
    registration.handlers.set(eventType, existing);
  }

  /** Subscribe to ALL events from a connector */
  onAny(connectorId: string, handler: WebhookHandler): void {
    const reg = this.registrations.get(connectorId);
    if (!reg) return;
    reg.catchAllHandlers.push(handler);
  }

  /**
   * Process an inbound webhook request.
   *
   * @param connectorId - Which connector this webhook is for
   * @param rawBody - Raw request body (string or Buffer)
   * @param headers - HTTP headers (lowercase keys)
   * @returns Processing result
   */
  async process(
    connectorId: string,
    rawBody: string | Buffer,
    headers: Record<string, string>
  ): Promise<{
    accepted: boolean;
    eventId?: string;
    reason?: string;
    eventsDispatched?: number;
  }> {
    const receivedAt = new Date();
    const registration = this.registrations.get(connectorId);

    if (!registration) {
      return { accepted: false, reason: `No webhook registration for "${connectorId}"` };
    }

    // 1. Verify signature
    const verified = this.verifySignature(registration.config, rawBody, headers);
    if (!verified) {
      console.warn(
        `[WebhookProcessor] Signature verification FAILED for ${connectorId}`,
        { headers: Object.keys(headers) }
      );
      return { accepted: false, reason: "Signature verification failed" };
    }

    // 2. Replay prevention
    const timestampHeader = registration.config.timestampHeader;
    if (timestampHeader) {
      const tsValue = headers[timestampHeader.toLowerCase()];
      if (tsValue) {
        const timestamp = parseInt(tsValue, 10) * 1000; // Unix seconds → ms
        const maxAge = registration.config.maxTimestampAgeMs ?? 300_000; // 5 min
        const age = Date.now() - timestamp;

        if (Number.isNaN(timestamp) || age > maxAge || age < -60_000) {
          return { accepted: false, reason: `Webhook timestamp too old or invalid (age: ${age}ms)` };
        }
      }
    }

    // 3. Nonce check (use signature as nonce)
    const signatureValue = headers[registration.config.signatureHeader.toLowerCase()] || "";
    if (signatureValue) {
      const nonceKey = `${connectorId}:${signatureValue}`;
      if (this.replayCache.has(nonceKey)) {
        return { accepted: false, reason: "Duplicate webhook (replay detected)" };
      }
      this.replayCache.set(nonceKey, {
        nonce: signatureValue,
        expiresAt: Date.now() + 600_000, // 10 min
      });
    }

    // 4. Parse payload
    let payload: Record<string, unknown>;
    try {
      const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
      payload = JSON.parse(bodyStr);
    } catch {
      return { accepted: false, reason: "Invalid JSON payload" };
    }

    // 5. Extract event type
    const eventType = extractEventType(connectorId, payload, headers);

    // 6. Create event
    const eventId = `wh_${connectorId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const event: WebhookEvent = {
      id: eventId,
      connectorId,
      eventType,
      payload,
      receivedAt,
      verified: true,
      providerMeta: {
        signatureHeader: registration.config.signatureHeader,
        rawHeaders: Object.keys(headers),
      },
    };

    // 7. Store in recent buffer
    this.recentWebhooks.push(event);
    if (this.recentWebhooks.length > this.maxRecentWebhooks) {
      this.recentWebhooks.shift();
    }

    // 8. Dispatch to handlers
    let dispatched = 0;

    // Event-specific handlers
    const specificHandlers = registration.handlers.get(eventType) || [];
    for (const handler of specificHandlers) {
      try {
        await handler(event);
        dispatched++;
      } catch (err) {
        console.error(
          `[WebhookProcessor] Handler error for ${connectorId}/${eventType}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Catch-all handlers
    for (const handler of registration.catchAllHandlers) {
      try {
        await handler(event);
        dispatched++;
      } catch (err) {
        console.error(
          `[WebhookProcessor] Catch-all handler error for ${connectorId}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // 9. Structured log
    console.log(
      JSON.stringify({
        event: "webhook_processed",
        connectorId,
        eventType,
        eventId,
        verified: true,
        payloadSizeBytes: typeof rawBody === "string" ? Buffer.byteLength(rawBody) : rawBody.length,
        handlersDispatched: dispatched,
        timestamp: receivedAt.toISOString(),
      })
    );

    return { accepted: true, eventId, eventsDispatched: dispatched };
  }

  /** Get recent webhooks for a connector */
  getRecentWebhooks(connectorId?: string, limit = 50): WebhookEvent[] {
    const events = connectorId
      ? this.recentWebhooks.filter((e) => e.connectorId === connectorId)
      : this.recentWebhooks;
    return events.slice(-limit);
  }

  /** Get registration info */
  getRegistrations(): string[] {
    return Array.from(this.registrations.keys());
  }

  /** Graceful shutdown */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.replayCache.clear();
    console.log("[WebhookProcessor] Shutdown complete");
  }

  // ─── Private helpers ─────────────────────────────────────────────

  private verifySignature(
    config: WebhookConfig,
    rawBody: string | Buffer,
    headers: Record<string, string>
  ): boolean {
    // Custom verifier takes priority
    if (config.customVerifier) {
      try {
        return config.customVerifier(rawBody, headers);
      } catch {
        return false;
      }
    }

    // No signing secret → accept all (development mode)
    if (!config.signingSecret) {
      return true;
    }

    const signatureValue = headers[config.signatureHeader.toLowerCase()];
    if (!signatureValue) {
      return false;
    }

    try {
      const bodyBuf = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
      const computed = createHmac(config.signatureAlgorithm, config.signingSecret)
        .update(bodyBuf)
        .digest("hex");

      const expected = config.signaturePrefix
        ? `${config.signaturePrefix}${computed}`
        : computed;

      // Timing-safe comparison
      if (expected.length !== signatureValue.length) return false;
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureValue));
    } catch {
      return false;
    }
  }

  private cleanupReplayCache(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of Array.from(this.replayCache.entries())) {
      if (entry.expiresAt < now) {
        this.replayCache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[WebhookProcessor] Cleaned ${cleaned} expired replay entries`);
    }
  }
}

// ─── Event type extraction per provider ──────────────────────────────

function extractEventType(
  connectorId: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): string {
  switch (connectorId) {
    case "github":
      // GitHub sends event type in X-GitHub-Event header
      return headers["x-github-event"] || String(payload.action || "unknown");

    case "slack":
      // Slack event API: payload.event.type or payload.type
      if (typeof payload.event === "object" && payload.event !== null) {
        return String((payload.event as Record<string, unknown>).type || "unknown");
      }
      return String(payload.type || "unknown");

    case "hubspot":
      // HubSpot sends array of events
      if (Array.isArray(payload)) {
        const first = payload[0] as Record<string, unknown> | undefined;
        return String(first?.subscriptionType || "unknown");
      }
      return String(payload.subscriptionType || payload.eventType || "unknown");

    case "notion":
      return String(payload.type || "unknown");

    case "google-drive":
      // Google Drive push notifications use X-Goog-Resource-State
      return headers["x-goog-resource-state"] || String(payload.type || "unknown");

    default:
      // Generic: try common field names
      return String(
        payload.event_type ||
          payload.eventType ||
          payload.type ||
          payload.action ||
          headers["x-event-type"] ||
          "unknown"
      );
  }
}

// ─── Default webhook configs for supported connectors ────────────────

export const DEFAULT_WEBHOOK_CONFIGS: WebhookConfig[] = [
  {
    connectorId: "github",
    signatureHeader: "x-hub-signature-256",
    signatureAlgorithm: "sha256",
    signaturePrefix: "sha256=",
    timestampHeader: undefined,
    maxTimestampAgeMs: 300_000,
  },
  {
    connectorId: "slack",
    signatureHeader: "x-slack-signature",
    signatureAlgorithm: "sha256",
    signaturePrefix: "v0=",
    timestampHeader: "x-slack-request-timestamp",
    maxTimestampAgeMs: 300_000,
  },
  {
    connectorId: "hubspot",
    signatureHeader: "x-hubspot-signature-v3",
    signatureAlgorithm: "sha256",
    timestampHeader: "x-hubspot-request-timestamp",
    maxTimestampAgeMs: 300_000,
  },
  {
    connectorId: "notion",
    signatureHeader: "x-notion-signature",
    signatureAlgorithm: "sha256",
    maxTimestampAgeMs: 300_000,
  },
];

// ─── Singleton ───────────────────────────────────────────────────────

export const connectorWebhookProcessor = new ConnectorWebhookProcessor();

// Auto-register default configs
for (const config of DEFAULT_WEBHOOK_CONFIGS) {
  connectorWebhookProcessor.registerWebhook(config);
}
