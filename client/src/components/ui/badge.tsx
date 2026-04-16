import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // @replit
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate ",
  {
    variants: {
      variant: {
        default:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary:
          // @replit no hover because we use hover-elevate
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",
          // @replit shadow-xs" - use badge outline variable
        outline: "text-foreground border [border-color:var(--badge-outline)]",
        success:
          "border-transparent bg-green-600 text-white shadow-xs",
        warning:
          "border-transparent bg-amber-500 text-amber-950 shadow-xs",
        info:
          "border-transparent bg-blue-600 text-white shadow-xs",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  pulse?: boolean;
  dot?: boolean;
}

function Badge({ className, variant, pulse = false, dot = false, children, ...props }: BadgeProps) {
  return (
    <div 
      className={cn(
        badgeVariants({ variant }), 
        pulse && "animate-pulse",
        className
      )} 
      data-testid={`badge-${variant || 'default'}`}
      {...props} 
    >
      {dot && (
        <span className={cn(
          "w-1.5 h-1.5 rounded-full mr-1.5",
          variant === "success" && "bg-green-400",
          variant === "warning" && "bg-amber-400",
          variant === "destructive" && "bg-red-400",
          variant === "info" && "bg-blue-400",
          (!variant || variant === "default") && "bg-primary-foreground/70",
          pulse && "animate-ping"
        )} />
      )}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
