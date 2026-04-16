import { storage } from "../storage";
import type { NotificationEventType, NotificationPreference } from "@shared/schema";

interface NotificationPayload {
  userId: string;
  eventTypeId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  actionUrl?: string;
}

interface ChannelResult {
  sent: boolean;
  error?: string;
}

interface DispatchResult {
  success: boolean;
  skipped: boolean;
  channels: {
    push?: ChannelResult;
    email?: ChannelResult;
  };
  error?: string;
}

async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, any>,
  actionUrl?: string
): Promise<ChannelResult> {
  try {
    console.log(`[Push] Sending to ${userId}: ${title}`);
    return { sent: true };
  } catch (error: any) {
    console.error(`[Push] Failed for ${userId}:`, error);
    return { sent: false, error: error.message };
  }
}

async function sendEmailNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, any>,
  actionUrl?: string
): Promise<ChannelResult> {
  try {
    const user = await storage.getUser(userId);
    if (!user?.email) {
      return { sent: false, error: "No email address" };
    }
    console.log(`[Email] Would send to ${user.email}: ${title}`);
    return { sent: true };
  } catch (error: any) {
    console.error(`[Email] Failed for ${userId}:`, error);
    return { sent: false, error: error.message };
  }
}

function parseChannels(channels: string): { push: boolean; email: boolean } {
  return {
    push: channels === "push" || channels === "push_email",
    email: channels === "email" || channels === "push_email",
  };
}

export async function dispatchNotification(
  payload: NotificationPayload
): Promise<DispatchResult> {
  const { userId, eventTypeId, title, body, data, actionUrl } = payload;
  const result: DispatchResult = { success: false, skipped: false, channels: {} };

  try {
    const preferences = await storage.getNotificationPreferences(userId);
    const pref = preferences.find((p) => p.eventTypeId === eventTypeId);

    if (pref && !pref.enabled) {
      return { success: false, skipped: true, channels: {} };
    }

    const eventTypes = await storage.getNotificationEventTypes();
    const eventType = eventTypes.find((e) => e.id === eventTypeId);

    const channelStr = pref?.channels || eventType?.defaultChannels || "push";
    const channels = parseChannels(channelStr);

    if (!channels.push && !channels.email) {
      return { success: false, skipped: true, channels: {} };
    }

    const promises: Promise<void>[] = [];

    if (channels.push) {
      promises.push(
        sendPushNotification(userId, title, body, data, actionUrl).then((r) => {
          result.channels.push = r;
        })
      );
    }

    if (channels.email) {
      promises.push(
        sendEmailNotification(userId, title, body, data, actionUrl).then((r) => {
          result.channels.email = r;
        })
      );
    }

    await Promise.all(promises);

    const channelResults = Object.values(result.channels).filter(Boolean);
    result.success = channelResults.length > 0 && channelResults.some((c) => c?.sent);

    if (!result.success && channelResults.length > 0) {
      const errors = channelResults
        .filter((c) => c?.error)
        .map((c) => c!.error);
      if (errors.length > 0) {
        result.error = errors.join("; ");
      }
    }
  } catch (error: any) {
    console.error(`[Dispatcher] Error:`, error);
    result.error = error.message;
  }

  return result;
}

export async function dispatchToMultipleUsers(
  userIds: string[],
  eventTypeId: string,
  title: string,
  body: string,
  data?: Record<string, any>,
  actionUrl?: string
): Promise<Map<string, DispatchResult>> {
  const results = new Map<string, DispatchResult>();

  await Promise.all(
    userIds.map(async (userId) => {
      const result = await dispatchNotification({
        userId,
        eventTypeId,
        title,
        body,
        data,
        actionUrl,
      });
      results.set(userId, result);
    })
  );

  return results;
}

export { NotificationPayload, DispatchResult, ChannelResult };
