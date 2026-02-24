/**
 * Webhook System
 * Send events to external URLs
 */

import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { auditLog } from "../services/auditLogger";
import crypto from "crypto";
import net from "net";
import { actionTriggerDaemon } from "../services/actionTriggerDaemon";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
function safeErrorMessage(error: unknown): string {
  if (!IS_PRODUCTION && error instanceof Error) return error.message;
  return "Internal server error";
}

function assertSafeWebhookUrl(raw: string): string {
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP/HTTPS webhook URLs are allowed");
  }
  const hostname = parsed.hostname.toLowerCase();
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];
  if (
    blocked.includes(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(hostname)
  ) {
    throw new Error("Webhook URLs to internal/private addresses are blocked");
  }
  if (net.isIP(hostname)) {
    // Additional check for IPv6-mapped IPv4 loopback
    if (hostname.startsWith("::ffff:127.") || hostname === "::ffff:0.0.0.0") {
      throw new Error("Webhook URLs to internal/private addresses are blocked");
    }
  }
  return parsed.href;
}

export const webhooksRouter = Router();

// Ensure table exists
const ensureTable = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webhooks (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        secret VARCHAR(255),
        events JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        last_triggered_at TIMESTAMP,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        webhook_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB,
        response_status INTEGER,
        response_body TEXT,
        duration_ms INTEGER,
        success BOOLEAN,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id)`);
  } catch (e) {
    // Tables might already exist
  }
};

ensureTable();

// Available event types
const EVENT_TYPES = [
  'chat.created',
  'chat.message',
  'chat.completed',
  'user.registered',
  'user.login',
  'payment.completed',
  'document.generated',
  'agent.task_completed'
];

// GET /api/webhooks - List user's webhooks
webhooksRouter.get("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const result = await db.execute(sql`
      SELECT * FROM webhooks WHERE user_id = ${userId} ORDER BY created_at DESC
    `);

    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: safeErrorMessage(error) });
  }
});

// GET /api/webhooks/events - List available events
webhooksRouter.get("/events", async (req, res) => {
  res.json(EVENT_TYPES);
});

// POST /api/webhooks/inbound/:hookId - Receiver for incoming webhook requests handled by ActionTriggerDaemon
webhooksRouter.post("/inbound/:hookId", (req, res) => {
  const hookId = req.params.hookId;
  const payload = req.body;

  // Pass payload directly to the daemon which will trigger loaded workflows/agents if active
  actionTriggerDaemon.handleWebhook(hookId, payload);
  res.status(200).json({ success: true, message: "Webhook received and trigger emitted." });
});

// POST /api/webhooks - Create webhook
webhooksRouter.post("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const { name, url, events, secret } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: "name and url are required" });
    }

    // Validate URL and block internal/private targets
    try {
      assertSafeWebhookUrl(url);
    } catch (e: any) {
      return res.status(400).json({ error: e.message || "Invalid URL" });
    }

    // Generate secret if not provided
    const webhookSecret = secret || crypto.randomBytes(32).toString('hex');

    const result = await db.execute(sql`
      INSERT INTO webhooks (user_id, name, url, secret, events)
      VALUES (${userId}, ${name}, ${url}, ${webhookSecret}, ${JSON.stringify(events || [])})
      RETURNING *
    `);

    await auditLog(req, {
      action: "webhook.created",
      resource: "webhooks",
      resourceId: result.rows?.[0]?.id,
      details: { name, url, events },
      category: "system",
      severity: "info"
    });

    res.json(result.rows?.[0]);
  } catch (error: any) {
    res.status(500).json({ error: safeErrorMessage(error) });
  }
});

// PATCH /api/webhooks/:id - Update webhook
webhooksRouter.patch("/:id", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const { name, url, events, isActive } = req.body;

    // Validate URL if being updated
    if (url) {
      try {
        assertSafeWebhookUrl(url);
      } catch (e: any) {
        return res.status(400).json({ error: e.message || "Invalid URL" });
      }
    }

    const result = await db.execute(sql`
      UPDATE webhooks SET
        name = COALESCE(${name}, name),
        url = COALESCE(${url}, url),
        events = COALESCE(${events ? JSON.stringify(events) : null}, events),
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING *
    `);

    if (!result.rows?.length) {
      return res.status(404).json({ error: "Webhook not found" });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: safeErrorMessage(error) });
  }
});

// DELETE /api/webhooks/:id - Delete webhook
webhooksRouter.delete("/:id", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    await db.execute(sql`
      DELETE FROM webhooks WHERE id = ${req.params.id} AND user_id = ${userId}
    `);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: safeErrorMessage(error) });
  }
});

// GET /api/webhooks/:id/logs - Get webhook logs
webhooksRouter.get("/:id/logs", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    // Verify webhook ownership before showing logs
    const ownerCheck = await db.execute(sql`
      SELECT id FROM webhooks WHERE id = ${req.params.id} AND user_id = ${userId}
    `);
    if (!ownerCheck.rows?.length) {
      return res.status(404).json({ error: "Webhook not found" });
    }

    const rawLimit = parseInt(req.query.limit as string) || 50;
    const limit = Math.min(Math.max(rawLimit, 1), 200);

    const result = await db.execute(sql`
      SELECT * FROM webhook_logs
      WHERE webhook_id = ${req.params.id}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: safeErrorMessage(error) });
  }
});

