/**
 * Push Notifications Service - ILIAGPT PRO 3.0
 * 
 * Web push notifications for real-time alerts.
 * Supports service workers and notification preferences.
 */

// ============== Types ==============

export interface NotificationConfig {
    vapidPublicKey: string;
    vapidPrivateKey?: string;
    email?: string;
}

export interface PushSubscription {
    userId: string;
    subscription: {
        endpoint: string;
        keys: {
            p256dh: string;
            auth: string;
        };
    };
    createdAt: Date;
    lastUsed?: Date;
    userAgent?: string;
}

export interface NotificationPayload {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    image?: string;
    tag?: string;
    data?: Record<string, any>;
    actions?: NotificationAction[];
    requireInteraction?: boolean;
    silent?: boolean;
    vibrate?: number[];
}

export interface NotificationAction {
    action: string;
    title: string;
    icon?: string;
}

export interface NotificationPreferences {
    enabled: boolean;
    categories: {
        messages: boolean;
        mentions: boolean;
        updates: boolean;
        marketing: boolean;
        agent: boolean;
    };
    quiet: {
        enabled: boolean;
        startHour: number;
        endHour: number;
        timezone: string;
    };
}

export type NotificationCategory = keyof NotificationPreferences["categories"];

// ============== Storage ==============

const subscriptions: Map<string, PushSubscription[]> = new Map();
const preferences: Map<string, NotificationPreferences> = new Map();
const notificationLog: { userId: string; payload: NotificationPayload; sentAt: Date; delivered: boolean }[] = [];

// ============== Default Preferences ==============

const DEFAULT_PREFERENCES: NotificationPreferences = {
    enabled: true,
    categories: {
        messages: true,
        mentions: true,
        updates: true,
        marketing: false,
        agent: true,
    },
    quiet: {
        enabled: false,
        startHour: 22,
        endHour: 8,
        timezone: "America/New_York",
    },
};

// ============== Push Notification Service ==============

export class PushNotificationService {
    private config: NotificationConfig | null = null;

    /**
     * Initialize with VAPID keys
     */
    initialize(config: NotificationConfig): void {
        this.config = config;
        console.log("[Push] Service initialized");
    }

    // ======== Subscription Management ========

    /**
     * Register a subscription
     */
    async subscribe(
        userId: string,
        subscription: PushSubscription["subscription"],
        userAgent?: string
    ): Promise<boolean> {
        const sub: PushSubscription = {
            userId,
            subscription,
            createdAt: new Date(),
            userAgent,
        };

        const userSubs = subscriptions.get(userId) || [];

        // Check for duplicate
        const exists = userSubs.some(s => s.subscription.endpoint === subscription.endpoint);
        if (!exists) {
            userSubs.push(sub);
            subscriptions.set(userId, userSubs);
        }

        // Set default preferences if not exists
        if (!preferences.has(userId)) {
            preferences.set(userId, { ...DEFAULT_PREFERENCES });
        }

        console.log(`[Push] User ${userId} subscribed`);
        return true;
    }

    /**
     * Unsubscribe endpoint
     */
    async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
        const userSubs = subscriptions.get(userId);
        if (!userSubs) return false;

        const filtered = userSubs.filter(s => s.subscription.endpoint !== endpoint);

        if (filtered.length === userSubs.length) return false;

