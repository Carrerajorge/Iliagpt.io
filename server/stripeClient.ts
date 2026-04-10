import Stripe from 'stripe';

let connectionSettings: any;

async function getCredentials(): Promise<{ publishableKey: string; secretKey: string }> {
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY) {
    return {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      secretKey: process.env.STRIPE_SECRET_KEY,
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken || !hostname) {
    throw new Error('Stripe credentials not found: set STRIPE_SECRET_KEY/STRIPE_PUBLISHABLE_KEY or connect Stripe via Replit integrations');
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Replit-Token': xReplitToken
    }
  });

  const data = await response.json();

  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil',
  });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
  return secretKey;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}

export async function runStripeMigrations() {
  const { runMigrations } = await import('stripe-replit-sync');
  await runMigrations({
    databaseUrl: process.env.DATABASE_URL!,
  });
}

export const STRIPE_PLANS = {
  go: {
    name: 'Go',
    price: 5,
    priceId: process.env.STRIPE_PRICE_GO || '',
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
