export const FREE_MODEL_ID = "google/gemma-3-27b-it:free";

export const FREE_MODEL_IDS = new Set([
  "google/gemma-4-31b-it",
  "google/gemma-4-31b-it:free",
  "google/gemma-3-27b-it:free",
  "grok-4-1-fast-non-reasoning",
  "x-ai/grok-4.1-fast",
]);

export function isModelFreeForAll(modelId: string): boolean {
  return FREE_MODEL_IDS.has(modelId);
}

export type UserPlan = {
  plan?: string | null;
  role?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPlan?: string | null;
  subscriptionPeriodEnd?: string | Date | null;
  subscriptionExpiresAt?: string | Date | null;
};

function toLower(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function getEffectivePlan(user?: UserPlan | null): string {
  if (!user) return "free";

  const role = toLower(user.role);
  if (role === "admin" || role === "superadmin") return "admin";

  // If subscription is active and a subscriptionPlan exists, prefer it.
  // (We keep this conservative: only treat as paid when status is 'active'.)
  const subStatus = toLower(user.subscriptionStatus);
  const subPlan = toLower(user.subscriptionPlan);
  if (subStatus === "active" && subPlan) return subPlan;

  const plan = toLower(user.plan);
  return plan || "free";
}

export function getPlanLabel(user?: UserPlan | null): string {
  const plan = getEffectivePlan(user);
  switch (plan) {
    case "free":
      return "Free";
    case "admin":
      return "Admin";
    case "enterprise":
    case "business":
      return "Enterprise";
    case "go":
      return "Go";
    case "plus":
      return "Plus";
    case "pro":
      return "Pro";
    default:
      // Fallback: show raw plan in a stable, non-shouty way
      return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Free";
  }
}

export function isPaidPlan(user?: UserPlan | null): boolean {
  const plan = getEffectivePlan(user);
  return plan !== "free" && plan !== "admin";
}

export function isFreeTierUser(user?: UserPlan | null): boolean {
  const plan = getEffectivePlan(user);
  return plan === "free";
}
