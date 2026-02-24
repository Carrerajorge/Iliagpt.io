/**
 * Push Notifications Service
 * Web push notifications for real-time updates
 */

// Optional dependency: only available when installed/configured.
// We use require() to avoid hard build-time dependency.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webPush: any = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('web-push');
  } catch {
    return null;
  }
})();

// import { db } from '../db';

// VAPID keys should be in environment variables
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@iliagpt.com';

// Configure web-push
if (webPush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

interface PushSubscription {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}

interface NotificationPayload {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    image?: string;
    tag?: string;
    data?: Record<string, any>;
    actions?: Array<{
        action: string;
        title: string;
        icon?: string;
    }>;
    requireInteraction?: boolean;
    silent?: boolean;
    vibrate?: number[];
}

/**
 * Store a push subscription for a user
 */
export async function saveSubscription(
    userId: number,
    subscription: PushSubscription
): Promise<void> {
    // Store in database (add pushSubscriptions table)
    // For now, use in-memory store
    subscriptionStore.set(userId, subscription);
}

/**
 * Remove a push subscription
 */
export async function removeSubscription(userId: number): Promise<void> {
    subscriptionStore.delete(userId);
}

/**
 * Get user's push subscription
 */
export async function getSubscription(userId: number): Promise<PushSubscription | null> {
    return subscriptionStore.get(userId) || null;
}

// In-memory subscription store (use Redis or DB in production)
const subscriptionStore = new Map<number, PushSubscription>();

/**
 * Send push notification to a user
 */
export async function sendPushNotification(
    userId: number,
    payload: NotificationPayload
): Promise<boolean> {
    try {
        const subscription = await getSubscription(userId);
        if (!subscription) {
            console.log(`No push subscription found for user ${userId}`);
            return false;
        }

        const pushPayload = JSON.stringify({
            ...payload,
            icon: payload.icon || '/icons/icon-192.png',
            badge: payload.badge || '/icons/badge-72.png',
        });

        if (!webPush) {
            console.warn('web-push not installed; skipping push notification');
            return false;
        }
        await webPush.sendNotification(subscription, pushPayload);
        console.log(`Push notification sent to user ${userId}`);
        return true;
    } catch (error: any) {
        console.error('Push notification error:', error);

        // If subscription is invalid, remove it
        if (error.statusCode === 410 || error.statusCode === 404) {
            await removeSubscription(userId);
        }

        return false;
    }
}

/**
 * Send notification to multiple users
 */
export async function sendPushToMany(
    userIds: number[],
    payload: NotificationPayload
): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    await Promise.all(
        userIds.map(async (userId) => {
            const result = await sendPushNotification(userId, payload);
            if (result) success++;
            else failed++;
        })
    );

    return { success, failed };
}

// ============================================
// PREDEFINED NOTIFICATIONS
// ============================================

/**
 * Notify user that AI response is ready
 */
export async function notifyResponseReady(
    userId: number,
    chatTitle: string,
    preview: string
): Promise<boolean> {
    return sendPushNotification(userId, {
        title: 'Respuesta lista',
        body: preview.slice(0, 100) + (preview.length > 100 ? '...' : ''),
        tag: 'response-ready',
        data: { type: 'response', chatTitle },
        actions: [
            { action: 'view', title: 'Ver respuesta' },
            { action: 'dismiss', title: 'Descartar' },
        ],
        requireInteraction: false,
    });
}

/**
 * Notify user of document generation complete
 */
export async function notifyDocumentReady(
    userId: number,
    documentName: string,
    documentType: string
): Promise<boolean> {
    return sendPushNotification(userId, {
        title: 'Documento generado',
        body: `${documentName} está listo para descargar`,
        tag: 'document-ready',
        data: { type: 'document', documentName, documentType },
        actions: [
            { action: 'download', title: 'Descargar' },
            { action: 'view', title: 'Ver' },
        ],
        requireInteraction: true,
    });
}

/**
 * Notify user of shared chat/document
 */
export async function notifyShared(
    userId: number,
    sharerName: string,
    itemType: 'chat' | 'document' | 'project',
    itemName: string
): Promise<boolean> {
    return sendPushNotification(userId, {
        title: `${sharerName} compartió contigo`,
        body: `${itemType === 'chat' ? 'Conversación' : itemType === 'document' ? 'Documento' : 'Proyecto'}: ${itemName}`,
        tag: 'shared-item',
        data: { type: 'shared', sharerName, itemType, itemName },
        actions: [
            { action: 'view', title: 'Ver ahora' },
        ],
    });
}

/**
 * Notify user of background task completion
 */
export async function notifyTaskComplete(
    userId: number,
    taskName: string,
    success: boolean
): Promise<boolean> {
    return sendPushNotification(userId, {
        title: success ? 'Tarea completada' : 'Error en tarea',
        body: taskName,
        tag: 'task-complete',
        data: { type: 'task', taskName, success },
    });
}

// ============================================
// ROUTER ENDPOINTS
// ============================================

import { Router } from 'express';

export function createPushRouter() {
    const router = Router();

    // Subscribe to push notifications
    router.post('/subscribe', async (req, res) => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { subscription } = req.body;
            if (!subscription || !subscription.endpoint || !subscription.keys) {
                return res.status(400).json({ error: 'Invalid subscription' });
            }

            await saveSubscription(userId, subscription);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to save subscription' });
        }
    });

    // Unsubscribe from push notifications
    router.post('/unsubscribe', async (req, res) => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            await removeSubscription(userId);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to remove subscription' });
        }
    });

    // Get VAPID public key
    router.get('/vapid-public-key', (req, res) => {
        res.json({ publicKey: VAPID_PUBLIC_KEY });
    });

    // Test notification (development only)
    if (process.env.NODE_ENV === 'development') {
        router.post('/test', async (req, res) => {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const success = await sendPushNotification(userId, {
                title: 'Test Notification',
                body: 'Este es un mensaje de prueba',
            });

            res.json({ success });
        });
    }

    return router;
}
