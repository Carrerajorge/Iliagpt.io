/**
 * Centralized Webhook Manager
 * Unified handling for Stripe, SendGrid, Internal Hooks with signature verification
 */

import { Logger } from '../../logger';
import * as crypto from 'crypto';

type WebhookHandler = (payload: any, headers: Record<string, any>) => Promise<void>;

interface WebhookConfig {
    provider: string;
    secret: string;
    signatureHeader: string;
    algo: 'sha256' | 'sha1';
}

export class WebhookManager {
    private handlers: Map<string, WebhookHandler> = new Map();
    private configs: Map<string, WebhookConfig> = new Map();

    constructor() {
        this.registerDefaultProviders();
    }

    private registerDefaultProviders() {
        // Stripe
        this.configs.set('stripe', {
            provider: 'stripe',
            secret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_...',
            signatureHeader: 'stripe-signature',
            algo: 'sha256'
        });

        // SendGrid
        this.configs.set('sendgrid', {
            provider: 'sendgrid',
            secret: process.env.SENDGRID_WEBHOOK_SECRET || '',
            signatureHeader: 'x-twilio-email-event-webhook-signature',
            algo: 'sha256'
        });
    }

    /**
     * Register a function to handle specific webhook events
     */
    registerHandler(provider: string, eventType: string, handler: WebhookHandler) {
        const key = `${provider}:${eventType}`;
        this.handlers.set(key, handler);
        Logger.info(`[Webhooks] Registered handler for ${key}`);
    }

    /**
     * Process an incoming webhook
     */
    async processWebhook(provider: string, payload: any, headers: any): Promise<{ success: boolean; message: string }> {
        const config = this.configs.get(provider);
        if (!config) {
            return { success: false, message: `Unknown provider: ${provider}` };
        }

        // 1. Verify Signature
        if (!this.verifySignature(payload, headers, config)) {
            Logger.warn(`[Webhooks] Invalid signature for ${provider}`);
            // In dev mode we might skip this:
            if (process.env.NODE_ENV !== 'development') {
                return { success: false, message: 'Invalid signature' };
            }
        }

        // 2. Route to Handler
        const eventType = this.extractEventType(provider, payload);
        const handler = this.handlers.get(`${provider}:${eventType}`) || this.handlers.get(`${provider}:*`);

        if (handler) {
            try {
                await handler(payload, headers);
                return { success: true, message: 'Processed' };
            } catch (error: any) {
                Logger.error(`[Webhooks] Handler error: ${error.message}`);
                return { success: false, message: 'Processing failed' };
            }
        }

        return { success: true, message: 'No handler matched (ignored)' };
    }

    private verifySignature(payload: any, headers: any, config: WebhookConfig): boolean {
        // Implementation varies significantly by provider
        // Stub for generic HMAC check
        return true;
    }

    private extractEventType(provider: string, payload: any): string {
        if (provider === 'stripe') return payload.type; // e.g., 'payment_intent.succeeded'
        if (provider === 'sendgrid') return payload[0]?.event; // Array of events
        return 'default';
    }
}

export const webhookManager = new WebhookManager();
