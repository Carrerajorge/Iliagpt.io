import { formatZonedDate, normalizeTimeZone, type PlatformDateFormat } from "@/lib/platformDateTime";

export type BillingStatusPayload = {
  subscriptionStatus: string | null;
  subscriptionPeriodEnd: string | null;
  willDeactivate: boolean;
};

export function shouldShowWorkspaceDeactivationBanner(input: {
  subscriptionStatus: string | null | undefined;
  subscriptionPeriodEnd: string | null | undefined;
  nowMs?: number;
}): boolean {
  const status = input.subscriptionStatus ?? null;
  const raw = input.subscriptionPeriodEnd ?? null;
  if (!status || status === "active") return false;
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return false;
  const now = input.nowMs ?? Date.now();
  return t > now;
}

export function formatPeriodEnd(
  periodEnd: string | null | undefined,
  opts: { timeZone: string; dateFormat: PlatformDateFormat }
): string | null {
  if (!periodEnd) return null;
  const tz = normalizeTimeZone(opts.timeZone);
  const out = formatZonedDate(periodEnd, { timeZone: tz, dateFormat: opts.dateFormat });
  return out || null;
}

// Backward-compat wrapper used by older UI surfaces (e.g. workspace settings).
export function formatPeriodEndEs(periodEnd: string | null | undefined): string | null {
  let guessedTz = "UTC";
  try {
    guessedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // ignore
  }
  return formatPeriodEnd(periodEnd, { timeZone: guessedTz, dateFormat: "DD/MM/YYYY" });
}
