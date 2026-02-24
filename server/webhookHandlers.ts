import { getUncachableStripeClient } from './stripeClient';
import { usageQuotaService } from './services/usageQuotaService';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }


    const stripe = await getUncachableStripeClient();
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );

    if (event.type === 'customer.subscription.created' || 
        event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as any;
      const customerId = subscription.customer;
      
      const [user] = await db.select().from(users)
        .where(eq(users.stripeCustomerId, customerId));
      
      if (user) {
        const status = subscription.status;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        
        let newPlan = 'free';
        if (status === 'active' || status === 'trialing') {
          if (priceId?.includes('enterprise')) {
            newPlan = 'enterprise';
          } else if (priceId?.includes('pro')) {
            newPlan = 'pro';
          }
        }
        
        await usageQuotaService.updateUserPlan(user.id, newPlan);
        await db.update(users)
          .set({ 
            stripeSubscriptionId: subscription.id,
            subscriptionExpiresAt: new Date(subscription.current_period_end * 1000)
          })
          .where(eq(users.id, user.id));
        
        console.log(`[Webhook] Updated user ${user.id} to plan: ${newPlan}`);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as any;
      const customerId = subscription.customer;
      
      const [user] = await db.select().from(users)
        .where(eq(users.stripeCustomerId, customerId));
      
      if (user) {
        await usageQuotaService.updateUserPlan(user.id, 'free');
        await db.update(users)
          .set({ 
            stripeSubscriptionId: null,
            subscriptionExpiresAt: null
          })
          .where(eq(users.id, user.id));
        
        console.log(`[Webhook] User ${user.id} subscription cancelled, reverted to free`);
      }
    }
  }
}