// POST /api/webhooks/:id/test - Test webhook
webhooksRouter.post("/:id/test", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const webhookResult = await db.execute(sql`
      SELECT * FROM webhooks WHERE id = ${req.params.id} AND user_id = ${userId}
    `);

    if (!webhookResult.rows?.length) {
      return res.status(404).json({ error: "Webhook not found" });
    }

    const webhook = webhookResult.rows[0];
    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook' }
    };

    const result = await sendWebhook(webhook, 'test', testPayload);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: safeErrorMessage(error) });
  }
});

// ============= WEBHOOK DISPATCH =============

interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
}

export async function sendWebhook(
  webhook: Webhook,
  eventType: string,
  payload: any
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const startTime = Date.now();

  // Sign payload
  const signature = crypto
    .createHmac('sha256', webhook.secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  try {
    // Validate URL to prevent SSRF on outbound webhook dispatch
    assertSafeWebhookUrl(webhook.url);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': eventType,
        'X-Webhook-Timestamp': new Date().toISOString()
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000) // 10s timeout
    });

    const duration = Date.now() - startTime;
    const responseBody = await response.text().catch(() => '');

    // Log the attempt
    await db.execute(sql`
      INSERT INTO webhook_logs (webhook_id, event_type, payload, response_status, response_body, duration_ms, success)
      VALUES (${webhook.id}, ${eventType}, ${JSON.stringify(payload)}, ${response.status}, ${responseBody.substring(0, 1000)}, ${duration}, ${response.ok})
    `);

    // Update webhook stats
    if (response.ok) {
      await db.execute(sql`
        UPDATE webhooks SET success_count = success_count + 1, last_triggered_at = NOW() WHERE id = ${webhook.id}
      `);
    } else {
      await db.execute(sql`
        UPDATE webhooks SET failure_count = failure_count + 1, last_triggered_at = NOW() WHERE id = ${webhook.id}
      `);
    }

    return { success: response.ok, statusCode: response.status };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    await db.execute(sql`
      INSERT INTO webhook_logs (webhook_id, event_type, payload, response_body, duration_ms, success)
      VALUES (${webhook.id}, ${eventType}, ${JSON.stringify(payload)}, ${safeErrorMessage(error)}, ${duration}, false)
    `);

    await db.execute(sql`
      UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ${webhook.id}
    `);

    return { success: false, error: safeErrorMessage(error) };
  }
}

export async function dispatchWebhook(eventType: string, payload: any, userId?: string) {
  try {
    // Find all active webhooks subscribed to this event
    let query = sql`
      SELECT * FROM webhooks
      WHERE is_active = true
      AND events @> ${JSON.stringify([eventType])}::jsonb
    `;

    if (userId) {
      query = sql`
        SELECT * FROM webhooks
        WHERE is_active = true
        AND user_id = ${userId}
        AND events @> ${JSON.stringify([eventType])}::jsonb
      `;
    }

    const result = await db.execute(query);
    const webhooks = result.rows || [];

    // Send to all matching webhooks (async, don't wait)
    for (const webhook of webhooks) {
      sendWebhook(webhook as Webhook, eventType, {
        event: eventType,
        timestamp: new Date().toISOString(),
        data: payload
      }).catch(console.error);
    }

    return { dispatched: webhooks.length };
  } catch (error) {
    console.error('[Webhook] Dispatch error:', error);
    return { dispatched: 0 };
  }
}
