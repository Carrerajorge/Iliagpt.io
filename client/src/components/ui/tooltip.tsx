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

export function TooltipProvider({ children }: WrapperProps) {
  return <>{children}</>;
}

export function Tooltip({ children }: WrapperProps) {
  return <>{children}</>;
}

export function TooltipTrigger({ children }: WrapperProps & { asChild?: boolean }) {
  return <>{children}</>;
}

export const TooltipContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function TooltipContent(_props, _ref) {
    return null;
  }
);

