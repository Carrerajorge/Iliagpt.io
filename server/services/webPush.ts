/**
 * Web Push helper (VAPID + sendNotification)
 *
 * Notes:
 * - Uses optional dependency `web-push`. If missing, calls will no-op.
 * - If VAPID keys are not provided via env, we generate ephemeral keys at runtime.
 *   This is fine for local dev but will invalidate subscriptions on server restart.
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);

let webPush: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  webPush = require("web-push");
} catch {
  webPush = null;
}

type VapidKeys = { publicKey: string; privateKey: string };

let runtimeKeys: VapidKeys | null = null;
let configuredForKeys: string | null = null;

function getConfiguredVapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  if (publicKey && privateKey) return { publicKey, privateKey };
  return null;
}

function getVapidKeys(): { keys: VapidKeys; isEphemeral: boolean } | null {
  const configured = getConfiguredVapidKeys();
  if (configured) return { keys: configured, isEphemeral: false };

  if (!webPush) return null;

  if (!runtimeKeys) {
    runtimeKeys = webPush.generateVAPIDKeys();
  }
  return { keys: runtimeKeys, isEphemeral: true };
}

function ensureWebPushConfigured(): { publicKey: string; isEphemeral: boolean } | null {
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@iliagpt.com";
  const keys = getVapidKeys();
  if (!keys || !webPush) return null;

  // Avoid resetting global config unless keys changed.
  const signature = `${subject}:${keys.keys.publicKey}`;
  if (configuredForKeys !== signature) {
    webPush.setVapidDetails(subject, keys.keys.publicKey, keys.keys.privateKey);
    configuredForKeys = signature;
  }

  return { publicKey: keys.keys.publicKey, isEphemeral: keys.isEphemeral };
}

export function getVapidPublicKey(): { publicKey: string; isEphemeral: boolean } | null {
  return ensureWebPushConfigured();
}

export function isWebPushAvailable(): boolean {
  return !!ensureWebPushConfigured();
}

export async function sendWebPush(
  subscription: unknown,
  payload: unknown,
): Promise<{ ok: boolean; error?: string; statusCode?: number }> {
  const configured = ensureWebPushConfigured();
  if (!configured || !webPush) {
    return { ok: false, error: "WEB_PUSH_NOT_CONFIGURED" };
  }

  try {
    const body = JSON.stringify(payload ?? {});
    await webPush.sendNotification(subscription, body);
    return { ok: true };
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message || "WEB_PUSH_FAILED",
      statusCode: error?.statusCode,
    };
  }
}

