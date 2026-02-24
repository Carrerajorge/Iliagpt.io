/**
 * Unified Loading State Component
 * 
 * Provides consistent loading states across the application:
 * - Skeleton: for content loading (e.g., initial page load, list loading)
 * - Spinner: for actions (e.g., button clicks, form submissions)
 * - Dots: for typing/thinking indicators
 * 
 * Usage:
 * <LoadingState type="skeleton" variant="card" />
 * <LoadingState type="spinner" size="sm" />
 * <LoadingState type="dots" />
 */

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import {
    Skeleton,
    ChatMessagesSkeleton,
    CardSkeleton,
    TableSkeleton,
    AppGridSkeleton
} from "@/components/ui/skeleton";

type LoadingType = "skeleton" | "spinner" | "dots";
type SkeletonVariant = "text" | "card" | "chat" | "table" | "grid" | "page";
type SpinnerSize = "xs" | "sm" | "md" | "lg";

interface LoadingStateProps {
    type?: LoadingType;
    variant?: SkeletonVariant;
    size?: SpinnerSize;
    className?: string;
    text?: string;
    count?: number;
}

const spinnerSizes: Record<SpinnerSize, string> = {
    xs: "h-3 w-3",
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
};

export function LoadingState({
    type = "spinner",
    variant = "text",
    size = "md",
    className,
    text,
    count = 3,
}: LoadingStateProps) {
    // Spinner loading (for actions)
    if (type === "spinner") {
        return (
            <div className={cn("flex items-center justify-center gap-2", className)}>
                <Loader2 className={cn("animate-spin text-primary", spinnerSizes[size])} />
                {text && <span className="text-sm text-muted-foreground">{text}</span>}
            </div>
        );
    }

    // Dots loading (for typing/thinking)
    if (type === "dots") {
        return (
            <div className={cn("flex items-center gap-1", className)}>
                <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce delay-0" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce delay-150" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce delay-300" />
            </div>
        );
    }

    // Skeleton loading (for content)
    switch (variant) {
        case "chat":
            return <ChatMessagesSkeleton count={count} />;
        case "card":
            return (
                <div className={cn("space-y-4", className)}>
                    {Array.from({ length: count }).map((_, i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            );
        case "table":
            return <TableSkeleton rows={count} />;
        case "grid":
            return <AppGridSkeleton count={count} />;
        case "page":
            return (
                <div className={cn("space-y-6 p-4", className)}>
                    <Skeleton className="h-8 w-1/3" />
                    <div className="space-y-4">
                        {Array.from({ length: count }).map((_, i) => (
                            <Skeleton key={i} className="h-20 w-full rounded-lg" />
                        ))}
                    </div>
                </div>
            );
        case "text":
        default:
            return (
                <div className={cn("space-y-2", className)}>
                    {Array.from({ length: count }).map((_, i) => (
                        <Skeleton
                            key={i}
                            className="h-4 w-[var(--skeleton-width)]"
                            style={{ '--skeleton-width': `${60 + Math.random() * 40}%` } as React.CSSProperties}
                        />
                    ))}
                </div>
            );
    }
}

/**
 * Inline spinner for buttons
 */
export function ButtonSpinner({ className }: { className?: string }) {
    return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}

/**
 * Full page loading overlay
 */
export function PageLoader({ text = "Cargando..." }: { text?: string }) {
    return (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{text}</p>
            </div>
        </div>
    );
}

/**
 * Inline loading text with spinner
 */
export function InlineLoader({ text }: { text: string }) {
    return (
        <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-sm">{text}</span>
        </span>
    );
}

export default LoadingState;
