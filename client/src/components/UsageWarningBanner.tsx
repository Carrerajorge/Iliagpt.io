import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X, AlertTriangle, Zap } from "lucide-react";

const DISMISS_KEY = "usage-banner-dismissed-at";
const DISMISS_DURATION = 60 * 60 * 1000; // 1 hour

interface QuotaStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: string;
  plan: string;
}

function isDismissed(): boolean {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  return Date.now() - Number(raw) < DISMISS_DURATION;
}

export default function UsageWarningBanner() {
  const [dismissed, setDismissed] = useState(isDismissed);

  const { data } = useQuery<QuotaStatus>({
    queryKey: ["quota-status"],
    queryFn: () => apiFetch("/api/user/quota-status").then((r) => r.json()),
    refetchInterval: 60_000,
    retry: false,
  });

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }, []);

  if (!data || dismissed) return null;

  const used = data.limit - data.remaining;
  const pct = data.limit > 0 ? (used / data.limit) * 100 : 0;
  const atLimit = pct >= 100;
  const nearLimit = pct >= 80;

  if (!nearLimit) return null;

  const usedLabel = used >= 1000 ? `${Math.round(used / 1000)}K` : String(used);
  const limitLabel =
    data.limit >= 1000 ? `${Math.round(data.limit / 1000)}K` : String(data.limit);

  const resetTime = new Date(data.resetAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-sm font-medium",
        "sm:flex-row flex-col sm:text-left text-center",
        atLimit
          ? "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200"
          : "bg-yellow-100 text-yellow-900 dark:bg-yellow-950/60 dark:text-yellow-200",
      )}
    >
      {atLimit ? (
        <Zap className="h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      )}

      <span className="flex-1">
        {atLimit
          ? "You've reached your daily limit. Upgrade to Pro for 10x more tokens."
          : `You've used ${Math.round(pct)}% of your daily tokens (${usedLabel}/${limitLabel}). Resets at ${resetTime}.`}
      </span>

      {data.plan === "free" && (
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "shrink-0",
            atLimit
              ? "border-red-300 text-red-900 hover:bg-red-200 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900"
              : "border-yellow-300 text-yellow-900 hover:bg-yellow-200 dark:border-yellow-700 dark:text-yellow-200 dark:hover:bg-yellow-900",
          )}
          asChild
        >
          <a href="/settings/billing">Upgrade</a>
        </Button>
      )}

      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        className={cn(
          "shrink-0 rounded p-1 transition-colors",
          atLimit
            ? "hover:bg-red-200 dark:hover:bg-red-900"
            : "hover:bg-yellow-200 dark:hover:bg-yellow-900",
        )}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
