// server/integrations/gateway.ts
export interface SaaSIntegration {
    name: string;
    authType: 'oauth2' | 'apiKey';
    connect(credentials: any): Promise<boolean>;
}

export class StripeIntegration implements SaaSIntegration {
    name = 'stripe';
    authType = 'apiKey' as const;

    async connect(credentials: { secretKey: string }) {
        // init stripe
        return true;
    }
}
