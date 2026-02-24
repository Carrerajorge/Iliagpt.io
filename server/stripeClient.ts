import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

// Get the secret key lazily to ensure dotenv has loaded
function getSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return key;
}

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(getSecretKey(), {
      apiVersion: '2026-01-28.clover',
    });
  }
  return stripeClient;
}

// Alias for backwards compatibility
export async function getUncachableStripeClient(): Promise<Stripe> {
  return getStripeClient();
}

export function getStripePublishableKey(): string {
  const key = process.env.STRIPE_PUBLISHABLE_KEY || '';
  if (!key) {
    throw new Error('STRIPE_PUBLISHABLE_KEY not configured');
  }
  return key;
}

export function getStripeSecretKey(): string {
  return getSecretKey();
}

// Plan configuration
export const STRIPE_PLANS = {
  go: {
    name: 'Go',
    price: 5,
    priceId: process.env.STRIPE_PRICE_GO || '', // Will be created in Stripe
  },
  plus: {
    name: 'Plus',
    price: 10,
    priceId: process.env.STRIPE_PRICE_PLUS || '',
  },
  pro: {
    name: 'Pro',
    price: 200,
    priceId: process.env.STRIPE_PRICE_PRO || '',
  },
  business: {
    name: 'Business',
    price: 25,
    priceId: process.env.STRIPE_PRICE_BUSINESS || '',
  },
};

export type PlanType = keyof typeof STRIPE_PLANS;