        subscriptions.set(userId, filtered);
        console.log(`[Push] Endpoint removed for user ${userId}`);
        return true;
    }

    /**
     * Unsubscribe all
     */
    async unsubscribeAll(userId: string): Promise<number> {
        const userSubs = subscriptions.get(userId);
        if (!userSubs) return 0;

        const count = userSubs.length;
        subscriptions.delete(userId);
        return count;
    }

    /**
     * Get user subscriptions
     */
    getSubscriptions(userId: string): PushSubscription[] {
        return subscriptions.get(userId) || [];
    }

    // ======== Preferences ========

    /**
     * Update preferences
     */
    updatePreferences(
        userId: string,
        updates: Partial<NotificationPreferences>
    ): NotificationPreferences {
        const current = preferences.get(userId) || { ...DEFAULT_PREFERENCES };

        const updated = {
            ...current,
            ...updates,
            categories: {
                ...current.categories,
                ...updates.categories,
            },
            quiet: {
                ...current.quiet,
                ...updates.quiet,
            },
        };

        preferences.set(userId, updated);
        return updated;
    }

    /**
     * Get preferences
     */
    getPreferences(userId: string): NotificationPreferences {
        return preferences.get(userId) || { ...DEFAULT_PREFERENCES };
    }

    /**
     * Check if should send
     */
    shouldSend(userId: string, category: NotificationCategory): boolean {
        const prefs = this.getPreferences(userId);

        if (!prefs.enabled) return false;
        if (!prefs.categories[category]) return false;

        // Check quiet hours
        if (prefs.quiet.enabled) {
            const now = new Date();
            const hour = now.getHours(); // Simplified, should use timezone

            if (prefs.quiet.startHour > prefs.quiet.endHour) {
                // Overnight quiet period
                if (hour >= prefs.quiet.startHour || hour < prefs.quiet.endHour) {
                    return false;
                }
            } else {
                if (hour >= prefs.quiet.startHour && hour < prefs.quiet.endHour) {
                    return false;
                }
            }
        }

        return true;
    }

    // ======== Sending Notifications ========

    /**
     * Send notification to user
     */
    async send(
        userId: string,
        payload: NotificationPayload,
        category: NotificationCategory = "messages"
    ): Promise<{ sent: number; failed: number }> {
        if (!this.shouldSend(userId, category)) {
            return { sent: 0, failed: 0 };
        }

        const userSubs = subscriptions.get(userId) || [];

        if (userSubs.length === 0) {
            return { sent: 0, failed: 0 };
        }

        let sent = 0;
        let failed = 0;

        for (const sub of userSubs) {
            try {
                await this.sendToEndpoint(sub.subscription, payload);
                sub.lastUsed = new Date();
                sent++;
            } catch (error) {
                failed++;
                console.error(`[Push] Failed to send to ${sub.subscription.endpoint}:`, error);

                // Remove invalid subscriptions
                if (this.isInvalidSubscription(error)) {
                    await this.unsubscribe(userId, sub.subscription.endpoint);
                }
            }
        }

        // Log notification
        notificationLog.push({
            userId,
            payload,
            sentAt: new Date(),
            delivered: sent > 0,
        });

        return { sent, failed };
    }

    /**
     * Send to multiple users
     */
    async sendBulk(
        userIds: string[],
        payload: NotificationPayload,
        category: NotificationCategory = "updates"
    ): Promise<{ total: number; sent: number; failed: number }> {
        let totalSent = 0;
        let totalFailed = 0;

        for (const userId of userIds) {
            const { sent, failed } = await this.send(userId, payload, category);
            totalSent += sent;
            totalFailed += failed;
        }

        return { total: userIds.length, sent: totalSent, failed: totalFailed };
    }

    /**
     * Send to endpoint (mock implementation)
     */
    private async sendToEndpoint(
        subscription: PushSubscription["subscription"],
        payload: NotificationPayload
    ): Promise<void> {
        // In production, use web-push library:
        // await webpush.sendNotification(subscription, JSON.stringify(payload));

        console.log(`[Push] Sending to ${subscription.endpoint.slice(0, 50)}...`);
        console.log(`[Push] Payload: ${payload.title} - ${payload.body}`);

        // Simulate network delay
        await new Promise(r => setTimeout(r, 100));
    }

    /**
     * Check if subscription is invalid
     */
    private isInvalidSubscription(error: any): boolean {
        // In production, check for 410 Gone or 404 Not Found
        return error?.statusCode === 410 || error?.statusCode === 404;
    }

    // ======== Notification Templates ========

    /**
     * New message notification
     */
    notifyMessage(userId: string, senderName: string, preview: string): Promise<{ sent: number; failed: number }> {
        return this.send(userId, {
            title: `Message from ${senderName}`,
            body: preview.length > 100 ? preview.slice(0, 100) + "..." : preview,
            icon: "/icons/message.png",
            tag: "message",
            data: { type: "message", sender: senderName },
            actions: [
                { action: "reply", title: "Reply" },
                { action: "dismiss", title: "Dismiss" },
            ],
        }, "messages");
    }

    /**
     * Mention notification
     */
    notifyMention(userId: string, mentioner: string, context: string): Promise<{ sent: number; failed: number }> {
        return this.send(userId, {
            title: `${mentioner} mentioned you`,
            body: context,
            icon: "/icons/mention.png",
            tag: "mention",
            requireInteraction: true,
        }, "mentions");
    }

    /**
     * Agent task complete
     */
    notifyAgentComplete(userId: string, taskName: string, success: boolean): Promise<{ sent: number; failed: number }> {
        return this.send(userId, {
            title: success ? "Task Completed" : "Task Failed",
            body: taskName,
            icon: success ? "/icons/success.png" : "/icons/error.png",
            tag: "agent",
            data: { type: "agent", task: taskName, success },
        }, "agent");
    }

    /**
     * System update notification
     */
    notifyUpdate(userId: string, version: string, changes: string): Promise<{ sent: number; failed: number }> {
        return this.send(userId, {
            title: `ILIAGPT ${version} Available`,
            body: changes,
            icon: "/icons/update.png",
            tag: "update",
            actions: [
                { action: "update", title: "Update Now" },
                { action: "later", title: "Later" },
            ],
        }, "updates");
    }

    // ======== Stats ========

    /**
     * Get notification stats
     */
    getStats(userId?: string): {
        total: number;
        delivered: number;
        byCategory: Record<string, number>;
    } {
        let logs = notificationLog;

        if (userId) {
            logs = logs.filter(l => l.userId === userId);
        }

        const byCategory: Record<string, number> = {};
        for (const log of logs) {
            const cat = log.payload.tag || "other";
            byCategory[cat] = (byCategory[cat] || 0) + 1;
        }

        return {
            total: logs.length,
            delivered: logs.filter(l => l.delivered).length,
            byCategory,
        };
    }
}

// ============== Singleton ==============

let pushInstance: PushNotificationService | null = null;

export function getPushNotifications(): PushNotificationService {
    if (!pushInstance) {
        pushInstance = new PushNotificationService();
    }
    return pushInstance;
}

export default PushNotificationService;
