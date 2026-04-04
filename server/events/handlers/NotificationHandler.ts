/**
 * NotificationHandler: Routes events to WebSocket / email / webhook channels
 * Improvement 10 – Event-Driven Architecture with CQRS
 */

import { Logger } from "../../lib/logger";
import {
  AppEvent,
  EVENT_TYPES,
  AgentTaskCompleted,
  AgentTaskFailed,
  ModelError,
  ErrorOccurred,
  DocumentGenerated,
  UserSignedIn,
} from "../types";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  userId?: string;
  title: string;
  body: string;
  level: "info" | "warning" | "error" | "success";
  eventType: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  actionUrl?: string;
}

export interface WebhookConfig {
  id: string;
  userId: string;
  url: string;
  secret?: string;
  eventTypes: string[];
  enabled: boolean;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Internal stub for WS server (replaced by real implementation at runtime)
// ---------------------------------------------------------------------------

type WsServerLike = {
  sendToUser?: (userId: string, payload: any) => void;
  clients?: Set<any>;
};

// ---------------------------------------------------------------------------
// NotificationHandler
// ---------------------------------------------------------------------------

export class NotificationHandler {
  private wsServer: WsServerLike | null = null;

  /**
   * Attach the WebSocket server so we can push real-time notifications.
   * Called once during server startup.
   */
  attachWsServer(server: WsServerLike): void {
    this.wsServer = server;
  }

  // -------------------------------------------------------------------------
  // Main dispatcher
  // -------------------------------------------------------------------------

