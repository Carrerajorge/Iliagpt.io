"use client";

import * as React from "react";

/**
 * React 19 compatibility: Radix Tooltip currently triggers a "Maximum update depth exceeded"
 * loop in this codebase (ref -> setState churn) when the app re-renders (e.g. switching models).
 *
 * For now we intentionally disable tooltips (no-op components) to keep the UI stable.
 * If we want tooltips back, replace this with a non-Radix implementation or a fixed Radix version.
 */

type WrapperProps = { children: React.ReactNode };

type TooltipSide = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

type TooltipProviderProps = WrapperProps & {
  delayDuration?: number;
  skipDelayDuration?: number;
  disableHoverableContent?: boolean;
};

type TooltipProps = WrapperProps & {
  delayDuration?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type TooltipTriggerProps = WrapperProps & { asChild?: boolean };

type TooltipContentProps = React.HTMLAttributes<HTMLDivElement> & {
  side?: TooltipSide;
  align?: TooltipAlign;
  sideOffset?: number;
  avoidCollisions?: boolean;
  collisionPadding?: number;
};

export function TooltipProvider({ children }: TooltipProviderProps) {
  return <>{children}</>;
}

export function Tooltip({ children }: TooltipProps) {
  return <>{children}</>;
}

export function TooltipTrigger({ children }: TooltipTriggerProps) {
  return <>{children}</>;
}

export const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  function TooltipContent(_props, _ref) {
    return null;
  }
);
