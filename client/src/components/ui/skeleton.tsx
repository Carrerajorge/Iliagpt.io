import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  )
}

function EmailItemSkeleton() {
  return (
    <div className="p-3 flex items-start gap-3">
      <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  )
}

function EmailListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y divide-red-100 dark:divide-red-900/30">
      {Array.from({ length: count }).map((_, i) => (
        <EmailItemSkeleton key={i} />
      ))}
    </div>
  )
}

function AppCardSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
      <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-full max-w-[180px]" />
      </div>
      <Skeleton className="h-4 w-4 rounded-full" />
    </div>
  )
}

function AppGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <AppCardSkeleton key={i} />
      ))}
    </div>
  )
}

function ChatMessageSkeleton({ isUser = false }: { isUser?: boolean }) {
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] space-y-2">
          <Skeleton className="h-10 w-48 rounded-2xl ml-auto" />
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex gap-3">
      <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2 max-w-[70%]">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </div>
  )
}

function ChatMessagesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <ChatMessageSkeleton key={i} isUser={i % 2 === 0} />
      ))}
    </div>
  )
}

function ThreadMessageSkeleton() {
  return (
    <div className="p-3 rounded-lg border border-border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="w-8 h-8 rounded-full" />
          <div className="space-y-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="pl-10 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    </div>
  )
}

function ThreadSkeleton({ messageCount = 3 }: { messageCount?: number }) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-2/3" />
      {Array.from({ length: messageCount }).map((_, i) => (
        <ThreadMessageSkeleton key={i} />
      ))}
    </div>
  )
}

function ConnectionStatusSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="w-12 h-12 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-muted/50 p-3 flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="p-3 flex gap-4 border-t border-border">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export { 
  Skeleton,
  EmailItemSkeleton,
  EmailListSkeleton,
  AppCardSkeleton,
  AppGridSkeleton,
  ChatMessageSkeleton,
  ChatMessagesSkeleton,
  ThreadMessageSkeleton,
  ThreadSkeleton,
  ConnectionStatusSkeleton,
  CardSkeleton,
  TableSkeleton
}