  async handleEvent(event: AppEvent): Promise<void> {
    if (!this.shouldNotify(event)) return;

    const notification = this.formatNotification(event);
    if (!notification) return;

    const tasks: Promise<void>[] = [];

    // WebSocket notification
    if (notification.userId) {
      tasks.push(
        this.sendWebSocketNotification(notification.userId, notification)
      );
    }

    // Webhook delivery
    if (notification.userId) {
      tasks.push(
        this.getWebhooksForUser(notification.userId).then((webhooks) =>
          Promise.all(
            webhooks
              .filter(
                (w) =>
                  w.enabled &&
                  (w.eventTypes.length === 0 ||
                    w.eventTypes.includes(event.type))
              )
              .map((w) => this.sendWebhook(w.url, { notification, event }, w.secret))
          ).then(() => undefined)
        )
      );
    }

    // Email for critical/error events
    if (
      notification.level === "error" &&
      notification.userId
    ) {
      tasks.push(
        this.sendEmailNotification(
          notification.userId,
          `[IliaGPT] ${notification.title}`,
          notification.body
        )
      );
    }

    await Promise.allSettled(tasks).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") {
          Logger.error("NotificationHandler: task rejected", r.reason);
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Delivery methods
  // -------------------------------------------------------------------------

  private async sendWebSocketNotification(
    userId: string,
    notification: Notification
  ): Promise<void> {
    try {
      if (!this.wsServer) {
        Logger.debug("NotificationHandler: no WS server attached");
        return;
      }

      const payload = { type: "notification", data: notification };

      // If the WS server has a typed sendToUser helper, use it
      if (typeof this.wsServer.sendToUser === "function") {
        this.wsServer.sendToUser(userId, payload);
        Logger.debug("NotificationHandler.sendWebSocketNotification", {
          userId,
          notificationId: notification.id,
        });
        return;
      }

      // Fallback: broadcast to all connected clients that match userId
      if (this.wsServer.clients) {
        const msg = JSON.stringify(payload);
        for (const client of this.wsServer.clients) {
          if (
            (client as any).userId === userId &&
            (client as any).readyState === 1 // OPEN
          ) {
            try {
              (client as any).send(msg);
            } catch (sendErr) {
              Logger.warn("NotificationHandler: ws send error", sendErr);
            }
          }
        }
      }
    } catch (err) {
      Logger.error("NotificationHandler.sendWebSocketNotification error", err);
    }
  }

  private async sendEmailNotification(
    userId: string,
    subject: string,
    body: string
  ): Promise<void> {
    try {
      // Email delivery is handled by the mailer service (injected externally).
      // We emit a structured log entry here that the mailer worker can pick up.
      Logger.info("NotificationHandler.sendEmailNotification", {
        userId,
        subject,
        bodyLength: body.length,
      });
      // TODO: integrate with actual mailer service (e.g. server/services/mailer.ts)
    } catch (err) {
      Logger.error("NotificationHandler.sendEmailNotification error", err);
    }
  }

  private async sendWebhook(
    webhookUrl: string,
    payload: any,
    secret?: string
  ): Promise<void> {
    try {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "IliaGPT-Webhook/1.0",
        "X-IliaGPT-Timestamp": Date.now().toString(),
      };

      if (secret) {
        // HMAC-SHA256 signature in hex
        const { createHmac } = await import("crypto");
        const sig = createHmac("sha256", secret).update(body).digest("hex");
        headers["X-IliaGPT-Signature"] = `sha256=${sig}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        Logger.warn("NotificationHandler.sendWebhook non-2xx response", {
          url: webhookUrl,
          status: resp.status,
        });
      } else {
        Logger.debug("NotificationHandler.sendWebhook delivered", { url: webhookUrl });
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        Logger.warn("NotificationHandler.sendWebhook timeout", { url: webhookUrl });
      } else {
        Logger.error("NotificationHandler.sendWebhook error", {
          err,
          url: webhookUrl,
        });
      }
    }
  }

  private async getWebhooksForUser(userId: string): Promise<WebhookConfig[]> {
    // In production this would query the database.
    // Returning empty array keeps the handler safe when DB is not configured.
    try {
      // TODO: import and call webhookRepository.findByUserId(userId)
      return [];
    } catch (err) {
      Logger.error("NotificationHandler.getWebhooksForUser error", err);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Filtering / formatting
  // -------------------------------------------------------------------------

  shouldNotify(event: AppEvent): boolean {
    const notifiableTypes = new Set<string>([
      EVENT_TYPES.AGENT_TASK_COMPLETED,
      EVENT_TYPES.AGENT_TASK_FAILED,
      EVENT_TYPES.MODEL_ERROR,
      EVENT_TYPES.ERROR_OCCURRED,
      EVENT_TYPES.DOCUMENT_GENERATED,
      EVENT_TYPES.USER_SIGNED_IN,
    ]);
    return notifiableTypes.has(event.type);
  }

  formatNotification(event: AppEvent): Notification | null {
    const base = {
      id: event.id,
      userId: event.userId,
      eventType: event.type,
      timestamp: event.timestamp,
    };

    switch (event.type) {
      case EVENT_TYPES.AGENT_TASK_COMPLETED: {
        const e = event as AgentTaskCompleted;
        return {
          ...base,
          userId: e.payload.userId,
          title: "Agent task completed",
          body: `Your agent task finished in ${e.payload.durationMs}ms.`,
          level: "success",
          metadata: {
            taskId: e.payload.taskId,
            durationMs: e.payload.durationMs,
          },
        };
      }

      case EVENT_TYPES.AGENT_TASK_FAILED: {
        const e = event as AgentTaskFailed;
        return {
          ...base,
          userId: e.payload.userId,
          title: "Agent task failed",
          body: `Agent task failed: ${e.payload.errorMessage}`,
          level: "error",
          metadata: {
            taskId: e.payload.taskId,
            errorCode: e.payload.errorCode,
          },
        };
      }

      case EVENT_TYPES.MODEL_ERROR: {
        const e = event as ModelError;
        return {
          ...base,
          userId: e.userId,
          title: "Model error",
          body: `Model ${e.payload.modelId} encountered an error: ${e.payload.errorMessage}`,
          level: "warning",
          metadata: {
            modelId: e.payload.modelId,
            errorCode: e.payload.errorCode,
            fallback: e.payload.fallbackModelId,
          },
        };
      }

      case EVENT_TYPES.ERROR_OCCURRED: {
        const e = event as ErrorOccurred;
        const level =
          e.payload.severity === "critical" || e.payload.severity === "high"
            ? "error"
            : "warning";
        return {
          ...base,
          userId: e.userId,
          title: `System error (${e.payload.severity})`,
          body: e.payload.errorMessage,
          level,
          metadata: { errorCode: e.payload.errorCode },
        };
      }

      case EVENT_TYPES.DOCUMENT_GENERATED: {
        const e = event as DocumentGenerated;
        return {
          ...base,
          userId: e.payload.userId,
          title: "Document ready",
          body: `Your ${e.payload.documentType} document is ready (${Math.round(e.payload.sizeBytes / 1024)}KB).`,
          level: "success",
          metadata: { documentId: e.payload.documentId },
        };
      }

      case EVENT_TYPES.USER_SIGNED_IN: {
        const e = event as UserSignedIn;
        return {
          ...base,
          userId: e.payload.userId,
          title: "New sign-in",
          body: `New sign-in via ${e.payload.provider}${e.payload.ipAddress ? ` from ${e.payload.ipAddress}` : ""}.`,
          level: "info",
        };
      }

      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const notificationHandler = new NotificationHandler();
