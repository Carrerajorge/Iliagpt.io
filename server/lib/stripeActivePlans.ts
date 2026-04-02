export const ACTIVE_SUBSCRIPTION_PLANS = {
  go: {
    alias: "price_go_monthly",
    name: "Go",
    amount: 500,
    interval: "month",
    defaultProductId: "prod_UCZVvFMHeIWdLC",
  },
  plus: {
    alias: "price_plus_monthly",
    name: "Plus",
    amount: 1000,
    interval: "month",
    defaultProductId: "prod_UCZWW8ZDfZzUWk",
  },
} as const;

export type ActiveSubscriptionPlanKey = keyof typeof ACTIVE_SUBSCRIPTION_PLANS;

const PRODUCT_ENV_KEYS: Record<ActiveSubscriptionPlanKey, "STRIPE_PRODUCT_GO" | "STRIPE_PRODUCT_PLUS"> = {
  go: "STRIPE_PRODUCT_GO",
  plus: "STRIPE_PRODUCT_PLUS",
};

const PRICE_ENV_KEYS: Record<ActiveSubscriptionPlanKey, "STRIPE_PRICE_GO" | "STRIPE_PRICE_PLUS"> = {
  go: "STRIPE_PRICE_GO",
  plus: "STRIPE_PRICE_PLUS",
};

export const ACTIVE_SUBSCRIPTION_PLAN_KEYS = Object.keys(
  ACTIVE_SUBSCRIPTION_PLANS,
) as ActiveSubscriptionPlanKey[];

export function getConfiguredProductId(planKey: ActiveSubscriptionPlanKey): string {
  const envValue = String(process.env[PRODUCT_ENV_KEYS[planKey]] || "").trim();
  return envValue || ACTIVE_SUBSCRIPTION_PLANS[planKey].defaultProductId;
}

export function getConfiguredPriceId(planKey: ActiveSubscriptionPlanKey): string | null {
  const envValue = String(process.env[PRICE_ENV_KEYS[planKey]] || "").trim();
  return envValue || null;
}

export function getAllowedProductIds(): string[] {
  return ACTIVE_SUBSCRIPTION_PLAN_KEYS.map((planKey) => getConfiguredProductId(planKey));
}

export function getPlanKeyFromAlias(alias?: string | null): ActiveSubscriptionPlanKey | null {
  const normalized = String(alias || "").trim();
  if (!normalized) return null;

  for (const planKey of ACTIVE_SUBSCRIPTION_PLAN_KEYS) {
    if (ACTIVE_SUBSCRIPTION_PLANS[planKey].alias === normalized) {
      return planKey;
    }
  }

  return null;
}

export function getPlanKeyFromProductId(productId?: string | null): ActiveSubscriptionPlanKey | null {
  const normalized = String(productId || "").trim();
  if (!normalized) return null;

  for (const planKey of ACTIVE_SUBSCRIPTION_PLAN_KEYS) {
    if (getConfiguredProductId(planKey) === normalized) {
      return planKey;
    }
  }

  return null;
}

export function getPlanKeyFromAmount(amount?: number | null): ActiveSubscriptionPlanKey | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;

  for (const planKey of ACTIVE_SUBSCRIPTION_PLAN_KEYS) {
    if (ACTIVE_SUBSCRIPTION_PLANS[planKey].amount === amount) {
      return planKey;
    }
  }

  return null;
}

export function getPlanKeyFromConfiguredPriceId(priceId?: string | null): ActiveSubscriptionPlanKey | null {
  const normalized = String(priceId || "").trim();
  if (!normalized) return null;

  for (const planKey of ACTIVE_SUBSCRIPTION_PLAN_KEYS) {
    if (getConfiguredPriceId(planKey) === normalized) {
      return planKey;
    }
  }

  return null;
}
