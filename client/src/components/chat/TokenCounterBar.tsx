/**
 * TokenCounterBar — Thin progress bar showing token usage
 *
 * Renders below the chat input. Hidden when text is empty.
 * Colors: green (<50%), amber (50-80%), red (>80%).
 * Shows token count on hover.
 */

import React, { useState } from "react";
import { useTokenCounter, type TokenCounterResult } from "@/hooks/use-token-counter";

interface TokenCounterBarProps {
  text: string;
  model?: string;
  className?: string;
}

export function TokenCounterBar({ text, model, className = "" }: TokenCounterBarProps) {
  const counter = useTokenCounter(text, model);
  const [showTooltip, setShowTooltip] = useState(false);

  // Hide when empty
  if (!text || counter.tokens === 0) return null;

  const barColor =
    counter.percentage > 80
      ? "bg-red-500"
      : counter.percentage > 50
        ? "bg-amber-500"
        : "bg-emerald-500";

  const barWidth = Math.min(counter.percentage, 100);

  return (
    <div
      className={`relative w-full h-1.5 bg-zinc-800/50 rounded-full overflow-hidden transition-opacity duration-200 ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className={`h-full ${barColor} transition-all duration-300 ease-out rounded-full`}
        style={{ width: `${barWidth}%` }}
      />

      {showTooltip && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-[10px] text-zinc-300 whitespace-nowrap z-50 shadow-lg">
          ~{counter.tokens.toLocaleString()} tokens ({counter.percentage.toFixed(1)}%)
          {counter.overBudget && " — over budget"}
        </div>
      )}
    </div>
  );
}

export default TokenCounterBar;
