/**
 * Shared HTTP delivery for NotificationHandler webhooks.
 * Used by the BullMQ worker (retries via job attempts) and inline fallback when Redis is off.
 */
import { createHmac } from "crypto";
import { Logger } from "./logger";

export type NotificationWebhookJobData = {
  url: string;
  payload: unknown;
  secret?: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function buildHeaders(body: string, secret?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "IliaGPT-Webhook/1.0",
    "X-IliaGPT-Timestamp": Date.now().toString(),
  };
  if (secret) {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    headers["X-IliaGPT-Signature"] = `sha256=${sig}`;
  }
  return headers;
}

/**
 * Single POST attempt. Throws on network/abort; returns false if response not ok (caller may retry).
 */
export async function postNotificationWebhookOnce(
  data: NotificationWebhookJobData,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ ok: boolean; status: number }> {
  const body = JSON.stringify(data.payload);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(data.url, {
      method: "POST",
      headers: buildHeaders(body, data.secret),
      body,
      signal: controller.signal,
    });
    return { ok: resp.ok, status: resp.status };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * For BullMQ: treat non-2xx as failure so job retries fire.
 */
export async function deliverNotificationWebhookOrThrow(data: NotificationWebhookJobData): Promise<void> {
  let result: { ok: boolean; status: number };
  try {
    result = await postNotificationWebhookOnce(data);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      Logger.warn("[NotificationWebhook] timeout", { url: data.url });
    } else {
      Logger.error("[NotificationWebhook] fetch error", { url: data.url, err: err?.message });
    }
    throw err;
  }
  if (!result.ok) {
    Logger.warn("[NotificationWebhook] non-2xx", { url: data.url, status: result.status });
    throw new Error(`Webhook HTTP ${result.status}`);
  }
  Logger.debug("[NotificationWebhook] delivered", { url: data.url });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * When Redis/BullMQ is unavailable: bounded retries with backoff.
 */
export async function deliverNotificationWebhookWithRetries(
  data: NotificationWebhookJobData,
  maxAttempts = 3
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await deliverNotificationWebhookOrThrow(data);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        const delay = Math.min(800 * 2 ** (attempt - 1), 8000) + Math.random() * 400;
        await sleep(delay);
      }
    }
  }
  Logger.error("[NotificationWebhook] exhausted inline retries", {
    url: data.url,
    err: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
}
