import { cn } from "@/lib/utils";

interface SkeletonProps {
    className?: string;
    'aria-label'?: string;
}

// Base skeleton with shimmer effect
function Skeleton({ className, 'aria-label': ariaLabel }: SkeletonProps) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-md bg-muted skeleton-shimmer",
                className
            )}
            role="status"
            aria-label={ariaLabel || "Cargando..."}
            aria-busy="true"
        >
            <span className="sr-only">{ariaLabel || "Cargando..."}</span>
        </div>
    );
}

// Premium skeleton with gradient shimmer
function SkeletonPremium({ className, 'aria-label': ariaLabel }: SkeletonProps) {
    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-md bg-muted",
                className
            )}
            role="status"
            aria-label={ariaLabel || "Cargando..."}
            aria-busy="true"
        >
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <span className="sr-only">{ariaLabel || "Cargando..."}</span>
        </div>
    );
}

// Chat message skeleton
export function SkeletonChatMessage({ isUser = false }: { isUser?: boolean }) {
    return (
        <div className={cn("flex gap-3 p-4", isUser && "flex-row-reverse")}>
            <SkeletonPremium className="h-8 w-8 rounded-full shrink-0" />
            <div className={cn("flex-1 space-y-2", isUser && "flex flex-col items-end")}>
                <SkeletonPremium className="h-4 w-24" />
                <SkeletonPremium className={cn("h-16", isUser ? "w-3/4" : "w-full")} />
            </div>
        </div>
    );
}

// Chat list skeleton (multiple messages)
export function SkeletonChatMessages({ count = 3 }: { count?: number }) {
    return (
        <div className="space-y-2">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonChatMessage key={i} isUser={i % 2 === 1} />
            ))}
        </div>
    );
}

// Sidebar chat item skeleton
export function SkeletonChatItem() {
    return (
        <div className="flex items-center gap-3 px-3 py-2">
            <SkeletonPremium className="h-4 w-4 rounded" />
            <div className="flex-1 space-y-1.5">
                <SkeletonPremium className="h-3.5 w-3/4" />
                <SkeletonPremium className="h-2.5 w-1/2" />
            </div>
        </div>
    );
}

// Sidebar skeleton (full)
export function SkeletonSidebar() {
    return (
        <div className="w-72 border-r bg-sidebar p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <SkeletonPremium className="h-8 w-8 rounded-lg" />
                <SkeletonPremium className="h-8 w-8 rounded-lg" />
            </div>

            {/* Search */}
            <SkeletonPremium className="h-10 w-full rounded-lg" />

            {/* Section header */}
            <SkeletonPremium className="h-3 w-16 mt-4" />

            {/* Chat items */}
            <div className="space-y-1">
                {Array.from({ length: 8 }).map((_, i) => (
                    <SkeletonChatItem key={i} />
                ))}
            </div>
        </div>
    );
}

// Card skeleton
export function SkeletonCard({ hasImage = false }: { hasImage?: boolean }) {
    return (
        <div className="rounded-xl border bg-card p-4 space-y-3 card-hover">
            {hasImage && <SkeletonPremium className="h-32 w-full rounded-lg" />}
            <SkeletonPremium className="h-5 w-3/4" />
            <SkeletonPremium className="h-3 w-full" />
            <SkeletonPremium className="h-3 w-2/3" />
            <div className="flex gap-2 pt-2">
                <SkeletonPremium className="h-8 w-20 rounded-full" />
                <SkeletonPremium className="h-8 w-20 rounded-full" />
            </div>
        </div>
    );
}

// Grid of cards skeleton
export function SkeletonCardGrid({ count = 6, hasImage = true }: { count?: number; hasImage?: boolean }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonCard key={i} hasImage={hasImage} />
            ))}
        </div>
    );
}

// Table skeleton
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
    return (
        <div className="rounded-lg border overflow-hidden">
            {/* Header */}
            <div className="flex gap-4 p-4 bg-muted/50 border-b">
                {Array.from({ length: cols }).map((_, i) => (
                    <SkeletonPremium key={i} className="h-4 flex-1" />
                ))}
            </div>

            {/* Rows */}
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex gap-4 p-4 border-b last:border-0">
                    {Array.from({ length: cols }).map((_, colIndex) => (
                        <SkeletonPremium
                            key={colIndex}
                            className={cn("h-4 flex-1", colIndex === 0 && "w-1/4 flex-none")}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

// Profile skeleton
export function SkeletonProfile() {
    return (
        <div className="flex items-center gap-4">
            <SkeletonPremium className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
                <SkeletonPremium className="h-5 w-32" />
                <SkeletonPremium className="h-3 w-48" />
            </div>
        </div>
    );
}

// Full page skeleton
export function SkeletonPage() {
    return (
        <div className="min-h-screen flex">
            <SkeletonSidebar />
            <div className="flex-1 p-8 space-y-6">
                <SkeletonProfile />
                <SkeletonPremium className="h-10 w-full max-w-2xl rounded-xl" />
                <SkeletonCardGrid count={3} />
            </div>
        </div>
    );
}

// Input skeleton
export function SkeletonInput() {
    return (
        <div className="space-y-2">
            <SkeletonPremium className="h-3 w-20" />
            <SkeletonPremium className="h-10 w-full rounded-lg" />
        </div>
    );
}

// Form skeleton
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
    return (
        <div className="space-y-6">
            {Array.from({ length: fields }).map((_, i) => (
                <SkeletonInput key={i} />
            ))}
            <SkeletonPremium className="h-10 w-32 rounded-lg" />
        </div>
    );
}

// Dashboard metrics skeleton
export function SkeletonDashboardMetrics({ count = 4 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" role="status" aria-label="Cargando métricas">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <SkeletonPremium className="h-9 w-9 rounded-md" />
                        <SkeletonPremium className="h-4 w-20" />
                    </div>
                    <SkeletonPremium className="h-8 w-24" />
                    <SkeletonPremium className="h-3 w-32" />
                </div>
            ))}
            <span className="sr-only">Cargando métricas del dashboard</span>
        </div>
    );
}

