import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    data-testid="tabs-list"
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    value={value}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className
    )}
    data-testid={`tabs-trigger-${value}`}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

interface TabsContentLoadingProps {
  className?: string
}

const TabsContentLoading: React.FC<TabsContentLoadingProps> = ({ className }) => (
  <div 
    className={cn("mt-2 space-y-3", className)} 
    data-testid="tabs-content-loading"
  >
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-4 w-1/2" />
    <Skeleton className="h-4 w-2/3" />
  </div>
)

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, value, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    value={value}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    data-testid={`tabs-content-${value}`}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

interface LazyTabsContentProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> {
  loadingFallback?: React.ReactNode
}

function LazyTabsContentInner({ 
  value, 
  children, 
  loadingFallback 
}: { 
  value: string
  children: React.ReactNode
  loadingFallback?: React.ReactNode 
}) {
  const [hasBeenActive, setHasBeenActive] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  
  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    const parentContent = container.closest('[data-state]')
    if (parentContent?.getAttribute('data-state') === 'active') {
      setHasBeenActive(true)
    }
  }, [])
  
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    const parentContent = container.closest('[data-state]')
    if (!parentContent) return
    
    const observer = new MutationObserver(() => {
      if (parentContent.getAttribute('data-state') === 'active' && !hasBeenActive) {
        setHasBeenActive(true)
      }
    })
    
    observer.observe(parentContent, { attributes: true, attributeFilter: ['data-state'] })
    return () => observer.disconnect()
  }, [hasBeenActive])
  
  const fallback = loadingFallback || <TabsContentLoading />
  
  return (
    <div ref={containerRef} data-lazy-content={value} data-mounted={hasBeenActive}>
      {hasBeenActive ? children : fallback}
    </div>
  )
}

const LazyTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  LazyTabsContentProps
>(({ className, value, children, loadingFallback, ...props }, ref) => {
  return (
    <TabsPrimitive.Content
      ref={ref}
      value={value}
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      data-testid={`lazy-tabs-content-${value}`}
      forceMount
      {...props}
    >
      <LazyTabsContentInner value={value || ''} loadingFallback={loadingFallback}>
        {children}
      </LazyTabsContentInner>
    </TabsPrimitive.Content>
  )
})
LazyTabsContent.displayName = "LazyTabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent, LazyTabsContent, TabsContentLoading }
