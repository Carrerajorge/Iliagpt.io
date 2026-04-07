import { memo } from "react";
import { cn } from "@/lib/utils";

// Re-export the base Skeleton from the existing skeleton.tsx for convenience
export { Skeleton } from "@/components/ui/skeleton";

/**
 * Accessible icon button helper.
 * Wraps an icon-only button ensuring it always carries an aria-label.
 * Usage:
 *   <IconButton aria-label="Close" onClick={onClose}><X /></IconButton>
 */
export function IconButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skeleton building blocks (use the shimmer from the base Skeleton)
// ---------------------------------------------------------------------------

function ShimmerBlock({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// ChatListSkeleton — sidebar list of chats (5 rows)
// ---------------------------------------------------------------------------

function ChatListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" role="presentation">
      <ShimmerBlock className="h-9 w-9 rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <ShimmerBlock className="h-4 w-3/4" />
        <ShimmerBlock className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export const ChatListSkeleton = memo(function ChatListSkeleton({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)} role="status" aria-label="Cargando lista de chats">
      <span className="sr-only">Cargando lista de chats...</span>
      {Array.from({ length: count }).map((_, i) => (
        <ChatListItemSkeleton key={i} />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// MessageSkeleton — single message (avatar + text block)
// ---------------------------------------------------------------------------

export const MessageSkeleton = memo(function MessageSkeleton({
  align = "left",
  className,
}: {
  align?: "left" | "right";
  className?: string;
}) {
  if (align === "right") {
    return (
      <div className={cn("flex justify-end", className)} role="presentation">
        <div className="max-w-[70%] space-y-2">
          <ShimmerBlock className="h-10 w-48 rounded-2xl ml-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3", className)} role="presentation">
      <ShimmerBlock className="w-8 h-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2 max-w-[70%]">
        <ShimmerBlock className="h-4 w-full" />
        <ShimmerBlock className="h-4 w-5/6" />
        <ShimmerBlock className="h-4 w-3/5" />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// MessageListSkeleton — 4 messages alternating left/right
// ---------------------------------------------------------------------------

export const MessageListSkeleton = memo(function MessageListSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4 p-4", className)} role="status" aria-label="Cargando mensajes">
      <span className="sr-only">Cargando mensajes...</span>
      {Array.from({ length: count }).map((_, i) => (
        <MessageSkeleton key={i} align={i % 2 === 0 ? "right" : "left"} />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// DashboardSkeleton — grid of 4 stat cards + chart placeholder
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <ShimmerBlock className="h-4 w-24" />
        <ShimmerBlock className="h-4 w-4 rounded" />
      </div>
      <ShimmerBlock className="h-8 w-20" />
      <ShimmerBlock className="h-3 w-32" />
    </div>
  );
}

export const DashboardSkeleton = memo(function DashboardSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("space-y-6 p-4", className)} role="status" aria-label="Cargando panel">
      <span className="sr-only">Cargando panel...</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      {/* Chart placeholder */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <ShimmerBlock className="h-5 w-32" />
          <ShimmerBlock className="h-8 w-24 rounded-md" />
        </div>
        <ShimmerBlock className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// SettingsSkeleton — form-like layout (labels + inputs)
// ---------------------------------------------------------------------------

function SettingsFieldSkeleton() {
  return (
    <div className="space-y-2">
      <ShimmerBlock className="h-4 w-28" />
      <ShimmerBlock className="h-10 w-full rounded-md" />
    </div>
  );
}

export const SettingsSkeleton = memo(function SettingsSkeleton({
  fields = 5,
  className,
}: {
  fields?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-6 p-4 max-w-2xl", className)} role="status" aria-label="Cargando configuracion">
      <span className="sr-only">Cargando configuracion...</span>
      {/* Section header */}
      <div className="space-y-2">
        <ShimmerBlock className="h-6 w-40" />
        <ShimmerBlock className="h-4 w-64" />
      </div>
      {/* Form fields */}
      <div className="space-y-5">
        {Array.from({ length: fields }).map((_, i) => (
          <SettingsFieldSkeleton key={i} />
        ))}
      </div>
      {/* Action button */}
      <ShimmerBlock className="h-10 w-32 rounded-md" />
    </div>
  );
});