// Code editor skeleton
export function SkeletonCodeEditor({ lines = 15 }: { lines?: number }) {
    return (
        <div className="rounded-lg border bg-[#1e1e1e] p-4 space-y-2 font-mono" role="status" aria-label="Cargando editor de código">
            {/* Line numbers + code */}
            {Array.from({ length: lines }).map((_, i) => (
                <div key={i} className="flex gap-4">
                    <SkeletonPremium className="h-4 w-6 bg-gray-700" />
                    <SkeletonPremium
                        className={cn(
                            "h-4 bg-gray-700",
                            i % 3 === 0 ? "w-3/4" : i % 2 === 0 ? "w-1/2" : "w-2/3"
                        )}
                    />
                </div>
            ))}
            <span className="sr-only">Cargando editor de código</span>
        </div>
    );
}

// Spreadsheet skeleton
export function SkeletonSpreadsheet({ rows = 10, cols = 6 }: { rows?: number; cols?: number }) {
    return (
        <div className="rounded-lg border overflow-hidden" role="status" aria-label="Cargando hoja de cálculo">
            {/* Column headers */}
            <div className="flex border-b bg-muted/30">
                <div className="w-10 h-8 border-r" />
                {Array.from({ length: cols }).map((_, i) => (
                    <div key={i} className="flex-1 min-w-[100px] h-8 border-r flex items-center justify-center">
                        <SkeletonPremium className="h-4 w-8" />
                    </div>
                ))}
            </div>

            {/* Rows */}
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex border-b last:border-0">
                    <div className="w-10 h-8 border-r bg-muted/20 flex items-center justify-center">
                        <SkeletonPremium className="h-3 w-4" />
                    </div>
                    {Array.from({ length: cols }).map((_, colIndex) => (
                        <div key={colIndex} className="flex-1 min-w-[100px] h-8 border-r last:border-0 p-1">
                            <SkeletonPremium className={cn("h-full w-full", (rowIndex + colIndex) % 3 === 0 && "w-3/4")} />
                        </div>
                    ))}
                </div>
            ))}
            <span className="sr-only">Cargando hoja de cálculo</span>
        </div>
    );
}

// Document editor skeleton
export function SkeletonDocumentEditor() {
    return (
        <div className="rounded-lg border bg-white overflow-hidden" role="status" aria-label="Cargando editor de documentos">
            {/* Toolbar */}
            <div className="flex items-center gap-2 p-2 border-b bg-muted/20">
                {Array.from({ length: 8 }).map((_, i) => (
                    <SkeletonPremium key={i} className="h-8 w-8 rounded" />
                ))}
                <div className="flex-1" />
                {Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonPremium key={i} className="h-8 w-8 rounded" />
                ))}
            </div>

            {/* Document content */}
            <div className="p-8 space-y-4 max-w-3xl mx-auto">
                <SkeletonPremium className="h-8 w-2/3" />
                <div className="space-y-2">
                    <SkeletonPremium className="h-4 w-full" />
                    <SkeletonPremium className="h-4 w-full" />
                    <SkeletonPremium className="h-4 w-4/5" />
                </div>
                <div className="space-y-2 pt-4">
                    <SkeletonPremium className="h-4 w-full" />
                    <SkeletonPremium className="h-4 w-3/4" />
                </div>
            </div>
            <span className="sr-only">Cargando editor de documentos</span>
        </div>
    );
}

// List item skeleton
export function SkeletonListItem() {
    return (
        <div className="flex items-center gap-3 p-3 border-b last:border-0">
            <SkeletonPremium className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
                <SkeletonPremium className="h-4 w-1/3" />
                <SkeletonPremium className="h-3 w-2/3" />
            </div>
            <SkeletonPremium className="h-8 w-20 rounded" />
        </div>
    );
}

// Virtualized list skeleton
export function SkeletonVirtualizedList({ itemCount = 10 }: { itemCount?: number }) {
    return (
        <div className="rounded-lg border overflow-hidden" role="status" aria-label="Cargando lista">
            {Array.from({ length: itemCount }).map((_, i) => (
                <SkeletonListItem key={i} />
            ))}
            <span className="sr-only">Cargando lista</span>
        </div>
    );
}

// Navigation skeleton
export function SkeletonNavigation() {
    return (
        <nav className="flex items-center gap-4 p-4 border-b" role="status" aria-label="Cargando navegación">
            <SkeletonPremium className="h-8 w-8 rounded" />
            <SkeletonPremium className="h-4 w-24" />
            <div className="flex-1" />
            <div className="flex items-center gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonPremium key={i} className="h-8 w-16 rounded" />
                ))}
            </div>
            <SkeletonPremium className="h-8 w-8 rounded-full" />
            <span className="sr-only">Cargando navegación</span>
        </nav>
    );
}

export { Skeleton, SkeletonPremium };
